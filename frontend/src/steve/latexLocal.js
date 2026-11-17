/**
 * An EPUB equation as LaTeX on the device (C20.8c, docs/STEVE.md S14): no Gemini call. The TeX annotation when
 * the MathML carries one (books made by our converter always do), else mathml-to-latex (MIT), loaded on first use.
 */

let converter = null;
const loadConverter = () => (converter ??= import('mathml-to-latex').then((m) => m.MathMLToLaTeX));

/** The TeX in a <math> element's annotation, or null. */
export function annotationTex(math) {
  for (const node of math?.getElementsByTagName?.('annotation') ?? []) {
    if ((node.getAttribute('encoding') || '').toLowerCase() === 'application/x-tex' && node.textContent.trim()) {
      return node.textContent.trim();
    }
  }
  return null;
}

/** MathML text as LaTeX through mathml-to-latex; '' when it cannot read it. */
export async function mathmlToLatex(mathml) {
  try {
    const MathMLToLaTeX = await loadConverter();
    return (MathMLToLaTeX.convert(mathml) || '').trim();
  } catch {
    return '';
  }
}

/** A <math> element as LaTeX: its annotation, else converted from its MathML. */
export async function latexOf(math) {
  return annotationTex(math) ?? mathmlToLatex(new XMLSerializer().serializeToString(math));
}
