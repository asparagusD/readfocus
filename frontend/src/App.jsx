import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Reader } from './pages/Reader';
import { Tester } from './pages/Tester';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/read/:sessionId" element={<Reader />} />
          <Route path="/test/:sessionId" element={<Tester />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
