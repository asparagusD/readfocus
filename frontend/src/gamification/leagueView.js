// The league page, pure (C24.6c, docs/GAMIFICATION.md G10-G14, handoff screen 27).

export const TIERS = ['Pamphlet', 'Paperback', 'Hardcover', 'Folio', 'First Edition', 'Illuminated'];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "3 days, 5 hours left": the time to Monday 00:00 UTC, calmly. */
export function timeLeft(endsAt, now = new Date()) {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (!(ms > 0)) return 'The new week starts now';
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${plural(days, 'day', 'days')}${hours % 24 ? `, ${plural(hours % 24, 'hour', 'hours')}` : ''} left`;
  return hours >= 1 ? `${plural(hours, 'hour', 'hours')} left` : 'Less than an hour left';
}

export function ordinal(n) {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${tail}`;
}

/** Two letters for the avatar: the first of two words, or the first two of one. */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  const letters = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...words[0]].slice(0, 2).join('');
  return letters.toUpperCase();
}

/** Each tier with its state on the reader's way up: done, current, next or later. */
export function tierStates(tier) {
  const at = TIERS.indexOf(tier);
  return TIERS.map((name, i) => ({ name, state: i < at ? 'done' : i === at ? 'current' : i === at + 1 ? 'next' : 'later' }));
}

/**
 * The standings with soft markers: the line under the promotion zone, the line over the demotion zone, and a gap
 * where ranks skip (readers who keep themselves off other boards). Markers follow the ranks, not the rows shown.
 */
export function withMarkers(rows, zones, tier) {
  const at = TIERS.indexOf(tier);
  const up = at < TIERS.length - 1 && zones?.promote > 0 ? zones.promote : 0;
  const down = at > 0 && zones?.demote > 0 ? zones.size - zones.demote : null;
  const items = [];
  let last = 0;
  for (const row of rows) {
    if (down !== null && last <= down && row.rank > down) {
      items.push({ marker: 'demotion', count: zones.demote, to: TIERS[at - 1] });
    } else if (row.rank > last + 1) {
      items.push({ marker: 'gap' });
    }
    items.push(row);
    if (up && row.rank <= up && (rows[rows.indexOf(row) + 1]?.rank ?? Infinity) > up) {
      items.push({ marker: 'promotion', count: up, to: TIERS[at + 1] });
    }
    last = row.rank;
  }
  return items;
}

/** Last week, in a sentence that never scolds. */
export function lastWeekLine(last) {
  if (!last) return null;
  const place = `you came ${ordinal(last.rank)} of ${last.size} with ${last.weekly_xp} XP`;
  if (last.outcome === 'promoted') return `Last week ${place} and moved up to ${last.now_in}.`;
  if (last.outcome === 'demoted') return `Last week ${place}. This week you read in ${last.now_in}, a fresh start.`;
  return `Last week ${place} and stayed in ${last.now_in}.`;
}
