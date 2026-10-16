import { useEffect, useState } from 'react';
import { Trash, Plus, Copy, Cloud, LogOut } from 'lucide-react';
import { useSettings, MODELS, type Thinking } from '../../state/settings';
import { firebaseConfigured } from '../../cloud/config';
import { useAuth, signIn, signOut } from '../../cloud/cloud';
import { usePersist, openProject, newProject, deleteProject, duplicateProject, syncNow } from '../../state/persistence';
import { useDaw } from '../../state/store';
import { relativeTime } from '../hooks';
import { toast } from '../toast';

function Modal({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const user = useAuth((x) => x.user);
  const [key, setKey] = useState(s.apiKey);
  const save = () => { s.set({ apiKey: key.trim() }); onClose(); };
  return (
    <Modal title="Settings" sub="How the agent connects to Gemini and how much freedom it has." onClose={onClose}>
      <div className="field">
        <span>Connection</span>
        <div className="radio-cards">
          <button className={`radio-card ${s.connection === 'firebase' ? 'on' : ''}`} disabled={!firebaseConfigured} onClick={() => s.set({ connection: 'firebase' })}>
            <b>Vibe cloud</b>
            <span>{firebaseConfigured ? 'Gemini through Firebase AI Logic. No key needed.' : 'Not configured in this build.'}</span>
          </button>
          <button className={`radio-card ${s.connection === 'apikey' ? 'on' : ''}`} onClick={() => s.set({ connection: 'apikey' })}>
            <b>Your Gemini key</b>
            <span>Calls Google directly from this browser.</span>
          </button>
        </div>
      </div>
      <label className="field">
        <span>Gemini API key</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" autoComplete="off" spellCheck={false} />
        <small>Stored only in this browser. Get one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.</small>
      </label>
      <label className="field">
        <span>Model</span>
        <select value={s.model} onChange={(e) => s.set({ model: e.target.value as typeof s.model })}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.blurb}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Thinking</span>
        <select value={s.thinking} onChange={(e) => s.set({ thinking: e.target.value as Thinking })}>
          <option value="MINIMAL">Minimal — fastest</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium — balanced</option>
          <option value="HIGH">High — best musical decisions, slower</option>
        </select>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={s.autoListen} onChange={(e) => s.set({ autoListen: e.target.checked })} />
        <span>Let the agent listen<small>It bounces audio and sends it to Gemini to audition samples and check the mix.</small></span>
      </label>
      {firebaseConfigured && (
        <div className="field">
          <span>Account</span>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Cloud size={14} /> {user.email ?? user.name}
              <button className="btn" onClick={() => void syncNow().then(() => toast('Synced'))}>Sync now</button>
              <button className="btn" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button>
            </div>
          ) : (
            <button className="btn solid" onClick={() => signIn().catch((e) => toast(e.message, 'error'))}>Sign in with Google to sync</button>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

export function ProjectsModal({ onClose }: { onClose: () => void }) {
  const projects = usePersist((s) => s.projects);
  const current = useDaw((s) => s.project.id);
  useEffect(() => { void usePersist.getState().refresh(); }, []);
  const open = async (id: string) => {
    try { await openProject(id); onClose(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <Modal title="Projects" sub="Saved on this device, and in the cloud when you're signed in." onClose={onClose}>
      <div className="project-list">
        {projects.map((p) => (
          <div key={p.id} className={`project-item ${p.id === current ? 'current' : ''}`}>
            <button style={{ flex: 1, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => void open(p.id)}>
              <b>{p.name}</b>
              {p.where !== 'local' && <Cloud size={12} color="var(--faint)" />}
              <span className="when">{relativeTime(p.updatedAt)}</span>
            </button>
            <button className="btn icon danger" aria-label={`Delete ${p.name}`} onClick={() => { if (confirm(`Delete “${p.name}”? This can't be undone.`)) void deleteProject(p.id); }}><Trash size={13} /></button>
          </div>
        ))}
        {!projects.length && <div className="dock-empty">No saved projects yet.</div>}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => void duplicateProject().then(onClose)}><Copy size={14} /> Duplicate current</button>
        <button className="btn primary" onClick={() => void newProject().then(onClose)}><Plus size={14} /> New project</button>
      </div>
    </Modal>
  );
}
