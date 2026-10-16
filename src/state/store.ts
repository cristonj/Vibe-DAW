import { create } from 'zustand';
import { produce } from 'immer';
import { createProject } from '../model/project';
import type { Project } from '../model/types';

// Project document + undo history + editor UI state.
// History is snapshot-based: immer gives structural sharing, so each entry is cheap.

const HISTORY_LIMIT = 200;
const COALESCE_MS = 600;

export type BottomPanel = 'editor' | 'mixer' | 'track';

export interface Selection {
  trackId: string | null;
  clipIds: string[];
}

interface DawState {
  project: Project;
  past: Array<{ project: Project; label: string }>;
  future: Array<{ project: Project; label: string }>;
  /** When set, edits are grouped into one undo step (used for agent runs). */
  transaction: string | null;
  lastLabel: string;
  lastTime: number;

  selection: Selection;
  editorClipId: string | null;
  bottomPanel: BottomPanel;
  bottomOpen: boolean;
  /** Pixels per beat in the arrangement. */
  zoom: number;
  /** Grid snap in beats (0 = off). */
  snap: number;
  followPlayhead: boolean;

  update: (label: string, recipe: (draft: Project) => void, opts?: { coalesce?: boolean }) => void;
  replaceProject: (p: Project, opts?: { keepHistory?: boolean; label?: string }) => void;
  beginTransaction: (label: string) => void;
  endTransaction: () => void;
  undo: () => void;
  redo: () => void;

  select: (sel: Partial<Selection>) => void;
  openEditor: (clipId: string | null) => void;
  setBottom: (panel: BottomPanel, open?: boolean) => void;
  toggleBottom: () => void;
  setZoom: (z: number) => void;
  setSnap: (s: number) => void;
  setFollow: (f: boolean) => void;
}

export const useDaw = create<DawState>((set, get) => ({
  project: createProject(),
  past: [],
  future: [],
  transaction: null,
  lastLabel: '',
  lastTime: 0,

  selection: { trackId: null, clipIds: [] },
  editorClipId: null,
  bottomPanel: 'editor',
  bottomOpen: true,
  zoom: 22,
  snap: 0.25,
  followPlayhead: true,

  update: (label, recipe, opts) => {
    const s = get();
    const next = produce(s.project, (d) => {
      recipe(d);
      d.updatedAt = Date.now();
    });
    if (next === s.project) return;
    const now = Date.now();
    if (s.transaction) {
      set({ project: next, future: [] });
      return;
    }
    const coalesce = opts?.coalesce && s.lastLabel === label && now - s.lastTime < COALESCE_MS;
    set({
      project: next,
      past: coalesce ? s.past : [...s.past, { project: s.project, label }].slice(-HISTORY_LIMIT),
      future: [],
      lastLabel: label,
      lastTime: now,
    });
  },

  replaceProject: (p, opts) => {
    const s = get();
    set({
      project: p,
      past: opts?.keepHistory ? [...s.past, { project: s.project, label: opts.label ?? 'Replace project' }].slice(-HISTORY_LIMIT) : [],
      future: [],
      selection: { trackId: null, clipIds: [] },
      editorClipId: opts?.keepHistory ? s.editorClipId : null,
    });
  },

  beginTransaction: (label) => {
    const s = get();
    if (s.transaction) return;
    set({ transaction: label, past: [...s.past, { project: s.project, label }].slice(-HISTORY_LIMIT), future: [], lastLabel: label, lastTime: Date.now() });
  },

  endTransaction: () => {
    const s = get();
    if (!s.transaction) return;
    // Drop the history entry if nothing actually changed.
    const top = s.past[s.past.length - 1];
    if (top && top.project === s.project) set({ past: s.past.slice(0, -1) });
    set({ transaction: null });
  },

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev || s.transaction) return;
    set({
      project: prev.project,
      past: s.past.slice(0, -1),
      future: [{ project: s.project, label: prev.label }, ...s.future],
      lastLabel: '',
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next || s.transaction) return;
    set({
      project: next.project,
      past: [...s.past, { project: s.project, label: next.label }],
      future: s.future.slice(1),
      lastLabel: '',
    });
  },

  select: (sel) => set((s) => ({ selection: { ...s.selection, ...sel } })),
  openEditor: (clipId) => set({ editorClipId: clipId, ...(clipId ? { bottomPanel: 'editor' as const, bottomOpen: true } : {}) }),
  setBottom: (panel, open = true) => set({ bottomPanel: panel, bottomOpen: open }),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  setZoom: (z) => set({ zoom: Math.max(4, Math.min(200, z)) }),
  setSnap: (snap) => set({ snap }),
  setFollow: (followPlayhead) => set({ followPlayhead }),
}));

/** Read the current project outside React. */
export const getProject = () => useDaw.getState().project;

// Playhead lives in its own store so 60fps updates don't re-render the whole app.
interface TransportState {
  playing: boolean;
  /** Beats */
  position: number;
  recording: boolean;
  metronome: boolean;
  setPlaying: (p: boolean) => void;
  setPosition: (b: number) => void;
  setMetronome: (m: boolean) => void;
}

export const useTransport = create<TransportState>((set) => ({
  playing: false,
  position: 0,
  recording: false,
  metronome: false,
  setPlaying: (playing) => set({ playing }),
  setPosition: (position) => set({ position }),
  setMetronome: (metronome) => set({ metronome }),
}));
