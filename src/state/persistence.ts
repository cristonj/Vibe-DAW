import { create } from 'zustand';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
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

async function writeLocal(p: Project) {
  await idbSet(key(p.id), p);
  const index = (await idbGet<ProjectEntry[]>(INDEX)) ?? [];
  const next = [{ id: p.id, name: p.name, updatedAt: p.updatedAt, where: 'local' as const }, ...index.filter((e) => e.id !== p.id)];
  await idbSet(INDEX, next);
  await idbSet(LAST, p.id);
}

let localTimer: ReturnType<typeof setTimeout> | undefined;
let cloudTimer: ReturnType<typeof setTimeout> | undefined;

export function startAutosave() {
  useDaw.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    usePersist.setState({ saveState: 'unsaved' });
    clearTimeout(localTimer);
    localTimer = setTimeout(async () => {
      usePersist.setState({ saveState: 'saving' });
      try {
        await writeLocal(useDaw.getState().project);
        usePersist.setState({ saveState: 'saved' });
      } catch (e) {
        console.error(e);
        usePersist.setState({ saveState: 'error' });
      }
    }, 700);
    if (useAuth.getState().user) {
      clearTimeout(cloudTimer);
      cloudTimer = setTimeout(() => { saveProjectToCloud(useDaw.getState().project).catch((e) => console.warn('Cloud save failed', e)); }, 4000);
    }
  });
  window.addEventListener('beforeunload', () => {
    clearTimeout(localTimer);
    void writeLocal(useDaw.getState().project);
  });
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
  useDaw.getState().replaceProject(p);
  useAgent.getState().clear();
  await idbSet(LAST, p.id);
}

export async function newProject(name?: string) {
  const p = createProject(name);
  useDaw.getState().replaceProject(p);
  useAgent.getState().clear();
  await writeLocal(p);
  await usePersist.getState().refresh();
}

export async function duplicateProject() {
  const cur = useDaw.getState().project;
  const p: Project = { ...structuredClone(cur), id: createProject().id, name: `${cur.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
  useDaw.getState().replaceProject(p);
  await writeLocal(p);
  await usePersist.getState().refresh();
}

export async function deleteProject(id: string) {
  await del(key(id));
  const index = (await idbGet<ProjectEntry[]>(INDEX)) ?? [];
  await idbSet(INDEX, index.filter((e) => e.id !== id));
  try { await deleteCloudProject(id); } catch { /* not in cloud */ }
  if (useDaw.getState().project.id === id) await newProject();
  await usePersist.getState().refresh();
}

export async function syncNow() {
  await saveProjectToCloud(useDaw.getState().project);
  await usePersist.getState().refresh();
}
