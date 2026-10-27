// Floor contact while posing: grounded feet stay planted (the legs bend via IK) and no part
// of the figure is allowed to sink through the floor (the body is pushed up instead).

import * as THREE from 'three';
import { solveCCD } from './ik.js';

const LEG_JOINTS = /^[lr]_(thigh|shin|foot|toes)$/;
const GROUND = 0.16; // an ankle closer than this to the floor counts as standing on it
const SAMPLES = 6000; // skinned models: vertices checked when looking for the lowest point

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _box = new THREE.Box3();

/** Lowest world-space Y of the figure's surface. */
export function lowestPoint(fig) {
  fig.root.updateMatrixWorld(true);
  if (!fig.rig) return _box.setFromObject(fig.root, true).min.y;
  fig.rig.update();
  const meshes = fig.rig.meshes;
  const total = meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  const stride = Math.max(1, Math.round(total / SAMPLES));
  let min = Infinity;
  for (const m of meshes) {
    const n = m.geometry.attributes.position.count;
    for (let i = 0; i < n; i += stride) {
      m.getVertexPosition(i, _v).applyMatrix4(m.matrixWorld);
      if (_v.y < min) min = _v.y;
    }
  }
  return min;
}

/**
 * Snapshot taken when a drag starts. `dragged` is the joint being manipulated; a leg being
 * dragged is left free, every other foot near the floor gets planted where it stands.
 */
export function beginContact(fig, dragged) {
  const floorY = Math.min(0, lowestPoint(fig)); // a pose already below the floor shouldn't pop up
  const free = LEG_JOINTS.test(dragged) ? dragged[0] : null;
  const feet = [];
  for (const p of ['l', 'r']) {
    const foot = fig.joints[`${p}_foot`];
    if (p === free || !foot) continue;
    const pos = foot.getWorldPosition(new THREE.Vector3());
    if (pos.y - floorY > GROUND * fig.root.scale.y) continue;
    feet.push({ name: `${p}_foot`, pos, quat: foot.getWorldQuaternion(new THREE.Quaternion()) });
  }
  return { fig, floorY, feet, hips: fig.joints.hips.getWorldPosition(new THREE.Vector3()) };
}

function plantFeet({ fig, feet }) {
  for (const f of feet) {
    solveCCD(fig, f.name, f.pos);
    const foot = fig.joints[f.name];
    foot.parent.getWorldQuaternion(_q).invert();
    foot.quaternion.copy(_q.multiply(f.quat)); // keep the sole flat on the ground
  }
}

/**
 * Re-apply contact after the pose changed.
 * @param opts.follow    feet slide along with horizontal hip motion (moving the whole figure)
 * @param opts.ik        { effector, target } when an IK handle is dragged: it stops at the floor
 */
export function applyContact(st, { follow = false, ik = null } = {}) {
  const { fig } = st;
  const hips = fig.joints.hips;
  if (follow) {
    hips.getWorldPosition(_v);
    for (const f of st.feet) {
      f.pos.x += _v.x - st.hips.x;
      f.pos.z += _v.z - st.hips.z;
    }
    st.hips.copy(_v);
  }
  for (let pass = 0; pass < 3; pass++) {
    plantFeet(st);
    const gap = st.floorY - lowestPoint(fig);
    if (gap <= 1e-4) break;
    if (ik) {
      ik.target.y += gap;
      solveCCD(fig, ik.effector, ik.target);
    } else {
      hips.position.y += gap / fig.root.scale.y;
    }
  }
}
