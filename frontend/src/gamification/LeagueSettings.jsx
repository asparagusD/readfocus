import { useState } from 'react';
import { fetchApi } from '../lib/api';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/toastContext';
import { useProgress } from './useProgress';
import { changes, GOAL_MAX, GOAL_MIN } from './leagueView';
import './LeagueSettings.css';

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
    </form>
  );
}

/**
 * League settings (C24.6d, GAMIFICATION G3, G5, G14): the display name others see, the daily goal and the leaderboard
 * opt-out, sent as one PUT /me/progress with only what changed. The server's reason for a refused name is shown on
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
