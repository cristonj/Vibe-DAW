import type { Project, Track } from '../model/types';
import { renderProject } from './render';
import { activeSpan } from './renderPlan';

// Background track freezing. Each instrument/drum track is rendered offline (its
// instrument and effects, pre-fader) and live playback streams that audio instead of
// running synths and effects in real time. Editing a track unfreezes it instantly
// (it plays live) and it re-freezes shortly after edits stop. Fader, pan, mute and
// solo stay live. Result: light CPU during playback, and playback == export.

export interface Frozen { sig: string; buffer: AudioBuffer; startBeat: number }

const cache = new Map<string, Frozen>();
const failed = new Map<string, string>();
const signatures = new WeakMap<Project, WeakMap<Track, string>>();
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let latest: Project | null = null;
let onChange: (() => void) | null = null;
let sampleRate = 48000;

export function configureFreeze(rate: number, changed: () => void) {
  if (sampleRate !== rate) { cache.clear(); failed.clear(); }
  sampleRate = rate;
  onChange = changed;
}

/** Everything that affects a track's pre-fader sound. Mixer settings are excluded on purpose. */
export function freezeSignature(p: Project, t: Track): string {
  let map = signatures.get(p);
  if (!map) { map = new WeakMap(); signatures.set(p, map); }
  const cached = map.get(t);
  if (cached) return cached;
  const duckSources = t.effects.filter((e) => e.type === 'duck' && e.enabled).map((e) => String(e.params.source));
  const sources = p.tracks.filter((x) => duckSources.includes(x.id)).map((x) => [x.id, x.clips, x.drumLanes]);
  const { volumeDb: _v, pan: _p, mute: _m, solo: _s, name: _n, color: _c, ...sound } = t;
  void _v; void _p; void _m; void _s; void _n; void _c;
  const sig = JSON.stringify([sound.clips.map((c) => ({ ...c, aiPending: undefined, name: undefined })), sound.instrument, sound.drumLanes, sound.effects, sound.kind, p.bpm, p.swing, p.timeSignature, sources]);
  map.set(t, sig);
  return sig;
}

export function frozenFor(p: Project, t: Track): Frozen | null {
  const f = cache.get(t.id);
  return f && f.sig === freezeSignature(p, t) ? f : null;
}

function freezable(t: Track) {
  return t.kind !== 'audio' && t.clips.some((c) => !c.muted);
}

/** Queue background freezes for any track whose sound changed. */
export function scheduleFreeze(p: Project) {
  if (latest?.id !== p.id) { cache.clear(); failed.clear(); }
  latest = p;
  const ids = new Set(p.tracks.map((t) => t.id));
  for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  for (const id of failed.keys()) if (!ids.has(id)) failed.delete(id);
  clearTimeout(timer);
  timer = setTimeout(() => void work(), 1200);
}

async function work() {
  if (running) return;
  running = true;
  try {
    while (latest) {
      const p = latest;
      const todo = p.tracks.find((t) => freezable(t) && cache.get(t.id)?.sig !== freezeSignature(p, t) && failed.get(t.id) !== freezeSignature(p, t));
      if (!todo) break;
      const sig = freezeSignature(p, todo);
      // Pre-fader: neutral volume/pan; the live channel applies the real mixer settings.
      const solo: Project = { ...p, tracks: p.tracks.map((t) => (t.id === todo.id ? { ...t, volumeDb: 0, pan: 0, mute: false, solo: false } : { ...t, solo: false })) };
      const span = activeSpan(todo, 0, Infinity)!;
      const startBeat = span[0];
      try {
        const pcm = await renderProject(solo, { startBeat, endBeat: span[1], onlyTracks: [todo.id], sampleRate, master: false, reuseFrozen: false });
        const current = latest?.tracks.find((t) => t.id === todo.id);
        if (!latest || latest.id !== p.id || !current || freezeSignature(latest, current) !== sig) continue;
        const bytes = pcm.channels.reduce((sum, c) => sum + c.byteLength, 0);
        const used = [...cache.values()].reduce((sum, f) => sum + f.buffer.length * f.buffer.numberOfChannels * 4, 0) - (cache.get(todo.id)?.buffer.length ?? 0) * 8;
        // Leave large projects live instead of repeatedly evicting and re-freezing tracks.
        if (used + bytes > MAX_CACHE_BYTES) { failed.set(todo.id, sig); continue; }
        const buffer = new AudioBuffer({ length: pcm.channels[0].length, numberOfChannels: 2, sampleRate });
        pcm.channels.forEach((d, i) => buffer.copyToChannel(d as Float32Array<ArrayBuffer>, i));
        cache.set(todo.id, { sig, buffer, startBeat });
        onChange?.();
      } catch (e) {
        console.warn('Freeze failed; track keeps playing live', e);
        failed.set(todo.id, sig);
      }
    }
  } finally {
    running = false;
  }
}
