import { MAX_IMAGE_BYTES, base64Bytes, base64Of, cropRect, shrinkSteps } from './blocks';

/** A canvas (or image) drawn into a PNG under MAX_IMAGE_BYTES, shrinking by a fifth until it fits; base64. */
function fitPng(source, rect, width, height, doc = document) {
  for (const size of shrinkSteps(width, height)) {
    const out = doc.createElement('canvas');
    out.width = size.width;
    out.height = size.height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, size.width, size.height);
    const b64 = base64Of(out.toDataURL('image/png'));
    if (base64Bytes(b64) <= MAX_IMAGE_BYTES) return b64;
  }
  throw new Error('The picture is too large to send.');
}

/**
 * A region of a rendered PDF page as a PNG for Steve (C20.8): read from the page's own canvas (what the
 * reader sees, recoloured or not), the box plus a little padding, at twice its CSS size, under 500 KB.
 */
export function cropPdfRegion(pageEl, bbox) {
  const canvas = pageEl?.querySelector('canvas');
  const scale = Number(pageEl?.dataset.scale);
  if (!canvas || !scale) throw new Error('The page is not drawn yet.');
  const cssWidth = pageEl.getBoundingClientRect().width || canvas.width;
  const ratio = canvas.width / cssWidth;
  const rect = cropRect({ bbox, scale, ratio, canvasWidth: canvas.width, canvasHeight: canvas.height });
  return fitPng(canvas, rect, rect.dw, rect.dh, pageEl.ownerDocument);
}

/** An image element (an EPUB figure, C20.8c) as a PNG under 500 KB, at most 1600 px on its long side. */
export async function imageToPng(img) {
  if (!img.complete) await new Promise((done, fail) => { img.onload = done; img.onerror = fail; });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const fit = Math.min(1, 1600 / Math.max(w, h));
  return fitPng(img, { sx: 0, sy: 0, sw: w, sh: h }, Math.round(w * fit), Math.round(h * fit), img.ownerDocument);
}
