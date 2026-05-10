import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './Layout.css';

export function Layout({ children }) {
  const { user, signOut } = useAuth();

  return (
    <div className="rf-layout-root">
      <nav className="rf-global-nav">
        <div className="rf-nav-container">
          <Link to="/" className="rf-wordmark">
            ReadFocus
          </Link>
          
          <div className="rf-nav-right">
            <div className="rf-nav-links">
              <NavLink 
                to="/" 
                end
                className={({ isActive }) => isActive ? "rf-nav-link active" : "rf-nav-link"}
              >
                Library
              </NavLink>
              <NavLink 
                to="/dashboard" 
                className={({ isActive }) => isActive ? "rf-nav-link active" : "rf-nav-link"}
              >
                Dashboard
              </NavLink>
            </div>
            
            {user && (
              <>
                <div className="rf-nav-divider"></div>
                <div className="rf-user-info">
                  <span className="rf-display-name">{user.email}</span>
                  <button onClick={signOut} className="rf-signout-btn">
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </nav>

      <main className="rf-main-content">
        {children}
      </main>
    </div>
  );
}
