import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCss, cleanSrcset, isAllowedUrl } from './urls.js';

test('only package (blob:), in-document and embedded image URLs are allowed', () => {
  for (const ok of ['blob:http://localhost:5173/3f1c', '#note-3', 'data:image/png;base64,iVBORw0', '', 'chapter2.xhtml#s1']) {
    assert.equal(isAllowedUrl(ok), true, ok);
  }
  for (const bad of ['https://example.invalid/x.png', 'http://x', '//cdn.example/x.png', 'javascript:alert(1)',
    ' JavaScript:alert(1)', 'jav\tascript:alert(1)', 'data:text/html,<script>', 'ftp://x/y', 'file:///etc/passwd',
    'vbscript:x']) {
    assert.equal(isAllowedUrl(bad), false, bad);
  }
});

test('remote url() and @import are removed from CSS; local ones stay', () => {
  const css = [
    '@import url("https://example.invalid/a.css");',
    "@import 'https://example.invalid/b.css' screen;",
    '@import "local.css";',
    'p { background: url(https://example.invalid/bg.png) no-repeat; color: red }',
    ".a { background-image: url('blob:http://localhost/1') }",
    '.b { background: URL( "//cdn.example/x.png" ) }',
    '@font-face { src: url(https://fonts.example/f.woff2) format("woff2"), url(blob:http://localhost/2) }',
  ].join('\n');
  const out = cleanCss(css);
  assert.doesNotMatch(out, /example\.invalid|cdn\.example|fonts\.example/);
  assert.match(out, /@import "local.css";/);
  assert.match(out, /url\('blob:http:\/\/localhost\/1'\)/);
  assert.match(out, /url\(blob:http:\/\/localhost\/2\)/);
  assert.match(out, /color: red/);
});

test('an expression or javascript url in CSS is removed', () => {
  assert.doesNotMatch(cleanCss('p { background: url(javascript:alert(1)) }'), /javascript/i);
  assert.doesNotMatch(cleanCss('p { width: expression(alert(1)) }'), /expression\(/i);
});

test('srcset keeps only allowed candidates', () => {
  assert.equal(cleanSrcset('blob:http://l/1 1x, https://x/2.png 2x'), 'blob:http://l/1 1x');
  assert.equal(cleanSrcset('https://x/2.png 2x'), '');
});
