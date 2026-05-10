import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { usePageTransition } from '../hooks/usePageTransition';
import { Button } from '../components/ui/Button';
import './Login.css';

export function Login() {
  const { signIn, signUp } = useAuth();
  const navigateTo = usePageTransition();
  const [activeTab, setActiveTab] = useState('signin'); // 'signin' or 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    
    if (activeTab === 'signup') {
      const { error } = await signUp(email, password);
      setLoading(false);
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSignupSuccess(true);
      }
    } else {
      const { error } = await signIn(email, password);
      setLoading(false);
      if (error) {
        setErrorMsg(error.message);
      } else {
        navigateTo('/');
      }
    }
  };

  return (
    <div className="rf-login-page page">
      <div className="rf-login-left">
        <div className="rf-login-quote-container">
          <blockquote className="rf-login-quote">
            "The reading of all good books is like a conversation with the finest minds of past centuries."
          </blockquote>
          <p className="rf-login-quote-author">— Descartes</p>
          <div className="rf-login-tagline">
            ReadFocus — intelligent reading, deeply understood.
          </div>
        </div>
      </div>

      <div className="rf-login-right">
        <div className="rf-auth-container">
          <div className="rf-auth-wordmark">ReadFocus</div>
          
          {signupSuccess ? (
            <div className="rf-auth-success">
              <p className="rf-success-message">Check your inbox — we sent you a confirmation link.</p>
              <button 
                className="rf-back-btn" 
                onClick={() => {
                  setSignupSuccess(false);
                  setActiveTab('signin');
                }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <div className="rf-auth-tabs">
                <button 
                  className={`rf-tab-pill ${activeTab === 'signin' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('signin'); setErrorMsg(''); }}
                  type="button"
                >
                  Sign in
                </button>
                <button 
                  className={`rf-tab-pill ${activeTab === 'signup' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('signup'); setErrorMsg(''); }}
                  type="button"
                >
                  Sign up
                </button>
              </div>

              <form className="rf-auth-form" onSubmit={handleSubmit}>
                {activeTab === 'signup' && (
                  <div className="rf-form-group">
                    <label className="rf-label">Display Name</label>
                    <input 
                      type="text" 
                      className="rf-input"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                    />
                  </div>
                )}

                <div className="rf-form-group">
                  <label className="rf-label">Email</label>
                  <input 
                    type="email" 
                    className="rf-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="rf-form-group">
                  <label className="rf-label">Password</label>
                  <input 
                    type="password" 
                    className="rf-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                {errorMsg && <div className="rf-auth-error">{errorMsg}</div>}

                <Button 
                  type="submit" 
                  variant="primary" 
                  loading={loading}
                  style={{ width: '100%', marginTop: '8px' }}
                >
                  {activeTab === 'signin' ? 'Sign In' : 'Sign Up'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
