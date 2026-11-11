import { describe, it, expect } from "vitest";
import { detectQuad, warp, outputSize } from "../lib/docScanner";

function img(w: number, h: number, paper: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = paper(x, y) ? 240 : 30; const o = (y * w + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}

describe("POD scanner", () => {
  it("finds the paper inside a dark background", () => {
    const q = detectQuad(img(100, 100, (x, y) => x >= 20 && x < 80 && y >= 10 && y < 90));
    expect(q[0]).toEqual({ x: 20, y: 10 });
    expect(q[2]).toEqual({ x: 79, y: 89 });
  });
  it("keeps the full photo when no paper is found", () => {
    const q = detectQuad(img(50, 40, () => false));
    expect(q[2]).toEqual({ x: 50, y: 40 });
  });
  it("crops to only the paper", () => {
    const src = img(100, 100, (x, y) => x >= 20 && x < 80 && y >= 10 && y < 90);
    const q = detectQuad(src);
    const size = outputSize(q);
    const out = { ...size, data: new Uint8ClampedArray(size.width * size.height * 4) };
    warp(src, q, out);
    let dark = 0; for (let i = 0; i < out.data.length; i += 4) if (out.data[i] < 100) dark++;
    expect(dark / (size.width * size.height)).toBeLessThan(0.02);
  });
});
