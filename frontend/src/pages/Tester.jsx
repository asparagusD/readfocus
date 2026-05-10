
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { usePageTransition } from '../hooks/usePageTransition';
import './Tester.css';

export function Tester() {
  usePageTransition();
  return (
    <div className="rf-tester page">
      <header className="rf-tester-header">
        <h1 className="rf-tester-title">Comprehension Check</h1>
        <p className="rf-tester-subtitle">Answer the following questions based on your reading.</p>
      </header>

      <div className="rf-questions-list">
        <Card className="rf-question-card">
          <p className="rf-question-text">1. What did the author learn from their grandfather?</p>
          <textarea 
            className="rf-question-input" 
            placeholder="Type your answer here..."
            rows={3}
          />
        </Card>
      </div>

      <footer className="rf-tester-footer">
        <Button variant="primary">Submit Answers</Button>
      </footer>
    </div>
  );
}
