import React, { useState, useEffect } from 'react';
import { fetchApi } from '../lib/api';
import { Button } from './ui/Button';

// Exactly 200 words
const CALIBRATION_TEXT = `Reading is a complex cognitive process of decoding symbols in order to construct or derive meaning. It is a means of language acquisition, communication, and of sharing information and ideas. Like all languages, it is a complex interaction between the text and the reader which is shaped by the reader's prior knowledge, experiences, attitude, and language community which is culturally and socially situated. The reading process requires continuous practice, development, and refinement. In addition, reading requires creativity and critical analysis. Consumers of literature make ventures with each piece, innately deviating from literal words to create images that make sense to them in the unfamiliar places the texts describe. Because reading is such a complex process, it cannot be controlled or restricted to one or two interpretations. There are no concrete laws in reading, but rather allows readers an escape to produce their own products introspectively. This promotes deep exploration of texts during interpretation. Readers use a variety of reading strategies to assist with decoding (to translate symbols into sounds or visual representations of speech) and comprehension. Readers may use context clues to identify the meaning of unknown words. Readers integrate the words they have read into their existing framework of knowledge or schema.`;

export function CalibrationFlow({ onComplete }) {
  const [started, setStarted] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStart = () => {
    setStarted(true);
    setStartTime(Date.now());
  };

  const handleDone = async () => {
    if (!startTime) return;
    setIsSubmitting(true);
    
    const elapsedMs = Date.now() - startTime;
    const elapsedMinutes = elapsedMs / 60000;
    
    // Calculate WPM, clamp between 50 and 1000
    let wpm = Math.round(200 / elapsedMinutes);
    wpm = Math.max(50, Math.min(1000, wpm));

    try {
      await fetchApi('/auth/profile/calibrate', {
        method: 'POST',
        body: JSON.stringify({ wpm })
      });
      onComplete(wpm);
    } catch (err) {
      console.error('Calibration failed:', err);
      alert('Failed to save calibration: ' + err.message);
      // Fallback
      onComplete(200);
    }
  };

  if (!started) {
    return (
      <div className="rf-reading-page page visible">
        <div style={{ maxWidth: '600px', margin: '0 auto', paddingTop: '20vh', textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--ink)', marginBottom: '16px', fontSize: '28px' }}>
            Before we begin...
          </h1>
          <p style={{ color: 'var(--ink-light)', fontSize: '18px', lineHeight: '1.6', marginBottom: '32px' }}>
            This is your first reading session. To accurately plan your focus times and pace, ReadFocus needs to know your natural reading speed. 
            <br/><br/>
            You will be shown a short 200-word passage. Read it at your normal, comfortable pace, and click "Done" when you reach the end.
          </p>
          <Button variant="primary" onClick={handleStart} style={{ fontSize: '18px', padding: '12px 32px' }}>
            Start Calibration Test
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rf-reading-page page visible">
      <header className="rf-chrome-bar" style={{ justifyContent: 'center' }}>
        <span className="rf-chrome-title">Reading Speed Calibration</span>
      </header>
      
      <main className="rf-reading-area" style={{ marginTop: '40px' }}>
        <div className="rf-reading-text">
          <p>{CALIBRATION_TEXT}</p>
        </div>
        
        <div style={{ textAlign: 'center', marginTop: '60px', marginBottom: '60px' }}>
          <Button 
            variant="primary" 
            onClick={handleDone} 
            disabled={isSubmitting}
            style={{ fontSize: '18px', padding: '12px 48px' }}
          >
            {isSubmitting ? 'Calculating...' : 'I am done reading'}
          </Button>
        </div>
      </main>
    </div>
  );
}
