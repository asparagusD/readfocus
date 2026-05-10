import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import './Navbar.css';

export function Navbar() {
  return (
    <nav className="rf-navbar">
      <div className="rf-navbar-container">
        <Link to="/" className="rf-logo">
          ReadFocus
        </Link>
        <div className="rf-nav-links">
          <NavLink 
            to="/" 
            className={({ isActive }) => isActive ? "rf-nav-link active" : "rf-nav-link"}
            end
          >
            Library
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
