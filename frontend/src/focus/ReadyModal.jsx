import { useEffect, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { fetchApi } from '../lib/api';

const WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen'];
const MINUTES_PER_QUESTION = 1.25;
const PASS = 0.4; // FOCUS_RULES F12
const PER_CORRECT = 20; // F11

/**
 * "Ready for your questions?" (C23.6b, handoff screen 22): over the book once the ribbon is set. It builds the
 * session's quiz (once, on the server) to say how many questions there are and about how long they take, shows
 * the points so far plainly, and lets the reader start now or come back to it from the focus bar.
 */
export function ReadyModal({ open, sessionId, label, points, onLater, onStart }) {
  const [count, setCount] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let live = true;
    fetchApi(`/focus/${sessionId}/quiz`, { method: 'POST' })
      .then((data) => { if (live) setCount(data.count); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, sessionId]);
  const keep = count ? Math.ceil(count * PASS) : null;
  return (
    <Modal isOpen={open} onClose={onLater} title="Ready for your questions?">
      <p className="rf-leave-text">
        {label ? `The ribbon is on ${label}. ` : ''}
        {count
          ? `${WORDS[count] ?? count} short questions on what you read, about ${Math.max(1, Math.round(count * MINUTES_PER_QUESTION))} minutes.`
          : failed ? 'Your questions couldn’t be gathered just now. Try again in a moment.' : 'Gathering your questions…'}
      </p>
      {count > 0 && (
        <p className="rf-leave-text">
          {points} points for your focus time so far, and {PER_CORRECT} for each right answer. Get {keep} of {count} right
          to keep them.
        </p>
      )}
      <div className="rf-leave-actions">
        <Button variant="secondary" onClick={onLater}>Not now, keep my place</Button>
        <Button onClick={onStart} disabled={!count}>Start questions</Button>
      </div>
    </Modal>
  );
}
