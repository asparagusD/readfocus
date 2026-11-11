import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { Button } from './ui/Button';
import { ErrorScreen } from './ErrorScreen';

/** Catches a page that fails to render and shows the error screen instead of a blank window. */
class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  // A new address clears the error. Not a `key`: remounting the routes on
  // every navigation would cut their fade-and-rise transition.
  componentDidUpdate(previous) {
    if (this.state.error && previous.pathname !== this.props.pathname) this.setState({ error: null });
  }

  componentDidCatch(error, info) {
    console.error('A page failed to render', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorScreen
        standalone
        title="This page didn’t open properly."
        body="Something went wrong while showing it. Nothing is lost: your books, your place and your tests are saved."
        code={error.name || 'Error'}
      >
        <Button onClick={() => window.location.reload()}>
          <RotateCcw size={18} strokeWidth={1.75} aria-hidden="true" />
          Reload the page
        </Button>
        <a href="/" className="rf-btn rf-btn--ghost">Back to your shelf</a>
      </ErrorScreen>
    );
  }
}

/** The boundary around the routes (C13.8a); moving to another address clears its error. */
export function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <Boundary pathname={pathname}>{children}</Boundary>;
}
