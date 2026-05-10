
import './ScoreBadge.css';

export function ScoreBadge({ percentage, className = '' }) {
  let colorVar = '--red-soft';
  if (percentage >= 75) {
    colorVar = '--green-soft';
  } else if (percentage >= 50) {
    colorVar = '--amber';
  }

  return (
    <div className={`rf-score-badge ${className}`}>
      <span 
        className="rf-score-dot" 
        style={{ backgroundColor: `var(${colorVar})` }} 
      />
      <span 
        className="rf-score-text"
        style={{ color: `var(${colorVar})` }}
      >
        {percentage}%
      </span>
    </div>
  );
}
