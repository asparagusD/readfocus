import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { PDFDocument, PDFName } from 'pdf-lib';
import { colourTables } from './saveCopy.js';

// The worker's module sets self.onmessage when imported; under Node, `self` is a stand-in that keeps what it posts.
const posted = [];
globalThis.self = { postMessage: (message, transfer) => posted.push({ message, transfer }) };
await import('./saveCopy.worker.js');
const ask = async (data) => {
  posted.length = 0;
  await globalThis.self.onmessage({ data });
  return posted[0];
};

const book = async () => (await PDFDocument.create()).addPage([612, 792]).doc.save();
const colours = { highlight: { honey: '#f4e2a8' }, underline: {}, mark: {} };
const highlight = { id: 'h', style: 'highlight', color: 'honey', comment: null,
  anchors: [{ kind: 'pdf', page: 1, quads: [[72, 100, 300, 112]], text: 'the lamp' }] };

test('the colour tables hold just the names the marks use, resolved on the page', () => {
  const seen = [];
  const resolve = (kind) => (name) => { seen.push(`${kind}:${name}`); return `${kind}-${name}`; };
  const tables = colourTables({ highlight: resolve('hl'), underline: resolve('ul'), mark: resolve('mk') },
    [{ color: 'honey' }, { color: 'honey' }, { color: 'sky' }], [{ color: 'ink' }, {}]);
  assert.deepEqual(tables, { highlight: { honey: 'hl-honey', sky: 'hl-sky' }, underline: { honey: 'ul-honey', sky: 'ul-sky' },
    mark: { ink: 'mk-ink' } });
  assert.equal(seen.length, 5); // each name read once
});

test('the worker writes the copy and hands it back transferred', async () => {
  const { message, transfer } = await ask({ bytes: await book(), annotations: [highlight], marks: [], colours });
  assert.equal(message.ok, true);
  assert.deepEqual(transfer, [message.out.buffer]);
  const pdf = await PDFDocument.load(message.out);
  const annot = pdf.context.lookup(pdf.getPages()[0].node.Annots().get(0));
  assert.equal(annot.get(PDFName.of('Subtype')).toString(), '/Highlight');
  assert.deepEqual(annot.get(PDFName.of('C')).asArray().map((n) => Math.round(n.asNumber() * 255)), [244, 226, 168]);
});

test('an encrypted file comes back untouched; anything else that fails says why', async () => {
  const plain = Buffer.from(await (await PDFDocument.load(await book())).save({ useObjectStreams: false })).toString('latin1');
  const locked = new Uint8Array(Buffer.from(plain.replace('trailer\n<<', 'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 >>'), 'latin1'));
  const { message } = await ask({ bytes: locked, annotations: [highlight], marks: [], colours });
  assert.deepEqual([message.ok, message.code], [false, 'encrypted']);
  assert.equal(message.bytes, locked);
  const broken = await ask({ bytes: new Uint8Array([1, 2, 3]), annotations: [], marks: [], colours });
  assert.deepEqual([broken.message.ok, broken.message.code], [false, 'failed']);
  assert.ok(broken.message.message.length > 0);
});
