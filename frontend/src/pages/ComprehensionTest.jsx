import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Button } from '../components/ui/Button';
import { usePageTransition } from '../hooks/usePageTransition';
import './ComprehensionTest.css';

export function ComprehensionTest() {
  const { sessionId } = useParams();
  const navigateTo = usePageTransition();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState(null);
  const [questions, setQuestions] = useState([]);
  
  // Test State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState(['', '', '', '', '']);
  const [lastEvaluatedAnswers, setLastEvaluatedAnswers] = useState(['', '', '', '', '']);
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [slideDirection, setSlideDirection] = useState('in'); // 'in' or 'out'
  
  // Fetch session data and questions
  useEffect(() => {
    async function fetchSession() {
      try {
        const data = await fetchApi(`/sessions/${sessionId}`);
        setSessionData(data);
        if (data.test_questions && data.test_questions.length > 0) {
          setQuestions(data.test_questions);
          // Initialize answers array if it doesn't match questions length
          if (answers.length !== data.test_questions.length) {
            setAnswers(new Array(data.test_questions.length).fill(''));
          }
        } else {
          // No questions found, maybe they didn't finish reading yet
          alert('No test questions found for this session.');
          navigate('/');
        }
        setLoading(false);
      } catch (err) {
        alert('Failed to load test: ' + err.message);
        navigate('/');
      }
    }
    fetchSession();
  }, [sessionId, navigate]);

  // Handle visibility transition after loading completes
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => setIsVisible(true), 16);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // Timer loop
  useEffect(() => {
    if (loading || isSubmitting) return;
    
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          handleSubmitAnswers(true); // Auto-submit at zero
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [loading, isSubmitting]);

  const handleSubmitAnswers = async (autoSubmit = false) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    
    try {
      const data = await fetchApi(`/sessions/${sessionId}/submit-answers`, {
        method: 'POST',
        body: JSON.stringify({ 
          answers: answers,
          time_taken_seconds: 300 - timeLeft
        })
      });
      // Use standard navigate to pass state, bypassing transition delay if needed, 
      // or we can use transition but we don't have it setup to pass state easily.
      // Wait, let's just use standard navigate since we want to pass state.
      navigate(`/results/${sessionId}`, { state: { resultsData: data, userAnswers: answers } });
    } catch (err) {
      alert('Failed to submit answers: ' + err.message);
      setIsSubmitting(false);
    }
  };

  const navigateQuestion = (index) => {
    if (index === currentIndex || isSubmitting) return;
    
    // Trigger background evaluation if answer changed
    if (answers[currentIndex].trim() !== lastEvaluatedAnswers[currentIndex].trim() && answers[currentIndex].trim() !== '') {
      fetchApi(`/sessions/${sessionId}/evaluate-single`, {
        method: 'POST',
        body: JSON.stringify({ index: currentIndex, answer: answers[currentIndex] })
      }).catch(console.error);
      
      const newLastEval = [...lastEvaluatedAnswers];
      newLastEval[currentIndex] = answers[currentIndex];
      setLastEvaluatedAnswers(newLastEval);
    }
    
    setSlideDirection('out');
    setTimeout(() => {
      setCurrentIndex(index);
      setSlideDirection('in');
    }, 180);
  };

  const handleAnswerChange = (e) => {
    const newAnswers = [...answers];
    newAnswers[currentIndex] = e.target.value;
    setAnswers(newAnswers);
  };

  // Format MM:SS
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString();
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Progress arc calculation
  const totalSeconds = 300;
  const progressPct = timeLeft / totalSeconds;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPct * circumference);
  
  const isWarning = timeLeft <= 60;

  if (loading) {
    return (
      <div className="rf-test-loading page visible">
        <span className="rf-test-submitting-text">Loading test…</span>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];

  return (
    <div className={`rf-test-page page ${isVisible ? 'visible' : ''}`}>
      
      {/* Top Chrome Bar */}
      <header className="rf-test-chrome">
        <div className="rf-test-chrome-left">
          <button className="rf-test-back-btn" onClick={() => navigateTo('/')}><ArrowLeft size={16} /></button>
          <span className="rf-test-chrome-title">ReadFocus</span>
        </div>
      </header>

      {/* Timer Strip */}
      <div className={`rf-test-timer-strip ${isWarning ? 'rf-test-timer-warning' : ''}`}>
        <div className="rf-test-timer-strip-inner">
          <span className="rf-test-timer-label">Comprehension check</span>
          <div className="rf-test-timer-display">
            <svg className="rf-timer-arc" width="36" height="36" viewBox="0 0 36 36">
              <circle className="rf-test-arc-bg" cx="18" cy="18" r={radius} fill="none" strokeWidth="2" />
              <circle 
                className="rf-test-arc-fg" 
                cx="18" cy="18" r={radius} 
                fill="none" 
                strokeWidth="2" 
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                transform="rotate(-90 18 18)"
              />
            </svg>
            <span className="rf-test-timer-digits">{formatTime(timeLeft)}</span>
          </div>
        </div>
      </div>

      <div className={isSubmitting ? 'rf-test-content-faded' : ''} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Navigation Dots */}
        <div className="rf-test-dots">
          {questions.map((_, i) => {
            let dotClass = 'rf-test-dot';
            if (i === currentIndex) {
              dotClass += ' current';
            } else if (answers[i].trim().length > 0) {
              dotClass += ' answered';
            } else {
              dotClass += ' unanswered';
            }
            return (
              <button 
                key={i} 
                className={dotClass}
                onClick={() => navigateQuestion(i)}
                aria-label={`Go to question ${i + 1}`}
              />
            );
          })}
        </div>

        {/* Question Area */}
        <main className="rf-test-main">
          <div className={`rf-test-question-container ${slideDirection === 'out' ? 'sliding-out' : ''}`}>
            <div className="rf-test-q-header">
              <span className="rf-test-badge">{currentQuestion?.type || 'QUESTION'}</span>
              <span className="rf-test-counter">Question {currentIndex + 1} of {questions.length}</span>
            </div>
            
            <h2 className="rf-test-question-text">{currentQuestion?.question}</h2>
            
            <textarea
              className="rf-test-textarea"
              placeholder="Write your answer here…"
              value={answers[currentIndex]}
              onChange={handleAnswerChange}
              disabled={isSubmitting}
            />

            <div className="rf-test-nav-buttons">
              {currentIndex > 0 ? (
                <Button variant="secondary" onClick={() => navigateQuestion(currentIndex - 1)}>
                  Previous
                </Button>
              ) : (
                <div className="rf-test-btn-spacer"></div>
              )}
              
              <div className="rf-test-btn-spacer"></div>
              
              {currentIndex < questions.length - 1 ? (
                <Button variant="secondary" onClick={() => navigateQuestion(currentIndex + 1)}>
                  Next
                </Button>
              ) : (
                <Button variant="primary" onClick={() => handleSubmitAnswers(false)}>
                  Submit answers
                </Button>
              )}
            </div>
          </div>
        </main>
      </div>

      {isSubmitting && (
        <div className="rf-test-submitting-overlay">
          <span className="rf-test-submitting-text">Evaluating your answers…</span>
        </div>
      )}
    </div>
  );
}
