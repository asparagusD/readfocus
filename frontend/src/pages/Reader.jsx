import React from 'react';
import { Button } from '../components/ui/Button';
import { usePageTransition } from '../hooks/usePageTransition';
import './Reader.css';

export function Reader() {
  usePageTransition();
  return (
    <div className="rf-reader-container page">
      <header className="rf-reader-header">
        <div className="rf-reader-meta">
          <span className="rf-reader-chapter">Chunk 1 of 42</span>
          <span className="rf-reader-timer">20:00</span>
        </div>
      </header>
      
      <article className="rf-reader-content">
        <p>
          From my grandfather Verus I learned good morals and the government of my temper.
        </p>
        <p>
          From the reputation and remembrance of my father, modesty and a manly character.
        </p>
        <p>
          From my mother, piety and beneficence, and abstinence, not only from evil deeds, but even from evil thoughts; and further, simplicity in my way of living, far removed from the habits of the rich.
        </p>
      </article>

      <footer className="rf-reader-footer">
        <Button variant="primary">Finish Reading</Button>
      </footer>
    </div>
  );
}
