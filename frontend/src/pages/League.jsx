import { useEffect } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { load, usePageData } from '../lib/pageData';
import { PROGRESS_FRESH_MS } from '../gamification/useProgress';
import { Skeleton } from '../components/ui/Skeleton';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { initials, lastWeekLine, tierStates, timeLeft, withMarkers } from '../gamification/leagueView';
import { LeagueSettings } from '../gamification/LeagueSettings';
import './League.css';

function Crest({ tier }) {
  return (
    <span className="rf-league__crest" aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 56 56"><circle cx="28" cy="28" r="26" /><circle cx="28" cy="28" r="20" /></svg>
      <span>{tier[0]}</span>
    </span>
  );
}

function Marker({ item }) {
  if (item.marker === 'gap') return <li className="rf-standing__gap" aria-hidden="true">· · ·</li>;
  const up = item.marker === 'promotion';
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <li className={`rf-standing__marker is-${item.marker}`}>
      <Icon size={14} aria-hidden="true" />
      {up ? `Promotion zone · the top ${item.count} move up to ${item.to}` : `The bottom ${item.count} move to ${item.to} next week`}
    </li>
  );
}

function Row({ row }) {
  return (
    <li className={row.you ? 'rf-standing is-you' : 'rf-standing'} aria-current={row.you ? 'true' : undefined}>
      <span className="rf-standing__rank">{row.rank}</span>
      <span className="rf-standing__avatar" aria-hidden="true">{initials(row.display_name)}</span>
      <span className="rf-standing__name">
        {row.display_name}
        {row.you && <span className="rf-standing__you"> (you)</span>}
      </span>
      <span className="rf-standing__xp">{row.weekly_xp.toLocaleString('en-GB')} XP</span>
    </li>
  );
}

/**
 * The weekly league (C24.6c, handoff screen 27, GAMIFICATION G10-G14): the tier with its crest and the six tier chips,
 * the time left until Monday 00:00 UTC, last week's outcome, and the reader's group ranked by this week's XP with
 * the promotion and demotion zones marked by soft lines (readers who keep off others' boards leave a gap). A reader
 * not yet in a group is told how they join; one who opted out is told only they see this board.
 */
export function League() {
  useDocumentTitle('League');
  // C35.5c (issue 20): the last league at once on a return, refreshed behind it; the settings' /me/progress is
  // asked now too, not after the league has answered (1.2 s, then 0.96 s, one after the other before).
  const { data, loading, error, reload } = usePageData('/leagues/current');
  useEffect(() => { load('/me/progress', { fresh: PROGRESS_FRESH_MS }).catch(() => {}); }, []);
  const state = data;

  if (loading) {
    return <div className="rf-league" aria-busy="true" aria-label="Loading your league"><Skeleton height={320} /></div>;
  }
  if (error) {
    return (
      <div className="rf-league" role="alert">
        <h1 className="rf-league__title">Your league didn’t load.</h1>
        <p className="rf-league__muted">Your XP and place are safe. Try again in a moment.</p>
      </div>
    );
  }
  const last = lastWeekLine(state.last_week);
  return (
    <div className="rf-league">
      <header className="rf-league__header">
        <p className="eyebrow">This week · {timeLeft(state.week.ends_at)} · Monday 00:00 UTC</p>
        <div className="rf-league__heading">
          <Crest tier={state.tier} />
          <h1 className="rf-league__title">{state.tier} league</h1>
        </div>
        <ol className="rf-league__tiers" aria-label="Tiers, lowest first">
          {tierStates(state.tier).map((t) => (
            <li key={t.name} className={`rf-tier is-${t.state}`} aria-current={t.state === 'current' ? 'step' : undefined}>
              {t.name}
            </li>
          ))}
        </ol>
      </header>

      <div className="rf-league__columns">
        <section aria-labelledby="rf-standings-title">
          <h2 id="rf-standings-title" className="rf-league__h2">Your group this week</h2>
          {state.opted_out && (
            <p className="rf-league__note">You keep yourself off other readers’ boards; only you see your place here.</p>
          )}
          {state.in_group ? (
            <ul className="rf-standings">
              {withMarkers(state.rows, state.zones, state.tier).map((item, i) => (
                item.marker ? <Marker key={`m${i}`} item={item} /> : <Row key={item.id} row={item} />
              ))}
            </ul>
          ) : (
            <p className="rf-league__note">
              Groups form each Monday from readers who earned XP in the two weeks before. Read in focus mode this
              week and you will join a {state.tier} group next Monday.
            </p>
          )}
        </section>

        <aside className="rf-league__side">
          {last && (
            <section className="rf-league__card" aria-labelledby="rf-last-title">
              <h2 id="rf-last-title" className="eyebrow">Last week</h2>
              <p>{last}</p>
            </section>
          )}
          <section className="rf-league__card" aria-labelledby="rf-how-title">
            <h2 id="rf-how-title" className="eyebrow">How leagues work</h2>
            <p>Each week you read alongside about 30 others at your tier. XP comes only from focused reading, its quizzes and badges. Nothing to buy, no extra lives.</p>
            <p>The top 7 move up and the bottom 5 move down; smaller groups move fewer, and a group under 10 moves nobody down. A quiet week just keeps you where you are.</p>
          </section>
          <LeagueSettings onSaved={reload} /> {/* C24.6d: a saved setting reloads the league (the opt-out shows at once) */}
        </aside>
      </div>
    </div>
  );
}
