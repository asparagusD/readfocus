import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Maximize, Minimize } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { usePageTransition } from '../hooks/usePageTransition';
import './ReadingSession.css';

export function ReadingSession() {
  const { bookId } = useParams();
  const navigateTo = usePageTransition();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState(null);
  
  // Timer state
  const [timeLeft, setTimeLeft] = useState(0); // in seconds
  const [timerStatus, setTimerStatus] = useState('idle'); // 'idle' | 'running' | 'paused'
  
  // UI state
  const [isDistractionFree, setIsDistractionFree] = useState(false);
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Initialize session
  useEffect(() => {
    async function startSession() {
      try {
        const data = await fetchApi('/sessions/start', {
          method: 'POST',
          body: JSON.stringify({ book_id: bookId })
        });
        setSessionData(data);
        setTimeLeft(data.focus_duration_minutes * 60);
        setLoading(false);
      } catch (err) {
        alert('Failed to start session: ' + err.message);
        navigate('/');
      }
    }
    startSession();
  }, [bookId, navigate]);

  // Handle visibility transition after loading completes
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => setIsVisible(true), 16);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // Timer loop
  useEffect(() => {
    let interval = null;
    if (timerStatus === 'running' && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && timerStatus === 'running') {
      setTimerStatus('paused'); // Auto-pause at 0
    }
    return () => clearInterval(interval);
  }, [timerStatus, timeLeft]);

  // Format MM:SS
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Progress arc calculation
  const totalSeconds = sessionData?.focus_duration_minutes * 60 || 1;
  const progressPct = timeLeft / totalSeconds;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPct * circumference);

  const handleFinishReading = async () => {
    if (!sessionData) return;
    setIsFinishing(true);
    
    const actualMinutes = Math.round((totalSeconds - timeLeft) / 60) || 1;
    
    try {
      await fetchApi(`/sessions/${sessionData.session_id}/finish-reading`, {
        method: 'POST',
        body: JSON.stringify({ actual_duration_minutes: actualMinutes })
      });
      navigateTo(`/test/${sessionData.session_id}`);
    } catch (err) {
      alert('Failed to finish reading: ' + err.message);
      setIsFinishing(false);
    }
  };

  const handleAbandon = () => {
    navigateTo('/');
  };

  if (loading) {
    return (
      <div className="rf-reading-loading page">
        <span className="rf-reading-loading-text">Preparing your session…</span>
      </div>
    );
  }

  // Split text into paragraphs for rendering
  // PDF extraction often puts single newlines for line wraps, and double newlines for paragraphs.
  const paragraphs = sessionData.chunks
    .map(c => c.content)
    .join('\n\n')
    .split(/\n\s*\n/)
    .map(p => p.replace(/\n/g, ' ').trim())
    .filter(p => p.length > 0);

  return (
    <div className={`rf-reading-page page ${isVisible ? 'visible' : ''} ${isDistractionFree ? 'rf-distraction-free' : ''}`}>
      
      {/* Floating timer pill (only visible in distraction-free mode) */}
      <div className="rf-floating-timer">
        {formatTime(timeLeft)}
      </div>

      {/* Top Chrome Bar */}
      <header className="rf-chrome-bar">
        <div className="rf-chrome-left">
          <button className="rf-back-btn" onClick={() => navigateTo('/')}><ArrowLeft size={16} /></button>
          <span className="rf-chrome-title">Reading Session</span>
        </div>
        <div className="rf-chrome-right">
          Session {sessionData.session_id.substring(0,6)} · {sessionData.assigned_words || '?'} words
        </div>
      </header>

      {/* Sticky Timer Strip */}
      <div className="rf-timer-strip">
        <div className="rf-timer-content">
          <div className="rf-timer-display">
            <svg className="rf-timer-arc" width="36" height="36" viewBox="0 0 36 36">
              <circle className="rf-arc-bg" cx="18" cy="18" r={radius} fill="none" strokeWidth="2" />
              <circle 
                className="rf-arc-fg" 
                cx="18" cy="18" r={radius} 
                fill="none" 
                strokeWidth="2" 
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                transform="rotate(-90 18 18)"
              />
            </svg>
            <span className="rf-timer-digits">{formatTime(timeLeft)}</span>
          </div>

          <div className="rf-timer-controls">
            {timerStatus === 'idle' && (
              <button className="rf-ctrl-primary" onClick={() => setTimerStatus('running')}>Start</button>
            )}
            {timerStatus === 'running' && (
              <button className="rf-ctrl-secondary" onClick={() => setTimerStatus('paused')}>Pause</button>
            )}
            {timerStatus === 'paused' && (
              <button className="rf-ctrl-secondary" onClick={() => setTimerStatus('running')}>Resume</button>
            )}
            
            <span className="rf-ctrl-sep">·</span>
            
            <button className="rf-ctrl-secondary" onClick={handleFinishReading} disabled={isFinishing}>
              {isFinishing ? 'Saving…' : 'Done reading'}
            </button>
          </div>
        </div>
      </div>

      {/* AI Reason Strip */}
      <div className={`rf-reason-strip ${timerStatus !== 'idle' ? 'hidden' : ''}`}>
        Based on your previous performance, {sessionData.reason || "I've tailored this session for your optimal focus."}
      </div>

      {/* Reading Text Area */}
      <main className="rf-reading-area">
        <div className="rf-reading-text">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <div className="rf-abandon-container">
          <button className="rf-abandon-link" onClick={() => setShowAbandonModal(true)}>
            Abandon session
          </button>
        </div>
      </main>

      {/* Distraction Free Toggle */}
      <button 
        className="rf-df-toggle" 
        onClick={() => setIsDistractionFree(!isDistractionFree)}
        title="Distraction-free mode"
      >
        {isDistractionFree ? <Minimize size={18} color="var(--ink)" /> : <Maximize size={18} color="var(--ink)" />}
      </button>

      {/* Abandon Modal */}
      <Modal isOpen={showAbandonModal} onClose={() => setShowAbandonModal(false)}>
        <div style={{ padding: '24px', width: '400px', boxSizing: 'border-box' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '18px', color: 'var(--ink)', lineHeight: '1.4', marginBottom: '32px' }}>
            If you abandon this session, no progress will be saved and the time you spent reading will not count.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <Button variant="danger" onClick={handleAbandon}>Abandon</Button>
            <Button variant="primary" onClick={() => setShowAbandonModal(false)}>Keep reading</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
