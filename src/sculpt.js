import * as THREE from 'three';

// Smooth Catmull-Rom interpolation through evenly spaced keys, t in [0, 1].
function catmull(keys, t) {
  const n = keys.length - 1;
  const x = THREE.MathUtils.clamp(t, 0, 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const u = x - i;
  const p0 = keys[Math.max(i - 1, 0)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(i + 2, n)];
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

const asFn = (v) => (typeof v === 'function' ? v : Array.isArray(v) ? (t) => catmull(v, t) : () => v);

export const gauss = (x, mu, sigma) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2);

/** Gaussian falloff around an angle (radians), wrapping correctly. */
export function angGauss(theta, center, width) {
  const d = Math.atan2(Math.sin(theta - center), Math.cos(theta - center));
  return Math.exp(-0.5 * (d / width) ** 2);
}

/**
 * A closed, smooth tube running from y0 to y1. Each cross-section is a superellipse
 * with half-width `a` (x) and half-depth `b` (z), centred at (cx, cz), plus an optional
 * radial `bulge(t, theta)` for muscles. theta = 0 faces +Z (front), theta = PI/2 faces +X.
 * a, b, cx, cz may be numbers, key arrays (spaced evenly along the tube) or functions of t.
 * `cap` gives the length (in metres) of the rounded end caps.
 */
export function tube({ y0, y1, a, b, n = 2, cx = 0, cz = 0, bulge, cap = [0.03, 0.03], segs = 32, rings = 36 }) {
  const A = asFn(a), B = asFn(b ?? a), CX = asFn(cx), CZ = asFn(cz);
  const len = Math.abs(y1 - y0);
  const c0 = cap[0] / len, c1 = cap[1] / len;
  const pos = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    let f = 1;
    if (c0 > 0 && t < c0) f = Math.sqrt(Math.max(0, 1 - (1 - t / c0) ** 2));
    if (c1 > 0 && t > 1 - c1) f = Math.min(f, Math.sqrt(Math.max(0, 1 - (1 - (1 - t) / c1) ** 2)));
    const y = y0 + (y1 - y0) * t;
    const ra = A(t), rb = B(t), ox = CX(t), oz = CZ(t);
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      const s = Math.sin(th), c = Math.cos(th);
      let r = Math.pow(Math.abs(s / ra) ** n + Math.abs(c / rb) ** n, -1 / n);
      if (bulge) r += bulge(t, th);
      r *= f;
      pos.push(ox + r * s, y, oz + r * c);
    }
  }
  const idx = [];
  const down = y1 < y0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const p = i * segs + j, q = i * segs + ((j + 1) % segs);
      const r = p + segs, s = q + segs;
      if (down) idx.push(p, r, q, q, r, s);
      else idx.push(p, q, r, q, s, r);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
