// Lamplight for a PDF page (C17.4) without touching its images or coloured figures.
// PDF.js's own pageColors runs one filter over the whole canvas, images included,
// so we recolour ourselves: near-grey pixels (paper, black text, grey rules) are
// remapped by luminance from paper→page and ink→text; coloured pixels stay; and
// every image PDF.js drew is copied back from the untouched render.

/** '#rgb' or '#rrggbb' (with or without '#') to [r, g, b]. */
export function hexRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/**
 * Recolour RGBA pixels in place. A pixel whose channels differ by less than
 * `chroma` is grey: luminance 1 becomes `bg`, 0 becomes `fg`, in between mixes.
 * Coloured pixels and alpha are left as they are.
 */
export function recolourPixels(data, fg, bg, chroma = 48) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) >= chroma) continue;
    const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    data[i] = fg[0] + (bg[0] - fg[0]) * light;
    data[i + 1] = fg[1] + (bg[1] - fg[1]) * light;
    data[i + 2] = fg[2] + (bg[2] - fg[2]) * light;
  }
  return data;
}

/**
 * Pixel rectangles of the images PDF.js drew: `coords` holds three corners per image
 * (x0, y0, x1, y1, x2, y2), each as a fraction of the canvas; the fourth corner is
 * x1 + x2 - x0. One pixel of padding covers rounding; rectangles stay on the canvas.
 */
export function imageRects(coords, width, height) {
  const rects = [];
  for (let i = 0; coords && i + 5 < coords.length; i += 6) {
    const [x0, y0, x1, y1, x2, y2] = coords.slice(i, i + 6);
    const xs = [x0, x1, x2, x1 + x2 - x0].map((x) => x * width);
    const ys = [y0, y1, y2, y1 + y2 - y0].map((y) => y * height);
    const left = Math.max(0, Math.floor(Math.min(...xs)) - 1);
    const top = Math.max(0, Math.floor(Math.min(...ys)) - 1);
    const right = Math.min(width, Math.ceil(Math.max(...xs)) + 1);
    const bottom = Math.min(height, Math.ceil(Math.max(...ys)) + 1);
    if (right > left && bottom > top) rects.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return rects;
}

/** Recolour a rendered page canvas for lamplight, keeping the images PDF.js recorded. */
export function recolourCanvas(canvas, coords, { foreground, background }) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rects = imageRects(coords, canvas.width, canvas.height);
  const kept = rects.map((r) => ({ ...r, pixels: ctx.getImageData(r.x, r.y, r.width, r.height) }));
  const all = ctx.getImageData(0, 0, canvas.width, canvas.height);
  recolourPixels(all.data, hexRgb(foreground), hexRgb(background));
  ctx.putImageData(all, 0, 0);
  for (const r of kept) ctx.putImageData(r.pixels, r.x, r.y);
}
