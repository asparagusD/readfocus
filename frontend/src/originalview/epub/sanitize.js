// Every EPUB section is cleaned before it renders (C17.3), in foliate-js's
// transform step, after foliate has turned the book's own links into blob: URLs.
//
// - DOMPurify, run in place on the parsed XHTML (so namespaces, epub:type, MathML
//   and SVG survive), removes scripts, event handlers, forms, iframes, objects,
//   embeds and any URL that leaves the book.
// - CSS in <style> and style="" loses remote url() and @import (urls.js).
// - SVG 2 <image href> (foliate rewrites only xlink:href) is loaded from the book.
// - Every image gets width and height from its file header, lazy loading and async
//   decoding, so pages do not shift while images decode.
// The app's Content-Security-Policy is the backstop for anything missed.
import DOMPurify from 'dompurify';
import { imageSize } from './imageSize';
import { cleanCss, cleanSrcset } from './urls';

const PURIFY = {
  IN_PLACE: true,
  PARSER_MEDIA_TYPE: 'application/xhtml+xml',
  ADD_TAGS: ['link', 'meta'], // the book's stylesheets (href must pass ALLOWED_URI_REGEXP); metas are cut to viewport below
  ADD_ATTR: ['epub:type', 'xml:lang', 'loading', 'decoding', 'content'],
  FORBID_TAGS: ['form', 'input', 'button', 'select', 'textarea', 'iframe', 'frame', 'frameset', 'object', 'embed',
    'base', 'audio', 'video', 'source', 'track'],
  // blob: (the book's resources), embedded images, #fragments and relative links only.
  ALLOWED_URI_REGEXP: /^(?:blob:|data:image\/|#|(?![a-z][a-z0-9+.-]*:|\/\/)[^\s]*$)/i,
};

/** Resolve `href` against the section path `base` inside the package ("OEBPS/text/ch1.xhtml"). */
export function resolvePath(href, base) {
  const parts = base.split('/').slice(0, -1);
  for (const part of href.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

async function sizeOf(url) {
  try {
    const blob = await (await fetch(url)).blob();
    return imageSize(new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * The cleaned section as an XHTML string. `name` is the section's path in the package;
 * `loadBlob(path)` reads a file from it; `track(url)` records blob URLs made here so the
 * engine can revoke them when the book closes.
 */
export async function sanitizeSection(source, { name, type, loadBlob, track }) {
  const html = type === 'text/html';
  const doc = new DOMParser().parseFromString(source, html ? 'text/html' : type === 'image/svg+xml' ? type : 'application/xhtml+xml');
  if (doc.querySelector('parsererror')) return UNREADABLE; // never pass on markup we could not clean
  DOMPurify.sanitize(doc.documentElement, html ? { ...PURIFY, PARSER_MEDIA_TYPE: 'text/html' } : PURIFY);
  // A fixed-layout page states its size in <meta name="viewport">; every other meta goes
  // (http-equiv refresh or set-cookie must not reach the page).
  for (const meta of doc.querySelectorAll('meta')) {
    if (meta.getAttribute('name')?.toLowerCase() !== 'viewport' || meta.hasAttribute('http-equiv')) meta.remove();
  }

  for (const style of doc.querySelectorAll('style')) style.textContent = cleanCss(style.textContent);
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', cleanCss(el.getAttribute('style')));
  for (const el of doc.querySelectorAll('[srcset]')) el.setAttribute('srcset', cleanSrcset(el.getAttribute('srcset')));

  // SVG 2 <image href="../images/x.png">: foliate leaves it relative, so it would not load.
  for (const image of doc.querySelectorAll('image[href]')) {
    const href = image.getAttribute('href');
    if (href.startsWith('blob:') || href.startsWith('data:')) continue;
    const blob = await loadBlob(resolvePath(href, name)).catch(() => null);
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    track(url);
    image.setAttribute('href', url);
  }

  await Promise.all([...doc.querySelectorAll('img[src^="blob:"]')].map(async (img) => {
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    if (img.hasAttribute('width') && img.hasAttribute('height')) return;
    const size = await sizeOf(img.getAttribute('src'));
    if (size) {
      img.setAttribute('width', String(Math.round(size.width)));
      img.setAttribute('height', String(Math.round(size.height)));
    }
  }));
  return html ? `<!DOCTYPE html>${doc.documentElement.outerHTML}` : new XMLSerializer().serializeToString(doc);
}

const UNREADABLE = '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Unreadable section</title></head>'
  + '<body><p>This part of the book could not be read safely, so it is not shown.</p></body></html>';

/** The styles added to every section: figures kept whole, images scaled with their aspect ratio. */
export const BOOK_CSS = `
figure, .figure, table { break-inside: avoid; }
figcaption { break-before: avoid; }
img[width][height] { height: auto; }
svg, img { max-width: 100%; }
pre, code { white-space: pre-wrap; }
`;
