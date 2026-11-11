/**
 * Pure helpers for the dashboard (C13.7a), over GET /dashboard's fields:
 * score_over_time [{date 'YYYY-MM-DD', score_pct, book_id, book_title}],
 * reading_streak, words_this_week, book_progress.
 */

const PARTS = [[5, 'morning'], [12, 'afternoon'], [18, 'evening']];

/** "morning" (5-11), "afternoon" (12-17) or "evening" (18-4), from the reader's own clock. */
export function partOfDay(date) {
  const hour = date.getHours();
  let part = 'evening';
  for (const [from, name] of PARTS) if (hour >= from) part = name;
  return hour < 5 ? 'evening' : part;
}

/** The eyebrow and greeting: "Wednesday evening", "Good evening." */
export function greeting(date) {
  const part = partOfDay(date);
  const day = date.toLocaleDateString('en-GB', { weekday: 'long' });
  return { eyebrow: `${day} ${part}`, title: `Good ${part}.` };
}

/** The streak in words: "12 days in a row", "1 day in a row", or none yet. */
export function streakLine(days) {
  if (!days) return 'No streak yet: tonight could start one';
  return `${days} ${days === 1 ? 'day' : 'days'} in a row`;
}

/** The last `count` tests across all books, oldest first, numbered for the chart. */
export function lastScores(scores, count = 8) {
  return [...scores]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-count)
    .map((s, i) => ({ ...s, n: i + 1, score: Math.round(s.score_pct) }));
}

/** The most recent test's percentage, or null before any test. */
export function lastScore(scores) {
  const last = lastScores(scores, 1)[0];
  return last ? last.score : null;
}

/** Tests taken since Monday (the reader's week, as words_this_week counts it). */
export function testsThisWeek(scores, today) {
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const from = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  return scores.filter((s) => s.date >= from).length;
}
