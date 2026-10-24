import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { APP_NAME, APP_PRIMARY_COLOR, APP_SHORT_NAME, APP_TAGLINE } from './config/brand';
import { MISSING_FIREBASE_CONFIG } from './config/firebase';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {MISSING_FIREBASE_CONFIG.length > 0 ? (
      <main style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', padding: 24, fontFamily: 'system-ui', color: '#0f172a' }}>
        <section style={{ maxWidth: 640, padding: 32, border: '1px solid #fecaca', borderRadius: 16, background: '#fff7f7' }}>
          <h1 style={{ marginTop: 0, color: '#b91c1c' }}>Configuration Firebase manquante</h1>
          <p>Renseignez les variables d’environnement VITE_FIREBASE_* requises puis reconstruisez l’application.</p>
          <code>{MISSING_FIREBASE_CONFIG.join(', ')}</code>
        </section>
      </main>
    ) : (
      <App />
    )}
  </StrictMode>,
);

document.documentElement.style.setProperty('--brand-primary', APP_PRIMARY_COLOR);
document.title = APP_NAME;
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', APP_PRIMARY_COLOR);
document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', APP_SHORT_NAME);
document.querySelector('meta[name="description"]')?.setAttribute('content', `${APP_NAME} — ${APP_TAGLINE}`);
document.querySelector('meta[property="og:title"]')?.setAttribute('content', APP_NAME);
document.querySelector('meta[property="og:description"]')?.setAttribute('content', `${APP_NAME} — ${APP_TAGLINE}`);
document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', APP_NAME);
document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', `${APP_NAME} — ${APP_TAGLINE}`);
