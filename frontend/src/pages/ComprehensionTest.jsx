import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { TextArea } from '../components/ui/TextArea';
import { useToast } from '../components/ui/toastContext';
import { OptionCards, LETTERS } from '../components/test/OptionCards';
import { TimerPill } from '../components/test/TimerPill';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import './ComprehensionTest.css';

const TEST_SECONDS = 300;
const storageKey = (sessionId) => `rf-test-answers:${sessionId}`;

function readSaved(sessionId, count) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey(sessionId)) ?? 'null');
    return Array.isArray(saved) && saved.length === count && saved.every((a) => typeof a === 'string') ? saved : null;
  } catch {
    return null;
  }
}

function writeSaved(sessionId, answers) {
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(answers));
  } catch {
    // Not kept; the answers still live in the page.
  }
}

function clearSaved(sessionId) {
  try {
    window.localStorage.removeItem(storageKey(sessionId));
  } catch {
    // Nothing to clear.
  }
}

/** The prompt alone: for multiple choice the stored question also lists the options on its second line. */
const promptOf = (question) => (question.options?.length ? question.question.split('\n')[0] : question.question);
/** An option answer is sent as "(b) <option>", which the grader reads by its words, then its letter. */
const asAnswer = (options, option) => `(${LETTERS[options.indexOf(option)].toLowerCase()}) ${option}`;
const chosen = (options, answer) => options.find((o) => asAnswer(options, o) === answer) ?? null;

/**
 * The comprehension test (handoff screen 07): one question per screen,
 * multiple choice as option cards and the rest as a written answer, a
 * calm timer that warns only in the last 30 s, progress dots, keys 1-4
 * and Enter, and answers kept in this browser until they are submitted.
 * The calls are the same as before: the session's questions, a quiet
 * evaluate-single when leaving a changed answer, and submit-answers by
 * hand or when the five minutes run out.
 */
export function ComprehensionTest() {
  useDocumentTitle('Test');
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [evaluated, setEvaluated] = useState([]);
  const [timeLeft, setTimeLeft] = useState(TEST_SECONDS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const promptRef = useRef(null);
  const moved = useRef(false);
  // The latest answers and time for the automatic submit at zero (docs/DEBUG_LOG.md, C13.5).
  const latest = useRef({ answers, timeLeft });
  useEffect(() => { latest.current = { answers, timeLeft }; });

  useEffect(() => {
    async function fetchSession() {
      try {
        const data = await fetchApi(`/sessions/${sessionId}`);
        const list = data.test_questions ?? [];
        if (!list.length) {
          toast({ kind: 'warning', message: 'This session has no test yet. Finish today’s reading first.' });
          navigate('/');
          return;
        }
        const restored = readSaved(sessionId, list.length);
        setQuestions(list);
        setAnswers(restored ?? new Array(list.length).fill(''));
        setEvaluated(new Array(list.length).fill(''));
        setLoading(false);
      } catch (err) {
        toast({ kind: 'warning', message: `The test couldn’t be opened: ${err.message}` });
        navigate('/');
      }
    }
    fetchSession();
  }, [sessionId, navigate, toast]);

  useEffect(() => {
    if (!loading) writeSaved(sessionId, answers);
  }, [answers, loading, sessionId]);

  const submit = useCallback(async (auto = false) => {
    setIsSubmitting(true);
    const { answers: current, timeLeft: left } = latest.current;
    try {
      const data = await fetchApi(`/sessions/${sessionId}/submit-answers`, {
        method: 'POST',
        body: JSON.stringify({ answers: current, time_taken_seconds: TEST_SECONDS - (auto ? 0 : left) }),
      });
      clearSaved(sessionId);
      navigate(`/results/${sessionId}`, { state: { resultsData: data, userAnswers: current } });
    } catch (err) {
      toast({ kind: 'warning', message: `Your answers couldn’t be graded just now: ${err.message}. They are kept; try Submit again.` });
      setIsSubmitting(false);
    }
  }, [sessionId, navigate, toast]);

  // One tick a second; at zero the test submits itself with the answers as they are.
  useEffect(() => {
    if (loading || isSubmitting || timeUp) return undefined;
    const interval = setInterval(() => {
      const left = latest.current.timeLeft - 1;
      setTimeLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(interval);
        setTimeUp(true);
        submit(true);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [loading, isSubmitting, timeUp, submit]);

  const setAnswer = (value) => setAnswers((list) => list.map((a, i) => (i === index ? value : a)));

  const go = (next) => {
    if (next === index || next < 0 || next >= questions.length || isSubmitting) return;
    const answer = answers[index];
    if (answer.trim() !== evaluated[index].trim() && answer.trim() !== '') {
      fetchApi(`/sessions/${sessionId}/evaluate-single`, {
        method: 'POST',
        body: JSON.stringify({ index, answer }),
      }).catch(console.error);
      setEvaluated((list) => list.map((a, i) => (i === index ? answer : a)));
    }
    moved.current = true;
    setIndex(next);
  };

  // After moving between questions, focus the new question so it is read out and the keys apply to it.
  useEffect(() => {
    if (moved.current) promptRef.current?.focus();
  }, [index]);

  // 1-4 choose an option and Enter moves on, except while typing, in a dialog, or on a control of its own.
  const question = questions[index];
  const options = useMemo(() => question?.options ?? [], [question]);
  const last = index === questions.length - 1;
  useEffect(() => {
    if (loading) return undefined;
    const onKey = (e) => {
      if (leaving || isSubmitting || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('textarea, input:not([type=radio]), [role=dialog], button, a')) return;
      const n = Number(e.key);
      if (options.length && n >= 1 && n <= options.length) {
        e.preventDefault();
        setAnswers((list) => list.map((a, i) => (i === index ? asAnswer(options, options[n - 1]) : a)));
      } else if (e.key === 'Enter' && !last) {
        e.preventDefault();
        document.querySelector('[data-test-next]')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, leaving, isSubmitting, options, index, last]);

  if (loading) {
    return (
      <div className="rf-test rf-test--loading" role="status">
        <p>Opening your test…</p>
      </div>
    );
  }

  const mcq = options.length > 0;
  const answered = (i) => answers[i].trim().length > 0;

  return (
    <div className="rf-test">
      <header className="rf-test__chrome">
        <button type="button" className="rf-test__leave" onClick={() => setLeaving(true)}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>Leave test</span>
        </button>
        <nav className="rf-test__where" aria-label="Questions">
          <p className="rf-test__label">Comprehension test</p>
          <ol className="rf-test__dots">
            {questions.map((_, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="rf-test__dot"
                  data-state={i === index ? 'current' : answered(i) ? 'answered' : 'open'}
                  aria-current={i === index ? 'step' : undefined}
                  aria-label={`Question ${i + 1}${answered(i) ? ', answered' : ''}`}
                  onClick={() => go(i)}
                />
              </li>
            ))}
          </ol>
        </nav>
        <TimerPill seconds={timeLeft} />
      </header>

      <main className="rf-test__main">
        <section className="rf-test__question" aria-labelledby="rf-test-prompt">
          <p className="eyebrow">Question {index + 1} of {questions.length} · {mcq ? 'Multiple choice' : 'Written answer'}</p>
          <h1 id="rf-test-prompt" className="rf-test__prompt" tabIndex={-1} ref={promptRef}>{promptOf(question)}</h1>
          {mcq ? (
            <>
              <OptionCards
                name={`rf-test-${index}`}
                labelledBy="rf-test-prompt"
                options={options}
                value={chosen(options, answers[index])}
                onChange={(option) => setAnswer(asAnswer(options, option))}
                disabled={isSubmitting}
              />
              <p className="rf-test__hint">Press 1 to {options.length} to choose, Enter to go on.</p>
            </>
          ) : (
            <TextArea
              label="Your answer"
              rows={5}
              placeholder="Two or three sentences in your own words…"
              value={answers[index]}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={isSubmitting}
            />
          )}
          <div className="rf-test__nav">
            <Button variant="ghost" onClick={() => go(index - 1)} disabled={index === 0 || isSubmitting}>
              <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />Back
            </Button>
            {last ? (
              <Button onClick={() => submit(false)} loading={isSubmitting} loadingLabel="Grading…">Submit answers</Button>
            ) : (
              <Button data-test-next onClick={() => go(index + 1)} disabled={isSubmitting}>
                Next<ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            )}
          </div>
        </section>
      </main>

      {isSubmitting && (
        <div className="rf-test__grading" role="status">
          <p>{timeUp ? 'Time’s up. Grading your answers…' : 'Grading your answers…'}</p>
        </div>
      )}

      <Modal isOpen={leaving} onClose={() => setLeaving(false)} title="Leave this test?">
        <p className="rf-test__leave-text">Your answers so far are kept in this browser. Open this test again to finish it.</p>
        <div className="rf-test__leave-actions">
          <Button variant="secondary" onClick={() => setLeaving(false)}>Keep going</Button>
          <Button onClick={() => navigate('/')}>Leave test</Button>
        </div>
      </Modal>
    </div>
  );
}
