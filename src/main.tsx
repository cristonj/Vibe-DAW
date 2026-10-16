import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './ui/App';
import { initLibrary } from './samples/library';
import { loadEngineOnFirstGesture } from './engine/api';
import { useDaw } from './state/store';
import { loadInitialProject, startAutosave, usePersist } from './state/persistence';
import { initCloud } from './cloud/cloud';
import { applyTheme } from './state/theme';

let bootPromise: Promise<void> | null = null;
function boot() { return bootPromise ??= initialize(); }

async function initialize() {
  applyTheme();
  await initLibrary();
  const project = await loadInitialProject();
  useDaw.getState().replaceProject(project);
  loadEngineOnFirstGesture();
  startAutosave();
  void initCloud().then(() => usePersist.getState().refresh());
  if (import.meta.env.DEV) {
    // Dev-only handle for automated smoke tests: drive tools and renders without the LLM.
    // Audio modules (render/engine) go through the lazy facade so dev also stays gesture-clean.
    const [tools, api, analysis, agent, library, llm, settings] = await Promise.all([
      import('./agent/tools'), import('./engine/api'), import('./samples/analysis'), import('./agent/agent'), import('./samples/library'), import('./agent/llm'), import('./state/settings'),
    ]);
    Object.assign(window, { __vibe: { useDaw, tools, render: api, engine: api, analysis, agent, library, llm, settings, liveContext: async () => (await api.loadEngine(), (await import('tone')).getContext()) } });
  }
}

function Root() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    boot().then(() => setReady(true)).catch((e) => setError(String(e?.message ?? e)));
  }, []);
  if (error) return <div className="boot">Vibe couldn't start: {error}</div>;
  if (!ready) return <div className="boot">Tuning the 808s…</div>;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
