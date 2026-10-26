// Rigged GLB models for the detailed figure style. Xbot ships with the app; users can
// import any Mixamo-rigged (T-pose) GLB, which is kept in IndexedDB across reloads.

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const MODELS = {
  xbot: { label: 'Xbot (detailed)', url: `${import.meta.env.BASE_URL}models/Xbot.glb` },
};

const loader = new GLTFLoader();
const loaded = new Map(); // key -> gltf
const pending = new Map(); // key -> Promise<gltf>

/** Strip the Mixamo prefix ("mixamorig:", "mixamorig1_", ...) from a bone name. */
export const boneKey = (name) => name.replace(/^mixamorig\d*[:_]?/i, '');

function validate(gltf) {
  let ok = false;
  gltf.scene.traverse((o) => { if (o.isBone && boneKey(o.name) === 'Hips') ok = true; });
  if (!ok) throw new Error('No Mixamo-style skeleton found (expected a "Hips" bone).');
  return gltf;
}

export const getModel = (key) => loaded.get(key);

export function loadModel(key) {
  if (loaded.has(key)) return Promise.resolve(loaded.get(key));
  if (!pending.has(key)) {
    const m = MODELS[key];
    if (!m) return Promise.reject(new Error(`Unknown model "${key}"`));
    const p = (m.buffer ? loader.parseAsync(m.buffer, '') : loader.loadAsync(m.url))
      .then(validate)
      .then((g) => { loaded.set(key, g); return g; })
      .finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return pending.get(key);
}

/** Load every model referenced by a scene (figures with a `model` field). */
export async function loadSceneModels(data) {
  const keys = new Set((data?.objects || []).map((d) => d.model).filter((k) => k && MODELS[k]));
  await Promise.all([...keys].map((k) => loadModel(k).catch(() => null)));
}

// ---------------------------------------------------------------- imported models (IndexedDB)

const DB = 'posetool-models';
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('models');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('models', mode);
    const req = fn(tx.objectStore('models'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** Register models imported in earlier sessions (does not parse them yet). */
export async function restoreImported() {
  try {
    const all = await idb('readonly', (s) => s.getAll());
    for (const m of all || []) MODELS[m.key] = { label: m.label, buffer: m.buffer };
  } catch { /* IndexedDB unavailable: imports just won't persist */ }
}

/** Parse, validate and store a user GLB. Returns its model key. */
export async function importModel(file) {
  const buffer = await file.arrayBuffer();
  validate(await loader.parseAsync(buffer.slice(0), ''));
  const label = file.name.replace(/\.(glb|gltf)$/i, '');
  const key = 'import:' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  MODELS[key] = { label, buffer };
  loaded.delete(key);
  try { await idb('readwrite', (s) => s.put({ key, label, buffer }, key)); } catch { /* not persisted */ }
  await loadModel(key);
  return key;
}
