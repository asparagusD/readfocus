import React from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Link } from 'react-router-dom';
import { BookPlus } from 'lucide-react';
import { usePageTransition } from '../hooks/usePageTransition';
import './Dashboard.css';

export function Dashboard() {
  usePageTransition();
  return (
    <div className="rf-dashboard page">
      <header className="rf-dashboard-header">
        <h1 className="rf-title">Your Library</h1>
        <Button variant="primary">
          <BookPlus size={16} />
          Upload Book
        </Button>
      </header>

      <div className="rf-book-list">
        <Card className="rf-book-card" hoverable>
          <div className="rf-book-meta">
            <h2 className="rf-book-title">Meditations</h2>
            <p className="rf-book-author">Marcus Aurelius</p>
          </div>
          <div className="rf-book-actions" style={{display: 'flex', gap: '8px'}}>
            <Link to="/read/mock-session">
              <Button variant="secondary">Resume Reading</Button>
            </Link>
            <Link to="/test/mock-session">
              <Button variant="primary">Take Test</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
