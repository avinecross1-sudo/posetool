import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { tube, gauss, angGauss } from './sculpt.js';
import { FINGERS, THUMB, handRot } from './hands.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const SPHERE = new THREE.SphereGeometry(1, 32, 20);

export const HIPS_Y = 0.96;

export const uid = () => Math.random().toString(36).slice(2, 10);

// chestW / waistW / hipW scale torso widths; bust and muscle scale surface detail.
export const BODY_TYPES = {
  male: {
    label: 'Male', scale: 1.0, shoulder: 0.2, hip: 0.095, thick: 1.0, head: 1.0,
    chestW: 1.0, waistW: 1.0, hipW: 1.0, bust: 0, muscle: 1,
  },
  female: {
    label: 'Female', scale: 0.94, shoulder: 0.175, hip: 0.1, thick: 0.86, head: 0.98,
    chestW: 0.88, waistW: 0.82, hipW: 1.1, bust: 1, muscle: 0.4,
  },
  child: {
    label: 'Child', scale: 0.62, shoulder: 0.18, hip: 0.09, thick: 1.1, head: 1.4,
    chestW: 0.95, waistW: 1.05, hipW: 0.95, bust: 0, muscle: 0.15,
  },
};

export const JOINT_LABELS = { hips: 'Hips', spine: 'Waist', chest: 'Chest', neck: 'Neck', head: 'Head' };
for (const [p, side] of [['l', 'Left'], ['r', 'Right']]) {
  Object.assign(JOINT_LABELS, {
    [`${p}_upperArm`]: `${side} Upper Arm`, [`${p}_forearm`]: `${side} Forearm`, [`${p}_hand`]: `${side} Hand`,
    [`${p}_thigh`]: `${side} Thigh`, [`${p}_shin`]: `${side} Shin`, [`${p}_foot`]: `${side} Foot`, [`${p}_toes`]: `${side} Toes`,
  });
  for (const f of [...FINGERS, { name: 'thumb', label: 'Thumb' }]) {
    for (let i = 1; i <= 3; i++) JOINT_LABELS[`${p}_${f.name}${i}`] = `${side} ${f.label} ${['base', 'middle', 'tip'][i - 1]}`;
  }
}

function tagMesh(mesh, owner, joint) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.owner = owner;
  mesh.userData.joint = joint;
  mesh.userData.baseMat = mesh.material;
}

const round = (v, n = 1000) => Math.round(v * n) / n;

// ---------------------------------------------------------------- Figure

export class Figure {
  constructor({ type = 'male', color = '#d8b48a', id } = {}) {
    this.kind = 'figure';
    this.id = id || uid();
    this.type = BODY_TYPES[type] ? type : 'male';
    this.color = color;
    this.root = new THREE.Group();
    this.joints = {};
    this.meshes = [];
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0 });
    this.jointMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
    this.setColor(color);
    this.build();
    this.root.scale.setScalar(BODY_TYPES[this.type].scale);
  }

  get label() { return `${BODY_TYPES[this.type].label} figure`; }

  setColor(color) {
    this.color = color;
    this.mat.color.set(color);
    this.jointMat.color.set(color).multiplyScalar(0.78);
  }

  _joint(name, parent, x, y, z) {
    const j = new THREE.Group();
    j.name = name;
    j.position.set(x, y, z);
    parent.add(j);
    this.joints[name] = j;
    return j;
  }

  _mesh(joint, geo, mat, pos, scale, quat) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.fromArray(pos);
    if (scale) m.scale.fromArray(scale);
    if (quat) m.quaternion.copy(quat);
    tagMesh(m, this, joint);
    joint.add(m);
    this.meshes.push(m);
    return m;
  }

  _ellipsoid(j, s, p) { return this._mesh(j, SPHERE, this.mat, p, s); }
  _ball(j, r) { return this._mesh(j, SPHERE, this.jointMat, [0, 0, 0], [r, r, r]); }
  _sculpt(j, geo, pos, quat) { return this._mesh(j, geo, this.mat, pos, null, quat); }

  // A short rounded digit segment from the joint origin along `dir`.
  _digit(j, dir, len, r) {
    const g = tube({ y0: 0.003, y1: -len, a: [r, r * 0.9], cap: [r * 0.9, r * 0.85], segs: 14, rings: 10 });
    return this._sculpt(j, g, null, new THREE.Quaternion().setFromUnitVectors(DOWN, dir));
  }

  build() {
    const B = BODY_TYPES[this.type];
    const t = B.thick;
    const M = B.muscle;
    const J = this._joint.bind(this);
    const PI = Math.PI;
    const sc = (arr, k) => arr.map((v) => v * k);

    // ---- pelvis
    const hips = J('hips', this.root, 0, HIPS_Y, 0);
    this._sculpt(hips, tube({
      y0: 0.09, y1: -0.13,
      a: sc([0.12, 0.138, 0.15, 0.152, 0.138, 0.095, 0.05], B.hipW),
      b: [0.088, 0.094, 0.1, 0.104, 0.098, 0.08, 0.05],
      cz: [0, 0, -0.004, -0.008, -0.008, 0, 0.01],
      bulge: (u, th) => 0.028 * gauss(u, 0.6, 0.16) * (angGauss(th, PI - 0.55, 0.42) + angGauss(th, PI + 0.55, 0.42)),
      cap: [0.03, 0.05],
    }));

    // ---- abdomen
    const spine = J('spine', hips, 0, 0.07, 0);
    this._sculpt(spine, tube({
      y0: -0.03, y1: 0.2,
      a: sc([0.125, 0.118, 0.112, 0.116, 0.125, 0.13], B.waistW),
      b: [0.09, 0.088, 0.085, 0.086, 0.088, 0.09],
      bulge: (u, th) => 0.008 * M * gauss(u, 0.4, 0.2) * angGauss(th, 0, 0.6),
      cap: [0.03, 0.03],
    }));

    // ---- ribcage, pecs / bust, shoulder blades, trapezius
    const chest = J('chest', spine, 0, 0.16, 0);
    this._sculpt(chest, tube({
      y0: -0.02, y1: 0.34,
      a: sc([0.125, 0.132, 0.142, 0.152, 0.162, 0.172, 0.178, 0.172, 0.13, 0.065, 0.045], B.chestW),
      b: [0.088, 0.092, 0.098, 0.102, 0.105, 0.104, 0.098, 0.086, 0.068, 0.052, 0.045],
      cz: [0, 0, 0, 0, 0, -0.005, -0.01, -0.015, -0.015, -0.01, -0.005],
      bulge: (u, th) =>
        0.011 * M * gauss(u, 0.58, 0.13) * (angGauss(th, 0.5, 0.5) + angGauss(th, -0.5, 0.5)) +
        0.036 * B.bust * gauss(u, 0.52, 0.075) * (angGauss(th, 0.42, 0.26) + angGauss(th, -0.42, 0.26)) +
        0.01 * gauss(u, 0.62, 0.12) * (angGauss(th, PI - 0.6, 0.35) + angGauss(th, PI + 0.6, 0.35)),
      cap: [0.03, 0.02],
    }));

    // ---- neck & head
    const neck = J('neck', chest, 0, 0.3, 0);
    this._sculpt(neck, tube({ y0: -0.03, y1: 0.12, a: [0.056 * t, 0.05 * t, 0.048 * t], b: [0.054 * t, 0.052 * t, 0.05 * t], cz: [-0.006, 0, 0.004], cap: [0.02, 0.02] }));

    const head = J('head', neck, 0, 0.09, 0);
    head.scale.setScalar(B.head);
    this._sculpt(head, tube({
      y0: -0.005, y1: 0.245,
      a: [0.03, 0.05, 0.062, 0.068, 0.074, 0.082, 0.088, 0.086, 0.07, 0.04],
      b: [0.035, 0.055, 0.075, 0.088, 0.098, 0.104, 0.105, 0.1, 0.085, 0.05],
      cz: [0.07, 0.055, 0.04, 0.03, 0.022, 0.015, 0.008, 0, -0.005, -0.005],
      // cheekbones, a soft brow ridge and shallow eye sockets
      bulge: (u, th) =>
        0.006 * gauss(u, 0.42, 0.07) * (angGauss(th, 0.9, 0.3) + angGauss(th, -0.9, 0.3)) +
        0.005 * gauss(u, 0.56, 0.035) * angGauss(th, 0, 0.55) -
        0.006 * gauss(u, 0.5, 0.03) * (angGauss(th, 0.36, 0.16) + angGauss(th, -0.36, 0.16)),
      cap: [0.03, 0.05], segs: 48, rings: 56,
    }));
    this._ellipsoid(head, [0.011, 0.022, 0.017], [0, 0.093, 0.117]); // nose
    for (const s of [1, -1]) this._ellipsoid(head, [0.008, 0.022, 0.013], [s * 0.077, 0.11, -0.004]); // ears

    for (const [p, s] of [['l', 1], ['r', -1]]) {
      const OUT = s * PI / 2; // angle pointing away from the body
      const IN = -OUT;

      // ---- upper arm: deltoid, biceps, triceps
      const ua = J(`${p}_upperArm`, chest, s * B.shoulder, 0.245, 0);
      this._sculpt(ua, tube({
        y0: 0.035, y1: -0.3,
        a: sc([0.05, 0.054, 0.05, 0.045, 0.043, 0.04, 0.037, 0.036], t),
        b: sc([0.05, 0.052, 0.048, 0.046, 0.045, 0.042, 0.038, 0.036], t),
        bulge: (u, th) =>
          0.012 * gauss(u, 0.14, 0.1) * angGauss(th, OUT, 0.9) +
          (0.004 + 0.008 * M) * gauss(u, 0.5, 0.14) * angGauss(th, 0, 0.6) +
          (0.003 + 0.006 * M) * gauss(u, 0.35, 0.15) * angGauss(th, PI, 0.7),
        cap: [0.055, 0.03],
      }));

      // ---- forearm: flattens toward the wrist
      const fa = J(`${p}_forearm`, ua, 0, -0.28, 0);
      this._ball(fa, 0.037 * t);
      this._sculpt(fa, tube({
        y0: 0.03, y1: -0.26,
        a: sc([0.04, 0.042, 0.038, 0.032, 0.025, 0.019, 0.017], t),
        b: sc([0.04, 0.045, 0.042, 0.037, 0.031, 0.027, 0.026], t),
        bulge: (u, th) => (0.004 + 0.006 * M) * gauss(u, 0.25, 0.12) * angGauss(th, s * 0.9, 0.6),
        cap: [0.03, 0.02],
      }));

      // ---- hand: palm + thenar pad, 4 fingers x 3 knuckles, thumb x 3
      const hand = J(`${p}_hand`, fa, 0, -0.25, 0);
      this._ball(hand, 0.02 * t);
      this._sculpt(hand, tube({
        y0: 0.006, y1: -0.098, n: 2.8,
        a: sc([0.014, 0.016, 0.017, 0.016, 0.013], t),
        b: sc([0.03, 0.038, 0.043, 0.044, 0.042], t),
        cap: [0.012, 0.012], segs: 28, rings: 20,
      }));
      this._ellipsoid(hand, [0.012 * t, 0.026, 0.016 * t], [-s * 0.009 * t, -0.035, 0.024 * t]);

      for (const f of FINGERS) {
        let parent = hand;
        for (let i = 0; i < 3; i++) {
          const pos = i === 0 ? [0, f.y, f.z * t] : [0, -f.len[i - 1], 0];
          parent = J(`${p}_${f.name}${i + 1}`, parent, ...pos);
          this._digit(parent, DOWN, f.len[i], f.r * t * (1 - i * 0.08));
        }
      }
      const tdir = new THREE.Vector3(-s * 0.3, -0.55, 0.78).normalize();
      let tp = J(`${p}_thumb1`, hand, -s * 0.006 * t, -0.022, 0.03 * t);
      for (let i = 0; i < 3; i++) {
        if (i) tp = J(`${p}_thumb${i + 1}`, tp, ...tdir.clone().multiplyScalar(THUMB.len[i - 1]).toArray());
        this._digit(tp, tdir, THUMB.len[i], THUMB.r * t * (1 - i * 0.1));
      }

      // ---- thigh: quads, inner-knee teardrop, hamstrings, kneecap
      const th = J(`${p}_thigh`, hips, s * B.hip, -0.05, 0);
      this._ball(th, 0.06 * t);
      this._sculpt(th, tube({
        y0: 0.05, y1: -0.44,
        a: sc([0.072, 0.08, 0.078, 0.072, 0.064, 0.056, 0.05, 0.048, 0.047], t),
        b: sc([0.072, 0.08, 0.077, 0.07, 0.062, 0.054, 0.048, 0.047, 0.047], t),
        bulge: (u, th) =>
          (0.004 + 0.008 * M) * gauss(u, 0.45, 0.18) * angGauss(th, 0, 0.7) +
          0.008 * gauss(u, 0.8, 0.08) * angGauss(th, s * -0.9, 0.5) +
          0.005 * gauss(u, 0.4, 0.2) * angGauss(th, PI, 0.7) +
          Math.max(0, B.hipW - 1) * 0.2 * gauss(u, 0.08, 0.12) * angGauss(th, OUT, 0.7),
        cap: [0.06, 0.04],
      }));
      this._ellipsoid(th, [0.026 * t, 0.032, 0.016 * t], [0, -0.415, 0.04 * t]);

      // ---- shin: calf with larger inner head
      const sh = J(`${p}_shin`, th, 0, -0.42, 0);
      this._ball(sh, 0.044 * t);
      this._sculpt(sh, tube({
        y0: 0.03, y1: -0.43,
        a: sc([0.05, 0.05, 0.047, 0.041, 0.035, 0.03, 0.027, 0.027], t),
        b: sc([0.048, 0.047, 0.044, 0.039, 0.033, 0.029, 0.026, 0.026], t),
        bulge: (u, th) =>
          (0.012 + 0.008 * M) * gauss(u, 0.28, 0.13) * (angGauss(th, PI - s * 0.5, 0.5) * 0.8 + angGauss(th, PI + s * 0.5, 0.5)),
        cap: [0.04, 0.03],
      }));

      // ---- foot (heel to ball) + toes. Built along -Y, then turned to point +Z.
      const toZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -PI / 2);
      const ft = J(`${p}_foot`, sh, 0, -0.42, 0);
      this._ball(ft, 0.034 * t);
      const fh = [0.03, 0.036, 0.036, 0.03, 0.024, 0.02];
      this._sculpt(ft, tube({
        y0: 0.075, y1: -0.155, n: 2.4,
        a: sc([0.026, 0.032, 0.035, 0.04, 0.045, 0.046], t),
        b: fh,
        cz: fh.map((h) => -0.072 + h), // flat sole at y = -0.072
        cap: [0.03, 0.012],
      }), null, toZ);
      // inner ankle bones
      for (const k of [1, -1]) this._ellipsoid(ft, [0.012, 0.016, 0.014], [k * 0.026 * t, -0.012, 0]);

      const toes = J(`${p}_toes`, ft, 0, -0.055, 0.145);
      const th2 = [0.017, 0.016, 0.014, 0.011];
      this._sculpt(toes, tube({
        y0: 0.012, y1: -0.072, n: 2.4,
        a: sc([0.045, 0.044, 0.04, 0.032], t),
        b: th2,
        cx: [0, -s * 0.002, -s * 0.005, -s * 0.008],
        cz: th2.map((h) => -0.017 + h),
        cap: [0.008, 0.016], rings: 16,
      }), null, toZ);
    }
  }

  getPose() {
    const rot = {};
    for (const [n, j] of Object.entries(this.joints)) {
      const r = j.rotation;
      if (r.x || r.y || r.z) rot[n] = [round(r.x * R2D, 100), round(r.y * R2D, 100), round(r.z * R2D, 100)];
    }
    return { rot, hips: this.joints.hips.position.toArray().map((v) => round(v)) };
  }

  setPose(pose, reset = true) {
    if (reset) {
      for (const j of Object.values(this.joints)) j.rotation.set(0, 0, 0);
      this.joints.hips.position.set(0, HIPS_Y, 0);
    }
    const rot = { ...(pose.rot || {}) };
    // Older saves had one "fingers" + one "thumb" joint per hand: expand to per-knuckle curls.
    for (const [p, s] of [['l', 1], ['r', -1]]) {
      const old = rot[`${p}_fingers`];
      if (!old) continue;
      const curl = THREE.MathUtils.clamp((-s * old[2]) / 90, -0.2, 1);
      const thumb = rot[`${p}_thumb`] ? THREE.MathUtils.clamp((-s * rot[`${p}_thumb`][2]) / 40, 0, 1) : curl;
      Object.assign(rot, handRot(p, { curl, thumb }));
      delete rot[`${p}_fingers`];
      delete rot[`${p}_thumb`];
    }
    for (const [n, r] of Object.entries(rot)) {
      this.joints[n]?.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
    }
    if (pose.hips) this.joints.hips.position.fromArray(pose.hips);
  }

  mirrorPose() {
    const pose = this.getPose();
    const rot = {};
    for (const [n, r] of Object.entries(pose.rot)) {
      const m = n.startsWith('l_') ? 'r_' + n.slice(2) : n.startsWith('r_') ? 'l_' + n.slice(2) : n;
      rot[m] = [r[0], -r[1], -r[2]];
    }
    const h = pose.hips;
    this.setPose({ rot, hips: [-h[0], h[1], h[2]] });
  }

  dropToFloor() {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    this.joints.hips.position.y -= box.min.y / this.root.scale.y;
  }

  serialize() {
    return {
      kind: 'figure', id: this.id, type: this.type, color: this.color,
      pos: this.root.position.toArray().map((v) => round(v)),
      pose: this.getPose(),
    };
  }

  dispose() {
    for (const m of this.meshes) if (m.geometry !== SPHERE) m.geometry.dispose();
    this.mat.dispose();
    this.jointMat.dispose();
  }
}

// ---------------------------------------------------------------- Props

export const PROP_SHAPES = {
  box: 'Cube', sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone',
  chair: 'Chair', stool: 'Stool', table: 'Table', stairs: 'Stairs', wall: 'Wall', pole: 'Pole / Staff',
};

export class Prop {
  constructor({ shape = 'box', color = '#8fa3bf', id } = {}) {
    this.kind = 'prop';
    this.id = id || uid();
    this.shape = PROP_SHAPES[shape] ? shape : 'box';
    this.color = color;
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 });
    this.root = new THREE.Group();
    this.meshes = [];
    this.build();
  }

  get label() { return PROP_SHAPES[this.shape]; }

  setColor(c) { this.color = c; this.mat.color.set(c); }

  _add(geo, x, y, z) {
    const m = new THREE.Mesh(geo, this.mat);
    m.position.set(x, y, z);
    tagMesh(m, this, null);
    this.root.add(m);
    this.meshes.push(m);
    return m;
  }

  build() {
    const box = (w, h, d) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.15);
    const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 32);
    switch (this.shape) {
      case 'box': this._add(box(0.5, 0.5, 0.5), 0, 0.25, 0); break;
      case 'sphere': this._add(new THREE.SphereGeometry(0.25, 40, 24), 0, 0.25, 0); break;
      case 'cylinder': this._add(cyl(0.2, 0.6), 0, 0.3, 0); break;
      case 'cone': this._add(new THREE.ConeGeometry(0.25, 0.6, 40), 0, 0.3, 0); break;
      case 'wall': this._add(box(2, 2, 0.1), 0, 1, 0); break;
      case 'pole': this._add(cyl(0.02, 1.6), 0, 0.8, 0); break;
      case 'stool':
        this._add(cyl(0.18, 0.05), 0, 0.42, 0);
        this._add(cyl(0.03, 0.42), 0, 0.2, 0);
        this._add(cyl(0.15, 0.03), 0, 0.015, 0);
        break;
      case 'chair':
        this._add(box(0.46, 0.05, 0.46), 0, 0.4, 0);
        this._add(box(0.46, 0.5, 0.04), 0, 0.66, -0.21);
        for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) this._add(box(0.04, 0.38, 0.04), x, 0.19, z);
        break;
      case 'table':
        this._add(box(1.2, 0.05, 0.7), 0, 0.73, 0);
        for (const [x, z] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]]) this._add(box(0.05, 0.71, 0.05), x, 0.355, z);
        break;
      case 'stairs':
        for (let i = 0; i < 4; i++) this._add(box(0.9, 0.18 * (i + 1), 0.28), 0, 0.09 * (i + 1), -0.28 * i);
        break;
    }
  }

  setHighlight(state) {
    this.mat.emissive.set(state === 'select' ? 0x6a3500 : state === 'hover' ? 0x262626 : 0x000000);
  }

  dropToFloor() {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    this.root.position.y -= box.min.y;
  }

  serialize() {
    return {
      kind: 'prop', id: this.id, shape: this.shape, color: this.color,
      pos: this.root.position.toArray().map((v) => round(v)),
      rot: [this.root.rotation.x, this.root.rotation.y, this.root.rotation.z].map((v) => round(v, 10000)),
      scale: this.root.scale.toArray().map((v) => round(v)),
    };
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.mat.dispose();
  }
}

export function deserialize(d) {
  if (d.kind === 'figure') {
    const f = new Figure({ type: d.type, color: d.color, id: d.id });
    if (d.pos) f.root.position.fromArray(d.pos);
    if (d.pose) f.setPose(d.pose);
    return f;
  }
  const p = new Prop({ shape: d.shape, color: d.color, id: d.id });
  if (d.pos) p.root.position.fromArray(d.pos);
  if (d.rot) p.root.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
  if (d.scale) p.root.scale.fromArray(d.scale);
  return p;
}
