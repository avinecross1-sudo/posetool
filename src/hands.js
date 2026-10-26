// Finger layout and hand-shape helpers. The hand hangs with the palm facing the body
// (palm normal = -X on the left hand, +X on the right) and the thumb pointing forward (+Z).

export const FINGERS = [
  { name: 'index', label: 'Index', z: 0.029, y: -0.092, len: [0.042, 0.026, 0.021], r: 0.0095, spread: -12 },
  { name: 'middle', label: 'Middle', z: 0.0095, y: -0.096, len: [0.046, 0.029, 0.023], r: 0.0098, spread: -3 },
  { name: 'ring', label: 'Ring', z: -0.0095, y: -0.094, len: [0.043, 0.027, 0.021], r: 0.0092, spread: 6 },
  { name: 'pinky', label: 'Pinky', z: -0.028, y: -0.087, len: [0.034, 0.021, 0.018], r: 0.0082, spread: 14 },
];
export const THUMB = { len: [0.034, 0.03, 0.024], r: 0.0125 };

const CURL = [80, 95, 70]; // max bend (deg) per knuckle
const THUMB_CURL = [30, 35, 45];

export const HAND_PRESETS = {
  Open: { curl: 0, spread: 1, thumb: 0 },
  Relaxed: { curl: 0.22, spread: 0.3, thumb: 0.25 },
  Grip: { curl: 0.6, spread: 0, thumb: 0.7 },
  Fist: { curl: 1, spread: 0, thumb: 1 },
  Point: { curl: 1, spread: 0, thumb: 1, point: true },
};

/** Joint rotations (degrees) that shape one hand. p = 'l' | 'r'. */
export function handRot(p, { curl = 0, spread = 0, thumb = 0, point = false } = {}) {
  const s = p === 'l' ? 1 : -1;
  const rot = {};
  for (const f of FINGERS) {
    const c = point && f.name === 'index' ? 0 : curl;
    for (let i = 0; i < 3; i++) {
      rot[`${p}_${f.name}${i + 1}`] = [i === 0 ? f.spread * spread : 0, 0, -s * c * CURL[i]];
    }
  }
  for (let i = 0; i < 3; i++) rot[`${p}_thumb${i + 1}`] = [0, 0, -s * thumb * THUMB_CURL[i]];
  return rot;
}

export const bothHands = (shape) => ({ ...handRot('l', shape), ...handRot('r', shape) });

/** Estimate the curl / spread / thumb sliders from a figure's current finger joints. */
export function readHand(figure, p) {
  const s = p === 'l' ? 1 : -1;
  const j = figure.joints;
  const deg = (v) => (v * 180) / Math.PI;
  return {
    curl: (-s * deg(j[`${p}_middle1`].rotation.z)) / CURL[0],
    spread: deg(j[`${p}_index1`].rotation.x) / FINGERS[0].spread,
    thumb: (-s * deg(j[`${p}_thumb1`].rotation.z)) / THUMB_CURL[0],
  };
}
