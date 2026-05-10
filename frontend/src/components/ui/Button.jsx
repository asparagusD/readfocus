import React from 'react';
import './Button.css';

export function Button({ 
  children, 
  variant = 'primary', 
  className = '', 
  ...props 
}) {
  return (
    <button 
      className={`rf-btn rf-btn-${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
