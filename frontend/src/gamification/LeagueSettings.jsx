import { useState } from 'react';
import { fetchApi } from '../lib/api';
import { remember } from '../lib/pageData';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/toastContext';
import { useProgress } from './useProgress';
import { changes, GOAL_MAX, GOAL_MIN } from './leagueView';
import { deviceZone } from './progressMath';
import './LeagueSettings.css';

/** The zone the reader's days follow (G6), and a switch to this device's when they differ (a trip, a new device). */
function Zone({ saved, onSaved }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const device = deviceZone();
  async function use() {
    setBusy(true);
    try {
      const next = await fetchApi('/me/progress', { method: 'PUT', body: JSON.stringify({ timezone: device }) });
      toast({ kind: 'success', message: `Your days now follow ${device}.` });
      remember('/me/progress', next); // C35.5c: the kept progress is the saved one
      onSaved(next);
    } catch {
      toast({ kind: 'warning', message: 'The time zone was not changed. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rf-lset__zone">
      <p>Your days and streak follow <strong>{saved.timezone}</strong>.</p>
      {device && device !== saved.timezone && (
        <Button variant="secondary" loading={busy} loadingLabel="Changing" onClick={use}>
          Use this device’s time zone ({device})
        </Button>
      )}
    </div>
  );
}

function Form({ saved, onSaved }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState({ display_name: saved.display_name ?? '', daily_goal: String(saved.daily_goal),
    leaderboard_opt_out: saved.leaderboard_opt_out });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const goal = Number(draft.daily_goal);
  const goalError = Number.isInteger(goal) && goal >= GOAL_MIN && goal <= GOAL_MAX
    ? null : `Choose a whole number from ${GOAL_MIN} to ${GOAL_MAX}.`;

  async function save(event) {
    event.preventDefault();
    const body = changes(saved, draft);
    if (goalError || Object.keys(body).length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const next = await fetchApi('/me/progress', { method: 'PUT', body: JSON.stringify(body) });
      toast({ kind: 'success', message: 'Your league settings are saved.' });
      remember('/me/progress', next); // C35.5c: the kept progress is the saved one
      onSaved(next);
    } catch (err) {
      setError(err.status === 422 && typeof err.detail === 'string' ? err.detail : 'Not saved just now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <form className="rf-lset" onSubmit={save} noValidate>
      <TextInput label="Display name" value={draft.display_name} onChange={set('display_name')} maxLength={40}
        autoComplete="nickname" error={error}
        hint="Other readers see this name and your weekly XP, nothing else. Leave it empty to appear as “Reader” and four letters." />
      <TextInput label="Daily goal (XP)" type="number" inputMode="numeric" min={GOAL_MIN} max={GOAL_MAX} step={10}
        value={draft.daily_goal} onChange={set('daily_goal')} error={goalError}
        hint="Ten XP is about one focused minute; 50 is a good evening." />
      <label className="rf-lset__check">
        <input type="checkbox" checked={draft.leaderboard_opt_out} onChange={set('leaderboard_opt_out')} />
        <span>Keep me off other readers’ boards
          <span className="rf-lset__hint">Your XP, streak and badges stay the same; your tier still moves.</span>
        </span>
      </label>
      <Button type="submit" loading={busy} loadingLabel="Saving" disabled={Boolean(goalError)}>Save settings</Button>
      <Zone saved={saved} onSaved={onSaved} />
    </form>
  );
}

/**
 * League settings (C24.6d, GAMIFICATION G3, G5, G14): the display name others see, the daily goal and the leaderboard
 * opt-out, sent as one PUT /me/progress with only what changed; and (G6) the time zone the days follow. The server's reason for a refused name is shown on
 * the name field; a saved change is confirmed in a toast and handed to the page (which reloads the league).
 */
export function LeagueSettings({ onSaved }) {
  const loaded = useProgress();
  const [saved, setSaved] = useState(null);
  const current = saved ?? loaded;
  return (
    <section className="rf-league__card" aria-labelledby="rf-lset-title">
      <h2 id="rf-lset-title" className="eyebrow">Your league settings</h2>
      {current
        ? <Form key={JSON.stringify(current)} saved={current} onSaved={(next) => { setSaved(next); onSaved?.(next); }} />
        : <p className="rf-league__muted">Loading your settings…</p>}
    </section>
  );
}
