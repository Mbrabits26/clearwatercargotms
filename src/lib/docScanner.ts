// @ts-nocheck -- tight pixel loops; covered by src/test/doc-scanner.test.ts
/* Browser-side POD "scan": find the paper, flatten it, and clean up shadows. Pure math on RGBA arrays. */
export type Pt = { x: number; y: number };
export type Quad = [Pt, Pt, Pt, Pt]; // top-left, top-right, bottom-right, bottom-left
export type ScanMode = "enhanced" | "color" | "original";
type Img = { width: number; height: number; data: Uint8ClampedArray };

const gray = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function otsu(values: Float32Array) {
  const hist = new Array(256).fill(0);
  values.forEach(v => hist[Math.min(255, Math.max(0, v | 0))]++);
  let sum = 0; hist.forEach((c, i) => (sum += c * i));
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = values.length - wB; if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/** Corners of the brightest large region (paper). Falls back to the full image when unsure. */
export function detectQuad(img: Img): Quad {
  const { width: w, height: h, data } = img;
  const full: Quad = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = gray(data, i * 4);
  const thr = otsu(g);
  // Largest connected bright region (paper), ignoring tiny glare spots.
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1, bestSize = 0; const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (label[s] !== -1 || g[s] <= thr) continue;
    let size = 0; label[s] = s; stack.push(s);
    while (stack.length) {
      const p = stack.pop()!; size++;
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && label[q] === -1 && g[q] > thr) { label[q] = s; stack.push(q); }
      }
    }
    if (size > bestSize) { bestSize = size; bestId = s; }
  }
  if (bestId < 0 || bestSize < w * h * 0.15 || bestSize > w * h * 0.97) return full;
  let tl = Infinity, br = -Infinity, tr = -Infinity, bl = Infinity;
  const q: Quad = [...full] as Quad;
  for (let p = 0; p < w * h; p++) {
    if (label[p] !== bestId) continue;
    const x = p % w, y = (p / w) | 0;
    if (x + y < tl) { tl = x + y; q[0] = { x, y }; }
    if (x - y > tr) { tr = x - y; q[1] = { x, y }; }
    if (x + y > br) { br = x + y; q[2] = { x, y }; }
    if (x - y < bl) { bl = x - y; q[3] = { x, y }; }
  }
  return q;
}

/** Homography mapping the unit output rectangle (0..W,0..H) onto the source quad. */
function homography(W: number, H: number, quad: Quad) {
  const src = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const A: number[][] = [];
  src.forEach((s, i) => {
    const d = quad[i];
    A.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y, d.x]);
    A.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y, d.y]);
  });
  for (let c = 0; c < 8; c++) {
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const m = A.map((row, i) => row[8] / row[i]);
  return [...m, 1];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Output size of the flattened page, capped at maxSide. */
export function outputSize(quad: Quad, maxSide = 2000) {
  let W = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  let H = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  const s = Math.min(1, maxSide / Math.max(W, H));
  return { width: Math.max(1, Math.round(W * s)), height: Math.max(1, Math.round(H * s)) };
}

/** Flatten the quad into an upright rectangle (bilinear sampling). */
export function warp(img: Img, quad: Quad, out: Img) {
  const m = homography(out.width, out.height, quad);
  const { width: sw, height: sh, data: sd } = img;
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const z = m[6] * x + m[7] * y + m[8];
    const u = Math.min(sw - 1.001, Math.max(0, (m[0] * x + m[1] * y + m[2]) / z));
    const v = Math.min(sh - 1.001, Math.max(0, (m[3] * x + m[4] * y + m[5]) / z));
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
    const o = (y * out.width + x) * 4;
    for (let c = 0; c < 3; c++) {
      const a = sd[(y0 * sw + x0) * 4 + c], b = sd[(y0 * sw + x0 + 1) * 4 + c];
      const d = sd[((y0 + 1) * sw + x0) * 4 + c], e = sd[((y0 + 1) * sw + x0 + 1) * 4 + c];
      out.data[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
    }
    out.data[o + 3] = 255;
  }
}

/** Scanner look: divide by a blurred background to remove shadows, whiten paper, keep ink dark. */
export function enhance(img: Img) {
  const { width: w, height: h, data } = img;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = gray(data, i * 4);
  // Box blur via integral image; radius ~ 1/16 of the page.
  const r = Math.max(8, Math.round(Math.max(w, h) / 16));
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    const bg = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    let v = (g[y * w + x] / Math.max(1, bg)) * 255;
    v = Math.min(255, Math.max(0, (v - 60) * (255 / 175))); // contrast stretch: paper → white
    const o = (y * w + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
}
