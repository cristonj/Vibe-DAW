import * as Tone from 'tone';
import { useDaw, useTransport, getProject } from '../state/store';
import { useSettings } from '../state/settings';
import { EngineGraph, preloadProject } from './graph';
import { contextLock } from './lock';
import { configureFreeze, scheduleFreeze } from './freeze';
import type { Project } from '../model/types';
import { renderSamplePreview } from './samplePreview';
import { pcmToAudioBuffer } from './wav';

// Live playback engine: one EngineGraph on the realtime AudioContext, kept in sync
// with the store. Everything here captures the realtime context/transport once,
// because offline renders temporarily swap Tone's global context.

let graph: EngineGraph | null = null;
let transport: ReturnType<typeof Tone.getTransport> | null = null;
let realtimeContext: Tone.Context | null = null;
let syncRunning = false;
let syncError: unknown = null;
let playRequest = 0;
let starting = false;
let previewRequest = 0;
let syncing: Promise<void> = Promise.resolve();
let pending: Project | null = null;
let raf = 0;
let previewSrc: Tone.Player | null = null;
let loadingListeners: Array<(loading: boolean) => void> = [];

export function onEngineLoading(fn: (loading: boolean) => void) {
  loadingListeners.push(fn);
  return () => { loadingListeners = loadingListeners.filter((f) => f !== fn); };
}

function setLoading(v: boolean) {
  loadingListeners.forEach((f) => f(v));
}

/** Create the graph (no audio yet — browsers need a gesture before the context runs). */
export function initEngine() {
  if (graph) return;
  // A larger output buffer ('playback') trades a few ms of latency for no dropouts
  // with heavy projects; a DAW's transport doesn't need game-level latency.
  const low = useSettings.getState().latency === 'low';
  realtimeContext = new Tone.Context({ latencyHint: low ? 'interactive' : 'playback', lookAhead: low ? 0.06 : 0.12 });
  Tone.setContext(realtimeContext, true);
  transport = Tone.getTransport();
  graph = new EngineGraph({ live: true });
  graph.setMetronome(useTransport.getState().metronome);
  configureFreeze(Tone.getContext().sampleRate, () => queueSync(getProject()));
  queueSync(getProject());
  useDaw.subscribe((s, prev) => {
    if (s.project !== prev.project) {
      if (s.project.id !== prev.project.id) stop(true);
      queueSync(s.project);
    }
  });
  useTransport.subscribe((s, prev) => {
    if (s.metronome !== prev.metronome) graph?.setMetronome(s.metronome);
  });
}

function queueSync(p: Project) {
  pending = p;
  if (syncRunning) return;
  syncRunning = true;
  syncing = Promise.resolve().then(async () => {
    setLoading(true);
    try {
      while (pending && graph) {
        const next = pending;
        pending = null;
        try {
          const assets = await preloadProject(next);
          if (pending) continue; // A newer edit superseded this load.
          await contextLock.run(() => graph!.sync(next, assets));
          syncError = null;
          scheduleFreeze(next);
        } catch (e) {
          syncError = e;
          console.error('Engine sync failed', e);
        }
      }
    } finally {
      syncRunning = false;
      setLoading(false);
    }
  });
}

/** Wait until the audio graph reflects the latest project. */
export async function engineSettled(): Promise<void> {
  let last: Promise<void> | null = null;
  while (last !== syncing) {
    last = syncing;
    await syncing;
  }
  if (syncError) throw syncError;
}

export async function ensureAudio() {
  // Offline rendering may currently own Tone's global context.
  if (realtimeContext?.state !== 'running') await realtimeContext?.resume();
}

export async function play(fromBeat?: number) {
  const request = ++playRequest;
  starting = true;
  try {
  await ensureAudio();
  await engineSettled();
  if (!transport || request !== playRequest) return;
  const t = transport;
  const at = Math.max(0, fromBeat ?? useTransport.getState().position);
  t.stop();
  graph?.panic();
  t.ticks = Math.round(at * t.PPQ);
  t.start('+0.05');
  useTransport.getState().setPlaying(true);
  startPlayheadLoop();
  } finally { if (request === playRequest) starting = false; }
}

export function stop(rewind = false) {
  ++playRequest;
  starting = false;
  transport?.stop();
  graph?.panic();
  useTransport.getState().setPlaying(false);
  cancelAnimationFrame(raf);
  if (rewind) {
    const loop = getProject().loop;
    useTransport.getState().setPosition(loop.enabled ? loop.start : 0);
  }
}

export function pause() {
  ++playRequest;
  starting = false;
  if (!transport) return;
  const pos = transport.ticks / transport.PPQ;
  transport.pause();
  graph?.panic();
  useTransport.getState().setPlaying(false);
  useTransport.getState().setPosition(pos);
  cancelAnimationFrame(raf);
}

export async function togglePlay() {
  if (starting || useTransport.getState().playing) pause();
  else await play();
}

export function seek(beat: number) {
  const b = Number.isFinite(beat) ? Math.max(0, beat) : 0;
  useTransport.getState().setPosition(b);
  if (transport && transport.state === 'started') {
    void play(b);
  }
}

function startPlayheadLoop() {
  cancelAnimationFrame(raf);
  const tick = () => {
    if (!transport || !useTransport.getState().playing) return;
    // Keep looping while we're playing: the transport starts slightly in the future,
    // so its state reads 'stopped' for the first frames.
    if (transport.state === 'started') useTransport.getState().setPosition(transport.ticks / transport.PPQ);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function previewNote(trackId: string, midi: number, velocity = 0.8) {
  void ensureAudio().then(engineSettled).then(() => graph?.previewNote(trackId, midi, velocity)).catch((e) => console.warn('Preview failed', e));
}

/** Audition a library sample through the master bus. */
export async function previewSample(sampleId: string) {
  stopPreview();
  const request = previewRequest;
  await ensureAudio();
  const { pcm } = await renderSamplePreview(getProject(), sampleId);
  if (request !== previewRequest) return;
  const buf = pcmToAudioBuffer(pcm);
  await contextLock.run(() => {
    if (request !== previewRequest || !realtimeContext) return;
    previewSrc = new Tone.Player({ context: realtimeContext, url: buf, volume: 0 });
    previewSrc.connect(realtimeContext.destination);
    const current = previewSrc;
    current.onstop = () => { if (previewSrc === current) previewSrc = null; current.dispose(); };
    current.start();
  });
}

export function stopPreview() {
  ++previewRequest;
  previewSrc?.stop();
  previewSrc?.dispose();
  previewSrc = null;
}

export function getMasterLevels(): number[] {
  return graph?.masterLevel() ?? [-Infinity, -Infinity];
}

export function getTrackLevel(trackId: string): number {
  return graph?.trackLevel(trackId) ?? -Infinity;
}

export function getSpectrum(): Float32Array | null {
  const v = graph?.analyser?.getValue();
  return v instanceof Float32Array ? v : null;
}
