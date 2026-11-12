// An image's natural size from the first bytes of its file (C17.3), so every
// image in an EPUB page gets width and height before it decodes and the page
// does not shift. PNG, GIF, JPEG, WebP and SVG; null for anything else.

const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));
const be16 = (b, at) => (b[at] << 8) | b[at + 1];
const be32 = (b, at) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const le16 = (b, at) => b[at] | (b[at + 1] << 8);
const le24 = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

function jpeg(b) {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) { at += 1; continue; } // fill byte
    // SOF0-SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) do not.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: be16(b, at + 7), height: be16(b, at + 5) };
    }
    at += 2 + be16(b, at + 2);
  }
  return null;
}

function webp(b) {
  const kind = ascii(b, 12, 4);
  if (kind === 'VP8 ' && b.length >= 30) return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  if (kind === 'VP8L' && b.length >= 25) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X' && b.length >= 30) return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  return null;
}

const LENGTH = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/;

function svg(b) {
  const text = new TextDecoder().decode(b.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2];
  const [w, h] = [LENGTH.exec(attr('width') ?? ''), LENGTH.exec(attr('height') ?? '')];
  if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
  const box = (attr('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  return box.length === 4 && box[2] > 0 && box[3] > 0 ? { width: box[2], height: box[3] } : null;
}

/** { width, height } in CSS pixels from a file's leading bytes, or null. */
export function imageSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (b.length >= 24 && be32(b, 0) === 0x89504e47 && ascii(b, 12, 4) === 'IHDR') {
    return { width: be32(b, 16), height: be32(b, 20) };
  }
  if (b.length >= 10 && ascii(b, 0, 3) === 'GIF') return { width: le16(b, 6), height: le16(b, 8) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  if (b.length >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webp(b);
  if (b.length > 4 && /<svg\b/i.test(new TextDecoder().decode(b.subarray(0, 4096)))) return svg(b);
  return null;
}
