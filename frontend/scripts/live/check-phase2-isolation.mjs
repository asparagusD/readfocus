// Phase-2 cross-user isolation, live (C25.3). Not a standard check: it writes to the shared Supabase project,
// so run it only with approval: `npm --prefix frontend run test:phase2-isolation`.
//
// Test user A gets phase-2 rows on one book, made through the API where the API makes them (sample.pdf, a
// highlight, a note and its picture, a focus session and its events) and seeded with the service key where only
// Gemini could (a Steve thread and message, an equation's LaTeX) or where C24.7 did (XP, a badge, progress).
// Test user B then tries to read, change and forge them through every phase-2 API route that takes an id and
// straight through Supabase (anon key and B's session: RLS) and Storage. equation_latex: B uploads the same file,
// so B's own copy gets A's cached LaTeX (by design: the file's hash, not the reader), while B asking with A's book
// gets nothing. The run deletes both books (cascade), the note picture and every seeded row, and reports what is
// left. No Gemini call is made: B never consents, and the LaTeX asked for is cached.
//
// Credentials: ../.env.test (TEST_USER_A_*, TEST_USER_B_*), ../.env (SUPABASE_SERVICE_KEY), frontend/.env
// (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY); none is printed. API: API_URL, default http://localhost:8000.
// bbox_hash is computed by Python (the backend's own two lines), so .venv's python must be on PATH or in PYTHON.
// Exit code 1 when any probe is not denied.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (file) => {
  const vars = {};
  if (!existsSync(file)) return vars;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
};
const env = { ...read(`${ROOT}.env`), ...read(`${ROOT}frontend/.env`), ...read(`${ROOT}.env.test`), ...process.env };
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'TEST_USER_A_EMAIL',
  'TEST_USER_A_PASSWORD', 'TEST_USER_B_EMAIL', 'TEST_USER_B_PASSWORD']) {
  if (!env[key]) throw new Error(`${key} is needed`);
}
const API = (env.API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const PYTHON = env.PYTHON ?? (existsSync(`${ROOT}.venv/Scripts/python.exe`) ? `${ROOT}.venv/Scripts/python.exe` : 'python');
const OPTS = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, OPTS);
const service = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, OPTS);
const RUN = `p2-isolation-${Date.now()}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const LATEX = `\\int_0^1 x\\,dx = \\tfrac{1}{2} % ${RUN}`;

const results = [];
const record = (area, probe, got, ok) => {
  results.push({ area, probe, got, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${area.padEnd(7)} ${probe} -> ${got}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(email, password) {
  const sb = anon();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return { sb, token: data.session.access_token, id: data.user.id };
}

async function api(method, path, token, body, extra = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
  let payload = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, text };
}

/** The backend's bbox_hash (backend/routers/steve_ask.py), run by Python so float formatting matches exactly. */
function bboxHash(bbox) {
  const code = 'import hashlib,json,sys; b=json.loads(sys.argv[1]); '
    + 'print(hashlib.sha256(json.dumps([round(float(v),1) for v in b],separators=(",",":")).encode()).hexdigest()[:32])';
  const out = spawnSync(PYTHON, ['-c', code, JSON.stringify(bbox)], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`bbox_hash: ${out.stderr}`);
  return out.stdout.trim();
}

async function upload(user, label) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(`${ROOT}sample.pdf`)], { type: 'application/pdf' }), 'sample.pdf');
  form.append('title', `${label} ${RUN}`);
  form.append('author', 'ReadFocus phase-2 isolation check');
  const r = await api('POST', '/books/upload', user.token, form);
  if (r.status !== 200) throw new Error(`${label} upload: ${r.status} ${r.text.slice(0, 200)}`);
  return r.json.book_id;
}

/** Until the book's ingestion and its regions job are done (the region map holds the equations). */
async function settle(user, book) {
  for (let i = 0; ; i += 1) {
    const status = await api('GET', `/books/${book}/status`, user.token);
    const job = status.json?.ingestion?.status;
    const regions = await service.from('processing_jobs').select('status').eq('book_id', book).eq('kind', 'regions');
    const regionsDone = regions.data?.some((j) => j.status === 'done');
    if (status.json?.status === 'ready' && (job === 'done' || job == null) && regionsDone) return;
    if (job === 'failed' || status.json?.status === 'error' || i > 180) throw new Error(`book ${book}: ${status.text.slice(0, 200)}`);
    await sleep(5000);
  }
}

const TABLES = [ // [table, column, which id of A's]
  ['annotations', 'book_id', 'book'], ['note_blocks', 'book_id', 'book'], ['focus_sessions', 'book_id', 'book'],
  ['focus_events', 'session_id', 'focus'], ['steve_threads', 'book_id', 'book'], ['steve_messages', 'thread_id', 'thread'],
  ['page_regions', 'book_id', 'book'], ['xp_events', 'user_id', 'user'], ['user_badges', 'user_id', 'user'],
  ['user_progress', 'user_id', 'user'], ['league_members', 'user_id', 'user'], ['steve_usage', 'user_id', 'user'],
];

async function main() {
  const started = Date.now();
  for (let i = 0; ; i += 1) {
    const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
    if (health?.model_ready) break;
    if (i > 60) throw new Error('API not ready after 5 minutes');
    await sleep(5000);
  }
  const A = await signIn(env.TEST_USER_A_EMAIL, env.TEST_USER_A_PASSWORD);
  const B = await signIn(env.TEST_USER_B_EMAIL, env.TEST_USER_B_PASSWORD);
  if (A.id === B.id) throw new Error('A and B are the same user');
  const ids = { user: A.id, book: null, bBook: null, focus: null, thread: null, annotation: null, note: null, file: null };
  const seeded = { xp: false, badge: false, progress: false, latex: null };
  try {
    // 1. A's phase-2 rows.
    ids.book = await upload(A, 'Isolation A');
    console.log(`A's book ${ids.book}; waiting for ingestion and the region map`);
    await settle(A, ids.book);
    const quad = (page) => ({ kind: 'pdf', page, quads: [[72.5, 140.2, 500, 152]], text: 'isolation probe' });
    const hl = await api('POST', `/books/${ids.book}/annotations`, A.token,
      { anchors: [quad(2)], style: 'highlight', color: 'honey', position_start: 2_014_014, position_end: 2_015_299 });
    if (hl.status !== 201) throw new Error(`A's highlight: ${hl.status} ${hl.text.slice(0, 200)}`);
    ids.annotation = hl.json.id;
    const pic = await api('POST', `/books/${ids.book}/note-files`, A.token, { content_type: 'image/png', data: PNG.toString('base64') });
    if (pic.status !== 201) throw new Error(`A's note file: ${pic.status} ${pic.text.slice(0, 200)}`);
    ids.file = pic.json.path;
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `A's private note ${RUN}` }] }] };
    const note = await api('POST', `/books/${ids.book}/notes`, A.token, { kind: 'text', scope: 'selection', anchors: [quad(2)],
      position_start: 2_014_014, position_end: 2_015_299, content: doc, thumbnail_path: ids.file });
    if (note.status !== 201) throw new Error(`A's note: ${note.status} ${note.text.slice(0, 200)}`);
    ids.note = note.json.id;
    const body = await api('GET', `/books/${ids.book}/body-start`, A.token);
    const startPage = body.json?.page ?? body.json?.body_start?.page ?? 1;
    const focus = await api('POST', '/focus/start', A.token, { book_id: ids.book, anchor: { kind: 'pdf', page: startPage, quads: [[50, 100, 50, 100]], text: '' } });
    if (![200, 201].includes(focus.status)) throw new Error(`A's focus start: ${focus.status} ${focus.text.slice(0, 200)}`);
    ids.focus = focus.json.id;
    await api('POST', `/focus/${ids.focus}/event`, A.token, { kind: 'heartbeat', had_input: true });
    const thread = await service.from('steve_threads').insert({ user_id: A.id, book_id: ids.book }).select('id').single();
    if (thread.error) throw new Error(`seed steve_threads: ${thread.error.message}`);
    ids.thread = thread.data.id;
    const msg = await service.from('steve_messages').insert({ thread_id: ids.thread, user_id: A.id, role: 'reader', content: `A asked ${RUN}` });
    if (msg.error) throw new Error(`seed steve_messages: ${msg.error.message}`);
    const xp = await service.from('xp_events').insert({ user_id: A.id, source: 'adjustment', source_id: RUN, amount: 1,
      earned_at: '2000-01-01T00:00:00Z', local_day: '2000-01-01' });
    if (xp.error) throw new Error(`seed xp_events: ${xp.error.message}`);
    seeded.xp = true;
    const badge = await service.from('user_badges').insert({ user_id: A.id, badge_id: RUN.slice(0, 60) });
    if (badge.error) throw new Error(`seed user_badges: ${badge.error.message}`);
    seeded.badge = true;
    const had = await service.from('user_progress').select('user_id').eq('user_id', A.id);
    if (!had.data?.length) {
      const made = await service.from('user_progress').insert({ user_id: A.id });
      if (made.error) throw new Error(`seed user_progress: ${made.error.message}`);
      seeded.progress = true;
    }
    const book = await service.from('books').select('file_sha256').eq('id', ids.book).single();
    const eq = await service.from('page_regions').select('id, page, bbox').eq('book_id', ids.book).eq('kind', 'math')
      .not('bbox', 'is', null).order('page').limit(1).single();
    if (eq.error) throw new Error(`no math region in A's book: ${eq.error.message}`);
    seeded.latex = { file_sha256: book.data.file_sha256, page: eq.data.page, bbox_hash: bboxHash(eq.data.bbox) };
    const latex = await service.from('equation_latex').insert({ ...seeded.latex, latex: LATEX, model: 'isolation-check' });
    if (latex.error) throw new Error(`seed equation_latex: ${latex.error.message}`);
    console.log(`A has: highlight, note + picture, focus session + event, Steve thread + message (seeded), XP, badge, progress, LaTeX for page ${eq.data.page} (seeded)`);

    // 2. Controls: A sees its own rows and gets its own LaTeX, so a zero for B means refused, not absent.
    const seenByA = {};
    for (const [table, column, which] of TABLES) {
      const { data, error } = await A.sb.from(table).select('*').eq(column, ids[which]);
      seenByA[table] = error ? `error ${error.code}` : data.length;
    }
    console.log('rows A sees of its own:', JSON.stringify(seenByA));
    for (const table of ['annotations', 'note_blocks', 'focus_sessions', 'steve_threads', 'steve_messages', 'xp_events', 'user_badges']) {
      record('control', `A selects own ${table}`, String(seenByA[table]), typeof seenByA[table] === 'number' && seenByA[table] > 0);
    }
    const ownLatex = await api('POST', '/steve/latex', A.token, { book_id: ids.book, region_id: eq.data.id });
    record('control', 'A gets the cached LaTeX for its own equation', `${ownLatex.status}`, ownLatex.status === 200 && ownLatex.json?.latex === LATEX);

    // 3. B through the API, with A's ids.
    const deniedOrEmpty = (r) => [403, 404].includes(r.status);
    const leaks = (r) => r.text.includes(RUN) || r.text.includes(ids.book) || (ids.file && r.text.includes(ids.file));
    const probes = [
      ['GET', `/books/${ids.book}/annotations`], ['POST', `/books/${ids.book}/annotations`, { anchors: [quad(3)], style: 'highlight', color: 'honey', position_start: 3_014_014, position_end: 3_015_299 }],
      ['PATCH', `/annotations/${ids.annotation}`, { color: 'sage' }], ['DELETE', `/annotations/${ids.annotation}`],
      ['GET', `/books/${ids.book}/notes`], ['POST', `/books/${ids.book}/notes`, { kind: 'text', scope: 'selection', anchors: [quad(3)], position_start: 3_014_014, position_end: 3_015_299, content: doc }],
      // PATCH needs If-Match with the note's version (A's is at 1), or it is 428 before any lookup.
      ['PATCH', `/notes/${ids.note}`, { content: doc }, { 'If-Match': '"1"' }], ['DELETE', `/notes/${ids.note}`],
      ['POST', `/books/${ids.book}/note-files`, { content_type: 'image/png', data: PNG.toString('base64') }],
      ['GET', `/focus/${ids.focus}`], ['POST', `/focus/${ids.focus}/event`, { kind: 'heartbeat', had_input: true }],
      ['POST', `/focus/${ids.focus}/pause`], ['POST', `/focus/${ids.focus}/resume`],
      ['POST', `/focus/${ids.focus}/end`, { bookmark_anchor: { kind: 'pdf', page: startPage + 1, quads: [[50, 100, 50, 100]], text: '' } }],
      ['POST', `/focus/${ids.focus}/quiz`], ['POST', `/focus/${ids.focus}/discard`],
      ['POST', '/focus/start', { book_id: ids.book, anchor: { kind: 'pdf', page: startPage, quads: [[50, 100, 50, 100]], text: '' } }],
      ['GET', `/steve/threads/${ids.thread}`],
      ['POST', '/steve/latex', { book_id: ids.book, region_id: eq.data.id }],
      ['GET', `/books/${ids.book}/regions?first=1&last=5`], ['GET', `/books/${ids.book}/body-start`],
    ];
    for (const [method, path, payload, extra] of probes) {
      const r = await api(method, path, B.token, payload, extra);
      const label = path.replaceAll(ids.book, '<A book>').replaceAll(ids.focus, '<A focus>').replaceAll(ids.thread, '<A thread>')
        .replaceAll(ids.annotation, '<A highlight>').replaceAll(ids.note, '<A note>');
      record('api', `B ${method} ${label}`, `${r.status}${leaks(r) ? " + A's data" : ''}`, deniedOrEmpty(r) && !leaks(r));
    }
    const threads = await api('GET', `/steve/threads?book_id=${ids.book}`, B.token);
    record('api', 'B GET /steve/threads?book_id=<A book>', `${threads.status}${leaks(threads) ? " + A's data" : ''}`,
      (deniedOrEmpty(threads) || threads.status === 200 || threads.status === 422) && !leaks(threads) && !threads.text.includes(ids.thread));
    const bTotal = (await service.from('xp_events').select('amount').eq('user_id', B.id)).data?.reduce((n, r) => n + r.amount, 0) ?? 0;
    for (const path of ['/me/progress', '/badges', '/leagues/current']) {
      const r = await api('GET', path, B.token);
      const ownTotal = path !== '/me/progress' || (r.json?.total_xp ?? r.json?.xp?.total ?? bTotal) === bTotal;
      record('api', `B GET ${path} holds only B's`, `${r.status}${leaks(r) ? " + A's data" : ''}`, r.status === 200 && !leaks(r) && ownTotal);
    }

    // 4. B and a token-less client straight through Supabase: reads, changes and forgeries.
    const nobody = anon();
    const foreign = (data) => (data ?? []).filter((row) => row.user_id === undefined || row.user_id !== B.id).length;
    for (const [table, column, which] of TABLES) {
      for (const [who, sb] of [['B', B.sb], ['anon', nobody]]) {
        const sel = await sb.from(table).select('*').eq(column, ids[which]);
        record('rls', `${who} select ${table}`, sel.error ? `error ${sel.error.code}` : `${foreign(sel.data)} of A's`, sel.error ? true : foreign(sel.data) === 0);
      }
      const upd = await B.sb.from(table).update({ user_id: A.id }).eq(column, ids[which]).select();
      record('rls', `B update ${table}`, upd.error ? `refused (${upd.error.code})` : `${upd.data.length} row(s)`, Boolean(upd.error) || !upd.data.length);
      const del = await B.sb.from(table).delete().eq(column, ids[which]).select();
      record('rls', `B delete ${table}`, del.error ? `refused (${del.error.code})` : `${del.data.length} row(s)`, Boolean(del.error) || !del.data.length);
    }
    for (const [who, sb] of [['B', B.sb], ['anon', nobody]]) {
      const r = await sb.from('equation_latex').select('*').eq('file_sha256', seeded.latex.file_sha256);
      record('rls', `${who} select equation_latex for A's file`, r.error ? `error ${r.error.code}` : `${r.data.length} row(s)`, r.error ? true : r.data.length === 0);
    }
    const forged = [
      ['insert annotations as A', () => B.sb.from('annotations').insert({ user_id: A.id, book_id: ids.book, style: 'highlight', color: 'honey', anchors: [quad(3)], position_start: 3_014_014, position_end: 3_015_299, text_snapshot: RUN }).select()],
      ['insert note_blocks as A', () => B.sb.from('note_blocks').insert({ user_id: A.id, book_id: ids.book, kind: 'text', scope: 'selection', content: doc }).select()],
      ['insert focus_sessions as B', () => B.sb.from('focus_sessions').insert({ user_id: B.id, book_id: ids.book }).select()],
      ['insert steve_messages into A\'s thread', () => B.sb.from('steve_messages').insert({ thread_id: ids.thread, user_id: B.id, role: 'reader', content: RUN }).select()],
      ['insert equation_latex', () => B.sb.from('equation_latex').insert({ ...seeded.latex, page: seeded.latex.page + 1, latex: 'forged', model: RUN }).select()],
      ['update A\'s equation_latex', () => B.sb.from('equation_latex').update({ latex: 'forged' }).eq('file_sha256', seeded.latex.file_sha256).select()],
    ];
    for (const [probe, run] of forged) {
      const { data, error } = await run();
      record('rls', `B ${probe}`, error ? `refused (${error.code ?? error.message})` : `${data.length} row(s)`, Boolean(error) || !data.length);
    }

    // Storage: A's note picture is private to A.
    const folder = ids.file.split('/').slice(0, 2).join('/');
    const dl = await B.sb.storage.from('notes').download(ids.file);
    record('storage', "B download A's note picture", dl.error ? 'refused' : `${dl.data.size} bytes`, Boolean(dl.error));
    const ls = await B.sb.storage.from('notes').list(folder);
    record('storage', "B list A's note folder", ls.error ? 'refused' : `${ls.data.length} files`, ls.error ? true : ls.data.length === 0);
    const put = await B.sb.storage.from('notes').upload(`${folder}/planted-by-b.png`, new Blob([PNG]), { upsert: false });
    record('storage', "B upload into A's note folder", put.error ? 'refused' : 'uploaded', Boolean(put.error));
    if (!put.error) await service.storage.from('notes').remove([`${folder}/planted-by-b.png`]);
    const rm = await B.sb.storage.from('notes').remove([ids.file]);
    record('storage', "B remove A's note picture", rm.error ? 'refused' : `${rm.data.length} removed`, rm.error ? true : rm.data.length === 0);

    // 5. equation_latex follows the file, not the reader: B's own copy of the same file gets the LaTeX, with no
    // consent (nothing is sent); A's book through B's account gets nothing.
    ids.bBook = await upload(B, 'Isolation B');
    console.log(`B's copy ${ids.bBook}; waiting for its region map`);
    await settle(B, ids.bBook);
    const bEq = await service.from('page_regions').select('id, bbox').eq('book_id', ids.bBook).eq('kind', 'math')
      .eq('page', seeded.latex.page).limit(20);
    const same = (bEq.data ?? []).find((r) => bboxHash(r.bbox) === seeded.latex.bbox_hash);
    const bOwn = same ? await api('POST', '/steve/latex', B.token, { book_id: ids.bBook, region_id: same.id }) : null;
    record('latex', "B's own copy of the same file gets the cached LaTeX", bOwn ? `${bOwn.status}` : 'no matching region',
      Boolean(bOwn) && bOwn.status === 200 && bOwn.json?.latex === LATEX);
    const bOther = await api('POST', '/steve/latex', B.token, { book_id: ids.book, region_id: eq.data.id });
    record('latex', "B asking with A's book", `${bOther.status}${bOther.text.includes(RUN) ? ' + the LaTeX' : ''}`,
      [403, 404].includes(bOther.status) && !bOther.text.includes(RUN));

    // 6. Nothing of A's changed.
    const after = {};
    for (const [table, column, which] of TABLES) {
      const { data, error } = await A.sb.from(table).select('*').eq(column, ids[which]);
      after[table] = error ? `error ${error.code}` : data.length;
    }
    const unchanged = JSON.stringify(after) === JSON.stringify(seenByA);
    record('after', "A's row counts unchanged", unchanged ? 'same' : JSON.stringify(after), unchanged);
    const latexAfter = await service.from('equation_latex').select('latex').eq('file_sha256', seeded.latex.file_sha256);
    record('after', 'equation_latex as seeded, nothing forged', `${latexAfter.data?.length} row(s)`,
      latexAfter.data?.length === 1 && latexAfter.data[0].latex === LATEX);
    const stillThere = await A.sb.storage.from('notes').list(folder);
    record('after', "A's note picture still there", `${stillThere.data?.length ?? 0} file(s)`, (stillThere.data?.length ?? 0) >= 1);
  } finally {
    // 7. Clean up: both books (cascade; C25.1's fix removes the note pictures), every seeded row, then a report.
    const deleted = [];
    for (const [user, book] of [[A, ids.book], [B, ids.bBook]]) {
      if (book) deleted.push((await api('DELETE', `/books/${book}`, user.token)).status);
    }
    if (seeded.xp) await service.from('xp_events').delete().eq('source_id', RUN);
    if (seeded.badge) await service.from('user_badges').delete().eq('badge_id', RUN.slice(0, 60));
    if (seeded.progress) await service.from('user_progress').delete().eq('user_id', A.id);
    if (seeded.latex) await service.from('equation_latex').delete().eq('file_sha256', seeded.latex.file_sha256).eq('model', 'isolation-check');
    await service.from('equation_latex').delete().eq('model', RUN);
    const left = {};
    for (const [table, column, value] of [['books', 'id', ids.book], ['books', 'id', ids.bBook], ['annotations', 'book_id', ids.book],
      ['note_blocks', 'book_id', ids.book], ['focus_sessions', 'book_id', ids.book], ['steve_threads', 'book_id', ids.book],
      ['xp_events', 'source_id', RUN], ['user_badges', 'badge_id', RUN.slice(0, 60)], ['equation_latex', 'model', 'isolation-check']]) {
      if (!value) continue;
      const { data } = await service.from(table).select('*').eq(column, value);
      left[`${table}.${column}`] = (left[`${table}.${column}`] ?? 0) + (data?.length ?? 0);
    }
    const files = ids.file ? await service.storage.from('notes').list(ids.file.split('/').slice(0, 2).join('/')) : { data: [] };
    const rowsLeft = Object.values(left).reduce((a, b) => a + b, 0);
    console.log(`cleanup: DELETE books -> ${deleted.join(', ')}; rows left ${JSON.stringify(left)}; note files left ${files.data?.length ?? 0}`);
    if (rowsLeft || files.data?.length) record('cleanup', 'nothing left', `${rowsLeft} rows, ${files.data?.length ?? 0} files`, false);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} probes, ${results.length - failed.length} as expected, ${failed.length} failed; ${Math.round((Date.now() - started) / 1000)} s against ${API}`);
  for (const r of failed) console.log(`  FAILED ${r.area} ${r.probe}: ${r.got}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => { console.error(error.message); process.exitCode = 2; });
