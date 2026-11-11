
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { Library } from './pages/Library';
import { Dashboard } from './pages/Dashboard';
import { ReadingSession } from './pages/ReadingSession';
import { ComprehensionTest } from './pages/ComprehensionTest';
import { Results } from './pages/Results';
import { Login } from './pages/Login';
import { MotionRoot } from './motion/MotionRoot';
import { ToastProvider } from './components/ui/Toast';
import { ThemeProvider } from './theme/ThemeProvider';
import { routeFade, routeTransition } from './motion/presets';

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
              <AnimatedRoutes scope={screenOf}>
                <Route path="/login" element={<Login />} />
                <Route path="/read/:bookId" element={<AuthGuard><ReadingSession /></AuthGuard>} />
                <Route path="/test/:sessionId" element={<AuthGuard><ComprehensionTest /></AuthGuard>} />
                <Route path="/*" element={
                  <Layout>
                    <AnimatedRoutes scope={pageOf}>
                      <Route path="/" element={<AuthGuard><Library /></AuthGuard>} />
                      <Route path="dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
                      <Route path="results/:sessionId" element={<AuthGuard><Results /></AuthGuard>} />
                    </AnimatedRoutes>
                  </Layout>
                } />
              </AnimatedRoutes>
            </BrowserRouter>
          </ToastProvider>
        </MotionRoot>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
