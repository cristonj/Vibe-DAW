import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing/Landing';
import './styles/base.css';

// The landing route never initializes IndexedDB, Firebase, AI, or audio.
const Studio = lazy(() => import('./studio'));
const landing = window.location.pathname === '/';
// The landing page is always dark, whatever the system or the studio's theme.
if (landing) document.documentElement.style.colorScheme = 'dark';
// Production only: the service worker caches the app so it opens offline once installed.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{landing ? <Landing /> : <Suspense fallback={<div className="boot">Opening your studio…</div>}><Studio /></Suspense>}</StrictMode>,
);
