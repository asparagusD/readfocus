import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexRgb, imageRects, recolourPixels } from './recolour.js';

const px = (...rgba) => new Uint8ClampedArray(rgba.flat());
const BG = [35, 30, 25];
const FG = [238, 229, 213];

test('hex colours parse to RGB', () => {
  assert.deepEqual(hexRgb('#231e19'), [35, 30, 25]);
  assert.deepEqual(hexRgb('eee5d5'), [238, 229, 213]);
  assert.deepEqual(hexRgb('#abc'), [170, 187, 204]);
});

test('paper becomes the lamplight page, ink becomes the lamplight text', () => {
  const data = px([255, 255, 255, 255], [0, 0, 0, 255]);
  recolourPixels(data, FG, BG);
  assert.deepEqual([...data.slice(0, 3)], BG);
  assert.deepEqual([...data.slice(4, 7)], FG);
});

test('greys land between; alpha is kept', () => {
  const data = px([128, 128, 128, 200]);
  recolourPixels(data, FG, BG);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(data[c] - (BG[c] + FG[c]) / 2) <= 2, `channel ${c}: ${data[c]}`);
  assert.equal(data[3], 200);
});

test('coloured strokes and fills (a red curve, a blue bar) keep their colour', () => {
  const data = px([191, 51, 38, 255], [40, 90, 200, 255]);
  const before = [...data];
  recolourPixels(data, FG, BG);
  assert.deepEqual([...data], before);
});

test('image rectangles come from PDF.js corner points, in canvas pixels, padded and clamped', () => {
  // one axis-aligned image: corners (0.25,0.5) (0.25,0.25) (0.75,0.5) on a 400 x 200 canvas
  const rects = imageRects(new Float32Array([0.25, 0.5, 0.25, 0.25, 0.75, 0.5]), 400, 200);
  assert.deepEqual(rects, [{ x: 99, y: 49, width: 202, height: 52 }]);
  assert.deepEqual(imageRects(new Float32Array([0, 1, 0, 0, 1, 1]), 10, 10), [{ x: 0, y: 0, width: 10, height: 10 }]);
  assert.deepEqual(imageRects(null, 10, 10), []);
});
