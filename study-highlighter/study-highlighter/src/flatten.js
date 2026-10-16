// Evens out shadows and uneven lighting in a page image (phone photos, curled pages) so faint text is still read.
// Works in place on RGBA pixels, keeps the image size, so word positions stay exactly where they were.
// Pages that are mostly dark (white text on black, such as some slides) are left alone.
export function flattenLighting(rgba, w, h, block = 24) {
  const n = w * h;
  const gray = new Float32Array(n);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const g = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    gray[i] = g; sum += g;
  }
  if (sum / n < 110) return false;                    // dark page: do nothing

  // 1) estimate the paper brightness: the brightest pixel in every block (text strokes are thin, so paper wins)
  const gw = Math.ceil(w / block), gh = Math.ceil(h / block);
  let grid = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = ((y / block) | 0) * gw;
    for (let x = 0; x < w; x++) {
      const gi = row + ((x / block) | 0), v = gray[y * w + x];
      if (v > grid[gi]) grid[gi] = v;
    }
  }
  grid = boxBlur(boxBlur(grid, gw, gh, 2), gw, gh, 2); // smooth it, lighting changes slowly

  // 2) divide the picture by that estimate, so paper becomes white everywhere and text stays dark
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) / block - 0.5, 0), gh - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, gh - 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max((x + 0.5) / block - 0.5, 0), gw - 1), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, gw - 1), tx = fx - x0;
      const bg = (grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx) * (1 - ty)
               + (grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx) * ty;
      const v = Math.min(255, (gray[y * w + x] * 255) / Math.max(bg, 1));
      const p = (y * w + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = v; rgba[p + 3] = 255;
    }
  }
  return true;
}

function boxBlur(src, w, h, r) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) { s += src[yy * w + xx]; c++; }
    }
    out[y * w + x] = s / c;
  }
  return out;
}