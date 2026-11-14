import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationTex, mathmlToLatex } from './latexLocal.js';

const element = (annotations) => ({
  getElementsByTagName: () => annotations.map(([encoding, text]) => ({ getAttribute: () => encoding, textContent: text })),
});

test('the TeX annotation is used when the MathML has one', () => {
  assert.equal(annotationTex(element([['application/x-tex', '  E = mc^2 ']])), 'E = mc^2');
  assert.equal(annotationTex(element([['MathML-Content', 'x'], ['application/x-tex', 'a+b']])), 'a+b');
  assert.equal(annotationTex(element([['text/plain', 'x']])), null);
  assert.equal(annotationTex(null), null);
});

test('MathML without an annotation is converted on the device', async () => {
  const latex = await mathmlToLatex('<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>');
  assert.equal(latex.replace(/\s+/g, ''), '\\frac{a}{b}');
  const power = await mathmlToLatex('<math><msup><mi>c</mi><mn>2</mn></msup></math>');
  assert.equal(power.replace(/\s+/g, ''), 'c^{2}');
});

test('unreadable MathML gives an empty string, not an error', async () => {
  assert.equal(await mathmlToLatex('<math><mfrac>'), '');
});
