import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPoint, blocksFor, erasedSummary, halfWidth, MAX_POINTS, newStroke, pagePoint, quadsHit, readInk, segmentDistance, storeInk, strokeHit, strokePath, sweep,
} from './ink.js';

const box = { left: 100, top: 50, width: 612, height: 792 }; // a Letter page at scale 1
const memory = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)) };
};

test('a pointer becomes a page point in PDF points, at any zoom, kept on the page', () => {
  assert.deepEqual(pagePoint(172, 194, box, 1), [72, 144, 0.5]);
  assert.deepEqual(pagePoint(244, 338, { ...box, width: 1224, height: 1584 }, 2, 0.8), [72, 144, 0.8]); // 200 %
  assert.deepEqual(pagePoint(50, 2000, box, 1, 3), [0, 792, 1]); // off the page: its edge; pressure at most 1
  assert.deepEqual(pagePoint(150, 60, box, 1, Number.NaN), [50, 10, 0.5]);
});

test('points closer than the step are dropped, and a stroke stops growing at the server limit', () => {
  let points = addPoint([], [10, 10, 0.5]);
  points = addPoint(points, [10.3, 10.3, 0.5]);
  assert.equal(points.length, 1);
  points = addPoint(points, [11, 10, 0.5]);
  assert.equal(points.length, 2);
  const full = Array.from({ length: MAX_POINTS }, (_, i) => [i, 0, 0.5]);
  assert.equal(addPoint(full, [5000, 5, 0.5]).length, MAX_POINTS);
});

test("a pen's pressure widens or thins the line; a mouse's 0.5 keeps the width", () => {
  assert.equal(halfWidth(2, 0.5), 1);
  assert.ok(halfWidth(2, 1) > halfWidth(2, 0.5) && halfWidth(2, 0) < halfWidth(2, 0.5));
  assert.equal(halfWidth(2, 0), 0.4);
});

test('a stroke is a closed outline around its points; a tap is a dot', () => {
  const line = strokePath({ points: [[10, 10, 0.5], [20, 10, 0.5], [30, 10, 0.5]], width: 2 });
  assert.match(line, /^M10 11Q.*A1 1 0 0 1 30 9.*Z$/); // the left side (y + 1), round the end, back along y - 1
  assert.match(strokePath({ points: [[10, 10, 0.5]], width: 4 }), /^M8 10a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z$/);
  assert.equal(strokePath({ points: [], width: 2 }), '');
});

test("Draw's colour and thickness are kept on this device, with defaults for nothing or nonsense", () => {
  const colours = ['ink', 'ocean'];
  const store = memory();
  assert.deepEqual(readInk(colours, store), { colour: 'ink', width: 2 });
  storeInk({ colour: 'ocean', width: 6 }, store);
  assert.deepEqual(readInk(colours, store), { colour: 'ocean', width: 6 });
  store.setItem('rf-ink', '{"colour":"honey","width":5}');
  assert.deepEqual(readInk(colours, store), { colour: 'ink', width: 2 });
  store.setItem('rf-ink', 'not json');
  assert.deepEqual(readInk(colours, store), { colour: 'ink', width: 2 });
});

test('a finished stroke becomes the body the API takes', () => {
  assert.deepEqual(newStroke(3, [[1, 2, 0.5]], { colour: 'poppy', width: 4 }),
    { kind: 'ink', page: 3, color: 'poppy', data: { points: [[1, 2, 0.5]], width: 4 } });
});

test('marks load 20 pages at a time: the blocks round the pages near the view', () => {
  assert.deepEqual(blocksFor([1, 2]), [0]);
  assert.deepEqual(blocksFor([19, 20]), [0, 1]); // two pages past 20 reach the next block
  assert.deepEqual(blocksFor([45]), [2]);
  assert.deepEqual(blocksFor([]), []);
});

test("the eraser touches a stroke within its radius and the stroke's half-width, not beyond", () => {
  const stroke = { points: [[10, 10, 0.5], [50, 10, 0.5]], width: 2 }; // half-width 1
  assert.equal(strokeHit(stroke, [30, 14], 3), true); // 4 from the line: 3 + 1
  assert.equal(strokeHit(stroke, [30, 14.5], 3), false);
  assert.equal(strokeHit(stroke, [52, 10], 1), true); // past the end, by its round cap
  assert.equal(strokeHit({ points: [[5, 5, 0.5]], width: 4 }, [8, 5], 1), true); // a dot
  assert.equal(segmentDistance([3, 4], [0, 0], [0, 0]), 5);
});

test("the eraser touches a highlight's quads, and a fast drag is swept with no gaps", () => {
  assert.equal(quadsHit([[72, 140, 500, 152]], [300, 155], 4), true);
  assert.equal(quadsHit([[72, 140, 500, 152]], [300, 160], 4), false);
  const path = sweep([0, 0], [20, 0], 4);
  assert.deepEqual(path[0], [0, 0]);
  assert.deepEqual(path.at(-1), [20, 0]);
  assert.ok(path.every((q, i) => i === 0 || q[0] - path[i - 1][0] <= 2));
});

test("one drag's toast says what it erased", () => {
  assert.equal(erasedSummary(2, 1), 'Erased 2 drawings and a highlight.');
  assert.equal(erasedSummary(1, 0), 'Erased a drawing.');
  assert.equal(erasedSummary(0, 3), 'Erased 3 highlights.');
  assert.equal(erasedSummary(0, 0), '');
});
