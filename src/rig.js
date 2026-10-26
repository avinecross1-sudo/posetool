// Drives a rigged (Mixamo-style) GLB model from a Figure's joint skeleton.
//
// The Figure keeps its usual joint Groups (same names and rotation conventions as the
// mannequin, so poses / IK / hand controls all work), but positions them to match the
// model's bones. Every frame each mapped bone is given the world rotation of its joint,
// times a fixed offset captured with both skeletons in a T-pose.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FINGERS } from './hands.js';
import { boneKey } from './models.js';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const SEL = new THREE.Color(1.55, 0.78, 0.25);
const HOV = new THREE.Color(1.25, 1.12, 0.95);

// [joint, parent joint, Mixamo bone(s), arm side]. Arm joints hang along -Y in our rig
// but lie along +-X in the model's T-pose, so their offsets get turned by 90 degrees.
const SPECS = (() => {
  const list = [
    ['hips', null, ['Hips']], ['spine', 'hips', ['Spine']], ['chest', 'spine', ['Spine1', 'Spine2']],
    ['neck', 'chest', ['Neck']], ['head', 'neck', ['Head']],
  ];
  for (const [p, S] of [['l', 'Left'], ['r', 'Right']]) {
    list.push(
      [`${p}_upperArm`, 'chest', [`${S}Arm`]],
      [`${p}_forearm`, `${p}_upperArm`, [`${S}ForeArm`], p],
      [`${p}_hand`, `${p}_forearm`, [`${S}Hand`], p],
    );
    for (const f of [...FINGERS.map((f) => f.name), 'thumb']) {
      for (let i = 1; i <= 3; i++) {
        list.push([`${p}_${f}${i}`, i === 1 ? `${p}_hand` : `${p}_${f}${i - 1}`, [`${S}Hand${cap(f)}${i}`], p]);
      }
    }
    list.push(
      [`${p}_thigh`, 'hips', [`${S}UpLeg`]],
      [`${p}_shin`, `${p}_thigh`, [`${S}Leg`]],
      [`${p}_foot`, `${p}_shin`, [`${S}Foot`]],
      [`${p}_toes`, `${p}_foot`, [`${S}ToeBase`]],
    );
  }
  return list;
})();

function boneMap(root) {
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[boneKey(o.name)] ??= o; });
  return bones;
}

// Fallback offsets for joints whose bone the model lacks.
function defaultOffset(name, p) {
  const s = p === 'l' ? 1 : -1;
  const f = FINGERS.find((f) => name.slice(2).startsWith(f.name));
  if (f) return name.endsWith('1') ? [0, f.y, f.z] : [0, -f.len[0] * 0.7, 0];
  if (name.includes('thumb')) return name.endsWith('1') ? [-s * 0.006, -0.022, 0.03] : [0, -0.02, 0.025];
  return [0, name.includes('toes') ? -0.05 : 0.05, name.includes('toes') ? 0.13 : 0];
}

/** Scale/offset that stand the model on the floor with its hips at hipsY, plus per-joint data. */
function calibrate(gltf, hipsY) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const bones = boneMap(scene);
  const floorY = new THREE.Box3().setFromObject(scene, true).min.y;
  const hipsP = bones.Hips.getWorldPosition(new THREE.Vector3());
  const k = hipsY / (hipsP.y - floorY);
  const pos = new THREE.Vector3(-k * hipsP.x, -k * floorY, -k * hipsP.z);

  const boneOf = {};
  const joints = [];
  for (const [name, parent, names, p] of SPECS) {
    const bone = names.map((n) => bones[n]).find(Boolean);
    const pb = parent && boneOf[parent];
    if (bone) boneOf[name] = bone;
    let offset;
    if (!parent) offset = [0, hipsY, 0];
    else if (bone && pb) {
      const d = bone.getWorldPosition(new THREE.Vector3()).sub(pb.getWorldPosition(new THREE.Vector3())).multiplyScalar(k);
      const s = p === 'l' ? 1 : -1;
      offset = p ? [s * d.y, -s * d.x, d.z] : d.toArray();
    } else offset = defaultOffset(name, p);
    let off = null;
    if (bone) {
      // Our joint's world rotation in the T-pose: arm joints are turned 90 degrees about Z.
      const cal = new THREE.Quaternion();
      if (name.includes('_') && /upperArm|forearm|hand|index|middle|ring|pinky|thumb/.test(name)) {
        cal.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (name[0] === 'l' ? 1 : -1) * Math.PI / 2);
      }
      off = cal.invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    }
    joints.push({ name, parent, offset, bone: bone ? boneKey(bone.name) : null, off });
  }
  return { k, pos, joints };
}

const _q = new THREE.Quaternion();
const _p = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class Rig {
  /**
   * @param fig     the Figure (its _joint helper and materials are used)
   * @param gltf    loaded model
   * @param opts    { hipsY, headScale }
   */
  constructor(fig, gltf, { hipsY, headScale = 1 }) {
    const cal = (gltf.userData.poseCal ??= calibrate(gltf, hipsY));
    this.fig = fig;
    this.model = cloneSkinned(gltf.scene);
    this.wrap = new THREE.Group();
    this.wrap.scale.setScalar(cal.k);
    this.wrap.position.copy(cal.pos);
    this.wrap.add(this.model);
    fig.root.add(this.wrap);

    const bones = boneMap(this.model);
    this.pairs = [];
    const jointOfBone = new Map();
    for (const j of cal.joints) {
      const joint = fig._joint(j.name, j.parent ? fig.joints[j.parent] : fig.root, ...j.offset);
      if (!j.bone) continue;
      const bone = bones[j.bone];
      jointOfBone.set(bone, j.name);
      if (j.name === 'hips') this.hips = { bone, joint };
      this.pairs.push({ bone, joint, off: j.off });
    }
    if (headScale !== 1) bones.Head?.scale.multiplyScalar(headScale);

    // Skinned meshes: own geometry copy (for highlight colours), tinted materials.
    this.meshes = [];
    this.extraMats = [];
    this.model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.geometry = o.geometry.clone();
      const n = o.geometry.attributes.position.count;
      o.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      const pick = (m) => {
        if (!m.map) return /joint/i.test(o.name + m.name) ? fig.jointMat : fig.mat;
        const c = m.clone();
        this.extraMats.push(c);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
      for (const m of [o.material].flat()) m.vertexColors = true;
      o.castShadow = o.receiveShadow = true;
      o.frustumCulled = false;
      o.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); // posed bounds change; never cull rays
      o.userData = { owner: fig, joint: null, baseMat: o.material };
      // skeleton bone index -> joint name (unmapped bones belong to the nearest mapped ancestor)
      o.userData.boneJoint = o.skeleton.bones.map((b) => {
        for (let x = b; x; x = x.parent) if (jointOfBone.has(x)) return jointOfBone.get(x);
        return 'hips';
      });
      this.meshes.push(o);
    });
    this.hl = '';
  }

  /** Copy joint rotations (and the hips position) onto the model's bones. */
  update() {
    this.fig.root.updateMatrixWorld(true);
    const { bone, joint } = this.hips;
    bone.parent.updateWorldMatrix(true, false);
    bone.position.copy(bone.parent.worldToLocal(joint.getWorldPosition(_v)));
    for (const { bone, joint, off } of this.pairs) {
      joint.getWorldQuaternion(_q).multiply(off);
      bone.parent.getWorldQuaternion(_p);
      bone.quaternion.copy(_p.invert().multiply(_q));
    }
    this.model.updateMatrixWorld(true);
  }

  /** The joint under a raycast hit, from the skin weights of the hit triangle. */
  pickJoint(hit) {
    const g = hit.object.geometry;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const map = hit.object.userData.boneJoint;
    const score = {};
    for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
      for (let c = 0; c < 4; c++) {
        const j = map[si.getComponent(v, c)];
        score[j] = (score[j] || 0) + sw.getComponent(v, c);
      }
    }
    const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
    return this.fig.joints[best];
  }

  /** Tint the skin around the selected / hovered joints. */
  highlight(selName, hovName) {
    const key = `${selName}|${hovName}`;
    if (key === this.hl) return;
    this.hl = key;
    for (const m of this.meshes) {
      const g = m.geometry;
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, col = g.attributes.color;
      const map = m.userData.boneJoint;
      for (let v = 0; v < col.count; v++) {
        let ws = 0, wh = 0;
        if (selName || hovName) {
          for (let c = 0; c < 4; c++) {
            const j = map[si.getComponent(v, c)];
            if (j === selName) ws += sw.getComponent(v, c);
            else if (j === hovName) wh += sw.getComponent(v, c);
          }
        }
        const w = 1 - ws - wh;
        col.setXYZ(v, w + SEL.r * ws + HOV.r * wh, w + SEL.g * ws + HOV.g * wh, w + SEL.b * ws + HOV.b * wh);
      }
      col.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of this.extraMats) m.dispose();
  }
}
