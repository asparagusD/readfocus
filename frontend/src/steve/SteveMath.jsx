import { useEffect, useState } from 'react';
import { loadKatex, texToMathml } from './math';

/**
 * Math in Steve's answers (C20.7b): KaTeX is loaded on the first equation only. Until then, or if the TeX
 * cannot be read, the source is shown as code, so nothing is lost.
 */
export function SteveMath({ tex, display = false }) {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let live = true;
    loadKatex().then((katex) => { if (live) setHtml(texToMathml(katex, tex, display)); }).catch(() => {});
    return () => { live = false; };
  }, [tex, display]);
  const Tag = display ? 'div' : 'span';
  if (!html) return <Tag className={display ? 'rf-steve-math rf-steve-math--display' : 'rf-steve-math'}><code>{tex}</code></Tag>;
  // KaTeX's MathML, sanitised with DOMPurify's MathML profile in math.js before it gets here.
  return <Tag className={display ? 'rf-steve-math rf-steve-math--display' : 'rf-steve-math'} dangerouslySetInnerHTML={{ __html: html }} />;
}
