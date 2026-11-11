import { useState } from 'react';
import { fetchApi } from '../lib/api';
import { Button } from './ui/Button';
import { useToast } from './ui/toastContext';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import './CalibrationFlow.css';

// Exactly 200 words
const CALIBRATION_TEXT = `Reading is a complex cognitive process of decoding symbols in order to construct or derive meaning. It is a means of language acquisition, communication, and of sharing information and ideas. Like all languages, it is a complex interaction between the text and the reader which is shaped by the reader's prior knowledge, experiences, attitude, and language community which is culturally and socially situated. The reading process requires continuous practice, development, and refinement. In addition, reading requires creativity and critical analysis. Consumers of literature make ventures with each piece, innately deviating from literal words to create images that make sense to them in the unfamiliar places the texts describe. Because reading is such a complex process, it cannot be controlled or restricted to one or two interpretations. There are no concrete laws in reading, but rather allows readers an escape to produce their own products introspectively. This promotes deep exploration of texts during interpretation. Readers use a variety of reading strategies to assist with decoding (to translate symbols into sounds or visual representations of speech) and comprehension. Readers may use context clues to identify the meaning of unknown words. Readers integrate the words they have read into their existing framework of knowledge or schema.`;

/**
 * First-session reading speed (C13.8b restyle): read a 200-word passage at
 * an easy pace; the time gives words per minute (clamped 50-1000), posted
 * to /auth/profile/calibrate. If saving fails, a toast says so and the
 * session goes on at 200 words a minute, as before.
 */
export function CalibrationFlow({ onComplete }) {
  useDocumentTitle('Your reading pace');
  const { toast } = useToast();
  const [startTime, setStartTime] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDone = async () => {
    if (!startTime) return;
    setIsSubmitting(true);
    const elapsedMinutes = (Date.now() - startTime) / 60000;
    const wpm = Math.max(50, Math.min(1000, Math.round(200 / elapsedMinutes)));
    try {
      await fetchApi('/auth/profile/calibrate', { method: 'POST', body: JSON.stringify({ wpm }) });
      onComplete(wpm);
    } catch (err) {
      console.error('Calibration failed:', err);
      toast({ kind: 'warning', message: `We couldn’t save your reading pace (${err.message}), so we’ll plan at 200 words a minute for now.` });
      onComplete(200);
    }
  };

  if (!startTime) {
    return (
      <main className="rf-calibrate rf-calibrate--intro">
        <p className="eyebrow">Before your first session</p>
        <h1 className="rf-calibrate__title">How quickly do you read?</h1>
        <p className="rf-calibrate__lead">
          ReadFocus plans each session around your natural pace. Read a short passage of 200 words
          the way you usually would, then say when you reach the end. There is no test on it.
        </p>
        <Button onClick={() => setStartTime(Date.now())}>Start reading</Button>
      </main>
    );
  }

  return (
    <main className="rf-calibrate">
      <p className="eyebrow">Your reading pace</p>
      <h1 className="rf-calibrate__title rf-calibrate__title--small">Read at your usual pace</h1>
      <p className="rf-calibrate__passage">{CALIBRATION_TEXT}</p>
      <Button onClick={handleDone} loading={isSubmitting} loadingLabel="Saving your pace…">I’ve finished reading</Button>
    </main>
  );
}
