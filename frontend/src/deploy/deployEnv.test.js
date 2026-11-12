// node --test (npm run test:unit): the Vercel build's env check and the SPA rewrite (C14.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkDeployEnv, isVercelBuild } from './deployEnv.js';

const jwt = (payload) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`;
const good = {
  VITE_API_URL: 'https://readfocus-backend.onrender.com',
  VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_example',
  VITE_SITE_URL: 'https://readfocus.vercel.app',
};

test('a complete production env passes with no warnings', () => {
  assert.deepEqual(checkDeployEnv(good), { errors: [], warnings: [] });
});

test('each required variable is named when missing', () => {
  const { errors } = checkDeployEnv({});
  assert.deepEqual(errors, ['VITE_API_URL is not set', 'VITE_SUPABASE_URL is not set', 'VITE_SUPABASE_ANON_KEY is not set']);
});

test('the API URL must be https, not local, with no trailing slash', () => {
  assert.deepEqual(checkDeployEnv({ ...good, VITE_API_URL: 'http://api.example.com' }).errors, ['VITE_API_URL must start with https://']);
  assert.deepEqual(checkDeployEnv({ ...good, VITE_API_URL: 'https://localhost:8000' }).errors, ['VITE_API_URL points at localhost']);
  assert.deepEqual(checkDeployEnv({ ...good, VITE_API_URL: 'https://api.example.com/' }).errors, ['VITE_API_URL must not end with /']);
  assert.deepEqual(checkDeployEnv({ ...good, VITE_SUPABASE_URL: 'not a url' }).errors, ['VITE_SUPABASE_URL is not a URL']);
});

test('a secret or service-role key is refused; an anon JWT passes', () => {
  assert.match(checkDeployEnv({ ...good, VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' }).errors[0], /secret key/);
  assert.match(checkDeployEnv({ ...good, VITE_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }) }).errors[0], /service-role/);
  assert.deepEqual(checkDeployEnv({ ...good, VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon' }) }).errors, []);
});

test('a missing site URL is a warning, not an error', () => {
  const { errors, warnings } = checkDeployEnv({ ...good, VITE_SITE_URL: '' });
  assert.deepEqual(errors, []);
  assert.match(warnings[0], /VITE_SITE_URL is not set/);
});

test('only Vercel builds are checked', () => {
  assert.equal(isVercelBuild({ VERCEL: '1' }), true);
  assert.equal(isVercelBuild({}), false);
});

// vercel.json: Vercel's source is a path-to-regexp pattern; its regex part is tested here as a RegExp.
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

test('vercel.json builds with npm run build into dist', () => {
  assert.equal(vercel.buildCommand, 'npm run build');
  assert.equal(vercel.outputDirectory, 'dist');
});

test('every app route rewrites to index.html, but a missing hashed asset does not', () => {
  assert.equal(vercel.rewrites.length, 1);
  const [{ source, destination }] = vercel.rewrites;
  assert.equal(destination, '/index.html');
  const matches = (path) => new RegExp(`^${source}$`).test(path);
  for (const path of ['/', '/login', '/library', '/dashboard', '/read/abc-123', '/results/s1', '/nope']) {
    assert.ok(matches(path), path);
  }
  assert.ok(!matches('/assets/Library-AbC123.js'), 'a stale chunk must 404, not return HTML');
});
