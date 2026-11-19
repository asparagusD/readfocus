import { useEffect } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ThemeToggle } from './ThemeToggle';
import { AccountMenu } from './AccountMenu';
import { HeaderProgress } from '../gamification/HeaderProgress';
import { useProgress } from '../gamification/useProgress';
import { prefetchCodeWhenIdle, prefetchProps } from '../lib/prefetchPage';
import './Layout.css';

const navClass = ({ isActive }) => (isActive ? 'rf-topbar__link is-active' : 'rf-topbar__link');

/**
 * The quiet top bar (handoff screens 03 and 09): the mark, Library and
 * Dashboard (the current one underlined in the accent, aria-current from
 * NavLink), the reader's progress (C24.6a), the theme toggle from 640 px
 * up, and the account button. A skip link leads past it to the page.
 */
export function Layout({ children }) {
  const { user } = useAuth();
  const progress = useProgress(Boolean(user), { adoptZone: true }); // C24.6a: null until it arrives (or if it fails): the header then shows nothing
  useEffect(() => { if (user) prefetchCodeWhenIdle(); }, [user]); // C35.5d: the tab pages' code, once idle

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
            <NavLink to="/" end className={navClass} {...prefetchProps('/')}>Library</NavLink>
            <NavLink to="/dashboard" className={navClass} {...prefetchProps('/dashboard')}>Dashboard</NavLink>
            <NavLink to="/league" className={navClass} {...prefetchProps('/league')}>League</NavLink>
          </nav>
          <div className="rf-topbar__end">
            {user && progress && <HeaderProgress progress={progress} />}
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
