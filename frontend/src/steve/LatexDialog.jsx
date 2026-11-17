import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { SteveMath } from './SteveMath';
import './LatexDialog.css';

/**
 * Copy as LaTeX (C20.8, docs/STEVE.md S14): a KaTeX preview of the equation and its LaTeX, to check before it
 * is copied. `state` is { loading } while it is read, { latex, source } once known, or { error }.
 */
export function LatexDialog({ state, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(state.latex); setCopied(true); } catch { setCopied(false); }
  };
  const where = state?.source === 'steve' ? 'Read by Steve from the page.' : state?.source === 'cached'
    ? 'Read by Steve from this page before.' : 'From the book’s own markup.';
  return (
    <Modal isOpen={Boolean(state)} onClose={onClose} title="Copy as LaTeX">
      {state?.loading && <p className="rf-latex-note" role="status">Reading the equation…</p>}
      {state?.error && <p className="rf-latex-note" role="alert">{state.error}</p>}
      {state?.latex && (
        <div className="rf-latex">
          <div className="rf-latex-preview"><SteveMath tex={state.latex} display /></div>
          <pre className="rf-latex-source" tabIndex={0}><code>{state.latex}</code></pre>
          <p className="rf-latex-note">{where} Check it against the book before you use it.</p>
          <div className="rf-latex-actions">
            <Button onClick={copy}><Copy size={16} strokeWidth={1.75} aria-hidden="true" />{copied ? 'Copied' : 'Copy LaTeX'}</Button>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
