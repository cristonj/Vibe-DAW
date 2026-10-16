import { useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { Browser } from './components/Browser';
import { Arrangement } from './components/Arrangement';
import { Dock } from './components/Dock';
import { AgentPanel } from './components/AgentPanel';
import { InlineAI, openInlineAI } from './components/InlineAI';
import { SettingsModal, ProjectsModal } from './components/Modals';
import { useToasts } from './toast';
import { useDaw } from '../state/store';
import { togglePlay, stop } from '../engine/api';
import { isTypingTarget } from './hooks';
import { Tooltips } from './Tooltips';
import { HelpModal } from './components/HelpModal';
import { copySelectedClips, deleteSelectedClips, duplicateSelectedClips, pasteClips, splitAtPlayhead } from './actions';

function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState(false);
  const [projects, setProjects] = useState(false);
  const [help, setHelp] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(true);
  const [agentOpen, setAgentOpen] = useState(true);
  const [focusAgent, setFocusAgent] = useState(0);

  useEffect(() => {
    // The agent asks for a key the first time someone tries it, not on page load.
    const open = () => setSettings(true);
    window.addEventListener('vibe:open-settings', open);
    return () => window.removeEventListener('vibe:open-settings', open);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') { e.preventDefault(); openInlineAI(); return; }
      if (mod && k === 'l') { e.preventDefault(); setAgentOpen(true); setFocusAgent((n) => n + 1); return; }
      if (isTypingTarget(e.target)) return;
      const daw = useDaw.getState();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) daw.redo(); else daw.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); daw.redo(); return; }
      if (e.code === 'Space') { e.preventDefault(); void togglePlay(); return; }
      if (e.key === 'Home') { stop(true); return; }
      if (k === 'l' && !mod) { daw.update('Toggle loop', (d) => { d.loop.enabled = !d.loop.enabled; }); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && daw.selection.clipIds.length) { deleteSelectedClips(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelectedClips(); return; }
      if (mod && k === 'c') { copySelectedClips(); return; }
      if (mod && k === 'x') { copySelectedClips(true); return; }
      if (mod && k === 'v') { e.preventDefault(); pasteClips(); return; }
      if (mod && k === 'e') { e.preventDefault(); splitAtPlayhead(); return; }
      if (e.key === '?') { setHelp(true); return; }
      if (e.key === 'Escape') { daw.select({ clipIds: [] }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar
        onOpenSettings={() => setSettings(true)}
        onOpenProjects={() => setProjects(true)}
        onOpenHelp={() => setHelp(true)}
        browserOpen={browserOpen}
        agentOpen={agentOpen}
        toggleBrowser={() => setBrowserOpen((v) => !v)}
        toggleAgent={() => setAgentOpen((v) => !v)}
      />
      <Browser open={browserOpen} />
      <main className="main">
        <Arrangement />
        <Dock />
      </main>
      <AgentPanel open={agentOpen} focusSignal={focusAgent} />
      <InlineAI />
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {projects && <ProjectsModal onClose={() => setProjects(false)} />}
      {help && <HelpModal onClose={() => setHelp(false)} />}
      <Tooltips />
      <Toasts />
    </div>
  );
}
