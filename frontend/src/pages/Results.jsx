import { useState, useEffect } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { Check, RotateCcw, Minus, HelpCircle } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { ConceptChip, ConceptChipGroup } from '../components/ui/ConceptChip';
import { OpenBook } from '../illustrations';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { OUTCOME_LABEL, conceptChips, outcome, splitFeedback, summary, verdict } from '../lib/results';
import './Results.css';

const ICONS = { right: Check, partial: Minus, wrong: RotateCcw, unsure: HelpCircle };
const NEXT_TITLE = {
  new: 'The next pages',
  re_read: 'A second look at today’s pages',
  review: 'A review of what needs another look',
  finished: 'You have reached the end of the book',
};

/** A stored multiple-choice question lists its options after the prompt; an answer is "(b) <option>". */
const promptOf = (q) => (q?.options?.length ? q.question.split('\n')[0] : q?.question);
const shownAnswer = (answer) => (answer ?? '').replace(/^\([a-h]\)\s+/, '');

function ResultsSkeleton() {
  return (
    <div className="rf-results" aria-busy="true" aria-label="Loading your results">
      <div className="rf-results__main">
        <Skeleton width={220} height={12} />
        <Skeleton width={200} height={96} className="rf-results__skel-score" />
        <Skeleton lines={6} />
      </div>
      <div className="rf-results__side">
        <Skeleton height={220} className="rf-results__skel-card" />
      </div>
    </div>
  );
}

/**
 * Results (handoff screen 08): the score, a one-line verdict and a count
 * by outcome; each question with its outcome in words and an icon, the
 * reader's answer, the feedback and the passage it rests on; the concepts
 * strengthened and to revisit; and the next session. Coming from the test
 * the grades arrive in router state; after a refresh they are rebuilt
 * from GET /sessions/{id} and the pace from GET /books/{id}, as before.
 */
export function Results() {
  useDocumentTitle('Results');
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState(null); // 'failed' | 'not-graded'
  const [sessionData, setSessionData] = useState(null);
  const [resultsData, setResultsData] = useState(null);
  const [userAnswers, setUserAnswers] = useState([]);

  const [attempt, setAttempt] = useState(0); // Try again loads once more

  useEffect(() => {
    async function load() {
      if (location.state?.resultsData) {
        let sess = null;
        try {
          sess = await fetchApi(`/sessions/${sessionId}`); // the questions' text
        } catch (e) {
          console.error(e);
        }
        setSessionData(sess);
        setResultsData(location.state.resultsData);
        if (location.state.userAnswers) setUserAnswers(location.state.userAnswers);
        setLoading(false);
        return;
      }
      // After a refresh: rebuild from the stored test results.
      try {
        const sess = await fetchApi(`/sessions/${sessionId}`);
        setSessionData(sess);
        if (!sess.test_results) {
          setProblem('not-graded');
          setLoading(false);
          return;
        }
        const results = sess.test_results;
        const reconstructed = {
          total_score: results.total_score,
          max_score: results.max_score,
          percentage: results.max_score ? (results.total_score / results.max_score) * 100 : 0,
          per_question: results.answers,
        };
        setUserAnswers(results.answers.map((a) => a.user_answer || ''));
        const book = await fetchApi(`/books/${sess.book_id}`);
        if (book.reading_progress?.pace_recommendation) reconstructed.pace_recommendation = book.reading_progress.pace_recommendation;
        setResultsData(reconstructed);
      } catch (e) {
        console.error(e);
        setProblem('failed');
      }
      setLoading(false);
    }
    load();
  }, [sessionId, location.state, attempt]);

  const retry = () => {
    setProblem(null);
    setLoading(true);
    setAttempt((n) => n + 1);
  };

  if (loading) return <ResultsSkeleton />;

  if (problem) {
    return (
      <div className="rf-results rf-results--message">
        <section className="rf-results__card" role={problem === 'failed' ? 'alert' : undefined}>
          <h1 className="rf-results__title">{problem === 'failed' ? 'Your results didn’t load.' : 'This test hasn’t been graded yet.'}</h1>
          <p>{problem === 'failed' ? 'Nothing is lost; the grades are saved. Try again in a moment.' : 'Finish the test first, then your results appear here.'}</p>
          <div className="rf-results__actions">
            {problem === 'failed' && <Button onClick={retry}>Try again</Button>}
            <Link to="/" className="rf-btn rf-btn--ghost">Back to library</Link>
          </div>
        </section>
      </div>
    );
  }

  const grades = resultsData.per_question ?? [];
  const pct = Math.round(resultsData.percentage ?? 0);
  const chips = conceptChips(grades);
  const unsure = grades.filter((g) => outcome(g) === 'unsure').length;
  const next = resultsData.next_session;
  const pace = resultsData.pace_recommendation;
  const minutes = next?.focus_duration_minutes || pace?.focus_duration_minutes;
  const bookId = sessionData?.book_id;

  return (
    <div className="rf-results">
      <div className="rf-results__main">
        <h1 className="eyebrow rf-results__eyebrow">Session results</h1>
        <div className="rf-results__headline">
          <p className="rf-results__score" aria-label={`Score: ${pct}%`}>
            <span className="rf-results__figure">{pct}</span><span className="rf-results__pct">%</span>
          </p>
          <div className="rf-results__verdict">
            {grades.length > 0 && <p className="rf-results__summary">{summary(grades)}</p>}
            <p className="rf-results__line">{verdict(pct)}</p>
            <p className="rf-results__points">{resultsData.total_score} of {resultsData.max_score} points</p>
          </div>
        </div>
        {unsure > 0 && (
          <p className="rf-results__unsure">
            We couldn’t judge {unsure === 1 ? 'one answer' : `${unsure} answers`} confidently, so {unsure === 1 ? 'it counts' : 'they count'} for less in your plan.
          </p>
        )}

        <h2 className="rf-results__section">Question by question</h2>
        {grades.length === 0 ? (
          <p className="rf-results__empty">No questions were graded in this session.</p>
        ) : (
          <ol className="rf-results__list">
            {grades.map((g, i) => {
              const kind = outcome(g);
              const Icon = ICONS[kind];
              const question = promptOf(g.question) || promptOf(sessionData?.test_questions?.[i]) || `Question ${i + 1}`;
              const answer = shownAnswer(userAnswers[i] || g.user_answer);
              const { text, quote } = splitFeedback(g.feedback);
              return (
                <li key={i} className="rf-results__item" data-outcome={kind}>
                  <span className="rf-results__icon" aria-hidden="true"><Icon size={16} strokeWidth={1.75} /></span>
                  <div className="rf-results__body">
                    <p className="rf-results__outcome">{OUTCOME_LABEL[kind]}</p>
                    <h3 className="rf-results__question">{question}</h3>
                    <p className="rf-results__answer">{answer ? <>You answered <span>{answer}</span></> : 'No answer given'}</p>
                    {text && <p className="rf-results__feedback">{text}</p>}
                    {quote && <blockquote className="rf-results__quote">“{quote}”</blockquote>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <aside className="rf-results__side">
        {(chips.strengthened.length > 0 || chips.revisit.length > 0) && (
          <section className="rf-results__card" aria-labelledby="rf-concepts">
            <h2 id="rf-concepts" className="eyebrow">Concepts from this session</h2>
            {chips.strengthened.length > 0 && (
              <>
                <h3 className="rf-results__chips-title">Strengthened</h3>
                <ConceptChipGroup label="Strengthened concepts">
                  {chips.strengthened.map((c) => <ConceptChip key={c} kind="strengthened" quiet>{c}</ConceptChip>)}
                </ConceptChipGroup>
              </>
            )}
            {chips.revisit.length > 0 && (
              <>
                <h3 className="rf-results__chips-title">To revisit</h3>
                <ConceptChipGroup label="Concepts to revisit">
                  {chips.revisit.map((c) => <ConceptChip key={c} kind="revisit" quiet>{c}</ConceptChip>)}
                </ConceptChipGroup>
              </>
            )}
          </section>
        )}

        <section className="rf-results__card rf-results__next" aria-labelledby="rf-next">
          <OpenBook size={72} />
          <h2 id="rf-next" className="eyebrow">Next session</h2>
          <p className="rf-results__next-title">
            {next ? NEXT_TITLE[next.mode] ?? NEXT_TITLE.new : pace?.re_read_mode ? NEXT_TITLE.re_read : NEXT_TITLE.new}
          </p>
          <p className="rf-results__next-line">
            {minutes ? `About ${minutes} minutes.` : ''}
            {next?.reason ? ` ${next.reason}` : pace?.re_read_mode ? ' Revisiting difficult material is how mastery is built.' : ''}
          </p>
          <div className="rf-results__actions">
            {bookId && (!next || next.mode !== 'finished') && (
              <Button onClick={() => navigate(`/read/${bookId}`)}>Start next session</Button>
            )}
            <Link to="/dashboard" className="rf-btn rf-btn--ghost">See your dashboard</Link>
          </div>
        </section>
        <Link to="/" className="rf-results__back">Back to library</Link>
      </aside>
    </div>
  );
}
