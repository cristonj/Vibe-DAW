import * as Tone from 'tone';
import type { Project, Track } from '../model/types';
import { beatsToSeconds, projectLength } from '../model/project';
import { EngineGraph, preloadProject } from './graph';
import type { InstrumentAssets } from './instruments';
import { contextLock } from './lock';
import { encodeWav, type PcmData } from './wav';
import type { ExportFormat } from './exportFormats';

// Offline bounce. Used for exports and — more importantly — for the agent's ears:
// it renders exactly what the user would hear and hands it to Gemini.
//
// Speed comes from three things:
//  1. Stems in parallel. Each track renders in its own OfflineAudioContext (Chrome
//     gives each one a thread), then stems are summed and the master bus runs once.
//  2. Each stem only renders the span where its track has clips (plus tail).
//  3. Windowed rendering inside each context: the native context suspends every
//     second and Tone's clock advances one window ahead, so only sounding voices
//     exist instead of every note's nodes for the whole song.

export interface RenderOptions {
  startBeat?: number;
  endBeat?: number;
  /** Solo these tracks (ids). */
  onlyTracks?: string[] | null;
  /** Extra seconds after the end for reverb/release tails. */
  tail?: number;
  sampleRate?: number;
  /** 0..1 as rendering advances. */
  onProgress?: (fraction: number) => void;
  /** Render tracks as parallel stems (default) or the whole mix in one pass. */
  stems?: boolean;
  /** Skip the master bus (used to freeze single tracks). */
  master?: boolean;
}

const WINDOW_SEC = 1;
const AHEAD_SEC = 0.25;

interface OfflineInternals {
  _currentTime: number;
  emit(event: 'tick'): void;
}

interface PassSpec {
  project: Project;
  assets: Map<string, InstrumentAssets>;
  startBeat: number;
  endBeat: number;
  tail: number;
  sampleRate: number;
  onlyTracks: string[] | null;
  bypassMaster: boolean;
  /** Pre-mixed audio to play into the master bus (master pass). */
  input?: Float32Array[];
  onProgress?: (fraction: number) => void;
}

/**
 * One offline render pass. The graph is built while holding the context lock (Tone's
 * global context is swapped during construction); the lock is released before the
 * audio thread starts, so several passes can render at once.
 */
async function renderPass(spec: PassSpec): Promise<Float32Array[]> {
  const { project: p, sampleRate } = spec;
  const duration = beatsToSeconds(p, spec.endBeat - spec.startBeat) + spec.tail;
  const frames = Math.max(128, Math.ceil(duration * sampleRate));
  const nativeCtx = new OfflineAudioContext(2, frames, sampleRate);
  let failure: unknown = null;

  const graph = await contextLock.run(async () => {
    const previous = Tone.getContext();
    // Hand Tone a native OfflineAudioContext. Tone's default wrapper builds offline
    // nodes only when rendering starts, so voices created in later windows would be
    // silent; native nodes join the graph immediately.
    const ctx = new Tone.OfflineContext(nativeCtx as never);
    Tone.setContext(ctx);
    try {
      const g = new EngineGraph({ live: false, onlyTracks: spec.onlyTracks, bypassMaster: spec.bypassMaster });
      await g.sync(p, spec.assets);
      if (spec.input) {
        const buf = new AudioBuffer({ length: spec.input[0].length, numberOfChannels: spec.input.length, sampleRate });
        spec.input.forEach((d, i) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, i));
        const src = new Tone.ToneBufferSource({ url: buf, context: ctx });
        src.connect(g.masterInput);
        src.start(0);
      } else {
        ctx.transport.start(0, beatsToSeconds(p, spec.startBeat));
        ctx.transport.stop(beatsToSeconds(p, spec.endBeat - spec.startBeat) + spec.tail);
      }
      const clock = ctx as unknown as OfflineInternals;
      const block = 128 / sampleRate;
      // Step in exact integer blocks: accumulating floats drifts, and Tone then fires
      // events that land on a block boundary twice (doubled notes in the bounce).
      let step = Math.round(clock._currentTime / block);
      const advance = (to: number) => {
        const limit = Math.min(to, duration);
        while (clock._currentTime < limit) {
          clock.emit('tick');
          clock._currentTime = ++step * block;
        }
      };
      advance(WINDOW_SEC + AHEAD_SEC);
      for (let t = WINDOW_SEC; t < duration - block; t += WINDOW_SEC) {
        const at = Math.round((t * sampleRate) / 128) * 128 / sampleRate;
        nativeCtx.suspend(at).then(() => {
          // Always resume, even if a scheduled callback throws — otherwise the bounce hangs.
          try {
            if (!failure) advance(at + WINDOW_SEC + AHEAD_SEC);
          } catch (e) {
            failure = e;
          }
          spec.onProgress?.(at / duration);
          return nativeCtx.resume();
        }, () => { /* suspend time already passed */ });
      }
      return g;
    } finally {
      Tone.setContext(previous);
    }
  });
  const rendered = await nativeCtx.startRendering();
  graph.dispose();
  if (failure) throw failure;
  spec.onProgress?.(1);
  return [rendered.getChannelData(0), rendered.getChannelData(1)];
}

function audibleTracks(p: Project, onlyTracks: string[] | null | undefined): Track[] {
  const anySolo = p.tracks.some((t) => t.solo);
  return p.tracks.filter((t) => (onlyTracks ? onlyTracks.includes(t.id) : !t.mute && (!anySolo || t.solo)));
}

/** First/last beat where a track has unmuted clips, clamped to [from, to). */
function activeSpan(t: Track, from: number, to: number): [number, number] | null {
  let a = Infinity, b = -Infinity;
  for (const c of t.clips) {
    if (c.muted) continue;
    a = Math.min(a, c.start);
    b = Math.max(b, c.start + c.length);
  }
  const s = Math.max(from, a), e = Math.min(to, b);
  return e > s ? [s, e] : null;
}

function noteValueBeats(v: string): number {
  const m = /^(\d+)(n|t)(\.)?$/.exec(v.trim());
  if (!m) return 0.5;
  let beats = 4 / Number(m[1]);
  if (m[2] === 't') beats *= 2 / 3;
  if (m[3]) beats *= 1.5;
  return beats;
}

/**
 * How long a track keeps sounding after its last note: instrument release plus
 * reverb/delay tails. Stems render this far so no tail gets cut off.
 */
function trackTail(t: Track, bpm: number): number {
  let tail = 0.5;
  const ip = t.instrument?.params;
  if (ip) tail = Math.max(tail, ip.release ?? 0, ip.decay ?? 0);
  for (const e of t.effects) {
    if (!e.enabled) continue;
    if (e.type === 'reverb') tail += Number(e.params.decay ?? 2.5) + Number(e.params.preDelay ?? 0);
    if (e.type === 'delay') {
      const sec = (noteValueBeats(String(e.params.time ?? '8n.')) * 60) / bpm;
      const fb = Math.min(0.95, Math.max(0.01, Number(e.params.feedback ?? 0.35)));
      tail += Math.min(12, sec * (Math.log(0.001) / Math.log(fb) + 1));
    }
    if (e.type === 'chorus' || e.type === 'phaser' || e.type === 'lofi') tail += 0.1;
  }
  return Math.min(20, tail + 0.3);
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

export async function renderProject(project: Project, opts: RenderOptions = {}): Promise<PcmData> {
  const start = Math.max(0, opts.startBeat ?? 0);
  const end = Math.max(start + 0.25, opts.endBeat ?? projectLength(project));
  const tail = opts.tail ?? 1.5;
  const sampleRate = opts.sampleRate ?? 44100;
  // Render a loop-free copy: bounces always run straight through.
  const p: Project = { ...project, loop: { ...project.loop, enabled: false } };
  const assets = await preloadProject(p);
  const total = Math.ceil((beatsToSeconds(p, end - start) + tail) * sampleRate);
  if (opts.stems === false) {
    const one = await renderPass({ project: p, assets, startBeat: start, endBeat: end, tail, sampleRate, onlyTracks: opts.onlyTracks ?? null, bypassMaster: false, onProgress: opts.onProgress });
    return { sampleRate, channels: one.map((c) => c.slice(0, total)) };
  }
  const mix = [new Float32Array(total), new Float32Array(total)];

  // Stems, in parallel. Longest first so the pool finishes evenly.
  const stems = audibleTracks(p, opts.onlyTracks)
    .map((t) => ({ t, span: activeSpan(t, start, end) }))
    .filter((x): x is { t: Track; span: [number, number] } => !!x.span)
    .sort((a, b) => (b.span[1] - b.span[0]) - (a.span[1] - a.span[0]));
  const weight = stems.reduce((s, x) => s + (x.span[1] - x.span[0]), 0) || 1;
  const done = new Map<string, number>();
  const report = () => opts.onProgress?.(0.92 * [...done.values()].reduce((a, b) => a + b, 0) / weight);
  const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  await pool(stems, workers, async ({ t, span }) => {
    const len = span[1] - span[0];
    const stem = await renderPass({
      project: p, assets, startBeat: span[0], endBeat: span[1], tail: Math.max(tail, trackTail(t, p.bpm)), sampleRate,
      onlyTracks: [t.id], bypassMaster: true,
      onProgress: (f) => { done.set(t.id, f * len); report(); },
    });
    const offset = Math.round(beatsToSeconds(p, span[0] - start) * sampleRate);
    for (let c = 0; c < 2; c++) {
      const dst = mix[c], src = stem[c];
      const n = Math.min(src.length, total - offset);
      for (let i = 0; i < n; i++) dst[offset + i] += src[i];
    }
  });

  if (opts.master === false) return { sampleRate, channels: mix };
  // Master bus once, over the summed stems.
  const out = await renderPass({
    project: { ...p, tracks: [] }, assets, startBeat: start, endBeat: end, tail, sampleRate,
    onlyTracks: [], bypassMaster: false, input: mix,
    onProgress: (f) => opts.onProgress?.(0.92 + 0.08 * f),
  });
  return { sampleRate, channels: out.map((c) => c.slice(0, total)) };
}

/** Encode PCM to MP3 in a worker so the UI stays responsive. */
function encodeMp3(pcm: PcmData, kbps: number, onProgress?: (f: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ progress?: number; data?: Uint8Array[]; error?: string }>) => {
      if (e.data.progress !== undefined) onProgress?.(e.data.progress);
      if (e.data.error) { worker.terminate(); reject(new Error(e.data.error)); }
      if (e.data.data) { worker.terminate(); resolve(new Blob(e.data.data as BlobPart[], { type: 'audio/mpeg' })); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'MP3 encoder failed')); };
    const [left, right] = pcm.channels;
    worker.postMessage({ left, right: right ?? left, sampleRate: pcm.sampleRate, kbps }, [left.buffer, ...(right ? [right.buffer] : [])]);
  });
}

/** Bounce and encode. Progress covers rendering (first 80%) then encoding. */
export async function exportAudio(project: Project, format: ExportFormat, onProgress?: (fraction: number, stage: 'render' | 'encode') => void): Promise<Blob> {
  const renderShare = format === 'mp3' ? 0.8 : 0.95;
  const pcm = await renderProject(project, { tail: 2.5, onProgress: (f) => onProgress?.(f * renderShare, 'render') });
  if (format === 'mp3') return encodeMp3(pcm, 320, (f) => onProgress?.(renderShare + f * (1 - renderShare), 'encode'));
  const blob = new Blob([encodeWav(pcm, format === 'wav24' ? 24 : 16)], { type: 'audio/wav' });
  onProgress?.(1, 'encode');
  return blob;
}
