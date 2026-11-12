// Cross-user data isolation, live (C15.2). Not a standard check: it writes to the shared Supabase
// project, so run it only with approval: `npm --prefix frontend run test:isolation`.
//
// Test user A uploads sample.pdf and reads, finishes and submits one session through the API, so
// every per-user table holds rows of A's for one book. Test user B then tries to read and modify
// them, through every API endpoint that takes an id and straight through Supabase with the anon key
// and B's session (RLS): tables, the two search RPCs and Storage. term_lookups is a shared cache:
// both may read it, neither may write it. A token-less client and a raw user id as bearer are
// refused too. The run deletes A's book at the end (cascade) and reports what is left.
//
// Credentials: ../.env.test (TEST_USER_A_*, TEST_USER_B_*), never printed. Supabase URL and anon
// key: frontend/.env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). API: API_URL, default
// http://localhost:8000. Exit code 1 when any probe is not denied.
import { readFileSync, existsSync } from 'node:fs';
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
const env = { ...read(`${ROOT}frontend/.env`), ...read(`${ROOT}.env.test`), ...process.env };
const API = (env.API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'TEST_USER_A_EMAIL', 'TEST_USER_A_PASSWORD', 'TEST_USER_B_EMAIL', 'TEST_USER_B_PASSWORD']) {
  if (!env[key]) throw new Error(`${key} is needed`);
}

const results = []; // [area, probe, expected, got, ok]
const record = (area, probe, expected, got, ok) => {
  results.push([area, probe, expected, got, ok]);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${area.padEnd(8)} ${probe} -> ${got}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = () => createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return { sb, token: data.session.access_token, id: data.user.id };
}

async function api(method, path, token, body) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, text };
}

const TABLES = [ // [table, column, which id of A's]
  ['books', 'id', 'book'], ['chunks', 'book_id', 'book'], ['question_bank', 'book_id', 'book'],
  ['concepts', 'book_id', 'book'], ['user_concept_mastery', 'book_id', 'book'], ['sessions', 'book_id', 'book'],
  ['test_results', 'session_id', 'session'], ['reading_progress', 'book_id', 'book'],
  ['agent_decisions', 'book_id', 'book'], ['processing_jobs', 'book_id', 'book'], ['profiles', 'user_id', 'user'],
];

async function main() {
  const started = Date.now();
  // 0. The API is up and its model loaded (a cold Render start takes a minute or more).
  for (let i = 0; ; i += 1) {
    const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
    if (health?.model_ready) break;
    if (i > 60) throw new Error('API not ready after 5 minutes');
    await sleep(5000);
  }
  const A = await signIn(env.TEST_USER_A_EMAIL, env.TEST_USER_A_PASSWORD);
  const B = await signIn(env.TEST_USER_B_EMAIL, env.TEST_USER_B_PASSWORD);
  if (A.id === B.id) throw new Error('A and B are the same user');

  // 1. A's data: one book, read, finished and tested through the API.
  const form = new FormData();
  form.append('file', new Blob([readFileSync(`${ROOT}sample.pdf`)], { type: 'application/pdf' }), 'sample.pdf');
  form.append('title', `Isolation ${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`);
  form.append('author', 'ReadFocus isolation check');
  const upload = await api('POST', '/books/upload', A.token, form);
  if (upload.status !== 200) throw new Error(`upload: ${upload.status} ${upload.text.slice(0, 200)}`);
  const ids = { book: upload.json.book_id, user: A.id, session: null, storage: null };
  console.log(`A's book ${ids.book}`);
  try {
    for (let i = 0; ; i += 1) {
      const status = await api('GET', `/books/${ids.book}/status`, A.token);
      // "ready" comes after the first batch; later batches keep adding questions, so wait for the
      // job to finish or A's row counts move during the probes (DEBUG_LOG 2026-11-12).
      const job = status.json?.ingestion?.status;
      if (status.json?.status === 'ready' && (job === 'done' || job == null)) break;
      if (job === 'failed') throw new Error(`ingestion job failed: ${status.text.slice(0, 200)}`);
      if (status.json?.status === 'error' || i > 120) throw new Error(`ingestion: ${status.text.slice(0, 200)}`);
      await sleep(5000);
    }
    const start = await api('POST', '/sessions/start', A.token, { book_id: ids.book });
    if (start.status !== 200) throw new Error(`A's start: ${start.status}`);
    ids.session = start.json.session_id;
    const first = start.json.chunks[0];
    const place = { chunk_index: first.chunk_index, block_id: first.blocks?.[0]?.id ?? `${first.chunk_index}.0`, char_offset: 0 };
    await api('PUT', `/sessions/${ids.session}/position`, A.token, place);
    const finish = await api('POST', `/sessions/${ids.session}/finish-reading`, A.token, { actual_duration_minutes: 1 });
    const questions = finish.json?.test_questions ?? [];
    const submit = await api('POST', `/sessions/${ids.session}/submit-answers`, A.token,
      { answers: questions.map(() => 'Bananas are yellow.'), time_taken_seconds: 30 });
    if (submit.status !== 200) throw new Error(`A's submit: ${submit.status}`);
    await sleep(3000); // decisions are stored after the response
    ids.storage = (await A.sb.from('books').select('storage_path').eq('id', ids.book).single()).data?.storage_path;

    // A sees its own rows: the denials below are only meaningful against rows that exist.
    const seenByA = {};
    for (const [table, column, which] of TABLES) {
      const { data, error } = await A.sb.from(table).select('*').eq(column, ids[which]);
      seenByA[table] = error ? `error ${error.code}` : data.length;
    }
    console.log('rows A sees of its own:', JSON.stringify(seenByA));

    // 2. B through the API: every endpoint that takes A's ids.
    const notFound = (r) => [403, 404].includes(r.status);
    // A's text, which no answer to B may carry: a plain run of it, so JSON escaping cannot hide a match.
    const snippet = /[A-Za-z0-9 ,.;:()-]{40,}/.exec(start.json.chunks[0]?.content ?? '')?.[0].slice(0, 40) ?? '';
    if (!snippet) throw new Error("no plain run of A's text to look for");
    const B_api = [
      ['GET', `/books/${ids.book}`], ['GET', `/books/${ids.book}/pages?start=0`], ['GET', `/books/${ids.book}/status`],
      ['POST', `/books/${ids.book}/resume`], ['DELETE', `/books/${ids.book}`],
      ['POST', '/sessions/start', { book_id: ids.book }],
      ['GET', `/sessions/${ids.session}`], ['PUT', `/sessions/${ids.session}/position`, place],
      ['POST', `/sessions/${ids.session}/finish-reading`, { actual_duration_minutes: 1 }],
      ['POST', `/sessions/${ids.session}/evaluate-single`, { index: 0, answer: 'x' }],
      ['POST', `/sessions/${ids.session}/submit-answers`, { answers: ['x'], time_taken_seconds: 1 }],
      ['POST', `/sessions/${ids.session}/abandon`],
    ];
    for (const [method, path, body] of B_api) {
      const r = await api(method, path, B.token, body);
      const leaked = r.text.includes(ids.book) || (snippet !== '' && r.text.includes(snippet));
      record('api', `B ${method} ${path.replace(ids.book, '<A book>').replace(ids.session, '<A session>')}`, '403/404, nothing of A\'s', `${r.status}${leaked ? ' + A\'s data' : ''}`, notFound(r) && !leaked);
    }
    const lists = [['GET', '/books'], ['GET', '/dashboard'], ['GET', `/mastery?book_id=${ids.book}&limit=10&offset=0`]];
    for (const [method, path] of lists) {
      const r = await api(method, path, B.token);
      const leaked = r.text.includes(ids.book) || (path.startsWith('/mastery') && (r.json?.items?.length ?? 0) > 0);
      record('api', `B ${method} ${path.replace(ids.book, '<A book>')}`, '200 without A\'s data', `${r.status}${leaked ? ' + A\'s data' : ''}`, r.status === 200 && !leaked);
    }
    for (const [label, token] of [['no token', null], ['A\'s user id as bearer', A.id]]) {
      const r = await api('GET', '/books', token);
      record('api', `${label}: GET /books`, '401', String(r.status), r.status === 401);
    }

    // 3. B straight through Supabase (anon key + B's session): RLS on reads and writes.
    // Rows B may legitimately get back are B's own (for example a session B made on A's book through an
    // API hole): those are reported, but only rows of anyone else's count as an RLS failure.
    const rows = (r) => {
      if (r.error) return [`error ${r.error.code}`, true];
      const foreign = r.data.filter((row) => row.user_id !== B.id).length;
      const own = r.data.length - foreign;
      return [`${foreign} rows of A's${own ? ` (+${own} of B's own)` : ''}`, foreign === 0];
    };
    const anon = client();
    for (const [table, column, which] of TABLES) {
      const id = ids[which];
      const sel = await B.sb.from(table).select('*').eq(column, id);
      record('rls', `B select ${table}`, "0 rows of A's", ...rows(sel));
      const all = await B.sb.from(table).select('*').eq('user_id', A.id).limit(1);
      record('rls', `B select ${table} where user_id = A`, "0 rows of A's", ...rows(all));
      const ano = await anon.from(table).select('*').eq(column, id);
      record('rls', `anon select ${table}`, '0 rows', ano.error ? `error ${ano.error.code}` : `${ano.data.length} rows`, ano.error ? true : ano.data.length === 0);
      // A no-op update (user_id set to A's own id) and a delete: either would touch A's rows if RLS let it.
      const upd = await B.sb.from(table).update({ user_id: A.id }).eq(column, id).select();
      record('rls', `B update ${table}`, "0 rows of A's changed", ...rows(upd));
      const del = await B.sb.from(table).delete().eq(column, id).select();
      record('rls', `B delete ${table}`, "0 rows of A's deleted", ...rows(del));
    }
    const insert = await B.sb.from('books').insert({ user_id: A.id, title: 'planted by B', status: 'ready' }).select();
    record('rls', 'B insert a book owned by A', 'refused', insert.error ? `error ${insert.error.code}` : `${insert.data.length} rows`, Boolean(insert.error));
    if (!insert.error && insert.data?.length) await A.sb.from('books').delete().eq('id', insert.data[0].id); // undo a leak
    for (const fn of ['search_chunks_text', 'match_chunks_local']) {
      const args = fn === 'search_chunks_text'
        ? { query_text: 'antenna design', match_count: 5, p_book_id: ids.book }
        : { query_embedding: Array(384).fill(0.01), match_count: 5, p_book_id: ids.book };
      const r = await B.sb.rpc(fn, args);
      record('rls', `B rpc ${fn} on A's book`, '0 rows', r.error ? `error ${r.error.code}` : `${r.data.length} rows`, r.error ? true : r.data.length === 0);
      const own = await A.sb.rpc(fn, args);
      console.log(`     (A's own ${fn}: ${own.error ? `error ${own.error.code}` : `${own.data.length} rows`})`);
    }

    // Storage: A's PDF is private to A.
    if (ids.storage) {
      const folder = ids.storage.split('/')[0];
      const dl = await B.sb.storage.from('books').download(ids.storage);
      record('storage', 'B download A\'s PDF', 'refused', dl.error ? 'refused' : `${dl.data.size} bytes`, Boolean(dl.error));
      const ls = await B.sb.storage.from('books').list(folder);
      record('storage', 'B list A\'s folder', '0 files', ls.error ? 'refused' : `${ls.data.length} files`, ls.error ? true : ls.data.length === 0);
      const put = await B.sb.storage.from('books').upload(`${folder}/planted-by-b.txt`, new Blob(['x']), { upsert: false });
      record('storage', 'B upload into A\'s folder', 'refused', put.error ? 'refused' : 'uploaded', Boolean(put.error));
      if (!put.error) await A.sb.storage.from('books').remove([`${folder}/planted-by-b.txt`]);
      const rm = await B.sb.storage.from('books').remove([ids.storage]);
      record('storage', 'B remove A\'s PDF', '0 removed', rm.error ? 'refused' : `${rm.data.length} removed`, rm.error ? true : rm.data.length === 0);
      const still = await A.sb.storage.from('books').download(ids.storage);
      record('storage', 'A still downloads its PDF', 'yes', still.error ? 'no' : 'yes', !still.error);
    } else {
      record('storage', 'A\'s storage path', 'present', 'missing', false);
    }

    // term_lookups: a shared cache, readable by signed-in readers, writable by none.
    for (const [who, sb] of [['A', A.sb], ['B', B.sb]]) {
      const r = await sb.from('term_lookups').select('term').limit(1);
      record('cache', `${who} reads term_lookups`, 'allowed', r.error ? `error ${r.error.code}` : `${r.data.length} rows`, !r.error);
      const term = `zz-isolation-probe-${who}`;
      const ins = await sb.from('term_lookups').insert({ term, lang: 'en', kind: 'probe', payload: {}, found: false }).select();
      record('cache', `${who} inserts into term_lookups`, 'refused', ins.error ? `error ${ins.error.code}` : 'inserted', Boolean(ins.error));
      const upd = await sb.from('term_lookups').update({ found: false }).neq('term', '').select();
      record('cache', `${who} updates term_lookups`, '0 rows changed', upd.error ? `error ${upd.error.code}` : `${upd.data.length} rows`, upd.error ? true : upd.data.length === 0);
      const del = await sb.from('term_lookups').delete().eq('term', term).select();
      record('cache', `${who} deletes from term_lookups`, '0 rows', del.error ? `error ${del.error.code}` : `${del.data.length} rows`, del.error ? true : del.data.length === 0);
    }
    const anonCache = await anon.from('term_lookups').select('term').limit(1);
    record('cache', 'anon reads term_lookups', '0 rows', anonCache.error ? `error ${anonCache.error.code}` : `${anonCache.data.length} rows`, anonCache.error ? true : anonCache.data.length === 0);

    // Nothing of A's changed under B's attempts.
    const book = await A.sb.from('books').select('id').eq('id', ids.book);
    record('after', 'A\'s book still there', '1 row', `${book.data?.length ?? 0} rows`, book.data?.length === 1);
    const session = await A.sb.from('sessions').select('status').eq('id', ids.session).single();
    record('after', 'A\'s session status', 'completed', session.data?.status ?? 'missing', session.data?.status === 'completed');
    const after = {};
    for (const [table, column, which] of TABLES) {
      const { data, error } = await A.sb.from(table).select('*').eq(column, ids[which]);
      after[table] = error ? `error ${error.code}` : data.length;
    }
    const same = JSON.stringify(after) === JSON.stringify(seenByA);
    record('after', 'A\'s row counts unchanged', JSON.stringify(seenByA), same ? 'same' : JSON.stringify(after), same);
  } finally {
    // 4. Clean up: A deletes its book (cascade) and the run says what is left.
    const del = await api('DELETE', `/books/${ids.book}`, A.token);
    const left = {};
    for (const [table, column, which] of TABLES.filter(([t]) => t !== 'profiles')) {
      if (!ids[which]) continue;
      const { data, error } = await A.sb.from(table).select('*').eq(column, ids[which]);
      left[table] = error ? `error ${error.code}` : data.length;
    }
    // A listing, not a download: a download straight after the remove can still be served from a cache.
    const [folder, file] = (ids.storage ?? '/').split('/');
    const listed = ids.storage ? await A.sb.storage.from('books').list(folder, { search: file }) : null;
    const pdfLeft = listed ? (listed.error ? `unknown (${listed.error.message})` : listed.data.some((f) => f.name === file)) : 'n/a';
    console.log(`cleanup: DELETE /books/<A book> -> ${del.status}; rows left: ${JSON.stringify(left)}; PDF left: ${pdfLeft}`);
  }
  const failed = results.filter((r) => !r[4]);
  console.log(`\n${results.length} probes, ${results.length - failed.length} denied as expected, ${failed.length} failed; ${Math.round((Date.now() - started) / 1000)} s against ${API}`);
  if (failed.length) {
    console.log('failed:');
    for (const [area, probe, expected, got] of failed) console.log(`  ${area} ${probe}: expected ${expected}, got ${got}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 2; });
