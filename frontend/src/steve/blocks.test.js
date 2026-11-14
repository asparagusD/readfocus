import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, base64Bytes, base64Of, cropRect, elementPath, regionLabel, shrinkSteps } from './blocks.js';

test('each kind has its actions; without Steve only the device copies stay', () => {
  assert.deepEqual(actionsFor('math'), ['explain_equation', 'copy_latex']);
  assert.deepEqual(actionsFor('code'), ['copy_code', 'explain_code']);
  assert.deepEqual(actionsFor('figure'), ['explain_figure']);
  assert.deepEqual(actionsFor('table'), []);
  assert.deepEqual(actionsFor('code', { steve: false }), ['copy_code']);
  assert.deepEqual(actionsFor('math', { steve: false }), []); // a PDF equation's LaTeX comes from Steve
  assert.deepEqual(actionsFor('math', { steve: false, format: 'epub' }), ['copy_latex']); // an EPUB's, on the device
  assert.equal(regionLabel('math', 'p. 4'), 'Equation, p. 4');
});

test('a crop is the box plus padding in canvas pixels, clamped, at twice its CSS size', () => {
  // A page drawn at 1.5 CSS px per point on a 2x screen: 3 canvas px per point.
  const crop = cropRect({ bbox: [100, 150, 300, 170], scale: 1.5, ratio: 2, canvasWidth: 1836, canvasHeight: 2376 });
  assert.deepEqual(crop, { sx: 282, sy: 432, sw: 636, sh: 96, dw: 636, dh: 96 });
  const edge = cropRect({ bbox: [0, 0, 20, 10], scale: 1, ratio: 1, canvasWidth: 15, canvasHeight: 100 });
  assert.deepEqual([edge.sx, edge.sy, edge.sw], [0, 0, 15]); // never off the canvas
});

test('shrink steps go down by a fifth and stop at 64 px', () => {
  const steps = shrinkSteps(1000, 500);
  assert.deepEqual(steps[0], { width: 1000, height: 500 });
  assert.deepEqual(steps[1], { width: 800, height: 400 });
  assert.ok(steps.every((s) => Math.min(s.width, s.height) >= 64));
  assert.deepEqual(shrinkSteps(30, 20), [{ width: 30, height: 20 }]);
});

test('an element path counts element siblings in CFI steps', () => {
  const el = (children = []) => {
    const node = { children, parentElement: null };
    children.forEach((c) => { c.parentElement = node; });
    return node;
  };
  const target = el();
  const body = el([el(), el(), target]);
  el([el(), body]); // html: head, body
  assert.equal(elementPath(target), '/4/6');
  assert.equal(elementPath(body), '/4');
});

test('base64 helpers', () => {
  assert.equal(base64Of('data:image/png;base64,iVBORw0KGgo='), 'iVBORw0KGgo=');
  assert.equal(base64Of('abc'), 'abc');
  assert.equal(base64Bytes('AAAA'), 3);
  assert.equal(base64Bytes('AAA='), 2);
});
