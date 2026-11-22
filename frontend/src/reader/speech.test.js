import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScript, epubRuns } from './readAloud.js';
import {
  createSpeaker, DEFAULT_READ_ALOUD, pickVoice, RATES, readReadAloud, sortVoices, stepRate, storeReadAloud, voiceLabel,
} from './speech.js';

const memory = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)) };
};

test('the voice and speed are kept, and nonsense gives the defaults', () => {
  const store = memory();
  assert.deepEqual(readReadAloud(store), DEFAULT_READ_ALOUD);
  storeReadAloud({ voice: 'aria', rate: 1.5 }, store);
  assert.deepEqual(readReadAloud(store), { voice: 'aria', rate: 1.5 });
  store.setItem('rf-read-aloud', '{"voice": 3, "rate": 9}');
  assert.deepEqual(readReadAloud(store), DEFAULT_READ_ALOUD);
  store.setItem('rf-read-aloud', 'not json');
  assert.deepEqual(readReadAloud(store), DEFAULT_READ_ALOUD);
  assert.deepEqual(readReadAloud(null), DEFAULT_READ_ALOUD);
});

test('speed steps between 0.5x and 2x', () => {
  assert.equal(stepRate(1, 1), 1.25);
  assert.equal(stepRate(0.5, -1), 0.5);
  assert.equal(stepRate(2, 1), 2);
  assert.equal(stepRate(3, -1), 0.75); // an unknown speed steps from 1x
  assert.deepEqual([RATES[0], RATES.at(-1)], [0.5, 2]);
});

const voices = [
  { name: 'Microsoft Hedda - German (Germany)', lang: 'de-DE', voiceURI: 'hedda' },
  { name: 'Microsoft David - English (United States)', lang: 'en-US', voiceURI: 'david', default: true },
  { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', voiceURI: 'aria' },
  { name: 'Microsoft Katja Online (Natural) - German (Germany)', lang: 'de-DE', voiceURI: 'katja' },
  { name: 'Microsoft Zira - English (United States)', lang: 'en-US', voiceURI: 'zira' },
];

test('English natural voices come first, then the default, then the rest', () => {
  assert.deepEqual(sortVoices(voices).map((v) => v.voiceURI), ['aria', 'david', 'zira', 'katja', 'hedda']);
  assert.deepEqual(sortVoices(undefined), []);
  assert.equal(pickVoice(voices, 'zira').voiceURI, 'zira');
  assert.equal(pickVoice(voices, 'gone').voiceURI, 'aria');
  assert.equal(pickVoice([], null), null);
  assert.equal(voiceLabel(voices[2]), 'Aria (Natural) - English (United States)');
});

/** A fake speechSynthesis: it keeps what was spoken; a test fires an utterance's events. */
function fakeSynth() {
  const spoken = [];
  return {
    spoken,
    cancels: 0,
    speak(u) { spoken.push(u); },
    cancel() { this.cancels += 1; },
  };
}
class Utterance { constructor(text) { this.text = text; } }

const script = buildScript(epubRuns({ nodeType: 1, localName: 'div', childNodes: [
  { nodeType: 1, localName: 'p', childNodes: [{ nodeType: 3, nodeValue: 'One two. Three four.' }] },
  { nodeType: 1, localName: 'p', childNodes: [{ nodeType: 3, nodeValue: 'Five six.' }] },
] }));

function speaker(extra = {}) {
  const synth = fakeSynth();
  const words = [];
  const sentences = [];
  const ends = [];
  const s = createSpeaker({ synth, Utterance, onWord: (w) => words.push(w), onSentence: (x) => sentences.push(x), onEnd: (e) => ends.push(e ?? 'done'), ...extra });
  return { s, synth, words, sentences, ends, last: () => synth.spoken.at(-1) };
}

test('a script is spoken sentence by sentence to its end', () => {
  const { s, synth, sentences, ends, last } = speaker();
  s.play(script);
  assert.equal(last().text, 'One two.');
  last().onend();
  assert.equal(last().text, 'Three four.');
  last().onend();
  assert.equal(last().text, 'Five six.');
  last().onend();
  assert.deepEqual(sentences, [{ p: 0, s: 0 }, { p: 0, s: 1 }, { p: 1, s: 0 }]);
  assert.deepEqual(ends, ['done']);
  assert.equal(s.playing, false);
  assert.equal(synth.spoken.length, 3);
});

test('each word boundary names the word in its runs, from a mid-sentence start too', () => {
  const { s, words, last } = speaker();
  s.play(script, { p: 0, s: 1, c: 6 }); // "four."
  assert.equal(last().text, 'four.');
  last().onboundary({ name: 'word', charIndex: 0, charLength: 4 });
  last().onboundary({ name: 'sentence', charIndex: 0 }); // not a word: ignored
  assert.deepEqual(words, [{ p: 0, s: 1, ranges: [{ run: 0, start: 15, end: 19 }] }]);
});

test('pause remembers the word, resume speaks from it, and a cancelled utterance is ignored', () => {
  const { s, synth, last } = speaker();
  s.play(script, { p: 0, s: 1, c: 0 });
  const first = last();
  first.onboundary({ name: 'word', charIndex: 6, charLength: 4 }); // "four."
  s.pause();
  assert.equal(s.playing, false);
  first.onend(); // Chromium ends a cancelled utterance: nothing moves on
  assert.equal(synth.spoken.length, 1);
  s.resume();
  assert.equal(last().text, 'four.');
  assert.equal(s.playing, true);
});

test('a speed or voice change speaks again from the last word; paused, it only waits', () => {
  const { s, last } = speaker();
  s.play(script);
  last().onboundary({ name: 'word', charIndex: 4, charLength: 4 });
  s.setRate(1.5);
  assert.equal(last().text, 'two.');
  assert.equal(last().rate, 1.5);
  s.setVoice(voices[2]);
  assert.equal(last().text, 'two.');
  assert.equal(last().voice, voices[2]);
  assert.equal(last().lang, 'en-US');
  s.pause();
  const before = s.place;
  s.setRate(2);
  assert.equal(s.playing, false);
  assert.deepEqual(s.place, before);
});

test('next and previous paragraph start a paragraph; past the last one ends', () => {
  const { s, ends, last } = speaker();
  s.play(script);
  s.skip(1);
  assert.equal(last().text, 'Five six.');
  s.skip(-1);
  assert.equal(last().text, 'One two.');
  s.skip(-1);
  assert.equal(last().text, 'One two.');
  s.skip(1);
  s.skip(1);
  assert.deepEqual(ends, ['done']);
});

test('a voice error ends reading with it; an interruption does not', () => {
  const { s, ends, last } = speaker();
  s.play(script);
  last().onerror({ error: 'interrupted' });
  assert.equal(s.playing, true);
  last().onerror({ error: 'synthesis-failed' });
  assert.deepEqual(ends, ['synthesis-failed']);
  assert.equal(s.playing, false);
  s.stop();
  assert.equal(s.place, null);
});
