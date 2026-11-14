import DOMPurify from 'dompurify';

let katexModule = null;

/** KaTeX, loaded once on the first equation Steve writes (about 78 KB gzip, its own chunk). */
export const loadKatex = () => (katexModule ??= import('katex').then((m) => m.default ?? m));

/** TeX as MathML (KaTeX's `mathml` output: no fonts or CSS shipped), sanitised with DOMPurify's MathML profile. */
export function texToMathml(katex, tex, display) {
  const html = katex.renderToString(tex, { displayMode: display, output: 'mathml', throwOnError: false, strict: 'ignore', trust: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { mathMl: true } });
}
