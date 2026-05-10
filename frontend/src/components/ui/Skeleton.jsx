
import './Skeleton.css';

export function Skeleton({ width = '100%', height = '20px', className = '', ...props }) {
  return (
    <div 
      className={`rf-skeleton ${className}`} 
      style={{ width, height }}
      {...props}
    />
  );
}
