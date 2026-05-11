
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { Library } from './pages/Library';
import { ReadingSession } from './pages/ReadingSession';
import { ComprehensionTest } from './pages/ComprehensionTest';
import { Results } from './pages/Results';
import { Login } from './pages/Login';

function AuthGuard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null; // Or a global loading state
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/read/:bookId" element={<AuthGuard><ReadingSession /></AuthGuard>} />
          <Route path="/test/:sessionId" element={<AuthGuard><ComprehensionTest /></AuthGuard>} />
          <Route path="/*" element={
            <Layout>
              <Routes>
                <Route path="/" element={<AuthGuard><Library /></AuthGuard>} />
                <Route path="dashboard" element={<AuthGuard><Library /></AuthGuard>} />
                <Route path="results/:sessionId" element={<AuthGuard><Results /></AuthGuard>} />
              </Routes>
            </Layout>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
