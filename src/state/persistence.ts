import { create } from 'zustand';
import { del, get as idbGet, setMany, update as idbUpdate } from 'idb-keyval';
import type { Project } from '../model/types';
import { createProject } from '../model/project';
import { useDaw } from './store';
import { useAuth, saveProjectToCloud, listCloudProjects, loadCloudProject, deleteCloudProject } from '../cloud/cloud';
import { useAgent } from '../agent/agent';

// Local-first persistence. Every change autosaves to IndexedDB; when signed in,
// projects also sync to Firestore.

export interface ProjectEntry { id: string; name: string; updatedAt: number; where: 'local' | 'cloud' | 'both' }

interface PersistState {
  projects: ProjectEntry[];
  saveState: 'saved' | 'saving' | 'unsaved' | 'error';
  refresh: () => Promise<void>;
}

const INDEX = 'vibe:projects';
const LAST = 'vibe:lastProject';
const key = (id: string) => `vibe:project:${id}`;

export const usePersist = create<PersistState>((set) => ({
  projects: [],
  saveState: 'saved',
  refresh: async () => {
    const local = (await idbGet<ProjectEntry[]>(INDEX).catch(() => undefined)) ?? [];
    let cloud: { id: string; name: string; updatedAt: number }[] = [];
    try { cloud = await listCloudProjects(); } catch { /* offline or signed out */ }
    const map = new Map<string, ProjectEntry>(local.map((e) => [e.id, { ...e, where: 'local' }]));
    for (const c of cloud) {
      const have = map.get(c.id);
      map.set(c.id, have ? { ...have, updatedAt: Math.max(have.updatedAt, c.updatedAt), where: 'both' } : { ...c, where: 'cloud' });
    }
    set({ projects: [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt) });
  },
}));

let localQueue: Promise<void> = Promise.resolve();
function serializeLocal(fn: () => Promise<void>) {
  const result = localQueue.then(fn, fn);
  localQueue = result.catch(() => undefined);
  return result;
}

function writeLocal(p: Project) {
  return serializeLocal(async () => {
    const index = (await idbGet<ProjectEntry[]>(INDEX)) ?? [];
    const next = [{ id: p.id, name: p.name, updatedAt: p.updatedAt, where: 'local' as const }, ...index.filter((e) => e.id !== p.id)];
    // Commit the document, index and last-opened pointer together.
    await setMany([[key(p.id), p], [INDEX, next], [LAST, p.id]]);
  });
}

let localTimer: ReturnType<typeof setTimeout> | undefined;
let cloudTimer: ReturnType<typeof setTimeout> | undefined;
let maxTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveCleanup: (() => void) | undefined;
let savedProject: Project | null = null;
let saveInFlight: Promise<void> | null = null;

/** Save pending edits before navigation; a completed older save must not mark newer edits saved. */
export function flushAutosave(): Promise<void> {
  clearTimeout(localTimer);
  clearTimeout(maxTimer);
  maxTimer = undefined;
  if (saveInFlight) return saveInFlight;
  if (savedProject === useDaw.getState().project) return Promise.resolve();
  saveInFlight = (async () => {
    usePersist.setState({ saveState: 'saving' });
    try {
      while (savedProject !== useDaw.getState().project) {
        const p = useDaw.getState().project;
        await writeLocal(p);
        savedProject = p;
      }
      usePersist.setState({ saveState: 'saved' });
    } catch (e) {
      usePersist.setState({ saveState: 'error' });
      throw e;
    } finally { saveInFlight = null; }
  })();
  return saveInFlight;
}

export function startAutosave() {
  if (autosaveCleanup) return autosaveCleanup;
  const save = () => { void flushAutosave().catch((e) => console.error('Autosave failed', e)); };
  const unsubscribe = useDaw.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    usePersist.setState({ saveState: 'unsaved' });
    clearTimeout(localTimer);
    localTimer = setTimeout(save, 700);
    // Continuous dragging/typing must not postpone saving indefinitely.
    maxTimer ??= setTimeout(save, 5000);
    clearTimeout(cloudTimer);
    if (useAuth.getState().user) {
      const p = s.project;
      cloudTimer = setTimeout(() => { saveProjectToCloud(p).catch((e) => console.warn('Cloud save failed', e)); }, 4000);
    }
  });
  const hidden = () => { if (document.visibilityState === 'hidden') save(); };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', hidden);
  autosaveCleanup = () => {
    unsubscribe();
    clearTimeout(localTimer);
    clearTimeout(cloudTimer);
    clearTimeout(maxTimer);
    maxTimer = undefined;
    window.removeEventListener('pagehide', save);
    document.removeEventListener('visibilitychange', hidden);
    autosaveCleanup = undefined;
  };
  return autosaveCleanup;
}

export async function loadInitialProject(): Promise<Project> {
  try {
    const last = await idbGet<string>(LAST);
    if (last) {
      const p = await idbGet<Project>(key(last));
      if (p) return p;
    }
  } catch (e) {
    console.warn('Could not read saved projects', e);
  }
  return createProject();
}

export async function openProject(id: string) {
  await flushAutosave();
  let p = await idbGet<Project>(key(id)).catch(() => undefined);
  if (useAuth.getState().user) {
    try {
      const remote = await loadCloudProject(id);
      if (remote && (!p || remote.updatedAt > p.updatedAt)) p = remote;
    } catch (e) {
      console.warn('Cloud load failed', e);
    }
  }
  if (!p) throw new Error('Project not found');
  await flushAutosave();
  useAgent.getState().clear();
  useDaw.getState().replaceProject(p);
  await flushAutosave();
}

export async function newProject(name?: string) {
  await flushAutosave();
  const p = createProject(name);
  useAgent.getState().clear();
  useDaw.getState().replaceProject(p);
  await flushAutosave();
  await usePersist.getState().refresh();
}

export async function duplicateProject() {
  await flushAutosave();
  const cur = useDaw.getState().project;
  const p: Project = { ...structuredClone(cur), id: createProject().id, name: `${cur.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
  useAgent.getState().clear();
  useDaw.getState().replaceProject(p);
  await flushAutosave();
  await usePersist.getState().refresh();
}

export async function deleteProject(id: string) {
  clearTimeout(cloudTimer);
  if (useDaw.getState().project.id === id) {
    // Switch first so a queued autosave cannot recreate the deleted project.
    useAgent.getState().clear();
    useDaw.getState().replaceProject(createProject());
    await flushAutosave();
  }
  await serializeLocal(async () => {
    await del(key(id));
    await idbUpdate<ProjectEntry[]>(INDEX, (index) => (index ?? []).filter((e) => e.id !== id));
  });
  try { await deleteCloudProject(id); } catch { /* not in cloud */ }
  await usePersist.getState().refresh();
}

export async function syncNow() {
  await saveProjectToCloud(useDaw.getState().project);
  await usePersist.getState().refresh();
}
