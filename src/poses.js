// Preset poses. Rotations are XYZ Euler degrees per joint; unspecified joints are zero.
// Conventions (figure faces +Z): arm z+ raises the left arm sideways (z- for right);
// x- swings a limb forward; elbows bend with x-, knees with x+; spine/head lean forward with x+.

import { HAND_PRESETS as H, handRot, bothHands } from './hands.js';

const relaxed = bothHands(H.Relaxed);
const fists = bothHands(H.Fist);

export const POSES = {
  Stand: {
    rot: { l_upperArm: [0, 0, 8], r_upperArm: [0, 0, -8], l_forearm: [-10, 0, 0], r_forearm: [-10, 0, 0], ...relaxed },
  },
  'T-Pose': { rot: { l_upperArm: [0, 0, 90], r_upperArm: [0, 0, -90] } },
  'A-Pose': { rot: { l_upperArm: [0, 0, 45], r_upperArm: [0, 0, -45], ...relaxed } },
  Walk: {
    hips: [0, 0.94, 0],
    rot: {
      chest: [0, -6, 0],
      l_thigh: [-22, 0, 0], l_shin: [8, 0, 0], l_foot: [-8, 0, 0],
      r_thigh: [18, 0, 0], r_shin: [22, 0, 0], r_foot: [12, 0, 0],
      l_upperArm: [18, 0, 6], l_forearm: [-15, 0, 0],
      r_upperArm: [-20, 0, -6], r_forearm: [-25, 0, 0], ...relaxed,
    },
  },
  Run: {
    hips: [0, 0.9, 0],
    rot: {
      spine: [12, 0, 0], head: [-8, 0, 0],
      l_thigh: [-65, 0, 0], l_shin: [95, 0, 0], l_foot: [10, 0, 0],
      r_thigh: [25, 0, 0], r_shin: [50, 0, 0], r_foot: [25, 0, 0],
      l_upperArm: [45, 0, 10], l_forearm: [-85, 0, 0],
      r_upperArm: [-55, 0, -10], r_forearm: [-90, 0, 0], ...fists,
    },
  },
  Sit: {
    hips: [0, 0.53, 0],
    rot: {
      spine: [-3, 0, 0],
      l_thigh: [-90, 0, 4], r_thigh: [-90, 0, -4], l_shin: [90, 0, 0], r_shin: [90, 0, 0],
      l_upperArm: [-20, 0, 5], r_upperArm: [-20, 0, -5], l_forearm: [-60, 0, 0], r_forearm: [-60, 0, 0], ...relaxed,
    },
  },
  Kneel: {
    hips: [0, 0.54, 0],
    rot: {
      l_thigh: [-90, 0, 0], l_shin: [90, 0, 0], r_shin: [90, 0, 0],
      l_upperArm: [-15, 0, 8], r_upperArm: [0, 0, -8], l_forearm: [-70, 0, 0], ...relaxed,
    },
  },
  Crouch: {
    hips: [0, 0.45, 0],
    rot: {
      spine: [30, 0, 0], head: [-25, 0, 0],
      l_thigh: [-100, 0, 12], r_thigh: [-100, 0, -12], l_shin: [120, 0, 0], r_shin: [120, 0, 0],
      l_foot: [-20, 0, 0], r_foot: [-20, 0, 0],
      l_upperArm: [-50, 0, 10], r_upperArm: [-50, 0, -10], l_forearm: [-30, 0, 0], r_forearm: [-30, 0, 0], ...relaxed,
    },
  },
  Wave: {
    rot: {
      head: [0, 0, -5],
      l_upperArm: [0, 0, 8], l_forearm: [-10, 0, 0],
      r_upperArm: [0, 0, -80], r_forearm: [0, 0, -75], ...handRot('l', H.Relaxed), ...handRot('r', H.Open),
    },
  },
  Cheer: {
    rot: {
      head: [-15, 0, 0], chest: [-5, 0, 0],
      l_upperArm: [0, 0, 155], r_upperArm: [0, 0, -155], l_forearm: [0, 0, 10], r_forearm: [0, 0, -10], ...fists,
    },
  },
  Think: {
    rot: {
      spine: [6, 0, 0], head: [12, 0, 6],
      r_upperArm: [-30, 0, -12], r_forearm: [-140, 0, 0], ...handRot('r', H.Grip),
      l_upperArm: [-20, -30, 15], l_forearm: [-100, 0, 0], ...handRot('l', H.Relaxed),
    },
  },
  Point: {
    rot: {
      head: [0, -8, 0],
      r_upperArm: [-90, 0, -5], r_forearm: [-5, 0, 0],
      l_upperArm: [0, 0, 8], l_forearm: [-10, 0, 0], ...handRot('l', H.Relaxed), ...handRot('r', H.Point),
    },
  },
  Fight: {
    hips: [0, 0.92, 0],
    rot: {
      hips: [0, -25, 0], chest: [0, 20, 0], head: [5, 5, 0],
      l_thigh: [-30, 0, 10], l_shin: [30, 0, 0], r_thigh: [15, 0, -8], r_shin: [20, 0, 0],
      l_upperArm: [-60, 0, 20], r_upperArm: [-50, 0, -25], l_forearm: [-110, 0, 0], r_forearm: [-120, 0, 0], ...fists,
    },
  },
  'Lie Down': {
    hips: [0, 0.12, 0],
    rot: { hips: [-90, 0, 0], l_upperArm: [0, 0, 12], r_upperArm: [0, 0, -12], l_foot: [-30, 0, 0], r_foot: [-30, 0, 0], ...relaxed },
  },
};
