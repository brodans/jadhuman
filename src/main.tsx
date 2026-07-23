import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Silently swallow benign HMR and WebSocket errors to keep the UX clean
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || String(event.reason || '');
    if (
      reason.includes('WebSocket') || 
      reason.includes('websocket') || 
      reason.includes('vite') ||
      reason.includes('HMR')
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  window.addEventListener('error', (event) => {
    const msg = event.message || '';
    if (
      msg.includes('WebSocket') || 
      msg.includes('websocket') || 
      msg.includes('vite') ||
      msg.includes('HMR')
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
