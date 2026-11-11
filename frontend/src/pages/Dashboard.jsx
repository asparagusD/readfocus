import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Dot, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { fetchApi } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { MasteryBar } from '../components/ui/MasteryBar';
import { BookStack, Candle } from '../illustrations';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { greeting, lastScore, lastScores, streakLine, testsThisWeek } from '../lib/dashboard';
import { splitFeedback } from '../lib/results';
import { MasteryList } from '../components/dashboard/MasteryList';
import './Dashboard.css';

/** A hollow point for each test, the last one filled (handoff chart). */
function TrendDot({ cx, cy, index, points }) {
  if (cx == null || cy == null) return null;
  const last = index === points - 1;
  return <Dot cx={cx} cy={cy} r={last ? 5 : 4} className={last ? 'rf-trend__dot rf-trend__dot--last' : 'rf-trend__dot'} />;
}

/**
 * Test scores (handoff screen 09): the last eight tests across all books as
 * an accent line over a soft area, 0-100 in quarters, drawn by Recharts
 * with every colour from CSS tokens. The chart is a picture; the same
 * numbers are in a table for assistive tech.
 */
function ScoreTrend({ scores }) {
  const points = lastScores(scores);
  if (points.length === 0) return <p className="rf-dash__muted">Your scores appear here after your first test.</p>;
  return (
    <>
      <div className="rf-trend" aria-hidden="true">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={points} margin={{ top: 8, right: 12, left: -20, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid vertical={false} className="rf-trend__grid" />
            <XAxis dataKey="n" hide />
            <YAxis domain={[0, 100]} ticks={[25, 50, 75, 100]} tickLine={false} axisLine={false} className="rf-trend__axis" />
            <Area
              type="linear"
              dataKey="score"
              className="rf-trend__line"
              isAnimationActive={false}
              dot={(props) => <TrendDot key={props.index} {...props} points={points.length} />}
              activeDot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <table className="rf-dash__sr">
        <caption>Test scores, oldest first</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Book</th><th scope="col">Score</th></tr></thead>
        <tbody>
          {points.map((p) => <tr key={p.n}><td>{p.date}</td><td>{p.book_title}</td><td>{p.score}%</td></tr>)}
        </tbody>
      </table>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="rf-dash" aria-busy="true" aria-label="Loading your progress">
      <Skeleton width={160} height={12} />
      <Skeleton width={320} height={48} className="rf-dash__skel-title" />
      <Skeleton height={96} className="rf-dash__skel-stats" />
      <Skeleton height={240} />
    </div>
  );
}

/**
 * Dashboard (handoff screen 09): greeting and streak, four figures, the
 * test-score trend, the books in progress and recent feedback, from one
 * GET /dashboard as before.
 */
export function Dashboard() {
  useDocumentTitle('Dashboard');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    fetchApi('/dashboard')
      .then((d) => {
        setData(d);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [attempt]);

  const retry = () => {
    setLoading(true);
    setAttempt((n) => n + 1);
  };

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="rf-dash">
        <section className="rf-dash__card rf-dash__message" role="alert">
          <h1 className="rf-dash__h2">Your progress didn’t load.</h1>
          <p className="rf-dash__muted">Nothing is lost. Try again in a moment.</p>
          <Button onClick={retry}>Try again</Button>
        </section>
      </div>
    );
  }

  const now = new Date();
  const { eyebrow, title } = greeting(now);
  const scores = data.score_over_time ?? [];
  const books = data.book_progress ?? [];
  const feedback = data.recent_feedback ?? [];
  const latest = lastScore(scores);

  if (scores.length === 0 && books.length === 0) {
    return (
      <div className="rf-dash">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="rf-dash__title">{title}</h1>
        <EmptyState
          className="rf-dash__empty"
          illustration={<BookStack size={180} />}
          title="Your progress starts with a first session"
          action={<Link to="/" className="rf-btn rf-btn--primary">Go to your shelf</Link>}
        >
          Read a session and take its short test. Your scores, streak and the ideas you are mastering will gather here.
        </EmptyState>
      </div>
    );
  }

  const stats = [
    [data.words_this_week.toLocaleString('en-GB'), 'words read this week'],
    [latest == null ? '–' : `${latest}%`, 'last test score'],
    [testsThisWeek(scores, now), 'tests this week'],
    [books.length, books.length === 1 ? 'book in progress' : 'books in progress'],
  ];

  return (
    <div className="rf-dash">
      <header className="rf-dash__header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="rf-dash__title">{title}</h1>
        </div>
        <p className="rf-dash__streak">
          <Candle size={40} />
          <span>{streakLine(data.reading_streak)}</span>
        </p>
      </header>

      <dl className="rf-dash__stats">
        {stats.map(([value, label]) => (
          <div key={label} className="rf-dash__stat">
            <dt className="rf-dash__label">{label}</dt>
            <dd className="rf-dash__figure">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="rf-dash__columns">
        <div className="rf-dash__main">
          <section aria-labelledby="rf-trend-title">
            <div className="rf-dash__section-head">
              <h2 id="rf-trend-title" className="rf-dash__h2">Test scores</h2>
              <p className="rf-dash__muted">Last 8 tests · all books</p>
            </div>
            <ScoreTrend scores={scores} />
          </section>
          <MasteryList books={books} />
        </div>

        <aside className="rf-dash__side">
          {books.length > 0 && (
            <section className="rf-dash__card" aria-labelledby="rf-books-title">
              <h2 id="rf-books-title" className="eyebrow">Your books</h2>
              <ul className="rf-dash__books">
                {books.map((b) => (
                  <li key={b.book_id}>
                    <p className="rf-dash__book-title">{b.title}</p>
                    <p className="rf-dash__muted">{b.author}</p>
                    <MasteryBar value={b.progress_pct} className="rf-dash__book-bar" />
                    <p className="rf-dash__muted">
                      {Math.round(b.progress_pct)}% read · {b.sessions_completed} {b.sessions_completed === 1 ? 'session' : 'sessions'}
                      {b.est_sessions_to_finish > 0 ? ` · about ${b.est_sessions_to_finish} to finish` : b.chunks_completed >= b.total_chunks ? ' · finished' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {feedback.length > 0 && (
            <section className="rf-dash__card" aria-labelledby="rf-feedback-title">
              <h2 id="rf-feedback-title" className="eyebrow">Recent feedback</h2>
              <ul className="rf-dash__feedback">
                {feedback.map((f, i) => {
                  const { text, quote } = splitFeedback(f.feedback);
                  return (
                    <li key={i}>
                      <p className="rf-dash__muted">{f.book_title} · {f.date} · {f.score} of {f.max_score}</p>
                      <p>{text}</p>
                      {quote && <blockquote className="rf-dash__quote">“{quote}”</blockquote>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
