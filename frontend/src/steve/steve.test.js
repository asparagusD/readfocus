import test from 'node:test';
import assert from 'node:assert/strict';
import { askSteve, createEventParser, errorFrom, SteveError } from './sse.js';
import { inline, labelsOf, toBlocks } from './answer.js';
import { languageOf, tokenize } from './highlight.js';
import { chapterName, suggestions } from './suggest.js';
import { backAt, initialState, steveReducer } from './steveState.js';

// --- sse.js -----------------------------------------------------------------------------------------------------

test('events are parsed across chunk boundaries', () => {
  const feed = createEventParser();
  assert.deepEqual(feed('event: start\ndata: {"thread_id":"t1","pa'), []);
  assert.deepEqual(feed('ges":["p. 4"]}\n\nevent: token\r\ndata: {"text":"Hi"}\r\n\r\n'), [
    { name: 'start', data: { thread_id: 't1', pages: ['p. 4'] } },
    { name: 'token', data: { text: 'Hi' } },
  ]);
});

test('an unreadable event becomes an error event', () => {
  assert.deepEqual(createEventParser()('event: token\ndata: {nope\n\n'),
    [{ name: 'error', data: { code: 'unavailable', message: 'Steve sent something unreadable.' } }]);
});

test('a refusal becomes a typed SteveError', () => {
  const pause = errorFrom(429, { detail: { code: 'daily_limit', message: 'Used up.', until: '2026-11-15T00:00:00Z' } });
  assert.ok(pause instanceof SteveError);
  assert.deepEqual([pause.code, pause.status, pause.until, pause.message], [
    'daily_limit', 429, '2026-11-15T00:00:00Z', 'Used up.']);
  assert.equal(errorFrom(422, { detail: [{ msg: 'bad' }] }).code, 'invalid');
  assert.equal(errorFrom(500, null).code, 'unavailable');
});

test('askSteve posts the question with the token and streams events to onEvent', async () => {
  const sent = [];
  const encoder = new TextEncoder();
  const chunks = ['event: start\ndata: {"thread_id":"t1"}\n\nevent: tok', 'en\ndata: {"text":"x"}\n\nevent: done\ndata: {"text":"x"}'];
  const fetchImpl = async (url, init) => {
    sent.push({ url, init });
    let i = 0;
    return { ok: true, status: 200, body: { getReader: () => ({
      read: async () => (i < chunks.length ? { value: encoder.encode(chunks[i++]), done: false } : { done: true }),
    }) } };
  };
  const events = [];
  await askSteve({ url: '/steve/ask', token: 'jwt', body: { question: 'q' }, onEvent: (e) => events.push(e), fetchImpl });
  assert.deepEqual(events.map((e) => e.name), ['start', 'token', 'done']);
  assert.equal(sent[0].init.headers.Authorization, 'Bearer jwt');
  assert.equal(JSON.parse(sent[0].init.body).question, 'q');
});

test('askSteve throws the typed refusal before any event', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ detail: { code: 'no_consent', message: 'Turn on Steve first.' } }) });
  await assert.rejects(askSteve({ url: '/x', body: {}, onEvent: () => assert.fail('no event'), fetchImpl }),
    (error) => error.code === 'no_consent' && error.status === 403);
});

// --- answer.js ----------------------------------------------------------------------------------------------------

const LABELS = new Set(['p. 4', 'p. 5', 'sec. 3']);

test('paragraphs, inline math, code, emphasis and citations', () => {
  const [para] = toBlocks('He counts $n^2$ coins with `count()` **twice** and *slowly* [p. 4].', LABELS);
  assert.equal(para.type, 'para');
  assert.deepEqual(para.segments.map((s) => s.kind), ['text', 'math', 'text', 'code', 'text', 'strong', 'text', 'em', 'text', 'cite', 'text']);
  assert.equal(para.segments[1].tex, 'n^2');
  assert.equal(para.segments.find((x) => x.kind === 'cite').label, 'p. 4');
});

test('only labels that were sent become chips; a list of labels becomes several', () => {
  assert.deepEqual(inline('See [p. 4, p. 5].', LABELS).filter((s) => s.kind === 'cite').map((s) => s.label), ['p. 4', 'p. 5']);
  assert.deepEqual(inline('See [p. 99].', LABELS), [{ kind: 'text', text: 'See ' }, { kind: 'text', text: '.' }]);
  assert.deepEqual(inline('See [p. 99].', new Set()).map((s) => s.text).join(''), 'See [p. 99].'); // while streaming
});

test('fenced code keeps its language and exact text; display math and lists are blocks', () => {
  const blocks = toBlocks('Intro.\n\n```Python\ndef f(x):\n    return  x  # two spaces\n```\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n- one [p. 4]\n- two\n\n1. first\n2. second', LABELS);
  assert.deepEqual(blocks.map((b) => b.type), ['para', 'code', 'math', 'list', 'list']);
  assert.equal(blocks[1].lang, 'python');
  assert.equal(blocks[1].text, 'def f(x):\n    return  x  # two spaces');
  assert.equal(blocks[2].tex, '\\int_0^1 x\\,dx');
  assert.equal(blocks[3].items.length, 2);
  assert.equal(blocks[4].ordered, true);
});

test('a half-written answer shows an open fence and open math as they stand', () => {
  const blocks = toBlocks('Look:\n```js\nconst a = 1;\n');
  assert.deepEqual(blocks.at(-1), { type: 'code', lang: 'js', text: 'const a = 1;\n'.trimEnd(), closed: false });
  assert.equal(toBlocks('$$ a + b').at(-1).closed, false);
  assert.deepEqual(toBlocks('$$a$$')[0], { type: 'math', tex: 'a', closed: true });
});

test('nothing in an answer is treated as HTML', () => {
  const [para] = toBlocks('<img src=x onerror=alert(1)> <script>bad()</script>', LABELS);
  assert.deepEqual(para.segments, [{ kind: 'text', text: '<img src=x onerror=alert(1)> <script>bad()</script>' }]);
});

test('labelsOf reads the done event citations', () => {
  assert.deepEqual([...labelsOf([{ label: 'p. 4', anchor: {} }])], ['p. 4']);
  assert.equal(labelsOf(undefined).size, 0);
});

// --- highlight.js -------------------------------------------------------------------------------------------------

test('keywords, comments and strings are tinted; the text is unchanged', () => {
  const code = 'def toll(n):  # twice\n    return "a#b" if n else None';
  const tokens = tokenize(code, 'py');
  assert.equal(tokens.map((t) => t.text).join(''), code);
  const kinds = Object.fromEntries(tokens.filter((t) => t.kind).map((t) => [t.text.trim(), t.kind]));
  assert.equal(kinds.def, 'k');
  assert.equal(kinds['# twice'], 'c');
  assert.equal(kinds['"a#b"'], 's');
  assert.equal(languageOf('TypeScript'), 'javascript');
  assert.deepEqual(tokenize('x = 1', 'brainfuck'), [{ text: 'x = 1', kind: null }]);
  assert.equal(tokenize('/* a */ let x // b', 'js').filter((t) => t.kind === 'c').length, 2);
});

// --- suggest.js ---------------------------------------------------------------------------------------------------

test('three suggestions from the chapter, or plain ones without it', () => {
  assert.deepEqual(suggestions('4.2 Orthogonality ........ 44'), [
    'What is the main idea of “4.2 Orthogonality”?',
    'Which terms in “4.2 Orthogonality” should I be sure I understand?',
    'How does “4.2 Orthogonality” connect to what came before?',
  ]);
  assert.equal(suggestions('').length, 3);
  assert.ok(suggestions(null)[0].includes('these pages'));
  assert.ok(chapterName('x'.repeat(80)).length <= 60);
});

// --- steveState.js --------------------------------------------------------------------------------------------

const settings = (over = {}) => ({ enabled: true, consent: { current: true }, notice: { version: 'v', text: 't' }, ...over });
const run = (actions, state = initialState) => actions.reduce(steveReducer, state);

test('settings decide the first view: consent, off or chat', () => {
  assert.equal(run([{ type: 'settings', settings: settings({ consent: { current: false } }) }]).view, 'consent');
  assert.equal(run([{ type: 'settings', settings: settings({ enabled: false }) }]).view, 'off');
  assert.equal(run([{ type: 'settings', settings: settings() }]).view, 'chat');
  assert.equal(run([{ type: 'settings_failed' }]).view, 'load_error');
});

test('an answer streams into the last message and is replaced by the checked text', () => {
  const state = run([
    { type: 'settings', settings: settings() },
    { type: 'ask', question: 'Why twice?' },
    { type: 'start', data: { thread_id: 't1', pages: ['p. 4'] } },
    { type: 'token', data: { text: 'He counts [p. 9' } },
    { type: 'token', data: { text: '9].' } },
  ]);
  assert.equal(state.messages.at(-1).text, 'He counts [p. 99].');
  assert.equal(state.messages.at(-1).status, 'streaming');
  const done = steveReducer(state, { type: 'done', data: { text: 'He counts.', citations: [], usage: { cached: false }, message_id: 'm1' } });
  assert.deepEqual([done.messages.at(-1).text, done.messages.at(-1).status, done.threadId], ['He counts.', 'done', 't1']);
});

test('a pause shows the resting state and drops the unanswered question', () => {
  const state = run([
    { type: 'settings', settings: settings() },
    { type: 'ask', question: 'One more?' },
    { type: 'failed', error: { code: 'daily_limit', until: '2026-11-15T00:00:00Z' } },
  ]);
  assert.equal(state.view, 'paused');
  assert.deepEqual(state.pause, { code: 'daily_limit', until: '2026-11-15T00:00:00Z' });
  assert.equal(state.messages.length, 0);
  assert.equal(steveReducer(state, { type: 'resume' }).view, 'chat');
});

test('other failures stay in the conversation as an error the reader can retry', () => {
  const state = run([{ type: 'settings', settings: settings() }, { type: 'ask', question: 'q' },
    { type: 'failed', error: { code: 'timeout', message: 'Too long.' } }]);
  assert.deepEqual([state.view, state.messages.at(-1).status, state.messages.at(-1).error.code], ['chat', 'error', 'timeout']);
  assert.equal(run([{ type: 'failed', error: { code: 'no_consent' } }], state).view, 'consent');
});

test('stop keeps what was written; the key view returns where it came from', () => {
  let state = run([{ type: 'settings', settings: settings() }, { type: 'ask', question: 'q' }, { type: 'token', data: { text: 'Part' } }, { type: 'stopped' }]);
  assert.deepEqual([state.messages.at(-1).text, state.messages.at(-1).status], ['Part', 'stopped']);
  state = run([{ type: 'failed', error: { code: 'paused_quota' } }, { type: 'show_key' }], run([{ type: 'ask', question: 'x' }], state));
  assert.equal(state.view, 'key');
  assert.equal(steveReducer(state, { type: 'back' }).view, 'paused');
  assert.equal(run([{ type: 'enabled', on: false }], state).view, 'off');
});

test('backAt names the reader\'s time, or tomorrow', () => {
  const now = new Date(2026, 10, 14, 18, 0);
  assert.equal(backAt(null, now), 'tomorrow');
  assert.match(backAt(new Date(2026, 10, 14, 18, 10).toISOString(), now), /^at /);
  assert.match(backAt(new Date(2026, 10, 15, 0, 0).toISOString(), now), /^tomorrow at /);
});
