import * as THREE from 'three';

// Effector joint -> chain of joints that the solver may rotate (closest first).
export const IK_CHAINS = {
  l_hand: ['l_forearm', 'l_upperArm'],
  r_hand: ['r_forearm', 'r_upperArm'],
  l_foot: ['l_shin', 'l_thigh'],
  r_foot: ['r_shin', 'r_thigh'],
  head: ['neck', 'chest', 'spine'],
};

// Hinge joints bend only around local X, within [min, max] degrees.
const HINGES = {
  l_forearm: [-160, 0], r_forearm: [-160, 0],
  l_shin: [0, 160], r_shin: [0, 160],
};

const D2R = Math.PI / 180;
const jp = new THREE.Vector3();
const ep = new THREE.Vector3();
const toEff = new THREE.Vector3();
const toTgt = new THREE.Vector3();
const jq = new THREE.Quaternion();
const dq = new THREE.Quaternion();

// Rotate a hinge joint about its local X so `a` turns toward `b` (both in the joint's frame).
function stepHinge(joint, a, b) {
  const h = HINGES[joint.name];
  a.x = 0;
  b.x = 0;
  if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) return;
  const angle = Math.atan2(a.y * b.z - a.z * b.y, a.dot(b));
  const x = THREE.MathUtils.clamp(joint.rotation.x + angle, h[0] * D2R, h[1] * D2R);
  joint.rotation.set(x, 0, 0);
}

const up = new THREE.Vector3();
const lp = new THREE.Vector3();

/** Analytic two-bone IK (arm / leg): bend the hinge to the right length, then aim the upper bone. */
function solveTwoBone(figure, eff, lower, upper, target) {
  const h = HINGES[lower.name];
  figure.root.updateMatrixWorld(true);
  upper.getWorldPosition(up);
  lower.getWorldPosition(lp);
  eff.getWorldPosition(ep);
  const a = up.distanceTo(lp);
  const b = lp.distanceTo(ep);
  const d = THREE.MathUtils.clamp(up.distanceTo(target), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const interior = Math.acos(THREE.MathUtils.clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  const bend = Math.min(Math.PI - interior, 160 * D2R);
  lower.rotation.set(h[0] < 0 ? -bend : bend, 0, 0);
  lower.updateMatrixWorld(true);
  for (let i = 0; i < 2; i++) {
    upper.getWorldPosition(up);
    eff.getWorldPosition(ep);
    upper.getWorldQuaternion(jq).invert();
    toEff.subVectors(ep, up).applyQuaternion(jq).normalize();
    toTgt.subVectors(target, up).applyQuaternion(jq).normalize();
    upper.quaternion.multiply(dq.setFromUnitVectors(toEff, toTgt));
    upper.updateMatrixWorld(true);
  }
}

/** Move `effName` (hand, foot or head) to `target` in world space by rotating its chain. */
export function solveCCD(figure, effName, target, iterations = 15) {
  const eff = figure.joints[effName];
  const chain = IK_CHAINS[effName].map((n) => figure.joints[n]);
  if (chain.length === 2 && HINGES[chain[0].name]) return solveTwoBone(figure, eff, chain[0], chain[1], target);

  // A perfectly straight hinge has no preferred bend direction; seed a small bend.
  for (const j of chain) {
    const h = HINGES[j.name];
    if (h && Math.abs(j.rotation.x) < 5 * D2R) j.rotation.set((h[0] < 0 ? -8 : 8) * D2R, 0, 0);
  }
  figure.root.updateMatrixWorld(true);

  for (let it = 0; it < iterations; it++) {
    for (const joint of chain) {
      joint.getWorldPosition(jp);
      eff.getWorldPosition(ep);
      joint.getWorldQuaternion(jq).invert();
      toEff.subVectors(ep, jp).applyQuaternion(jq);
      toTgt.subVectors(target, jp).applyQuaternion(jq);
      if (toEff.lengthSq() < 1e-10 || toTgt.lengthSq() < 1e-10) continue;
      if (HINGES[joint.name]) {
        stepHinge(joint, toEff, toTgt);
      } else {
        dq.setFromUnitVectors(toEff.normalize(), toTgt.normalize());
        joint.quaternion.multiply(dq);
      }
      joint.updateMatrixWorld(true);
    }
    eff.getWorldPosition(ep);
    if (ep.distanceToSquared(target) < 1e-7) break;
  }
}
