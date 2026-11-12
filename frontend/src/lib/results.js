/**
 * Pure helpers for the results page (C13.6a): how each graded answer is
 * labelled, the summary line, the concept chips and the verdict. Grades
 * come from submit-answers' per_question (or the stored test_results
 * after a refresh): score, max_score, feedback, confidence,
 * matched_concepts, missing_concepts.
 */

/** Feedback ends with the passage it rests on in curly quotes: split it so the quote can stand apart. */
export function splitFeedback(feedback = '') {
  const match = /^([\s\S]*?)\s*“([^”]+)”\s*$/.exec(feedback.trim());
  return match ? { text: match[1].trim(), quote: match[2].trim() } : { text: feedback.trim(), quote: '' };
}

/** 'right' (80% or more), 'partial' (40% or more), 'wrong', or 'unsure' when the grade is low-confidence. */
export function outcome(grade) {
  if (grade?.confidence === 'low') return 'unsure';
  const share = grade?.max_score ? grade.score / grade.max_score : 0;
  if (share >= 0.8) return 'right';
  if (share >= 0.4) return 'partial';
  return 'wrong';
}

export const OUTCOME_LABEL = { right: 'Correct', partial: 'Partly', wrong: 'Not quite', unsure: 'We couldn’t judge this one' };

/** "3 correct · 1 partial · 1 to revisit", leaving out the counts that are zero. */
export function summary(grades) {
  const count = (kind) => grades.filter((g) => outcome(g) === kind).length;
  const parts = [
    [count('right'), 'correct'],
    [count('partial'), 'partial'],
    [count('wrong'), 'to revisit'],
    [count('unsure'), 'not judged'],
  ].filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`);
  return parts.join(' · ');
}

/** Concepts named by the grades: strengthened unless any answer missed them, then to revisit. */
export function conceptChips(grades) {
  const missing = new Set(grades.flatMap((g) => g?.missing_concepts ?? []));
  const matched = new Set(grades.flatMap((g) => g?.matched_concepts ?? []).filter((c) => !missing.has(c)));
  return { strengthened: [...matched], revisit: [...missing] };
}

/** One sentence in the room's voice for the whole session. */
export function verdict(percentage) {
  if (percentage >= 80) return 'A strong session. These ideas are holding.';
  if (percentage >= 60) return 'A good session. Most of it is holding.';
  if (percentage >= 40) return 'Some of it is holding; the rest comes back next time.';
  return 'This one hasn’t settled yet. We’ll go over it again.';
}
