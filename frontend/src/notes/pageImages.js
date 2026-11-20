/**
 * Pictures on notebook pages (C37.6, issue 26): what a page keeps of Excalidraw's files, and a picture made small
 * enough for the notes bucket. The server keeps a drawing's files only as { path, mimeType } in the reader's own
 * folder (note_content.py), never data URLs, so a picture is uploaded (WebP, else PNG, under the bucket's 256 KB)
 * before its page can keep it; on opening, each path's signed URL is read back into a data URL for Excalidraw.
 * Excalidraw's library is kept in this browser.
 */

export const FILE_MAX = 250_000; // under the bucket's 256 KB
const STEPS = [[1600, 0.82], [1600, 0.7], [1200, 0.7], [900, 0.65], [700, 0.6], [500, 0.6], [360, 0.6]];
const LIBRARY_KEY = 'rf-excalidraw-library';

/** The first of `encode(side, quality)`'s results (largest side, then quality) under `limit` bytes, or null. */
export async function fitUnder(encode, limit = FILE_MAX) {
  for (const [side, quality] of STEPS) {
    const blob = await encode(side, quality);
    if (blob && blob.size <= limit) return blob;
  }
  return null;
}

/** The page's files for the server: each live image element's file that has been uploaded, as { path, mimeType }. */
export function keptFiles(elements, stored) {
  const files = {};
  for (const e of elements ?? []) {
    if (e.type !== 'image' || e.isDeleted || !e.fileId) continue;
    const file = stored.get(e.fileId);
    if (file) files[e.fileId] = { path: file.path, mimeType: file.mimeType };
  }
  return files;
}

/** An image (a data URL) as a WebP blob under FILE_MAX (a PNG where the browser cannot write WebP), or null. */
export async function shrinkImage(dataURL) {
  const img = new Image();
  img.decoding = 'async';
  img.src = dataURL;
  await img.decode();
  const encode = (side, quality) => {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => { canvas.toBlob(resolve, 'image/webp', quality); });
  };
  const blob = await fitUnder(encode);
  return blob && ['image/webp', 'image/png'].includes(blob.type) ? blob : null;
}

/** A picture's natural size, scaled to at most `max` wide for the page. */
export async function pictureSize(dataURL, max = 420) {
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  const scale = Math.min(1, max / img.naturalWidth);
  return { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) };
}

/** A URL (a signed Storage URL, or a data URL) read as a data URL. */
export async function dataUrlOf(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Excalidraw's library, kept in this browser (a per-viewer convenience: it can come back empty). */
export function libraryStore(storage = globalThis.localStorage) {
  return {
    load: () => {
      try {
        const items = JSON.parse(storage?.getItem(LIBRARY_KEY) ?? '[]');
        return Array.isArray(items) ? items : [];
      } catch { return []; }
    },
    save: (items) => {
      try { storage?.setItem(LIBRARY_KEY, JSON.stringify(items ?? [])); } catch { /* full or private: kept for this visit */ }
    },
  };
}
