import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, Copy, KeyRound, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ReadingLamp } from '../illustrations';
import { OwnKeyForm } from './OwnKeyForm';
import { SteveAnswer } from './SteveAnswer';
import { backAt } from './steveState';
import { chapterName, suggestions } from './suggest';
import './StevePanel.css';

const ACTIVE = new Set(['waiting', 'streaming']);

function Identity({ title, role, small = false }) {
  return (
    <div className="rf-steve-id">
      <span className={small ? 'rf-steve-av rf-steve-av--sm' : 'rf-steve-av'} aria-hidden="true">S</span>
      <div>
        <p className="rf-steve-name">{title}</p>
        {role && <p className="rf-steve-role">{role}</p>}
      </div>
    </div>
  );
}

function Consent({ notice, onAccept, onLater, onKey }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accept = async () => {
    setBusy(true);
    try { await onAccept(); } catch { setError('That did not save. Try again.'); } finally { setBusy(false); }
  };
  return (
    <>
      <Identity title="Steve" role="Study assistant · reads along with you" />
      <section className="rf-steve-card" aria-labelledby="rf-steve-consent-title">
        <h3 id="rf-steve-consent-title" className="rf-steve-h3">Before Steve reads along</h3>
        {(notice?.text ?? '').split('\n\n').map((paragraph) => <p key={paragraph.slice(0, 24)} className="rf-steve-notice">{paragraph}</p>)}
        {notice?.terms_url && (
          <a className="rf-steve-link" href={notice.terms_url} target="_blank" rel="noopener noreferrer">
            Google's terms for the free tier<span className="rf-steve-hidden"> (opens in a new tab)</span>
          </a>
        )}
        <div className="rf-steve-row">
          <Button onClick={accept} loading={busy} loadingLabel="Turning on…">Turn on Steve</Button>
          <Button variant="ghost" onClick={onLater}>Not now</Button>
        </div>
        {error && <p className="rf-steve-small" role="alert">{error}</p>}
        <p className="rf-steve-fine">Prefer your own account? <button type="button" onClick={onKey}>Use your own Gemini key</button></p>
      </section>
    </>
  );
}

function Empty({ chapter, onAsk }) {
  const name = chapterName(chapter);
  return (
    <>
      <Identity title="Ask Steve about these pages" role={name ? `He has read “${name}” and the pages around it.` : 'He has read these pages and the ones around them.'} />
      <div className="rf-steve-sugg">
        {suggestions(chapter).map((question) => (
          <button key={question} type="button" className="rf-steve-sg" onClick={() => onAsk({ question })}>
            <span>{question}</span>
            <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="rf-steve-small">Tip: select a sentence in the book, then ask about it.</p>
    </>
  );
}

function pagesLabel(pages) {
  const numbers = pages.filter((p) => p.startsWith('p. ')).map((p) => Number(p.slice(3)));
  if (numbers.length) {
    const lo = Math.min(...numbers);
    const hi = Math.max(...numbers);
    return lo === hi ? `page ${lo}` : `pages ${lo}–${hi}`;
  }
  return pages.length ? pages.join(', ') : 'these pages';
}

function Conversation({ messages, pages, onCite, onStop, onRetry }) {
  const [copied, setCopied] = useState(null);
  const copy = async (message) => {
    try { await navigator.clipboard.writeText(message.text); setCopied(message.id); } catch { /* clipboard refused */ }
  };
  return (
    <ol className="rf-steve-thread">
      {messages.map((message) => (message.role === 'reader' ? (
        <li key={message.id} className="rf-steve-q">{message.label ? `${message.label}: ` : ''}{message.text}</li>
      ) : (
        <li key={message.id} className="rf-steve-a">
          <Identity small title={`Steve · from ${pagesLabel(pages)}`} />
          {message.status === 'waiting' && <p className="rf-steve-small" role="status">Steve is reading…</p>}
          {(message.text || message.status === 'streaming') && (
            <SteveAnswer text={message.text} citations={message.citations} streaming={ACTIVE.has(message.status)} onCite={onCite} />
          )}
          {ACTIVE.has(message.status) && (
            <div className="rf-steve-streaming">
              <span role="status">Steve is writing…</span>
              <Button variant="ghost" onClick={onStop}>Stop</Button>
            </div>
          )}
          {message.status === 'stopped' && <p className="rf-steve-small">Stopped. The answer above is unfinished.</p>}
          {message.status === 'error' && (
            <div className="rf-steve-error" role="alert">
              <p>{message.error?.message || 'Steve could not finish that answer.'}</p>
              <Button variant="secondary" onClick={onRetry}>Try again</Button>
            </div>
          )}
          {message.status === 'done' && (
            <div className="rf-steve-row">
              <Button variant="ghost" onClick={() => copy(message)}>
                <Copy size={16} strokeWidth={1.75} aria-hidden="true" />{copied === message.id ? 'Copied' : 'Copy'}
              </Button>
            </div>
          )}
        </li>
      )))}
    </ol>
  );
}

function Paused({ pause, onKey, onClose }) {
  // The daily limit always ends at the reader's midnight; Google's pause gives a time, or Steve rests for now.
  const when = backAt(pause?.until);
  const title = pause?.code === 'daily_limit' || when.startsWith('tomorrow') ? 'Steve is resting until tomorrow'
    : when.startsWith('at ') ? `Steve is resting until ${when.slice(3)}` : 'Steve is resting for now';
  return (
    <section className="rf-steve-card rf-steve-paused" aria-labelledby="rf-steve-paused-title">
      <ReadingLamp className="rf-steve-lamp" />
      <h3 id="rf-steve-paused-title" className="rf-steve-h3">{title}</h3>
      <p className="rf-steve-notice">
        {pause?.code === 'daily_limit'
          ? 'You have used today’s shared questions. They come back at midnight, your time.'
          : 'Steve’s shared questions are used up for now. He will be back on his own.'}
        {' '}The book, your notes and your highlights are all still here.
      </p>
      <div className="rf-steve-row">
        <Button variant="secondary" onClick={onKey}><KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />Use your own key</Button>
        <Button variant="ghost" onClick={onClose}>Keep reading</Button>
      </div>
    </section>
  );
}

function KeyView({ enabled, onEnabled, onBack }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try { await onEnabled(!enabled); } finally { setBusy(false); }
  };
  return (
    <>
      <Button variant="ghost" className="rf-steve-back" onClick={onBack}><ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />Steve</Button>
      <h3 className="rf-steve-h3">Steve’s settings</h3>
      <div className="rf-steve-switchrow">
        <div>
          <p className="rf-steve-strong" id="rf-steve-send-label">Send book text to Gemini</p>
          <p className="rf-steve-small">Off turns Steve off for every book. Nothing is sent while he is off.</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-labelledby="rf-steve-send-label"
          className="rf-steve-switch" onClick={toggle} disabled={busy}>
          <span aria-hidden="true" />
        </button>
      </div>
      <OwnKeyForm defaultOpen />
    </>
  );
}

/**
 * Steve's side panel (C20.7b, handoff screens 13-17): a narrow column beside the book from 760 px, a pull-up
 * sheet below; the book stays visible and usable either way (it is not a modal). Esc or the close button closes
 * it and focus returns to the toolbar's Steve button. States: consent, off, empty with suggestions, the
 * conversation (streaming answers, citations, stop, errors), resting (quota) and settings with the own key.
 */
export function StevePanel({ steve, chapter, onCite, onClose, returnTo }) {
  const { state, ask, stop, retry, accept, setEnabled, dispatch, reload } = steve;
  const [draft, setDraft] = useState('');
  const panel = useRef(null);
  const body = useRef(null);
  const heading = useRef(null);
  const last = state.messages[state.messages.length - 1];
  const active = last?.role === 'steve' && ACTIVE.has(last.status);

  useEffect(() => {
    heading.current?.focus();
    const button = returnTo?.current;
    return () => button?.focus();
  }, [returnTo]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && panel.current?.contains(document.activeElement)) { event.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => { // follow the answer as it grows, unless the reader has scrolled up
    const el = body.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [last?.text, state.messages.length]);

  const send = (event) => {
    event.preventDefault();
    if (!draft.trim() || active) return;
    ask({ question: draft });
    setDraft('');
  };

  const canAsk = state.view === 'chat';
  const placeholder = state.view === 'paused' ? (state.pause?.code === 'daily_limit' ? 'Steve is back tomorrow' : 'Steve is resting')
    : state.view === 'consent' || state.view === 'off' ? 'Turn on Steve to ask' : 'Ask about these pages…';

  let content;
  if (state.view === 'loading') content = <p className="rf-steve-small" role="status">Opening Steve…</p>;
  else if (state.view === 'load_error') {
    content = (
      <div className="rf-steve-error" role="alert">
        <p>Steve’s settings could not be loaded.</p>
        <Button variant="secondary" onClick={reload}>Try again</Button>
      </div>
    );
  } else if (state.view === 'consent') {
    content = <Consent notice={state.notice} onAccept={accept} onLater={onClose} onKey={() => dispatch({ type: 'show_key' })} />;
  } else if (state.view === 'off') {
    content = (
      <>
        <Identity title="Steve is switched off" role="Nothing from this book is sent while he is off." />
        <div className="rf-steve-row"><Button onClick={() => setEnabled(true)}>Turn on Steve</Button></div>
      </>
    );
  } else if (state.view === 'paused') {
    content = <Paused pause={state.pause} onKey={() => dispatch({ type: 'show_key' })} onClose={onClose} />;
  } else if (state.view === 'key') {
    content = <KeyView enabled={state.enabled} onEnabled={setEnabled} onBack={() => dispatch({ type: 'back' })} />;
  } else if (!state.messages.length) {
    content = <Empty chapter={chapter} onAsk={ask} />;
  } else {
    content = <Conversation messages={state.messages} pages={state.pages} onCite={onCite} onStop={stop} onRetry={retry} />;
  }

  return (
    <aside ref={panel} id="rf-steve-panel" className="rf-steve" aria-labelledby="rf-steve-title">
      <span className="rf-steve-grab" aria-hidden="true" />
      <header className="rf-steve-head">
        <h2 id="rf-steve-title" className="rf-steve-title" tabIndex={-1} ref={heading}>
          <span className="rf-steve-av rf-steve-av--sm" aria-hidden="true">S</span>Steve
        </h2>
        <button type="button" className="rf-steve-x" onClick={onClose} aria-label="Close Steve">
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      <div className="rf-steve-body" ref={body}>{content}</div>
      <footer className="rf-steve-foot">
        <form className="rf-steve-ask" onSubmit={send}>
          <label className="rf-steve-hidden" htmlFor="rf-steve-input">Your question for Steve</label>
          <input id="rf-steve-input" type="text" value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder} disabled={!canAsk} maxLength={1200} autoComplete="off" />
          <button type="submit" className="rf-steve-send" aria-label="Send" disabled={!canAsk || active || !draft.trim()}>
            <ArrowUp size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </form>
        <p className="rf-steve-fine">
          <span>Answers by Gemini · book text leaves this device</span>
          <button type="button" onClick={() => dispatch({ type: 'show_key' })}>Settings</button>
        </p>
      </footer>
    </aside>
  );
}
