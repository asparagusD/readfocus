import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxStyle, moveBy, newTextBox, placeAt, readTextStyle, storeTextStyle } from './textbox.js';

const letter = { width: 612, height: 792 };
const style = { colour: 'ocean', size: 12, width: 192 };
const memory = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)) };
};

test('a box goes where the reader pressed, kept inside the page', () => {
  assert.deepEqual(placeAt([72.123, 144], style, letter), { x: 72.12, y: 144 });
  assert.deepEqual(placeAt([600, 790], style, letter), { x: 420, y: 777 }); // its width and one line fit
  assert.deepEqual(placeAt([-5, -5], style, letter), { x: 0, y: 0 });
});

test('a box moves by points and stays on the page', () => {
  const data = { x: 100, y: 100, width: 192, text: 'See fig. 3', size: 12 };
  assert.deepEqual(moveBy(data, 20, -30, letter), { ...data, x: 120, y: 70 });
  assert.deepEqual(moveBy(data, 1000, 1000, letter), { ...data, x: 420, y: 777 });
});

test('on screen a box is its points times the scale', () => {
  assert.deepEqual(boxStyle({ x: 10, y: 20, width: 100, size: 12 }, 1.5), { left: 15, top: 30, width: 150, fontSize: 18 });
});

test('a new box becomes the body the API takes', () => {
  assert.deepEqual(newTextBox(4, { x: 72, y: 144 }, 'See fig. 3', style), {
    kind: 'text', page: 4, color: 'ocean', data: { x: 72, y: 144, width: 192, text: 'See fig. 3', size: 12 },
  });
  assert.equal(newTextBox(1, { x: 0, y: 0 }, 'x'.repeat(3000), style).data.text.length, 2000);
});

test("Add text's colour, size and width are kept on this device, with defaults for nothing or nonsense", () => {
  const colours = ['ink', 'ocean'];
  const store = memory();
  assert.deepEqual(readTextStyle(colours, store), { colour: 'ink', size: 12, width: 192 });
  storeTextStyle({ colour: 'ocean', size: 18, width: 320 }, store);
  assert.deepEqual(readTextStyle(colours, store), { colour: 'ocean', size: 18, width: 320 });
  store.setItem('rf-text', '{"colour":"honey","size":13,"width":7}');
  assert.deepEqual(readTextStyle(colours, store), { colour: 'ink', size: 12, width: 192 });
});
