import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './ui/App';
import { initLibrary } from './samples/library';
import { initEngine } from './engine/engine';
import { useDaw } from './state/store';
import { loadInitialProject, startAutosave, usePersist } from './state/persistence';
import { initCloud } from './cloud/cloud';

async function boot() {
  await initLibrary();
  const project = await loadInitialProject();
  useDaw.getState().replaceProject(project);
  initEngine();
  startAutosave();
  void initCloud().then(() => usePersist.getState().refresh());
  if (import.meta.env.DEV) {
    // Dev-only handle for automated smoke tests: drive tools and renders without the LLM.
    const [tools, render, analysis, engine, agent, graph, Tone, library, llm, settings] = await Promise.all([
      import('./agent/tools'), import('./engine/render'), import('./samples/analysis'), import('./engine/engine'), import('./agent/agent'), import('./engine/graph'), import('tone'), import('./samples/library'), import('./agent/llm'), import('./state/settings'),
    ]);
    Object.assign(window, { __vibe: { useDaw, tools, render, analysis, engine, agent, graph, Tone, library, llm, settings } });
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
