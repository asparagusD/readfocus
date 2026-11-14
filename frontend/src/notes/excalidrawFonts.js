/**
 * Excalidraw's fonts from our own origin only (C22.3). Excalidraw gives each FontFace our copy
 * (`EXCALIDRAW_ASSET_PATH`, scripts/copy-excalidraw.mjs) and then esm.sh as a fallback it always adds; Chrome
 * asks every source in the list, so each face also asked esm.sh (the CSP blocked it in a build; dev has no CSP).
 * `serveOwnFonts()` runs before Excalidraw's chunk: it sets the path and makes FontFace keep only sources on this
 * origin (or local()), so no other host is asked (CLAUDE.md constraint 1). DEBUG_LOG 2026-11-14 C22.3.
 */
export const ASSET_PATH = '/excalidraw-assets/';

/** `src` with every url(...) on another origin dropped; unchanged if that would leave nothing. */
export function ownSources(src, origin) {
  if (typeof src !== 'string') return src; // an ArrayBuffer: already here
  const parts = src.split(/,\s*(?=(?:url|local)\()/);
  const kept = parts.filter((part) => {
    const url = /^url\(\s*['"]?([^'")]+)/.exec(part.trim())?.[1];
    if (!url) return true; // local(...)
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true; // relative to this page
    return url.startsWith(`${origin}/`);
  });
  return kept.length ? kept.join(', ') : src;
}

export function serveOwnFonts(win = window) {
  win.EXCALIDRAW_ASSET_PATH = ASSET_PATH;
  const Real = win.FontFace;
  if (!Real || Real.rfOwnSources) return;
  class OwnFontFace extends Real {
    constructor(family, src, descriptors) {
      super(family, ownSources(src, win.location.origin), descriptors);
    }
  }
  OwnFontFace.rfOwnSources = true;
  win.FontFace = OwnFontFace;
}
