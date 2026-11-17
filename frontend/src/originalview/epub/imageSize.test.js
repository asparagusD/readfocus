import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize } from './imageSize.js';

const bytes = (...parts) => new Uint8Array(parts.flat());
const u16be = (n) => [(n >> 8) & 255, n & 255];
const u32be = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

test('PNG: width and height from IHDR', () => {
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), [0x49, 0x48, 0x44, 0x52], u32be(1200), u32be(800));
  assert.deepEqual(imageSize(png), { width: 1200, height: 800 });
});

test('GIF: little-endian logical screen size', () => {
  assert.deepEqual(imageSize(bytes([...'GIF89a'].map((c) => c.charCodeAt(0)), [64, 0, 48, 0])), { width: 64, height: 48 });
});

test('JPEG: the first SOF segment after other segments', () => {
  const app0 = [0xff, 0xe0, ...u16be(16), ...new Array(14).fill(0)];
  const sof2 = [0xff, 0xc2, ...u16be(17), 8, ...u16be(900), ...u16be(1600), 3, ...new Array(9).fill(0)];
  assert.deepEqual(imageSize(bytes([0xff, 0xd8], app0, sof2)), { width: 1600, height: 900 });
});

test('WebP: lossy (VP8 ) and extended (VP8X)', () => {
  const riff = (kind, payload) => bytes([...'RIFF'].map((c) => c.charCodeAt(0)), [0, 0, 0, 0],
    [...'WEBP'].map((c) => c.charCodeAt(0)), [...kind].map((c) => c.charCodeAt(0)), [0, 0, 0, 0], payload);
  assert.deepEqual(imageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0x00])), { width: 320, height: 240 });
  assert.deepEqual(imageSize(riff('VP8X', [0, 0, 0, 0, 0x3f, 0x01, 0x00, 0xef, 0x00, 0x00])), { width: 320, height: 240 });
});

test('SVG: width and height attributes, else the viewBox', () => {
  const enc = (s) => new TextEncoder().encode(s);
  assert.deepEqual(imageSize(enc('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"/>')), { width: 400, height: 200 });
  assert.deepEqual(imageSize(enc('<?xml version="1.0"?><svg viewBox="0 0 120.5 60" xmlns="http://www.w3.org/2000/svg"/>')), { width: 120.5, height: 60 });
  assert.equal(imageSize(enc('<svg width="100%" height="50%"/>')), null);
});

test('anything else, or a truncated header, is null', () => {
  assert.equal(imageSize(bytes([1, 2, 3])), null);
  assert.equal(imageSize(bytes([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(imageSize(new Uint8Array(0)), null);
});
