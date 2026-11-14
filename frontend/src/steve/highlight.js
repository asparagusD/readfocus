/**
 * A small code highlighter for Steve's answers (C20.7, handoff screen 15): keywords, comments and strings
 * only, the three tints the handoff draws (.k, .c, .s). Pure, no dependency, no HTML: it returns tokens the
 * panel renders as spans. Unknown languages come back as one plain token.
 */

const KEYWORDS = {
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
  javascript: 'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null return static super switch this throw true try typeof undefined var void while yield',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true false try void while',
  c: 'auto break case char const continue default do double else enum extern float for if inline int long return short signed sizeof static struct switch typedef union unsigned void volatile while NULL true false bool',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  rust: 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  sql: 'select from where and or not insert into values update set delete create table index join left right inner outer on group by order having limit as null is in distinct union',
  bash: 'if then else elif fi for while do done case esac function in return export local echo',
};
const ALIASES = { py: 'python', js: 'javascript', jsx: 'javascript', ts: 'javascript', typescript: 'javascript', tsx: 'javascript', 'c++': 'c', cpp: 'c', cs: 'java', csharp: 'java', kotlin: 'java', rs: 'rust', sh: 'bash', shell: 'bash', zsh: 'bash', postgres: 'sql', postgresql: 'sql' };
const HASH_COMMENTS = new Set(['python', 'bash']);
const SQL_COMMENTS = new Set(['sql']);

export function languageOf(lang) {
  const name = String(lang ?? '').toLowerCase();
  return KEYWORDS[name] ? name : ALIASES[name] ?? null;
}

/** [{text, kind}] where kind is 'k' (keyword), 'c' (comment), 's' (string) or null. */
export function tokenize(code, lang) {
  const language = languageOf(lang);
  if (!language) return [{ text: code, kind: null }];
  const keywords = new Set(KEYWORDS[language].split(' '));
  const comment = HASH_COMMENTS.has(language) ? '#[^\\n]*' : SQL_COMMENTS.has(language) ? '--[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)';
  const pattern = new RegExp(`(${comment})|("(?:\\\\.|[^"\\\\\\n])*"?|'(?:\\\\.|[^'\\\\\\n])*'?|\`(?:\\\\.|[^\`\\\\])*\`?)|([A-Za-z_][A-Za-z0-9_]*)`, 'g');
  const out = [];
  let last = 0;
  const push = (text, kind) => {
    if (!text) return;
    const previous = out[out.length - 1];
    if (previous && previous.kind === kind) previous.text += text;
    else out.push({ text, kind });
  };
  for (const match of code.matchAll(pattern)) {
    push(code.slice(last, match.index), null);
    const [whole, isComment, isString, word] = match;
    if (isComment) push(whole, 'c');
    else if (isString) push(whole, 's');
    else push(whole, word && keywords.has(word) ? 'k' : null);
    last = match.index + whole.length;
  }
  push(code.slice(last), null);
  return out;
}
