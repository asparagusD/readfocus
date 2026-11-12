import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentSecurityPolicy, inlineScriptHashes } from './csp.js';

const policy = (extra = {}) => contentSecurityPolicy({
  apiUrl: 'https://readfocus-api.onrender.com/', supabaseUrl: 'https://abc.supabase.co', scriptHashes: ["'sha256-AAA='"], ...extra,
});
const directive = (csp, name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

test('scripts: our own files, the hashed inline theme script and wasm only; never unsafe-inline or eval', () => {
  const scripts = directive(policy(), 'script-src');
  assert.equal(scripts, "script-src 'self' 'wasm-unsafe-eval' 'sha256-AAA='");
  assert.doesNotMatch(policy(), /'unsafe-eval'|script-src[^;]*'unsafe-inline'/);
});

test('the API and Supabase are reached by origin only; Supabase also for covers and its websocket', () => {
  assert.equal(directive(policy(), 'connect-src'),
    "connect-src 'self' blob: data: https://readfocus-api.onrender.com https://abc.supabase.co wss://abc.supabase.co");
  assert.match(directive(policy(), 'img-src'), /https:\/\/abc\.supabase\.co/);
});

test('book pages: blob iframes, styles and fonts; nothing embeds us and no plugins run', () => {
  const csp = policy();
  assert.equal(directive(csp, 'frame-src'), "frame-src 'self' blob:");
  assert.equal(directive(csp, 'worker-src'), "worker-src 'self' blob:");
  assert.match(directive(csp, 'style-src'), /blob:/);
  assert.match(directive(csp, 'font-src'), /blob:/);
  assert.equal(directive(csp, 'object-src'), "object-src 'none'");
  assert.equal(directive(csp, 'base-uri'), "base-uri 'self'");
});

test('a missing or malformed URL is refused instead of widening the policy', () => {
  assert.throws(() => policy({ apiUrl: '' }), /apiUrl/);
  assert.throws(() => policy({ supabaseUrl: 'not a url' }), /supabaseUrl/);
  assert.throws(() => policy({ apiUrl: 'https://*.example.com' }), /apiUrl/);
});

test('inline scripts are hashed exactly; scripts with src are not', () => {
  const html = '<head><script>  var a = 1;\n</script><script type="module" src="/x.js"></script></head>';
  // sha256 of "  var a = 1;\n", base64
  assert.deepEqual(inlineScriptHashes(html), ["'sha256-ePKCp4Ul5hMEVO1EQ+qqGLBbX1uowA9/TL3uQklvQrQ='"]);
});

test('line endings are hashed as the browser parses them (CRLF and CR become LF)', () => {
  const lf = inlineScriptHashes('<script>  var a = 1;\n</script>');
  assert.deepEqual(inlineScriptHashes('<script>  var a = 1;\r\n</script>'), lf);
  assert.deepEqual(inlineScriptHashes('<script>  var a = 1;\r</script>'), lf);
});
