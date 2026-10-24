import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Purge any stale custom_session from obsolete runs
try {
  const session = localStorage.getItem('custom_session');
  if (session) {
    const parsed = JSON.parse(session);
    if (parsed?.uid === 'phoneclinic_admin' || !parsed?.uid) {
      localStorage.removeItem('custom_session');
    }
  }
} catch {
  localStorage.removeItem('custom_session');
}

// Unregister obsolete service workers to prevent cached chunk conflicts
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const r of registrations) {
      r.unregister();
    }
  });
}
if ('caches' in window) {
  caches.keys().then((keys) => {
    for (const k of keys) {
      caches.delete(k);
    }
  });
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
