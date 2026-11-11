import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOLD_MS, MOVE_PX, SWIPE_CLOSE_PX, createLongPress, sheetDrag } from './longPress.js';

/** A long-press driven by a fake clock: fire() runs the pending timer. */
function harness() {
  const fired = [];
  let pending = null;
  const press = createLongPress({
    onHold: (point) => fired.push(point),
    setTimer: (fn, ms) => { pending = { fn, ms }; return 1; },
    clearTimer: () => { pending = null; },
  });
  return { press, fired, fire: () => { const p = pending; pending = null; p?.fn(); }, pending: () => pending };
}

test('a still finger held for the hold time fires once, at the starting point', () => {
  const h = harness();
  h.press.down({ x: 100, y: 200, pointerType: 'touch' });
  assert.equal(h.pending().ms, HOLD_MS);
  h.press.move({ x: 103, y: 202 });
  h.fire();
  assert.deepEqual(h.fired, [{ x: 100, y: 200 }]);
  assert.equal(h.press.up(), true); // the release ends a long-press: the page must not act on it
});

test('moving further than the slop, lifting early or a cancel fires nothing', () => {
  for (const finish of [
    (p) => p.move({ x: 100 + MOVE_PX + 1, y: 200 }),
    (p) => p.up(),
    (p) => p.cancel(),
  ]) {
    const h = harness();
    h.press.down({ x: 100, y: 200, pointerType: 'touch' });
    const result = finish(h.press);
    assert.equal(h.pending(), null);
    assert.deepEqual(h.fired, []);
    if (typeof result === 'boolean') assert.equal(result, false);
  }
});

test('a mouse or pen press is not a long-press', () => {
  const h = harness();
  h.press.down({ x: 1, y: 1, pointerType: 'mouse' });
  assert.equal(h.pending(), null);
});

test('the hold matches the handoff: 450 ms, 8 px of slop', () => {
  assert.equal(HOLD_MS, 450);
  assert.equal(MOVE_PX, 8);
});

test('sheetDrag follows the finger down only and closes past the threshold', () => {
  assert.deepEqual(sheetDrag(-30), { offset: 0, close: false });
  assert.deepEqual(sheetDrag(20), { offset: 20, close: false });
  assert.deepEqual(sheetDrag(SWIPE_CLOSE_PX), { offset: SWIPE_CLOSE_PX, close: true });
});
