import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { ScoreBadge } from '../components/ui/ScoreBadge';
import { ProgressRing } from '../components/ui/ProgressRing';
import { ConceptChip, ConceptChipGroup } from '../components/ui/ConceptChip';

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

function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Open “Leave this test?”</Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Leave this test?">
        <p className="gallery-modal-body">Your answers so far are kept. You can come back and finish it any time today.</p>
        <div className="gallery-row gallery-modal-actions">
          <Button variant="secondary" onClick={() => setOpen(false)}>Keep going</Button>
          <Button onClick={() => setOpen(false)}>Leave test</Button>
        </div>
      </Modal>
    </>
  );
}

function ChipsDemo() {
  const [run, setRun] = useState(0);
  return (
    <div className="gallery-grid" key={run}>
      <ConceptChipGroup label="Concepts from this session">
        <ConceptChip kind="strengthened">Opportunity cost</ConceptChip>
        <ConceptChip kind="strengthened">Simplicity</ConceptChip>
        <ConceptChip kind="revisit">Quiet desperation</ConceptChip>
        <ConceptChip kind="revisit">The cost of a thing is the amount of life exchanged for it</ConceptChip>
      </ConceptChipGroup>
      <div className="gallery-row gallery-center">
        <ScoreBadge percentage={86} label="Session 5" />
        <ScoreBadge percentage={72} label="Session 6" variant="outlined" />
        <ProgressRing value={64} label="Concept mastery, Walden" />
        <ProgressRing value={0} label="Concept mastery, Middlemarch" />
        <ProgressRing value={100} label="Concept mastery, Meditations" size={80} />
      </div>
      <div><Button variant="ghost" onClick={() => setRun((n) => n + 1)}>Replay</Button></div>
    </div>
  );
}

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

      <Section title="Modal">
        <ModalDemo />
        <p className="gallery-note">Tab stays inside; Esc or the scrim closes; focus returns to the button.</p>
      </Section>

      <Section title="Chips, badges, progress">
        <ChipsDemo />
      </Section>

      <Section title="Skeleton">
        <div className="gallery-skeletons" aria-busy="true" aria-label="Loading example">
          <Skeleton lines={3} />
          <div className="gallery-row">
            {[0, 1, 2].map((i) => <Skeleton key={i} width={96} height={144} />)}
          </div>
        </div>
      </Section>
    </main>
  );
}
