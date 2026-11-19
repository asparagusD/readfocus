import { useEffect, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { fetchApi } from '../lib/api';

const WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen'];
const MINUTES_PER_QUESTION = 1.25;
const PASS = 0.4; // FOCUS_RULES F12
const PER_CORRECT = 20; // F11
const RETRY_MS = 5_000; // C26.3: while the range is prepared, ask again this often (C36.3: it waits for one batch)

/**
 * "Ready for your questions?" (C23.6b, handoff screen 22): over the book once the ribbon is set. It builds the
 * session's quiz (once, on the server) to say how many questions there are and about how long they take, shows
 * the points so far plainly, and lets the reader start now or come back to it from the focus bar.
 */
export function ReadyModal({ open, sessionId, label, points, onLater, onStart }) {
  const [count, setCount] = useState(null);
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState(false); // C26.3: the range is not stored yet (C36.3); the session is kept
  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let live = true;
    let timer = null;
    const ask = () => fetchApi(`/focus/${sessionId}/quiz`, { method: 'POST' })
      .then((data) => { if (live) { setWaiting(false); setCount(data.count); } })
      .catch((err) => {
        if (!live) return;
        if (err.status === 409 && err.detail?.code === 'preparing') {
          setWaiting(true);
          timer = setTimeout(ask, RETRY_MS);
        } else setFailed(true);
      });
    ask();
    return () => { live = false; clearTimeout(timer); };
  }, [open, sessionId]);
  const keep = count ? Math.ceil(count * PASS) : null;
  return (
    <Modal isOpen={open} onClose={onLater} title="Ready for your questions?">
      <p className="rf-leave-text">
        {label ? `The ribbon is on ${label}. ` : ''}
        {count
          ? `${WORDS[count] ?? count} short questions on what you read, about ${Math.max(1, Math.round(count * MINUTES_PER_QUESTION))} minutes.`
          : waiting ? 'The pages you read are still being prepared. Your session is kept, and your questions appear here in a moment.'
            : failed ? 'Your questions couldn’t be gathered just now. Try again in a moment.' : 'Gathering your questions…'}
      </p>
      {count > 0 && (
        <p className="rf-leave-text">
          {points} points for your focus time so far, and {PER_CORRECT} for each right answer, up to as many again.
          Get {keep} of {count} right to keep them.
        </p>
      )}
      <div className="rf-leave-actions">
        <Button variant="secondary" onClick={onLater}>Not now, keep my place</Button>
        <Button onClick={onStart} disabled={!count}>Start questions</Button>
      </div>
    </Modal>
  );
}
