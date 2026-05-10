import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import './Layout.css';

export function Layout({ children }) {
  const location = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [transitionStage, setTransitionStage] = useState('fadeIn');

  useEffect(() => {
    if (location !== displayLocation) {
      setTransitionStage('fadeOut');
    }
  }, [location, displayLocation]);

  const onAnimationEnd = () => {
    if (transitionStage === 'fadeOut') {
      setTransitionStage('fadeIn');
      setDisplayLocation(location);
    }
  };

  return (
    <div className="rf-layout">
      <Navbar />
      <main className="rf-main-container">
        <div
          className={`${transitionStage === 'fadeIn' ? 'fade-in' : 'fade-out'}`}
          onAnimationEnd={onAnimationEnd}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
