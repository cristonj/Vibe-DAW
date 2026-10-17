import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing/Landing';
import './styles/global.css';

// The landing route never initializes IndexedDB, Firebase, AI, or audio.
const Studio = lazy(() => import('./studio'));
const landing = window.location.pathname === '/';
createRoot(document.getElementById('root')!).render(
  <StrictMode>{landing ? <Landing /> : <Suspense fallback={<div className="boot">Opening your studio…</div>}><Studio /></Suspense>}</StrictMode>,
);
