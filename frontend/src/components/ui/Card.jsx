
import './Card.css';

export function Card({ 
  children, 
  className = '', 
  hoverable = false,
  ...props 
}) {
  return (
    <div 
      className={`rf-card ${hoverable ? 'rf-card-hoverable' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
