/**
 * Three suggested questions for Steve's empty state (C20.7, handoff screen 14), from the chapter the reader is
 * in. Templates, not a model: nothing is sent until the reader picks one.
 */

const WITH_CHAPTER = [
  (c) => `What is the main idea of “${c}”?`,
  (c) => `Which terms in “${c}” should I be sure I understand?`,
  (c) => `How does “${c}” connect to what came before?`,
];
const WITHOUT = [
  () => 'What is the main idea of these pages?',
  () => 'Which terms here should I be sure I understand?',
  () => 'How do these pages connect to what came before?',
];

/** A chapter title cleaned for a question: no page numbers or dot leaders, at most 60 characters. */
export function chapterName(chapter) {
  const name = String(chapter ?? '').replace(/[.\s]*\d+\s*$/, '').replace(/\s+/g, ' ').trim();
  return name.length > 60 ? `${name.slice(0, 59).trimEnd()}…` : name;
}

export function suggestions(chapter) {
  const name = chapterName(chapter);
  return (name ? WITH_CHAPTER : WITHOUT).map((make) => make(name));
}
