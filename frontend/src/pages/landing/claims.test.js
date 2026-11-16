// Public claims stay true (C25.1). Steve uses Google's Gemini since C20, so no page may say ReadFocus has no AI,
// and the gamification copy keeps away from loss and guilt (C24 plan, GAMIFICATION "no dark patterns").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = join(SRC, '..');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(jsx?|json|html)$/.test(name) && !/\.test\.js$/.test(name) ? [path] : [];
  });
}

const FALSE_CLAIMS = /no generative ai|no (llm|ai)\b|without (any )?ai\b|nothing writes text|no chatbot|never uses ai/i;

test('no page, component or the HTML shell claims ReadFocus has no AI', () => {
  const hits = [...files(SRC), join(FRONTEND, 'index.html')]
    .filter((path) => FALSE_CLAIMS.test(readFileSync(path, 'utf8')))
    .map((path) => relative(FRONTEND, path));
  assert.deepEqual(hits, []);
});

test('the privacy page and the landing page say who uses Gemini and that it can be turned off', () => {
  const privacy = readFileSync(join(SRC, 'pages', 'Privacy.jsx'), 'utf8').replace(/\s+/g, ' ');
  assert.match(privacy, /Steve, the optional study assistant, uses Google’s Gemini/);
  assert.match(privacy, /on the free tier, may be used to improve Google’s products\. You can turn Steve off\./);
  const features = readFileSync(join(SRC, 'pages', 'landing', 'Features.jsx'), 'utf8');
  assert.match(features, /He uses Google’s Gemini/);
});

const LOSS = /\b(lose|losing|lost)\b|don[’']t break|hurry|last chance|you missed|running out/i;

test('the gamification copy has no loss or guilt words', () => {
  const sources = [...files(join(SRC, 'gamification')), join(SRC, 'pages', 'League.jsx')];
  const hits = sources.filter((path) => LOSS.test(readFileSync(path, 'utf8'))).map((path) => relative(FRONTEND, path));
  assert.deepEqual(hits, []);
});
