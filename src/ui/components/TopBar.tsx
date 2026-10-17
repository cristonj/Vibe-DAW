import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, Repeat, Metronome, Undo2, Redo2, Settings, FolderOpen, Download, PanelLeft, PanelRight, LogIn, Cloud, Square, CircleQuestionMark, Ellipsis } from 'lucide-react';
import { useDaw, useTransport } from '../../state/store';
import { usePersist } from '../../state/persistence';
import { useAuth, signIn } from '../../cloud/cloud';
import { firebaseConfigured } from '../../cloud/config';
import { togglePlay, stop, exportAudio } from '../../engine/api';
import { EXPORT_FORMATS, downloadBlob, type ExportFormat } from '../../engine/exportFormats';
import { formatPosition } from '../../model/project';
import { projectToMidi } from '../../model/midi';
import { PITCH_CLASSES, SCALES } from '../../model/theory';
import type { PitchClass, ScaleName } from '../../model/types';
import { toast } from '../toast';
import { tip, useKeymap } from '../../state/keymap';
import { exportProjectFile } from '../../state/projectFile';

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#262b40" />
      <path d="M6 20c3 0 3-8 6-8s3 12 6 12 3-16 6-16 2 6 2 6" fill="none" stroke="#b69cff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Position() {
  const pos = useTransport((s) => s.position);
  const ts = useDaw((s) => s.project.timeSignature);
  return <div className="pos" title="Bar . beat . sixteenth">{formatPosition({ timeSignature: ts }, pos)}</div>;
}

export function TopBar(props: { onOpenSettings: () => void; onOpenProjects: () => void; onOpenHelp: () => void; browserOpen: boolean; agentOpen: boolean; toggleBrowser: () => void; toggleAgent: () => void }) {
  useKeymap((k) => k.overrides);
  const name = useDaw((s) => s.project.name);
  const bpm = useDaw((s) => s.project.bpm);
  const key = useDaw((s) => s.project.key);
  const ts = useDaw((s) => s.project.timeSignature);
  const loop = useDaw((s) => s.project.loop.enabled);
  const canUndo = useDaw((s) => s.past.length > 0);
  const canRedo = useDaw((s) => s.future.length > 0);
  const update = useDaw((s) => s.update);
  const playing = useTransport((s) => s.playing);
  const starting = useTransport((s) => s.starting);
  const metronome = useTransport((s) => s.metronome);
  const saveState = usePersist((s) => s.saveState);
  const user = useAuth((s) => s.user);
  const syncing = useAuth((s) => s.syncing);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);

  const commitBpm = () => {
    if (bpmDraft === null) return;
    const v = Number(bpmDraft);
    if (isFinite(v) && v >= 40 && v <= 220) update('Tempo', (d) => { d.bpm = Math.round(v * 100) / 100; });
    setBpmDraft(null);
  };


  return (
    <header className="topbar">
      <button className="btn icon" title={tip('Show or hide the sound browser', 'toggleBrowser')} onClick={props.toggleBrowser} aria-pressed={props.browserOpen}><PanelLeft size={16} /></button>
      <div className="brand"><Logo /> <span className="brand-name">Vibe</span></div>
      <input
        className="project-name"
        value={name}
        aria-label="Project name"
        onChange={(e) => update('Rename project', (d) => { d.name = e.target.value; }, { coalesce: true })}
      />
      <span className="save-state hide-narrow">{saveState === 'saved' ? (user ? (syncing ? 'Syncing…' : 'Saved') : 'Saved locally') : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Edited'}</span>
      <button className="btn icon hide-narrow" title="Open, create, or delete projects" onClick={props.onOpenProjects}><FolderOpen size={16} /></button>
      <button className="btn icon" title={tip('Undo', 'undo')} disabled={!canUndo} onClick={() => useDaw.getState().undo()}><Undo2 size={16} /></button>
      <button className="btn icon" title={tip('Redo', 'redo')} disabled={!canRedo} onClick={() => useDaw.getState().redo()}><Redo2 size={16} /></button>

      {/* Phones put the transport and LCD on a second row. */}
      <div className="topbar-break" aria-hidden />

      <div className="transport">
        <button className="btn icon" title={tip('Back to start', 'stopRewind')} onClick={() => stop(true)}><SkipBack size={16} /></button>
        <button className="btn icon hide-narrow" title="Stop" onClick={() => stop(false)}><Square size={14} fill="currentColor" /></button>
        <button className={`play ${playing || starting ? 'playing' : ''}`} aria-label={starting ? 'Cancel playback startup' : playing ? 'Pause' : 'Play'} title={starting ? 'Loading audio… Click to cancel' : tip('Play / pause', 'playPause')} onClick={() => void togglePlay().catch((e) => toast(`Playback failed: ${(e as Error).message}`, 'error'))}>
          {playing || starting ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
        </button>
        <button className={`btn icon ${loop ? 'on' : ''}`} title={tip('Loop', 'toggleLoop')} onClick={() => update('Toggle loop', (d) => { d.loop.enabled = !d.loop.enabled; })}><Repeat size={16} /></button>
        <button className={`btn icon ${metronome ? 'on' : ''}`} title={tip('Metronome click', 'toggleMetronome')} onClick={() => useTransport.getState().setMetronome(!metronome)}><Metronome size={16} /></button>
      </div>

      <div className="lcd">
        <Position />
        <div title="Tempo">
          <input
            aria-label="Tempo"
            value={bpmDraft ?? String(bpm)}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setBpmDraft(null); }}
          />
          <span className="unit">BPM</span>
        </div>
        <div title="Key">
          <select aria-label="Key root" value={key.root} onChange={(e) => update('Key', (d) => { d.key.root = e.target.value as PitchClass; })}>
            {PITCH_CLASSES.map((pc) => <option key={pc} value={pc}>{pc}</option>)}
          </select>
          &nbsp;
          <select aria-label="Scale" value={key.scale} onChange={(e) => update('Scale', (d) => { d.key.scale = e.target.value as ScaleName; })}>
            {Object.keys(SCALES).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div className="sig" title="Time signature">
          <select aria-label="Time signature" value={ts.join('/')} onChange={(e) => update('Time signature', (d) => { d.timeSignature = e.target.value.split('/').map(Number) as [number, number]; })}>
            {['4/4', '3/4', '6/8', '5/4', '7/8'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="top-right">
        <ExportMenu />
        {firebaseConfigured && (user ? (
          <span className="avatar" title={`${user.name ?? user.email} — synced to the cloud`}>
            {user.photo ? <img src={user.photo} alt="" referrerPolicy="no-referrer" /> : (user.name ?? '?')[0]}
          </span>
        ) : (
          <button className="btn hide-narrow" onClick={() => signIn().catch((e) => toast(e.message, 'error'))} title="Sign in to sync projects and samples"><LogIn size={15} /> Sign in</button>
        ))}
        {user && <Cloud size={14} color="var(--faint)" aria-label="Cloud sync on" />}
        <button className="btn icon hide-narrow" title={tip('Help and keyboard shortcuts', 'help')} onClick={props.onOpenHelp}><CircleQuestionMark size={16} /></button>
        <button className="btn icon hide-narrow" title="Settings: Gemini key, model, account" onClick={props.onOpenSettings}><Settings size={16} /></button>
        <MoreMenu onOpenProjects={props.onOpenProjects} onOpenHelp={props.onOpenHelp} onOpenSettings={props.onOpenSettings} signedIn={!!user} />
        <button className="btn icon" title={tip('Show or hide the Producer panel', 'toggleAgent')} onClick={props.toggleAgent} aria-pressed={props.agentOpen}><PanelRight size={16} /></button>
      </div>
    </header>
  );
}

/** Open/close state for a dropdown that closes on any press outside it. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return { open, setOpen, ref };
}

/** Narrow-screen overflow menu for the actions that don't fit in the top bar. */
function MoreMenu(props: { onOpenProjects: () => void; onOpenHelp: () => void; onOpenSettings: () => void; signedIn: boolean }) {
  const { open, setOpen, ref } = useDropdown();
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="menu-wrap only-narrow" ref={ref}>
      <button className="btn icon" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="More"><Ellipsis size={16} /></button>
      {open && (
        <div className="menu" role="menu">
          <button className="menu-item" role="menuitem" onClick={pick(props.onOpenProjects)}><b><FolderOpen size={14} /> Projects</b><span>Open, create, or delete projects</span></button>
          {firebaseConfigured && !props.signedIn && (
            <button className="menu-item" role="menuitem" onClick={pick(() => void signIn().catch((e) => toast(e.message, 'error')))}><b><LogIn size={14} /> Sign in</b><span>Sync projects and samples</span></button>
          )}
          <button className="menu-item" role="menuitem" onClick={pick(props.onOpenSettings)}><b><Settings size={14} /> Settings</b><span>Gemini key, model, theme, playback</span></button>
          <button className="menu-item" role="menuitem" onClick={pick(props.onOpenHelp)}><b><CircleQuestionMark size={14} /> Help</b><span>How Vibe works</span></button>
        </div>
      )}
    </div>
  );
}

function ExportMenu() {
  const { open, setOpen, ref } = useDropdown();
  const [progress, setProgress] = useState<{ pct: number; stage: 'render' | 'encode' } | null>(null);

  const run = async (format: ExportFormat) => {
    setOpen(false);
    setProgress({ pct: 0, stage: 'render' });
    try {
      const p = useDaw.getState().project;
      const blob = format === 'midi'
        ? new Blob([projectToMidi(p) as BlobPart], { type: 'audio/midi' })
        : await exportAudio(p, format, (f, stage) => setProgress({ pct: Math.round(f * 100), stage }));
      const ext = EXPORT_FORMATS.find((x) => x.id === format)!.ext;
      downloadBlob(blob, `${p.name.replace(/[^\w\- ]+/g, '').trim() || 'beat'}.${ext}`);
      toast(format === 'midi' ? 'Exported MIDI' : `Exported ${ext.toUpperCase()} (${(blob.size / 1048576).toFixed(1)} MB)`);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setProgress(null);
    }
  };
  const saveProject = async () => {
    setOpen(false);
    setProgress({ pct: 0, stage: 'encode' });
    try {
      const p = useDaw.getState().project;
      const blob = await exportProjectFile(p);
      downloadBlob(blob, `${p.name.replace(/[^\w\- ]+/g, '').trim() || 'project'}.vibe`);
      toast(`Exported project with custom samples (${(blob.size / 1048576).toFixed(1)} MB)`);
    } catch (e) { toast(`Project export failed: ${(e as Error).message}`, 'error'); }
    finally { setProgress(null); }
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} disabled={!!progress} aria-haspopup="menu" aria-expanded={open} aria-label="Export" title="Bounce the song to an audio file">
        <Download size={15} /> {progress ? `${progress.stage === 'render' ? 'Bouncing' : 'Encoding'} ${progress.pct}%` : <span className="btn-label">Export</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          <button className="menu-item" role="menuitem" onClick={() => void saveProject()}><b>Vibe project (.vibe)</b><span>Portable session with notes, instruments, effects and custom samples</span></button>
          {EXPORT_FORMATS.map((f) => (
            <button key={f.id} className="menu-item" role="menuitem" onClick={() => void run(f.id)}>
              <b>{f.label}</b>
              <span>{f.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
