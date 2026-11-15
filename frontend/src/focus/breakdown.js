/**
 * The focus results' points breakdown (C23.7, handoff screens 24-25): the server's scored lines as table rows.
 * Every number comes from the server (FOCUS_RULES F4, F11, F12); this only words them.
 */
const NOT_COUNTED = new Set(['page_cap', 'session_cap', 'hidden', 'paused', 'idle', 'no_heartbeat']);

/** Seconds as whole minutes in words: "1 minute", "52 minutes", "under a minute". */
export function minutesOf(seconds) {
  const m = Math.round((seconds ?? 0) / 60);
  if (m === 0) return seconds > 0 ? 'under a minute' : '0 minutes';
  return m === 1 ? '1 minute' : `${m} minutes`;
}

const plus = (n) => (n > 0 ? `+${n}` : '0');

/**
 * { passed, correct, total, rows: [{ key, title, detail, value, kind }] } from a graded focus quiz's response.
 * kind is 'counted', 'void' (time that did not count) or 'total'. Under the pass mark the rows say what was
 * read and answered, with no figures, and the total is 0.
 */
export function breakdown(data) {
  const passed = data?.passed !== false;
  const lines = data?.lines ?? [];
  const correct = data?.quiz_correct ?? 0;
  const total = data?.quiz_total ?? 0;
  const rows = [];
  for (const line of lines) {
    if (line.code === 'counted') {
      rows.push({ key: 'counted', title: 'Focused reading', detail: minutesOf(line.seconds), value: passed ? plus(line.points) : '—', kind: 'counted' });
    } else if (NOT_COUNTED.has(line.code)) {
      rows.push({ key: line.code, title: 'Not counted', detail: `${line.label} · ${minutesOf(line.seconds)}`, value: '—', kind: 'void' });
    } else if (line.code === 'quiz_bonus') {
      const pct = total ? Math.round((correct / total) * 100) : 0;
      rows.push({ key: 'quiz', title: passed ? 'Quiz bonus' : 'Quiz', detail: `${correct} of ${total} right · ${pct}%`, value: passed ? plus(line.points) : '—', kind: 'counted' });
    }
  }
  rows.push({ key: 'total', title: passed ? 'Total' : 'This session', detail: passed ? 'Points from this session' : 'No points this time', value: passed ? plus(data?.points_total ?? 0) : '0', kind: 'total' });
  return { passed, correct, total, rows };
}
