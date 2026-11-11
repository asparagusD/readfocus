import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

// Dev-only gallery: every component in every state, in both themes and
// both accents, for the design-review checks at 375 and 1440 px.

function ThemeSwitch() {
  const [theme, setTheme] = useState('paper');
  const [accent, setAccent] = useState('terracotta');
  const apply = (t, a) => {
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.accent = a;
    setTheme(t);
    setAccent(a);
  };
  return (
    <div className="gallery-switch" role="group" aria-label="Theme and accent">
      <Button variant={theme === 'paper' ? 'secondary' : 'ghost'} aria-pressed={theme === 'paper'} onClick={() => apply('paper', accent)}>Paper</Button>
      <Button variant={theme === 'lamplight' ? 'secondary' : 'ghost'} aria-pressed={theme === 'lamplight'} onClick={() => apply('lamplight', accent)}>Lamplight</Button>
      <Button variant={accent === 'terracotta' ? 'secondary' : 'ghost'} aria-pressed={accent === 'terracotta'} onClick={() => apply(theme, 'terracotta')}>Terracotta</Button>
      <Button variant={accent === 'sage' ? 'secondary' : 'ghost'} aria-pressed={accent === 'sage'} onClick={() => apply(theme, 'sage')}>Sage</Button>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="gallery-section" aria-labelledby={`g-${title}`}>
      <h2 id={`g-${title}`} className="eyebrow">{title}</h2>
      {children}
    </section>
  );
}

const VARIANTS = [
  ['primary', 'Start test', 'Grading…'],
  ['secondary', 'Add a book', 'Uploading…'],
  ['ghost', 'Later', 'Saving…'],
  ['danger', 'Leave test', 'Leaving…'],
];

export function Gallery() {
  return (
    <main className="gallery">
      <header className="gallery-header">
        <h1>Components</h1>
        <ThemeSwitch />
      </header>

      <Section title="Buttons">
        <div className="gallery-grid">
          {VARIANTS.map(([variant, label, busy]) => (
            <div key={variant} className="gallery-row">
              <Button variant={variant}>{label}</Button>
              <Button variant={variant} disabled>{label}</Button>
              <Button variant={variant} loading loadingLabel={busy}>{label}</Button>
            </div>
          ))}
        </div>
        <p className="gallery-note">Default, disabled, loading. Hover, press and focus-visible: use the pointer and Tab.</p>
      </Section>

      <Section title="Cards">
        <div className="gallery-cards">
          <Card>
            <h3>Raised</h3>
            <p>Surface with a hairline; no shadow.</p>
          </Card>
          <Card variant="sunken">
            <h3>Sunken</h3>
            <p>Paper-2, no line.</p>
          </Card>
          <Card as="a" href="#cards" interactive>
            <h3>Interactive</h3>
            <p>A link card: the hairline darkens on hover.</p>
          </Card>
        </div>
      </Section>
    </main>
  );
}
