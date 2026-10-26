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

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Analytic two-bone IK (arm / leg): bend the hinge to the right length, then aim the upper bone.
 * Works in the upper bone's frame, where the effector sits at L + Rx(theta) * E
 * (L = hinge offset, E = effector offset), so bones need not be collinear at rest.
 */
function solveTwoBone(figure, eff, lower, upper, target) {
  const [min, max] = HINGES[lower.name].map((v) => v * D2R);
  figure.root.updateMatrixWorld(true);
  const L = lower.position, E = eff.position;
  // |L + Rx(theta) E|^2 = LL + EE + 2 (C + A cos(theta) + B sin(theta))
  const C = L.x * E.x, A = L.y * E.y + L.z * E.z, B = L.z * E.y - L.y * E.z;
  const R = Math.hypot(A, B), phi = Math.atan2(B, A);
  const base = L.lengthSq() + E.lengthSq() + 2 * C;
  const d2 = upper.worldToLocal(lp.copy(target)).lengthSq();
  const k = THREE.MathUtils.clamp((d2 - base) / (2 * R || 1), -1, 1);
  const alpha = Math.acos(k);
  // Two solutions; take the one inside the hinge range (or the nearest after clamping).
  const pick = [wrap(phi + alpha), wrap(phi - alpha)]
    .map((t) => ({ t, c: THREE.MathUtils.clamp(t, min, max) }))
    .sort((p, q) => Math.abs(p.t - p.c) - Math.abs(q.t - q.c))[0];
  lower.rotation.set(Math.min(Math.abs(pick.c), 160 * D2R) * Math.sign(pick.c), 0, 0);
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
