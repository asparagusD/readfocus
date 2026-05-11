import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import { fetchApi } from '../lib/api';
import { usePageTransition } from '../hooks/usePageTransition';
import './Dashboard.css';

// Warm palette for multi-book lines on the chart
const LINE_COLORS = ['#c8832a', '#2d7a4f', '#4a6fa5', '#8e5ca6', '#a05040'];

// Pivot score_over_time rows into recharts-friendly format:
// [{ date: '2026-05-01', 'Book A': 85, 'Book B': 70 }, ...]
function pivotScores(scoreData) {
  const byDate = {};
  for (const row of scoreData) {
    if (!byDate[row.date]) byDate[row.date] = { date: row.date };
    byDate[row.date][row.book_title] = row.score_pct;
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

function BookProgressCard({ book }) {
  const pct = book.progress_pct;
  return (
    <div className="rf-dash-book-card">
      <div className="rf-dash-book-header">
        <div>
          <div className="rf-dash-book-title">{book.title}</div>
          <div className="rf-dash-book-author">{book.author}</div>
        </div>
        <div className="rf-dash-book-score">{book.avg_score > 0 ? `${book.avg_score}%` : '—'}</div>
      </div>

      <div className="rf-dash-progress-track">
        <div className="rf-dash-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="rf-dash-progress-label">
        {book.chunks_completed}/{book.total_chunks} chunks · {pct}% complete
      </div>

      <div className="rf-dash-book-meta">
        <span>{book.sessions_completed} session{book.sessions_completed !== 1 ? 's' : ''} done</span>
        <span className="rf-dash-meta-sep">·</span>
        <span>
          {book.est_sessions_to_finish > 0
            ? `~${book.est_sessions_to_finish} to finish`
            : book.chunks_completed >= book.total_chunks
              ? 'Finished!'
              : 'Start reading'}
        </span>
      </div>
    </div>
  );
}

function ScoreChart({ scoreData, bookTitles }) {
  const chartData = pivotScores(scoreData);
  if (chartData.length === 0) {
    return <div className="rf-dash-empty">No sessions completed yet — your scores will appear here.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--paper-mid)" />
        <XAxis
          dataKey="date"
          tick={{ fontFamily: 'var(--font-ui)', fontSize: 11, fill: 'var(--ink-faint)' }}
          tickLine={false}
          axisLine={{ stroke: 'var(--paper-mid)' }}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontFamily: 'var(--font-ui)', fontSize: 11, fill: 'var(--ink-faint)' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `${v}%`}
        />
        <Tooltip
          contentStyle={{
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            backgroundColor: 'var(--paper)',
            border: '1px solid var(--paper-mid)',
            borderRadius: '4px',
            color: 'var(--ink)',
          }}
          formatter={(value) => [`${value}%`, '']}
        />
        <Legend
          wrapperStyle={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--ink-light)', paddingTop: 12 }}
        />
        {bookTitles.map((title, i) => (
          <Line
            key={title}
            type="monotone"
            dataKey={title}
            stroke={LINE_COLORS[i % LINE_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 4, fill: LINE_COLORS[i % LINE_COLORS.length], strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function FeedbackQuote({ item }) {
  const scorePct = item.max_score > 0 ? Math.round((item.score / item.max_score) * 100) : 0;
  return (
    <div className="rf-dash-feedback-card">
      <blockquote className="rf-dash-feedback-text">"{item.feedback}"</blockquote>
      <div className="rf-dash-feedback-meta">
        <span className="rf-dash-feedback-book">{item.book_title}</span>
        <span className="rf-dash-meta-sep">·</span>
        <span className={`rf-dash-feedback-score ${scorePct >= 70 ? 'good' : scorePct >= 40 ? 'mid' : 'low'}`}>
          {item.score}/{item.max_score}
        </span>
        <span className="rf-dash-meta-sep">·</span>
        <span className="rf-dash-feedback-date">{item.date}</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const navigateTo = usePageTransition();

  useEffect(() => {
    fetchApi('/dashboard')
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!loading) setTimeout(() => setIsVisible(true), 16);
  }, [loading]);

  if (loading) {
    return (
      <div className="rf-dash-loading page">
        <span className="rf-dash-loading-text">Loading your progress…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rf-dash-loading page visible">
        <span className="rf-dash-loading-text" style={{ color: 'var(--red-soft)' }}>{error}</span>
      </div>
    );
  }

  const bookTitles = [...new Set(data.score_over_time.map(s => s.book_title))];

  return (
    <div className={`rf-dash-page page ${isVisible ? 'visible' : ''}`}>
      <div className="rf-dash-container">

        {/* Page Header */}
        <header className="rf-dash-header">
          <h1 className="rf-dash-title">Your Progress</h1>
          <p className="rf-dash-subtitle">A record of everything you have read and learned.</p>
        </header>

        {/* Stat Pills */}
        <div className="rf-dash-stats-row">
          <div className="rf-dash-stat">
            <div className="rf-dash-stat-value">{data.reading_streak}</div>
            <div className="rf-dash-stat-label">day streak</div>
          </div>
          <div className="rf-dash-stat-divider" />
          <div className="rf-dash-stat">
            <div className="rf-dash-stat-value">{data.words_this_week.toLocaleString()}</div>
            <div className="rf-dash-stat-label">words this week</div>
          </div>
          <div className="rf-dash-stat-divider" />
          <div className="rf-dash-stat">
            <div className="rf-dash-stat-value">{data.book_progress.length}</div>
            <div className="rf-dash-stat-label">book{data.book_progress.length !== 1 ? 's' : ''} in progress</div>
          </div>
        </div>

        {/* Score Chart */}
        <section className="rf-dash-section">
          <h2 className="rf-dash-section-title">Comprehension over time</h2>
          <div className="rf-dash-chart-wrap">
            <ScoreChart scoreData={data.score_over_time} bookTitles={bookTitles} />
          </div>
        </section>

        {/* Book Progress List */}
        <section className="rf-dash-section">
          <h2 className="rf-dash-section-title">Books</h2>
          {data.book_progress.length === 0 ? (
            <div className="rf-dash-empty">
              No books in progress yet.{' '}
              <span
                className="rf-dash-empty-link"
                onClick={() => navigateTo('/')}
              >
                Visit the Library to get started.
              </span>
            </div>
          ) : (
            <div className="rf-dash-book-list">
              {data.book_progress.map(book => (
                <BookProgressCard key={book.book_id} book={book} />
              ))}
            </div>
          )}
        </section>

        {/* Recent Feedback */}
        <section className="rf-dash-section">
          <h2 className="rf-dash-section-title">Recent feedback</h2>
          {data.recent_feedback.length === 0 ? (
            <div className="rf-dash-empty">Complete a comprehension test to see your evaluator feedback here.</div>
          ) : (
            <div className="rf-dash-feedback-list">
              {data.recent_feedback.map((item, i) => (
                <FeedbackQuote key={i} item={item} />
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
