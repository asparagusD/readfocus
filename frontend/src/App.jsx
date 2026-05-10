import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Reader } from './pages/Reader';
import { Tester } from './pages/Tester';
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
        <Layout>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            {/* Protected Routes */}
            <Route path="/" element={<AuthGuard><Dashboard /></AuthGuard>} />
            <Route path="/dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
            <Route path="/read/:bookId" element={<AuthGuard><Reader /></AuthGuard>} />
            <Route path="/test/:sessionId" element={<AuthGuard><Tester /></AuthGuard>} />
            <Route path="/results/:sessionId" element={<AuthGuard><div>Results (WIP)</div></AuthGuard>} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
