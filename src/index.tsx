import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';

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

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const buildId = document.querySelector<HTMLMetaElement>('meta[name="app-build-id"]')?.content;
    const workerUrl = new URL('/sw.js', window.location.origin);
    if (buildId) workerUrl.searchParams.set('v', buildId);
    void navigator.serviceWorker.register(workerUrl.toString(), { updateViaCache: 'none' }).catch(() => {
      console.error('Unable to register the application service worker.');
    });
  });
}
