import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Figure, Prop, BODY_TYPES, PROP_SHAPES, JOINT_LABELS, deserialize, uid } from './objects.js';
import { MODELS, loadModel, loadSceneModels, importModel, restoreImported } from './models.js';
import { POSES } from './poses.js';
import { IK_CHAINS, solveCCD } from './ik.js';
import { HAND_PRESETS, handRot, readHand } from './hands.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const LS_SCENE = 'posetool-scene';
const LS_ENV = 'posetool-env';
const LS_POSES = 'posetool-poses';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const loadJSON = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };

// ================================================================ renderer & scene

const viewport = $('#viewport');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
} catch (e) {
  viewport.innerHTML = '<div class="fatal">WebGL is not available in this browser, so the 3D view cannot start.</div>';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
camera.position.set(1.8, 1.6, 3.4);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.95, 0);
orbit.enableDamping = true;
orbit.update();

const hemi = new THREE.HemisphereLight(0xffffff, 0x50555e, 1);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 30 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(hemi, sun, sun.target);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.28 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(20, 40, 0x6a707b, 0x41464f);
scene.add(grid);

const content = new THREE.Group();
scene.add(content);

const ikTarget = new THREE.Object3D();
scene.add(ikTarget);

const env = Object.assign(
  { bg: '#3a3f47', lightAz: 35, lightEl: 55, lightInt: 2.4, ambient: 1.0, shadows: true, grid: true, fov: 45, transparent: false },
  loadJSON(LS_ENV, {}),
);

function applyEnv() {
  scene.background = new THREE.Color(env.bg);
  const az = env.lightAz * D2R, el = env.lightEl * D2R, r = 10;
  sun.position.set(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az));
  sun.intensity = env.lightInt;
  sun.castShadow = env.shadows;
  floor.visible = env.shadows;
  hemi.intensity = env.ambient;
  grid.visible = env.grid && !previewMode;
  camera.fov = env.fov;
  camera.updateProjectionMatrix();
  localStorage.setItem(LS_ENV, JSON.stringify(env));
}

// ================================================================ transform gizmo

const tc = new TransformControls(camera, renderer.domElement);
tc.setSize(0.9);
const tcHelper = tc.getHelper();
scene.add(tcHelper);

tc.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (!e.value) {
    if (ikEffector && sel?.joint) sel.joint.getWorldPosition(ikTarget.position);
    commit();
  }
});
tc.addEventListener('objectChange', () => {
  if (ikEffector && sel) solveCCD(sel.owner, ikEffector, ikTarget.position);
  updatePanelValues();
});

// ================================================================ state

const objects = []; // Figure | Prop
let sel = null; // { owner, joint }
let hover = null;
let mode = 'rotate'; // rotate | move | ik | scale
let jointSpace = 'local';
let ikEffector = null;
let previewMode = false;
let handSide = 'both';

function addObject(o) {
  objects.push(o);
  content.add(o.root);
  return o;
}

function removeObject(o) {
  const i = objects.indexOf(o);
  if (i >= 0) objects.splice(i, 1);
  content.remove(o.root);
  o.dispose();
}

function clearObjects() {
  tc.detach();
  while (objects.length) removeObject(objects[0]);
}

function freeSpot() {
  for (let i = 0; i < 40; i++) {
    const x = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.8;
    if (!objects.some((o) => Math.abs(o.root.position.x - x) < 0.5 && Math.abs(o.root.position.z) < 0.5)) return x;
  }
  return 0;
}

// ================================================================ selection & highlight

const selMat = new THREE.MeshStandardMaterial({ color: 0xffa640, emissive: 0x6a3500, roughness: 0.5 });
const hoverMat = new THREE.MeshStandardMaterial({ color: 0xffe0b8, emissive: 0x2a1a00, roughness: 0.55 });

function applyHighlights() {
  for (const o of objects) {
    if (o.kind === 'prop') {
      o.setHighlight(previewMode ? null : sel?.owner === o ? 'select' : hover?.owner === o ? 'hover' : null);
      continue;
    }
    if (o.rig) {
      const pick = (h) => (!previewMode && h?.owner === o ? h.joint?.name ?? null : null);
      o.rig.highlight(pick(sel), pick(hover));
      continue;
    }
    for (const m of o.meshes) {
      let mat = m.userData.baseMat;
      if (!previewMode) {
        if (sel?.owner === o && sel.joint === m.userData.joint) mat = selMat;
        else if (hover?.owner === o && hover.joint === m.userData.joint) mat = hoverMat;
      }
      m.material = mat;
    }
  }
}

function select(h) {
  sel = h ? { owner: h.owner, joint: h.joint || null } : null;
  attachGizmo();
  applyHighlights();
  refreshSelPanel();
  updateToolbar();
}

function attachGizmo() {
  ikEffector = null;
  if (!sel || previewMode) return tc.detach();
  const o = sel.owner;
  if (o.kind === 'prop') {
    tc.attach(o.root);
    tc.setMode(mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : 'translate');
    tc.setSpace(mode === 'move' || mode === 'ik' ? 'world' : 'local');
    return;
  }
  const name = sel.joint.name;
  if (mode === 'move' || (mode === 'ik' && name === 'hips')) {
    tc.attach(o.joints.hips);
    tc.setMode('translate');
    tc.setSpace('world');
    return;
  }
  if (mode === 'ik' && IK_CHAINS[name]) {
    ikEffector = name;
    sel.joint.getWorldPosition(ikTarget.position);
    tc.attach(ikTarget);
    tc.setMode('translate');
    tc.setSpace('world');
    return;
  }
  tc.attach(sel.joint);
  tc.setMode('rotate');
  tc.setSpace(jointSpace);
}

function setMode(m) {
  mode = m;
  attachGizmo();
  updateToolbar();
}

// ================================================================ picking

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function hitTest(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  for (const h of raycaster.intersectObjects(content.children, true)) {
    const u = h.object.userData;
    if (u.owner) return { owner: u.owner, joint: u.owner.rig?.pickJoint(h) ?? u.joint ?? null };
  }
  return null;
}

let down = null;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (ev) => {
  down = { x: ev.clientX, y: ev.clientY, gizmo: tc.axis !== null, button: ev.button };
});
canvas.addEventListener('pointerup', (ev) => {
  if (!down) return;
  const d = down;
  down = null;
  if (d.button !== 0 || d.gizmo || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 5 || previewMode) return;
  select(hitTest(ev));
});
canvas.addEventListener('pointermove', (ev) => {
  if (ev.buttons || previewMode) return;
  const h = tc.axis !== null ? null : hitTest(ev);
  if (h?.owner !== hover?.owner || h?.joint !== hover?.joint) {
    hover = h;
    canvas.style.cursor = h ? 'pointer' : '';
    applyHighlights();
  }
});
canvas.addEventListener('dblclick', (ev) => {
  const h = hitTest(ev);
  if (!h) return;
  if (h.joint) h.joint.rotation.set(0, 0, 0);
  else h.owner.root.rotation.set(0, 0, 0);
  if (ikEffector && sel?.joint) sel.joint.getWorldPosition(ikTarget.position);
  commit();
  updatePanelValues();
});

// ================================================================ history

const history = { stack: [], index: -1 };

const snapshot = () => JSON.stringify({ version: 1, objects: objects.map((o) => o.serialize()) });

function commit() {
  const s = snapshot();
  if (history.stack[history.index] === s) return;
  history.stack.splice(history.index + 1);
  history.stack.push(s);
  if (history.stack.length > 150) history.stack.shift();
  history.index = history.stack.length - 1;
  localStorage.setItem(LS_SCENE, s);
  updateToolbar();
}

function loadScene(json) {
  const keep = sel && { id: sel.owner.id, joint: sel.joint?.name };
  clearObjects();
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  for (const d of data.objects || []) addObject(deserialize(d));
  const owner = keep && objects.find((o) => o.id === keep.id);
  hover = null;
  select(owner ? { owner, joint: keep.joint ? owner.joints[keep.joint] : null } : null);
}

function undo() {
  if (history.index <= 0) return;
  history.index--;
  loadScene(history.stack[history.index]);
  localStorage.setItem(LS_SCENE, history.stack[history.index]);
  updateToolbar();
}

function redo() {
  if (history.index >= history.stack.length - 1) return;
  history.index++;
  loadScene(history.stack[history.index]);
  localStorage.setItem(LS_SCENE, history.stack[history.index]);
  updateToolbar();
}

// ================================================================ actions

function currentFigure() {
  if (sel?.owner.kind === 'figure') return sel.owner;
  const figs = objects.filter((o) => o.kind === 'figure');
  return figs.length === 1 ? figs[0] : null;
}

async function addFigure(type, model = null) {
  if (model) {
    try { await loadModel(model); } catch (err) { return alert('Could not load the model: ' + err.message); }
  }
  const f = addObject(new Figure({ type, model }));
  f.root.position.x = freeSpot();
  f.setPose(POSES.Stand);
  select({ owner: f, joint: f.joints.chest });
  commit();
}

function addProp(shape) {
  const p = addObject(new Prop({ shape }));
  p.root.position.set(freeSpot(), 0, 0.6);
  select({ owner: p });
  commit();
}

function applyPose(pose) {
  const f = currentFigure();
  if (!f) return alert('Select a figure first.');
  f.setPose(pose);
  if (ikEffector && sel?.joint) sel.joint.getWorldPosition(ikTarget.position);
  commit();
  updatePanelValues();
}

function duplicate() {
  if (!sel) return;
  const d = sel.owner.serialize();
  d.id = uid();
  d.pos = [d.pos[0] + 0.7, d.pos[1], d.pos[2]];
  const o = addObject(deserialize(d));
  select({ owner: o, joint: sel.joint ? o.joints?.[sel.joint.name] : null });
  commit();
}

function del() {
  if (!sel) return;
  const o = sel.owner;
  select(null);
  removeObject(o);
  commit();
}

function setView(name) {
  const dirs = {
    front: [0, 0.15, 1], back: [0, 0.15, -1], left: [1, 0.15, 0], right: [-1, 0.15, 0],
    top: [0, 1, 0.001], three4: [0.6, 0.35, 1],
  };
  const dist = camera.position.distanceTo(orbit.target);
  const dir = new THREE.Vector3(...dirs[name]).normalize();
  camera.position.copy(orbit.target).addScaledVector(dir, dist);
  orbit.update();
}

function focusSelection() {
  const box = new THREE.Box3();
  if (sel) box.setFromObject(sel.owner.root);
  else for (const o of objects) box.expandByObject(o.root);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  if (sel?.joint && sel.joint.name !== 'hips') sel.joint.getWorldPosition(c);
  const size = box.getSize(new THREE.Vector3()).length();
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, Math.max(size * 1.3, 1.2));
  orbit.update();
}

function setPreview(on) {
  previewMode = on;
  document.body.classList.toggle('preview', on);
  hover = null;
  attachGizmo();
  applyHighlights();
  applyEnv();
}

function exportPNG() {
  const wasPreview = previewMode;
  if (!wasPreview) setPreview(true);
  const bg = scene.background;
  if (env.transparent) scene.background = null;
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.background = bg;
  if (!wasPreview) setPreview(false);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pose-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  a.click();
}

function saveScene() {
  const blob = new Blob([JSON.stringify({ ...JSON.parse(snapshot()), env }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pose-scene.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.env) { Object.assign(env, data.env); applyEnv(); renderScenePanel(); }
    await loadSceneModels(data);
    sel = null;
    loadScene(data);
    commit();
  } catch (err) {
    alert('Could not open that file: ' + err.message);
  }
});

function newScene() {
  if (!confirm('Start a new scene? Unsaved changes stay available via Undo.')) return;
  clearObjects();
  select(null);
  addFigure('male');
}

const actions = {
  undo, redo, duplicate, delete: del,
  focus: focusSelection,
  preview: () => setPreview(!previewMode),
  png: exportPNG,
  save: saveScene,
  open: () => $('#file-input').click(),
  new: newScene,
};

// ================================================================ toolbar

$('#menu-figure').innerHTML =
  '<div class="menu-sub">Mannequin</div>' +
  Object.entries(BODY_TYPES).map(([k, v]) => `<button data-figure="${k}">${v.label}</button>`).join('') +
  '<div class="menu-sub">Detailed (Xbot)</div>' +
  Object.entries(BODY_TYPES).map(([k, v]) => `<button data-figure="${k}" data-model="xbot">${v.label}</button>`).join('');
$('#menu-prop').innerHTML = Object.entries(PROP_SHAPES).map(([k, v]) => `<button data-prop="${k}">${v}</button>`).join('');

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const { act, mode: m, view, figure, prop } = b.dataset;
  if (act && actions[act]) actions[act]();
  else if (m) setMode(m);
  else if (view) setView(view);
  else if (figure) addFigure(figure, b.dataset.model || null);
  else if (prop) addProp(prop);
  else return;
  if (b.closest('.menu')) document.activeElement?.blur();
});

function updateToolbar() {
  $$('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $$('[data-act="undo"]').forEach((b) => (b.disabled = history.index <= 0));
  $$('[data-act="redo"]').forEach((b) => (b.disabled = history.index >= history.stack.length - 1));
  $$('[data-act="duplicate"], [data-act="delete"]').forEach((b) => (b.disabled = !sel));
}

// ================================================================ side panel: selection

const selPanel = $('#sel-panel');

function axisRows() {
  return ['X', 'Y', 'Z'].map((a, i) => `
    <div class="row axis"><span>${a}</span>
      <input type="range" min="-180" max="180" step="1" data-axis="${i}">
      <input type="number" min="-180" max="180" step="1" data-axisnum="${i}">
    </div>`).join('');
}

function refreshSelPanel() {
  if (!sel) {
    selPanel.innerHTML = `<p class="hint">Click a body part to pose it, or a prop to move it.<br>
      <b>R</b> rotate · <b>T</b> move · <b>I</b> IK drag · <b>S</b> scale<br>
      <b>F</b> focus · <b>P</b> preview · <b>Del</b> delete · <b>Ctrl+Z / Ctrl+Y</b> undo/redo</p>`;
    return;
  }
  const o = sel.owner;
  let html = '';
  if (o.kind === 'figure') {
    if (sel.joint) {
      const ik = IK_CHAINS[sel.joint.name] ? ' · IK handle' : '';
      html += `<div class="block">
        <div class="block-title">${JOINT_LABELS[sel.joint.name]} <small>joint${ik}</small></div>
        ${axisRows()}
        <div class="row btns">
          <button data-p="reset-joint">Reset joint</button>
          <button data-p="space">Gizmo: ${jointSpace}</button>
        </div></div>`;
    }
    html += `<div class="block">
      <div class="block-title">${o.label}</div>
      <div class="row"><span>Model</span><select data-p="model">
        <option value="">Sculpted mannequin</option>
        ${Object.entries(MODELS).map(([k, v]) => `<option value="${k}" ${k === o.model ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select></div>
      <div class="row"><span>Body</span><select data-p="type">
        ${Object.entries(BODY_TYPES).map(([k, v]) => `<option value="${k}" ${k === o.type ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select></div>
      <div class="row"><span>Color</span><input type="color" data-p="color" value="${o.color}"></div>
      <div class="row btns">
        <button data-p="mirror">Mirror pose</button>
        <button data-p="reset-pose">Reset pose</button>
        <button data-p="floor">Drop to floor</button>
        <button data-p="hips">Select hips</button>
        <button data-p="import-model" title="Load a Mixamo-rigged GLB in T-pose">Import model…</button>
      </div></div>`;
    const jn = sel.joint?.name || '';
    if (jn.startsWith('l_') || jn.startsWith('r_')) handSide = jn[0];
    html += `<div class="block">
      <div class="block-title">Hands</div>
      <div class="row"><span>Hand</span><select data-p="hand-side">
        ${[['l', 'Left'], ['r', 'Right'], ['both', 'Both']].map(([v, l]) => `<option value="${v}" ${v === handSide ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
      <div class="row"><span>Curl</span><input type="range" min="-0.2" max="1" step="0.01" data-hand="curl"></div>
      <div class="row"><span>Spread</span><input type="range" min="-0.5" max="1.5" step="0.01" data-hand="spread"></div>
      <div class="row"><span>Thumb</span><input type="range" min="-0.5" max="1" step="0.01" data-hand="thumb"></div>
      <div class="row btns">${Object.keys(HAND_PRESETS).map((k) => `<button data-handpreset="${k}">${k}</button>`).join('')}</div>
      </div>`;
  } else {
    html += `<div class="block">
      <div class="block-title">${o.label} <small>prop</small></div>
      <div class="row"><span>Color</span><input type="color" data-p="color" value="${o.color}"></div>
      <div class="row"><span>Size</span><input type="range" min="0.1" max="5" step="0.05" data-p="scale"></div>
      <div class="sub">Rotation</div>
      ${axisRows()}
      <div class="row btns">
        <button data-p="floor">Drop to floor</button>
        <button data-p="reset-rot">Reset rotation</button>
      </div></div>`;
  }
  selPanel.innerHTML = html;
  updatePanelValues();
}

function rotTarget() {
  return sel?.joint || (sel?.owner.kind === 'prop' ? sel.owner.root : null);
}

function updatePanelValues() {
  const t = rotTarget();
  if (t) {
    const r = [t.rotation.x, t.rotation.y, t.rotation.z].map((v) => Math.round(v * R2D));
    $$('[data-axis]', selPanel).forEach((el) => { el.value = r[el.dataset.axis]; });
    $$('[data-axisnum]', selPanel).forEach((el) => { if (document.activeElement !== el) el.value = r[el.dataset.axisnum]; });
  }
  const sc = $('[data-p="scale"]', selPanel);
  if (sc && sel?.owner.kind === 'prop') sc.value = sel.owner.root.scale.x;
  if (sel?.owner.kind === 'figure') {
    const h = readHand(sel.owner, handSide === 'r' ? 'r' : 'l');
    $$('[data-hand]', selPanel).forEach((el) => { el.value = h[el.dataset.hand]; });
  }
}

function shapeHands(figure, shape) {
  const sides = handSide === 'both' ? ['l', 'r'] : [handSide];
  for (const p of sides) figure.setPose({ rot: handRot(p, shape) }, false);
}

selPanel.addEventListener('input', (e) => {
  const el = e.target;
  const t = rotTarget();
  const axis = el.dataset.axis ?? el.dataset.axisnum;
  if (axis !== undefined && t) {
    const v = THREE.MathUtils.clamp(Number(el.value) || 0, -180, 180) * D2R;
    t.rotation[['x', 'y', 'z'][axis]] = v;
    if (ikEffector && sel?.joint) sel.joint.getWorldPosition(ikTarget.position);
    updatePanelValues();
  } else if (el.dataset.hand) {
    const shape = {};
    $$('[data-hand]', selPanel).forEach((s) => { shape[s.dataset.hand] = Number(s.value); });
    shapeHands(sel.owner, shape);
  } else if (el.dataset.p === 'color') {
    sel.owner.setColor(el.value);
  } else if (el.dataset.p === 'scale') {
    sel.owner.root.scale.setScalar(Number(el.value));
  }
});

selPanel.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.p === 'hand-side') {
    handSide = el.value;
    return updatePanelValues();
  }
  if (el.dataset.p === 'type') return rebuildFigure(sel.owner, { type: el.value });
  if (el.dataset.p === 'model') return rebuildFigure(sel.owner, { model: el.value || null });
  commit();
});

/** Replace a figure with a copy that has a different body type or model, keeping its pose. */
async function rebuildFigure(old, changes) {
  if (changes.model) {
    try { await loadModel(changes.model); } catch (err) { refreshSelPanel(); return alert('Could not load the model: ' + err.message); }
  }
  const d = { ...old.serialize(), ...changes };
  if (!d.model) delete d.model;
  const f = deserialize(d);
  const jointName = sel?.owner === old ? sel.joint?.name : null;
  objects.splice(objects.indexOf(old), 1, f);
  content.remove(old.root);
  old.dispose();
  content.add(f.root);
  select({ owner: f, joint: jointName ? f.joints[jointName] : null });
  commit();
}

const modelInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.glb,model/gltf-binary', hidden: true });
document.body.append(modelInput);
modelInput.addEventListener('change', async () => {
  const file = modelInput.files[0];
  modelInput.value = '';
  if (!file) return;
  try {
    const key = await importModel(file);
    const fig = currentFigure();
    if (fig) await rebuildFigure(fig, { model: key });
    else await addFigure('male', key);
  } catch (err) {
    alert('Could not import that model: ' + err.message);
  }
});

selPanel.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn?.dataset.handpreset && sel) {
    shapeHands(sel.owner, HAND_PRESETS[btn.dataset.handpreset]);
    updatePanelValues();
    return commit();
  }
  const p = btn?.dataset.p;
  if (!p || !sel) return;
  const o = sel.owner;
  if (p === 'import-model') return modelInput.click();
  switch (p) {
    case 'reset-joint': sel.joint.rotation.set(0, 0, 0); break;
    case 'space':
      jointSpace = jointSpace === 'local' ? 'world' : 'local';
      attachGizmo();
      refreshSelPanel();
      return;
    case 'mirror': o.mirrorPose(); break;
    case 'reset-pose': o.setPose({ rot: {} }); break;
    case 'floor': o.dropToFloor(); break;
    case 'reset-rot': o.root.rotation.set(0, 0, 0); break;
    case 'hips': select({ owner: o, joint: o.joints.hips }); return;
  }
  if (ikEffector && sel.joint) sel.joint.getWorldPosition(ikTarget.position);
  updatePanelValues();
  commit();
});

// ================================================================ side panel: poses

const posePanel = $('#pose-panel');

function renderPosePanel() {
  const custom = loadJSON(LS_POSES, {});
  posePanel.innerHTML = `
    <div class="pose-grid">${Object.keys(POSES).map((n) => `<button data-pose="${n}">${n}</button>`).join('')}</div>
    <div class="sub">My poses</div>
    <div class="pose-grid">
      ${Object.keys(custom).map((n) => `<button data-custom="${encodeURIComponent(n)}">${n.replace(/</g, '&lt;')}<span class="del" data-delpose="${encodeURIComponent(n)}">×</span></button>`).join('')}
    </div>
    <div class="row btns" style="margin-top:8px"><button data-savepose>Save current pose…</button></div>`;
}

posePanel.addEventListener('click', (e) => {
  const custom = loadJSON(LS_POSES, {});
  const t = e.target;
  if (t.dataset.delpose) {
    e.stopPropagation();
    const n = decodeURIComponent(t.dataset.delpose);
    if (!confirm(`Delete pose "${n}"?`)) return;
    delete custom[n];
    localStorage.setItem(LS_POSES, JSON.stringify(custom));
    return renderPosePanel();
  }
  const b = t.closest('button');
  if (!b) return;
  if (b.dataset.pose) applyPose(POSES[b.dataset.pose]);
  else if (b.dataset.custom) applyPose(custom[decodeURIComponent(b.dataset.custom)]);
  else if ('savepose' in b.dataset) {
    const f = currentFigure();
    if (!f) return alert('Select a figure first.');
    const name = prompt('Name this pose:');
    if (!name) return;
    custom[name.trim()] = f.getPose();
    localStorage.setItem(LS_POSES, JSON.stringify(custom));
    renderPosePanel();
  }
});

// ================================================================ side panel: scene

const scenePanel = $('#scene-panel');

function renderScenePanel() {
  const range = (k, label, min, max, step) =>
    `<div class="row"><span>${label}</span><input type="range" data-env="${k}" min="${min}" max="${max}" step="${step}" value="${env[k]}"></div>`;
  const check = (k, label) =>
    `<div class="row"><span>${label}</span><input type="checkbox" data-env="${k}" ${env[k] ? 'checked' : ''}></div>`;
  scenePanel.innerHTML = `
    <div class="sub">Light</div>
    ${range('lightAz', 'Direction', -180, 180, 1)}
    ${range('lightEl', 'Height', 5, 90, 1)}
    ${range('lightInt', 'Intensity', 0, 6, 0.1)}
    ${range('ambient', 'Ambient', 0, 3, 0.05)}
    ${check('shadows', 'Shadows')}
    <div class="sub">View</div>
    <div class="row"><span>Background</span><input type="color" data-env="bg" value="${env.bg}"></div>
    ${check('grid', 'Grid')}
    ${range('fov', 'Lens (FOV)', 10, 150, 1)}
    ${check('transparent', 'PNG: transparent')}`;
}

// Dolly zoom: move the camera so the orbit target keeps its on-screen size while the
// lens angle changes. Wide angles then pull the camera in close, exaggerating perspective.
function dollyZoom(fromFov, toFov) {
  const half = (f) => Math.tan((f * D2R) / 2);
  const offset = camera.position.clone().sub(orbit.target);
  offset.multiplyScalar(half(fromFov) / half(toFov));
  camera.position.copy(orbit.target).add(offset);
  orbit.update();
}

scenePanel.addEventListener('input', (e) => {
  const k = e.target.dataset.env;
  if (!k) return;
  if (k === 'fov') dollyZoom(env.fov, Number(e.target.value));
  env[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
  applyEnv();
});

// ================================================================ keyboard

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (ctrl && k === 'd') { e.preventDefault(); duplicate(); }
  else if (ctrl) return;
  else if (k === 'delete' || k === 'backspace') del();
  else if (k === 'escape') previewMode ? setPreview(false) : select(null);
  else if (k === 'r') setMode('rotate');
  else if (k === 't' || k === 'g') setMode('move');
  else if (k === 'i') setMode('ik');
  else if (k === 's') setMode('scale');
  else if (k === 'f') focusSelection();
  else if (k === 'p') setPreview(!previewMode);
});

// ================================================================ boot

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);

applyEnv();
renderScenePanel();
renderPosePanel();

resize();

(async () => {
  await restoreImported();
  const saved = localStorage.getItem(LS_SCENE);
  let restored = false;
  if (saved) {
    try {
      await loadSceneModels(JSON.parse(saved));
      loadScene(saved);
      restored = objects.length > 0;
    } catch { clearObjects(); }
  }
  if (restored) commit();
  else await addFigure('male');
  select(null);
})();

renderer.setAnimationLoop(() => {
  orbit.update();
  for (const o of objects) o.rig?.update();
  renderer.render(scene, camera);
});

window.poseTool = { objects, scene, camera, orbit, select }; // handy for debugging in the console
