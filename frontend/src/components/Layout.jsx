import { NavLink, Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ThemeToggle } from './ThemeToggle';
import { AccountMenu } from './AccountMenu';
import './Layout.css';

const navClass = ({ isActive }) => (isActive ? 'rf-topbar__link is-active' : 'rf-topbar__link');

/**
 * The quiet top bar (handoff screens 03 and 09): the mark, Library and
 * Dashboard (the current one underlined in the accent, aria-current from
 * NavLink), the theme toggle from 640 px up, and the account button. A
 * skip link leads past it to the page.
 */
export function Layout({ children }) {
  const { user } = useAuth();

  return (
    <div className="rf-layout-root">
      <a className="rf-skip" href="#main">Skip to content</a>
      <header className="rf-topbar">
        <div className="rf-topbar__inner">
          <Link to="/" className="rf-topbar__mark" aria-label="ReadFocus, your shelf">
            <BookOpen size={24} strokeWidth={1.75} aria-hidden="true" />
            <span aria-hidden="true">ReadFocus</span>
          </Link>
          <nav aria-label="Main" className="rf-topbar__nav">
            <NavLink to="/" end className={navClass}>Library</NavLink>
            <NavLink to="/dashboard" className={navClass}>Dashboard</NavLink>
          </nav>
          <div className="rf-topbar__end">
            <div className="rf-topbar__theme"><ThemeToggle /></div>
            {user && <AccountMenu />}
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="rf-main-content">
        {children}
      </main>
    </div>
  );
}
