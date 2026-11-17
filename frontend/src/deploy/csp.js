// The app's Content-Security-Policy (C17.3), added to the built index.html as a
// <meta> tag (vite.config.js, contentSecurityPolicyMeta). It is the backstop for
// the original view: an EPUB's pages are same-origin blob: iframes, which inherit
// this policy, so a script the sanitizer missed cannot run and a remote image or
// stylesheet cannot load. foliate-js requires one (its README, "Security").
import { createHash } from 'node:crypto';

function origin(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`csp: ${name} is not a URL (${JSON.stringify(value)})`);
  }
  if (!/^https?:$/.test(url.protocol) || url.hostname.includes('*')) throw new Error(`csp: ${name} must be a plain http(s) URL`);
  return url.origin;
}

/** The policy string for an API and a Supabase project, allowing the given inline-script hashes. */
export function contentSecurityPolicy({ apiUrl, supabaseUrl, scriptHashes = [] }) {
  const api = origin('apiUrl', apiUrl);
  const supabase = origin('supabaseUrl', supabaseUrl);
  const socket = supabase.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${scriptHashes.join(' ')}`.trim(), // wasm: PDF.js image decoders
    "style-src 'self' 'unsafe-inline' blob:", // React style props; a book's own stylesheets are blobs
    `img-src 'self' blob: data: ${supabase}`, // covers live in Supabase Storage
    "font-src 'self' blob: data:",
    `connect-src 'self' blob: data: ${api} ${supabase} ${socket}`, // signed book URLs are on the Supabase host
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * 'sha256-…' sources for every inline <script> (no src) in `html`. The HTML parser turns
 * CRLF and CR into LF before the browser hashes a script, so we hash the same text
 * (a Windows checkout has CRLF in index.html; DEBUG_LOG 2026-11-12 C17.3).
 */
export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(([, body]) => body.replace(/\r\n?/g, '\n'))
    .map((body) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
}
