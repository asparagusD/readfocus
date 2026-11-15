// Gamification data isolation, live (C24.7). Not a standard check: it writes to the shared Supabase project, so run
// it only with approval: `npm --prefix frontend run test:xp-isolation`.
//
// The service key (root .env, server-side only, never sent anywhere but Supabase) seeds rows of test user A's that
// nothing else reads: an 'adjustment' xp_events row dated 2000-01-01 (outside every day, goal and league window), a
// user_badges row 'isolation-check' (not in the catalogue, so the API never shows it) and, only when A has none, a
// user_progress row. A reads each through the anon key (the probe can see a row it is allowed to). B, with the anon
// key and B's session, and a token-less anon client then try to read, change, delete and forge A's rows in
// xp_events, user_badges, user_progress and the league tables; every attempt must be refused or see nothing. The run
// deletes exactly what it seeded and reports anything left. Exit code 1 when any probe is not denied.
//
// Credentials: ../.env.test (TEST_USER_A_*, TEST_USER_B_*), frontend/.env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY),
// ../.env (SUPABASE_SERVICE_KEY); none is printed.
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
const env = { ...read(`${ROOT}.env`), ...read(`${ROOT}frontend/.env`), ...read(`${ROOT}.env.test`), ...process.env };
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'TEST_USER_A_EMAIL',
  'TEST_USER_A_PASSWORD', 'TEST_USER_B_EMAIL', 'TEST_USER_B_PASSWORD']) {
  if (!env[key]) throw new Error(`${key} is needed`);
}
const OPTS = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, OPTS);
const service = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, OPTS);
const RUN = `isolation-${Date.now()}`;
const BADGE = 'isolation-check';

let failures = 0;
const record = (area, probe, got, ok) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${area.padEnd(6)} ${probe} -> ${got}`);
};
const rowsOf = (data, user) => (data ?? []).filter((r) => r.user_id === user).length;

async function signIn(email, password) {
  const sb = anon();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return { sb, id: data.user.id };
}

async function main() {
  const A = await signIn(env.TEST_USER_A_EMAIL, env.TEST_USER_A_PASSWORD);
  const B = await signIn(env.TEST_USER_B_EMAIL, env.TEST_USER_B_PASSWORD);
  if (A.id === B.id) throw new Error('A and B are the same user');
  const seeded = { xp: null, badge: false, progress: false };
  try {
    // 1. Seed A's rows with the service key.
    const xp = await service.from('xp_events').insert({ user_id: A.id, source: 'adjustment', source_id: RUN, amount: 1,
      earned_at: '2000-01-01T00:00:00Z', local_day: '2000-01-01' }).select('id').single();
    if (xp.error) throw new Error(`seed xp_events: ${xp.error.message}`);
    seeded.xp = xp.data.id;
    const badge = await service.from('user_badges').insert({ user_id: A.id, badge_id: BADGE });
    if (badge.error) throw new Error(`seed user_badges: ${badge.error.message}`);
    seeded.badge = true;
    const had = await service.from('user_progress').select('user_id').eq('user_id', A.id);
    if (!had.data?.length) {
      const made = await service.from('user_progress').insert({ user_id: A.id });
      if (made.error) throw new Error(`seed user_progress: ${made.error.message}`);
      seeded.progress = true;
    }
    console.log(`seeded for A: xp_events 1, user_badges 1, user_progress ${seeded.progress ? 'made' : 'already there'}`);

    // 2. Control: A sees each of A's rows, so a zero below means refused, not absent.
    for (const [table, filter] of [['xp_events', ['id', seeded.xp]], ['user_badges', ['badge_id', BADGE]],
      ['user_progress', ['user_id', A.id]]]) {
      const { data, error } = await A.sb.from(table).select('*').eq(...filter);
      record('A', `select own ${table}`, error ? error.message : `${data.length} row(s)`, !error && data.length === 1);
    }

    // 3. B and a token-less client against A's rows.
    const nobody = anon();
    for (const [who, sb] of [['B', B.sb], ['anon', nobody]]) {
      for (const table of ['xp_events', 'user_badges', 'user_progress', 'league_members']) {
        const byUser = await sb.from(table).select('*').eq('user_id', A.id);
        record(who, `select ${table} where user_id = A`, byUser.error?.message ?? `${byUser.data.length} row(s)`,
          rowsOf(byUser.data, A.id) === 0);
        const all = await sb.from(table).select('*').limit(1000);
        record(who, `select all ${table}`, all.error?.message ?? `${rowsOf(all.data, A.id)} of A's`, rowsOf(all.data, A.id) === 0);
      }
      for (const table of ['league_weeks', 'league_groups']) {
        const all = await sb.from(table).select('id').limit(1);
        record(who, `select ${table}`, all.error?.message ?? `${all.data.length} row(s)`, !all.data?.length);
      }
    }
    const changes = [
      ['update user_progress (A)', () => B.sb.from('user_progress').update({ total_xp: 999999 }).eq('user_id', A.id).select()],
      ['update user_badges (A)', () => B.sb.from('user_badges').update({ badge_id: 'stolen' }).eq('user_id', A.id).select()],
      ['delete xp_events (A)', () => B.sb.from('xp_events').delete().eq('id', seeded.xp).select()],
      ['delete user_badges (A)', () => B.sb.from('user_badges').delete().eq('user_id', A.id).select()],
      ['delete user_progress (A)', () => B.sb.from('user_progress').delete().eq('user_id', A.id).select()],
      ['insert xp_events as A', () => B.sb.from('xp_events').insert({ user_id: A.id, source: 'adjustment',
        source_id: `${RUN}-forged`, amount: 500, earned_at: '2000-01-01T00:00:00Z', local_day: '2000-01-01' }).select()],
      ['insert xp_events as B', () => B.sb.from('xp_events').insert({ user_id: B.id, source: 'focus',
        source_id: `${RUN}-self`, amount: 500, earned_at: '2000-01-01T00:00:00Z', local_day: '2000-01-01' }).select()],
      ['insert user_badges as B', () => B.sb.from('user_badges').insert({ user_id: B.id, badge_id: `${BADGE}-b` }).select()],
      ['upsert user_progress as B', () => B.sb.from('user_progress').upsert({ user_id: B.id, total_xp: 999999 }).select()],
    ];
    for (const [probe, run] of changes) {
      const { data, error } = await run();
      record('B', probe, error ? `refused (${error.code ?? error.message})` : `${data.length} row(s)`, Boolean(error) || !data.length);
    }

    // 4. A's rows are as seeded, and B forged nothing for themself.
    const after = await Promise.all([
      service.from('xp_events').select('id').eq('user_id', A.id).eq('source_id', RUN),
      service.from('user_badges').select('badge_id').eq('user_id', A.id).eq('badge_id', BADGE),
      service.from('xp_events').select('id').like('source_id', `${RUN}-%`),
      service.from('user_badges').select('badge_id').eq('badge_id', `${BADGE}-b`),
      service.from('user_progress').select('total_xp').eq('user_id', A.id),
    ]);
    record('check', 'A\'s seeded rows unchanged', `${after[0].data.length} xp, ${after[1].data.length} badge`,
      after[0].data.length === 1 && after[1].data.length === 1);
    record('check', 'nothing forged', `${after[2].data.length} xp, ${after[3].data.length} badge`,
      after[2].data.length === 0 && after[3].data.length === 0);
    record('check', 'A\'s total not 999999', String(after[4].data[0]?.total_xp), after[4].data[0]?.total_xp !== 999999);
  } finally {
    // 5. Delete exactly what this run seeded (and anything a failed probe forged), then report what is left.
    await service.from('xp_events').delete().like('source_id', `${RUN}%`);
    await service.from('user_badges').delete().in('badge_id', [BADGE, `${BADGE}-b`]);
    if (seeded.progress) await service.from('user_progress').delete().eq('user_id', A.id);
    const left = await Promise.all([
      service.from('xp_events').select('id').like('source_id', `${RUN}%`),
      service.from('user_badges').select('badge_id').in('badge_id', [BADGE, `${BADGE}-b`]),
      seeded.progress ? service.from('user_progress').select('user_id').eq('user_id', A.id) : { data: [] },
    ]);
    const count = left.reduce((n, r) => n + (r.data?.length ?? 0), 0);
    console.log(`rows left after cleanup: ${count}`);
    if (count) failures += 1;
  }
  console.log(failures ? `${failures} probe(s) not denied` : 'every probe denied');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
