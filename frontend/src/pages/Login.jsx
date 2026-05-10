import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { usePageTransition } from '../hooks/usePageTransition';
import { Button } from '../components/ui/Button';

export function Login() {
  const { signIn, signUp } = useAuth();
  const navigateTo = usePageTransition();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    let error;
    if (isSignUp) {
      const res = await signUp(email, password);
      error = res.error;
    } else {
      const res = await signIn(email, password);
      error = res.error;
    }
    setLoading(false);
    
    if (!error) {
      if (isSignUp) {
        alert('Check your email for the confirmation link!');
      } else {
        navigateTo('/');
      }
    } else {
      alert(error.message);
    }
  };

  return (
    <div className="page" style={{ maxWidth: '400px', margin: '100px auto', padding: '24px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: '24px' }}>
        {isSignUp ? 'Create an Account' : 'Sign In'}
      </h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <input 
          type="email" 
          placeholder="Email" 
          value={email} 
          onChange={(e) => setEmail(e.target.value)} 
          required 
          style={{ padding: '12px', borderRadius: '4px', border: '1px solid var(--paper-mid)' }}
        />
        <input 
          type="password" 
          placeholder="Password" 
          value={password} 
          onChange={(e) => setPassword(e.target.value)} 
          required 
          style={{ padding: '12px', borderRadius: '4px', border: '1px solid var(--paper-mid)' }}
        />
        <Button type="submit" variant="primary" loading={loading}>
          {isSignUp ? 'Sign Up' : 'Sign In'}
        </Button>
      </form>
      <div style={{ marginTop: '16px', textAlign: 'center' }}>
        <button 
          onClick={() => setIsSignUp(!isSignUp)}
          style={{ background: 'none', border: 'none', color: 'var(--amber)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}
        >
          {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
        </button>
      </div>
    </div>
  );
}
