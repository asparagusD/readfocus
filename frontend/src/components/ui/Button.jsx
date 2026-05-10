
import './Button.css';

export function Button({ 
  children, 
  variant = 'primary', 
  className = '', 
  loading = false,
  disabled,
  ...props 
}) {
  return (
    <button 
      className={`rf-btn rf-btn-${variant} ${loading ? 'rf-btn-loading' : ''} ${className}`}
      disabled={loading || disabled}
      {...props}
    >
      <span className="rf-btn-content">{children}</span>
      {loading && <div className="rf-btn-loader" />}
    </button>
  );
}
