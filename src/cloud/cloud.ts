import { create } from 'zustand';
import type { User } from 'firebase/auth';
import type { Project, SampleMeta } from '../model/types';
import { getFirebaseApp } from './firebase';
import { firebaseConfigured } from './config';
import { setRemoteSampleFetcher, setRemoteSampleUploader, useLibrary } from '../samples/library';

// Firebase-backed sync: Google sign-in, projects in Firestore, sample audio in Storage.
// Everything is scoped under users/{uid} and locked down by the rules in firestore.rules
// and storage.rules.

export interface CloudProjectInfo { id: string; name: string; updatedAt: number }

interface AuthState {
  user: { uid: string; name: string | null; email: string | null; photo: string | null } | null;
  ready: boolean;
  syncing: boolean;
  lastSyncError: string | null;
}

export const useAuth = create<AuthState>(() => ({ user: null, ready: !firebaseConfigured, syncing: false, lastSyncError: null }));

let currentUser: User | null = null;

export async function initCloud() {
  const app = await getFirebaseApp();
  if (!app) return;
  const { getAuth, onAuthStateChanged } = await import('firebase/auth');
  const auth = getAuth(app);
  onAuthStateChanged(auth, (u) => {
    currentUser = u;
    useAuth.setState({
      ready: true,
      user: u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null,
    });
    if (u) void pullSampleIndex();
  });
  setRemoteSampleFetcher(fetchSampleBytes);
  setRemoteSampleUploader(uploadSample);
}

export async function signIn() {
  const app = await getFirebaseApp();
  if (!app) throw new Error('Cloud sync isn’t configured for this build.');
  const { getAuth, GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  await signInWithPopup(getAuth(app), new GoogleAuthProvider());
}

export async function signOut() {
  const app = await getFirebaseApp();
  if (!app) return;
  const { getAuth, signOut: so } = await import('firebase/auth');
  await so(getAuth(app));
}

async function db() {
  const app = await getFirebaseApp();
  const { getFirestore } = await import('firebase/firestore');
  return getFirestore(app!);
}

// ---------------------------------------------------------------- projects

export async function saveProjectToCloud(p: Project): Promise<void> {
  if (!currentUser) return;
  const uid = currentUser.uid;
  useAuth.setState({ syncing: true });
  try {
    const { doc, setDoc } = await import('firebase/firestore');
    const data = JSON.stringify(p);
    if (data.length > 900_000) throw new Error('Project too large for cloud sync (over ~900 KB). It is still saved on this device.');
    await setDoc(doc(await db(), 'users', uid, 'projects', p.id), { name: p.name, updatedAt: p.updatedAt, bpm: p.bpm, data, schemaVersion: p.schemaVersion });
    useAuth.setState({ lastSyncError: null });
  } catch (e) {
    useAuth.setState({ lastSyncError: (e as Error).message });
    throw e;
  } finally {
    useAuth.setState({ syncing: false });
  }
}

export async function listCloudProjects(): Promise<CloudProjectInfo[]> {
  if (!currentUser) return [];
  if (cloudIndex) return [...cloudIndex.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const { collection, getDocs, orderBy, query, limit } = await import('firebase/firestore');
  const snap = await getDocs(query(collection(await db(), 'users', currentUser.uid, 'projects'), orderBy('updatedAt', 'desc'), limit(100)));
  return snap.docs.map((d) => ({ id: d.id, name: String(d.get('name') ?? 'Untitled'), updatedAt: Number(d.get('updatedAt') ?? 0) }));
}

export async function loadCloudProject(id: string): Promise<Project | null> {
  if (!currentUser) return null;
  const { doc, getDoc } = await import('firebase/firestore');
  const snap = await getDoc(doc(await db(), 'users', currentUser.uid, 'projects', id));
  if (!snap.exists()) return null;
  return JSON.parse(String(snap.get('data'))) as Project;
}

export async function deleteCloudProject(id: string) {
  if (!currentUser) return;
  const { doc, deleteDoc } = await import('firebase/firestore');
  await deleteDoc(doc(await db(), 'users', currentUser.uid, 'projects', id));
}

export interface CloudProjectChange {
  type: 'added' | 'modified' | 'removed';
  info: CloudProjectInfo;
  /** True when this device wrote the change and Firestore has not confirmed it yet. */
  local: boolean;
  load: () => Project | null;
}

// Live index of the signed-in user's cloud projects, kept by watchCloudProjects.
let cloudIndex: Map<string, CloudProjectInfo> | null = null;

/** Last updatedAt the cloud has for a project, or undefined if unknown. */
export function cloudUpdatedAt(id: string): number | undefined {
  return cloudIndex?.get(id)?.updatedAt;
}

/**
 * Listen to the user's projects collection. The first callback carries every project
 * (initial = true) so callers can reconcile; later ones carry what other devices changed.
 */
export async function watchCloudProjects(onChange: (changes: CloudProjectChange[], initial: boolean) => void): Promise<() => void> {
  if (!currentUser) return () => {};
  const { collection, onSnapshot } = await import('firebase/firestore');
  const index = new Map<string, CloudProjectInfo>();
  let initial = true;
  const unsubscribe = onSnapshot(collection(await db(), 'users', currentUser.uid, 'projects'), { includeMetadataChanges: true }, (snap) => {
    // Reconciling against an offline cache could mistake missing projects for deleted ones.
    if (initial && snap.metadata.fromCache) return;
    const docChanges = initial ? snap.docs.map((doc) => ({ type: 'added' as const, doc })) : snap.docChanges();
    const changes: CloudProjectChange[] = docChanges.map((c) => {
      const d = c.doc;
      const info = { id: d.id, name: String(d.get('name') ?? 'Untitled'), updatedAt: Number(d.get('updatedAt') ?? 0) };
      if (c.type === 'removed') index.delete(d.id);
      else index.set(d.id, info);
      return {
        type: c.type, info, local: d.metadata.hasPendingWrites,
        load: () => { try { return JSON.parse(String(d.get('data'))) as Project; } catch { return null; } },
      };
    });
    cloudIndex = index;
    const first = initial;
    initial = false;
    if (first || changes.length) onChange(changes, first);
  }, (e) => {
    console.warn('Cloud project sync unavailable', e);
    useAuth.setState({ lastSyncError: e.message });
  });
  return () => {
    unsubscribe();
    if (cloudIndex === index) cloudIndex = null;
  };
}

// ---------------------------------------------------------------- samples

async function uploadSample(meta: SampleMeta, data: ArrayBuffer, mime: string): Promise<string | null> {
  if (!currentUser) return null;
  const app = await getFirebaseApp();
  const { getStorage, ref, uploadBytes } = await import('firebase/storage');
  const { doc, setDoc } = await import('firebase/firestore');
  const path = `users/${currentUser.uid}/samples/${meta.id}`;
  await uploadBytes(ref(getStorage(app!), path), new Uint8Array(data), { contentType: mime });
  await setDoc(doc(await db(), 'users', currentUser.uid, 'samples', meta.id), { ...stripUndefined(meta), storagePath: path });
  return path;
}

async function fetchSampleBytes(meta: SampleMeta): Promise<ArrayBuffer | null> {
  if (!currentUser) return null;
  const app = await getFirebaseApp();
  const { getStorage, ref, getBytes } = await import('firebase/storage');
  const path = meta.storagePath ?? `users/${currentUser.uid}/samples/${meta.id}`;
  try {
    return await getBytes(ref(getStorage(app!), path));
  } catch {
    return null;
  }
}

/** Merge the user's cloud sample metadata into the local library (audio loads lazily). */
async function pullSampleIndex() {
  if (!currentUser) return;
  try {
    const { collection, getDocs } = await import('firebase/firestore');
    const snap = await getDocs(collection(await db(), 'users', currentUser.uid, 'samples'));
    const lib = useLibrary.getState();
    for (const d of snap.docs) {
      const meta = d.data() as SampleMeta;
      if (!lib.samples[meta.id]) lib.upsert(meta);
    }
  } catch (e) {
    console.warn('Could not pull sample index', e);
  }
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
