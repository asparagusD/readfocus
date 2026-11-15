// Progress, pure (C24.6a, docs/GAMIFICATION.md): levels, the candle's flame and the header's words.
// Levels are display only: level n to n + 1 costs LEVEL_STEP x n XP (plan D4, open as plan question 3).

export const LEVEL_STEP = 250;
export const FREEZE_MAX = 2; // GAMIFICATION G8

/** {level, into, span}: the level for a total, the XP into it and the XP it spans. */
export function levelOf(total) {
  let level = 1;
  let floor = 0;
  const xp = Math.max(0, Math.floor(Number(total) || 0));
  while (xp >= floor + LEVEL_STEP * level) {
    floor += LEVEL_STEP * level;
    level += 1;
  }
  return { level, into: xp - floor, span: LEVEL_STEP * level };
}

/** The share of a bar or ring, 0 to 1. */
export function share(part, whole) {
  return whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0;
}

/** The flame's height: none before a streak, then growing gently with it to full at 30 days. */
export function flameScale(days) {
  if (!days || days < 1) return 0;
  return Number((0.7 + 0.3 * Math.min(1, Math.log(days) / Math.log(30))).toFixed(3));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The words the header's link reads out; never a warning, never a loss. */
export function headerLabel(progress) {
  const { level, into, span } = levelOf(progress.total_xp);
  const { xp, goal, met } = progress.today;
  const { days, freezes } = progress.streak;
  const today = met ? `Today's goal is met, ${xp} XP.` : `Today ${xp} of ${goal} XP.`;
  const streak = days > 0 ? `${plural(days, 'day', 'days')} in a row` : 'A new streak starts with today’s goal';
  const saved = freezes > 0 ? `, ${plural(freezes, 'freeze', 'freezes')} saved` : '';
  return `Level ${level}, ${into} of ${span} XP to level ${level + 1}. ${today} ${streak}${saved}. Open your progress.`;
}

/** The localStorage key that remembers the goal was celebrated on a day, so it is celebrated once. */
export const celebratedKey = (day) => `rf-goal-celebrated:${day}`;
