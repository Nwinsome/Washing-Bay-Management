import React from 'react';
import { createRoot } from 'react-dom/client';
import SetupPage from './pages/SetupPage';

function App() {
  return <SetupPage />;
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
