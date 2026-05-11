import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { fetchApi } from '../lib/api';
import { usePageTransition } from '../hooks/usePageTransition';
import './Results.css';

export function Results() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  usePageTransition();

  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState(null);
  const [resultsData, setResultsData] = useState(null);
  const [userAnswers, setUserAnswers] = useState([]);
  
  // Animation state
  const [animatedScore, setAnimatedScore] = useState(0);
  const scoreAnimationRef = useRef(null);

  useEffect(() => {
    async function loadData() {
      // If we came directly from the test page, we have everything in state
      if (location.state?.resultsData) {
        setResultsData(location.state.resultsData);
        if (location.state.userAnswers) setUserAnswers(location.state.userAnswers);
        
        // Fetch session strictly to get the questions text
        try {
          const sess = await fetchApi(`/sessions/${sessionId}`);
          setSessionData(sess);
        } catch (e) {
          console.error(e);
        }
        setLoading(false);
      } else {
        // Fallback: user refreshed the page, fetch from backend DB
        try {
          const sess = await fetchApi(`/sessions/${sessionId}`);
          setSessionData(sess);
          if (sess.test_results) {
            // Reconstruct resultsData from DB test_results
            const reconstructed = {
              total_score: sess.test_results.total_score,
              max_score: sess.test_results.max_score,
              percentage: (sess.test_results.total_score / sess.test_results.max_score) * 100,
              per_question: sess.test_results.answers, // Array of { question, user_answer, score, feedback }
            };
            
            // Map the user answers from the DB
            const dbAnswers = sess.test_results.answers.map(a => a.user_answer || '');
            setUserAnswers(dbAnswers);
            
            // Need to fetch pace_recommendation from the book's reading_progress
            const bookId = sess.book_id;
            const book = await fetchApi(`/books/${bookId}`);
            if (book.reading_progress?.pace_recommendation) {
                reconstructed.pace_recommendation = book.reading_progress.pace_recommendation;
            }
            
            setResultsData(reconstructed);
          } else {
            // Test not taken or not finished
            navigate('/');
          }
        } catch (e) {
            console.error(e);
            navigate('/');
        }
        setLoading(false);
      }
    }
    loadData();
  }, [sessionId, location.state, navigate]);

  useEffect(() => {
    if (!loading && resultsData) {
      // Animate score from 0 to total_score over 800ms
      const targetScore = resultsData.total_score;
      const duration = 800;
      const startTime = performance.now();
      
      const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // ease-out cubic
        const easeOut = 1 - Math.pow(1 - progress, 3);
        
        setAnimatedScore(Math.round(targetScore * easeOut));
        
        if (progress < 1) {
          scoreAnimationRef.current = requestAnimationFrame(animate);
        } else {
          setAnimatedScore(targetScore);
        }
      };
      
      scoreAnimationRef.current = requestAnimationFrame(animate);
      
      return () => {
        if (scoreAnimationRef.current) cancelAnimationFrame(scoreAnimationRef.current);
      };
    }
  }, [loading, resultsData]);

  if (loading) {
    return <div className="rf-results-loading">Loading results...</div>;
  }

  // Calculate verdict
  const pct = resultsData.percentage;
  let verdictText = "Needs review";
  let verdictClass = "rf-verdict-needs-review";
  
  if (pct >= 80) {
    verdictText = "Excellent";
    verdictClass = "rf-verdict-excellent";
  } else if (pct >= 60) {
    verdictText = "Good";
    verdictClass = "rf-verdict-good";
  } else if (pct < 50) { 
    verdictText = "Re-read required";
    verdictClass = "rf-verdict-re-read";
  }

  const paceRec = resultsData.pace_recommendation;
  const isReRead = paceRec?.re_read_mode === true;
  
  return (
    <div className="rf-results-page">
      <div className="rf-results-score-section">
        <div className="rf-results-score-label">Comprehension score</div>
        <div className="rf-results-score-number-wrapper">
          <span className="rf-results-score-number">{animatedScore}</span>
          <span className="rf-results-score-max">/ {resultsData.max_score}</span>
        </div>
        <div className="rf-results-percentage">{Math.round(pct)}% correct</div>
        <div className={`rf-results-verdict ${verdictClass}`}>{verdictText}</div>
      </div>
      
      <div className="rf-results-breakdown-heading">Answer Breakdown</div>
      <div className="rf-results-breakdown-list">
        {resultsData.per_question.map((q, i) => {
          // Determine question text based on where data came from
          const qText = q.question?.question || sessionData?.test_questions?.[i]?.question || `Question ${i + 1}`;
          const uAns = userAnswers[i] || q.user_answer;
          
          let scoreClass = "rf-score-mid";
          if (q.score >= 8) scoreClass = "rf-score-high";
          else if (q.score < 5) scoreClass = "rf-score-low";
          
          return (
            <div key={i} className="rf-results-q-row">
              <div className="rf-results-q-top">
                <div className="rf-results-q-text">{qText}</div>
                <div className={`rf-results-q-score ${scoreClass}`}>{q.score} / 10</div>
              </div>
              {uAns && <div className="rf-results-q-answer">— '{uAns}'</div>}
              <div className="rf-results-q-feedback">{q.feedback}</div>
            </div>
          );
        })}
      </div>
      
      {paceRec && (
        isReRead ? (
          <div className="rf-results-reread-panel">
            <div className="rf-results-reread-title">You'll revisit this section next session.</div>
            <div className="rf-results-reread-desc">Revisiting difficult material is how mastery is built.</div>
          </div>
        ) : (
          <div className="rf-results-next-panel">
            <div className="rf-results-next-info">Next session — {paceRec.focus_duration_minutes} min</div>
            <button className="rf-results-next-btn" onClick={() => navigate(`/read/${sessionData?.book_id}`)}>Start next session &rarr;</button>
          </div>
        )
      )}
      
      <div className="rf-results-bottom">
        <Link to="/" className="rf-results-library-link">Back to library</Link>
      </div>
    </div>
  );
}
