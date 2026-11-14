/**
 * Block actions (C20.8, docs/STEVE.md S14): what each region offers, where to crop a PDF page for Steve, and
 * the element path that finds an EPUB region. Pure, so Node's runner tests it.
 */

export const MAX_IMAGE_BYTES = 500 * 1024; // POST /steve/ask and /steve/latex refuse larger PNGs
export const CROP_PAD_PT = 6; // points kept around the box so nothing at its edge is cut
export const CROP_SCALE = 2; // the crop is twice the box's CSS size: sharp enough to read an index

const KIND_LABEL = { math: 'Equation', code: 'Code', figure: 'Figure' };

/** The actions of a region kind, in order. Without Steve (a pages-only book) only the copies on the device stay. */
export function actionsFor(kind, { steve = true, format = 'pdf' } = {}) {
  const all = {
    math: ['explain_equation', 'copy_latex'],
    code: ['copy_code', 'explain_code'],
    figure: ['explain_figure'],
  }[kind] ?? [];
  const local = new Set(['copy_code', ...(format === 'epub' ? ['copy_latex'] : [])]);
  return steve ? all : all.filter((action) => local.has(action));
}

export const ACTION_LABEL = {
  explain_equation: 'Explain this equation',
  copy_latex: 'Copy as LaTeX',
  copy_code: 'Copy code',
  explain_code: 'Explain this code',
  explain_figure: 'Explain this figure',
};

/** "Equation, p. 4" for the question bubble and the overlay's name. */
export function regionLabel(kind, place) {
  return `${KIND_LABEL[kind] ?? 'Region'}, ${place}`;
}

/**
 * Where to read a region from a rendered page canvas: the source rectangle in canvas pixels (the box plus
 * CROP_PAD_PT, clamped to the canvas) and the output size, CROP_SCALE times the box's CSS size.
 * bbox: [x0, top, x1, bottom] in PDF points; scale: CSS px per point; ratio: canvas px per CSS px.
 */
export function cropRect({ bbox, scale, ratio, canvasWidth, canvasHeight, pad = CROP_PAD_PT }) {
  const [x0, top, x1, bottom] = bbox;
  const px = scale * ratio;
  const sx = Math.max(0, Math.floor((x0 - pad) * px));
  const sy = Math.max(0, Math.floor((top - pad) * px));
  const ex = Math.min(canvasWidth, Math.ceil((x1 + pad) * px));
  const ey = Math.min(canvasHeight, Math.ceil((bottom + pad) * px));
  const sw = Math.max(1, ex - sx);
  const sh = Math.max(1, ey - sy);
  return { sx, sy, sw, sh, dw: Math.max(1, Math.round((sw / ratio) * CROP_SCALE)), dh: Math.max(1, Math.round((sh / ratio) * CROP_SCALE)) };
}

/** The sizes to try, largest first, until a PNG fits MAX_IMAGE_BYTES (each 80 % of the last, at least 64 px). */
export function shrinkSteps(width, height, steps = 8) {
  const out = [];
  let w = width;
  let h = height;
  for (let i = 0; i < steps && Math.min(w, h) >= 64; i += 1) {
    out.push({ width: Math.round(w), height: Math.round(h) });
    w *= 0.8;
    h *= 0.8;
  }
  return out.length ? out : [{ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }];
}

/**
 * An element's path as CFI steps from its document's root ("/4/6"), counted as chunks.block_paths and
 * page_regions.anchor count them: each step is 2 x (its index among element siblings + 1).
 */
export function elementPath(el) {
  const steps = [];
  let node = el;
  while (node && node.parentElement) {
    const siblings = Array.from(node.parentElement.children);
    steps.unshift(2 * (siblings.indexOf(node) + 1));
    node = node.parentElement;
  }
  return steps.length ? `/${steps.join('/')}` : '';
}

/** A data: URL or base64 string as plain base64 (what the API takes). */
export function base64Of(dataUrl) {
  const comma = String(dataUrl).indexOf(',');
  return comma >= 0 ? String(dataUrl).slice(comma + 1) : String(dataUrl);
}

/** The decoded byte count of base64 text. */
export function base64Bytes(b64) {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
