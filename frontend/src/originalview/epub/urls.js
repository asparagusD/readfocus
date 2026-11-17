// What an EPUB page may point at (C17.3). A book's own resources are blob:
// URLs by the time we see them (foliate-js rewrites them), in-document links are
// relative or #fragments, and embedded images may be data:image. Everything else
// (http, https, protocol-relative, javascript:, file:, other data:) is removed,
// so a book never reaches the network or runs code. The app's CSP is the backstop.

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** True when `url` stays inside the book (or is empty). */
export function isAllowedUrl(url) {
  // Browsers ignore tabs, newlines and leading spaces in URLs ("jav\tascript:"), so we do too.
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const plain = String(url ?? '').replace(/[\u0000- \u007f]/g, '');
  if (plain === '' || plain.startsWith('#')) return true;
  if (plain.startsWith('//') || plain.startsWith('\\\\')) return false; // protocol-relative: another host
  const scheme = SCHEME.exec(plain)?.[1].toLowerCase();
  if (!scheme) return true; // relative to the section
  if (scheme === 'blob') return true;
  return scheme === 'data' && /^data:image\//i.test(plain);
}

const IMPORT = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]*)\1\s*\)?[^;]*;?/gi;
const URL_TOKEN = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

/** CSS with remote @import rules dropped, remote url() made `none`, and expression() disabled. */
export function cleanCss(css) {
  return String(css ?? '')
    .replace(IMPORT, (rule, _q, url) => (isAllowedUrl(url) ? rule : ''))
    .replace(URL_TOKEN, (token, _q, url) => (isAllowedUrl(url) ? token : 'none'))
    .replace(/expression\s*\(/gi, 'invalid(');
}

/** A srcset with only allowed candidates kept ('' when none is left). */
export function cleanSrcset(srcset) {
  return String(srcset ?? '')
    .split(/,\s+/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate && isAllowedUrl(candidate.split(/\s+/)[0]))
    .join(', ');
}
