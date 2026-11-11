
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { BackendGate } from './components/BackendGate';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { Library } from './pages/Library';
import { Dashboard } from './pages/Dashboard';
import { ReadingSession } from './pages/ReadingSession';
import { ComprehensionTest } from './pages/ComprehensionTest';
import { Results } from './pages/Results';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import { NotFound } from './pages/NotFound';
import { MotionRoot } from './motion/MotionRoot';
import { ToastProvider } from './components/ui/Toast';
import { ThemeProvider } from './theme/ThemeProvider';
import { routeFade, routeTransition } from './motion/presets';

// Dev-only review page for the illustrations (C11.1). In a production
// build import.meta.env.DEV is false, so the import and the route are
// dropped and no chunk is emitted.
const IllustrationGallery = import.meta.env.DEV
  ? lazy(() => import('./gallery/IllustrationGallery.jsx'))
  : null;
// Dev-only review page for the paginated reader (C12.3), dropped the same way.
const ReaderGallery = import.meta.env.DEV ? lazy(() => import('./gallery/ReaderGallery.jsx')) : null;

/**
 * Signed-out visitors at "/" get the static landing page (C13.10a), outside
 * the backend gate so it never waits on a sleeping backend. Everyone else,
 * and every other route, goes through the gate exactly as before.
 */
function PublicHome({ children }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user && pathname === '/') return <Landing />;
  return <BackendGate>{children}</BackendGate>;
}

function AuthGuard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Routes that fade and rise in on navigation. `scope` maps a path to the
// key that decides when to animate, so the nav inside Layout stays put
// while its pages change. The leaving screen keeps its own location until
// it has faded out (AnimatePresence, mode "wait").
function AnimatedRoutes({ scope, children }) {
  const location = useLocation();
  const reduced = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div
        key={scope(location.pathname)}
        variants={reduced ? routeFade : routeTransition}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <Routes location={location}>{children}</Routes>
      </m.div>
    </AnimatePresence>
  );
}

const screenOf = (path) => (
  path === '/login' ? 'login'
    : path.startsWith('/read/') ? 'read'
      : path.startsWith('/test/') ? 'test'
        : 'app'
);
const pageOf = (path) => path;

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MotionRoot>
          <ToastProvider>
            <BrowserRouter>
              <PublicHome>
                <RouteErrorBoundary>
                  <AnimatedRoutes scope={screenOf}>
                    <Route path="/login" element={<Login />} />
                    {IllustrationGallery && (
                      <Route path="/__illustrations" element={<Suspense fallback={null}><IllustrationGallery /></Suspense>} />
                    )}
                    {ReaderGallery && (
                      <Route path="/__reader" element={<Suspense fallback={null}><ReaderGallery /></Suspense>} />
                    )}
                    <Route path="/read/:bookId" element={<AuthGuard><ReadingSession /></AuthGuard>} />
                    <Route path="/test/:sessionId" element={<AuthGuard><ComprehensionTest /></AuthGuard>} />
                    <Route path="/*" element={
                      <Layout>
                        <AnimatedRoutes scope={pageOf}>
                          <Route path="/" element={<AuthGuard><Library /></AuthGuard>} />
                          <Route path="dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
                          <Route path="results/:sessionId" element={<AuthGuard><Results /></AuthGuard>} />
                          <Route path="*" element={<NotFound />} />
                        </AnimatedRoutes>
                      </Layout>
                    } />
                  </AnimatedRoutes>
                </RouteErrorBoundary>
              </PublicHome>
            </BrowserRouter>
          </ToastProvider>
        </MotionRoot>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
