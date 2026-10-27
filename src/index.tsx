import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import '@fontsource-variable/inter';
import { APP_BRAND_COLORS, APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from './config/brand';

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

document.documentElement.style.setProperty('--brand-primary', APP_BRAND_COLORS.primary);
document.title = APP_NAME;
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', APP_BRAND_COLORS.primary);
document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', APP_SHORT_NAME);
document.querySelector('meta[name="description"]')?.setAttribute('content', `${APP_NAME} — ${APP_TAGLINE}`);
document.querySelector('meta[property="og:title"]')?.setAttribute('content', APP_NAME);
document.querySelector('meta[property="og:description"]')?.setAttribute('content', `${APP_NAME} — ${APP_TAGLINE}`);
document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', APP_NAME);
document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', `${APP_NAME} — ${APP_TAGLINE}`);

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
