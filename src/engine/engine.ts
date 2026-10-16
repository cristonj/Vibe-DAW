import * as Tone from 'tone';
import { useDaw, useTransport, getProject } from '../state/store';
import { useSettings } from '../state/settings';
import { EngineGraph, preloadProject } from './graph';
import { contextLock } from './lock';
import { configureFreeze, scheduleFreeze } from './freeze';
import type { Project } from '../model/types';
import { getLoadedBuffer, loadBuffer } from '../samples/library';

// Live playback engine: one EngineGraph on the realtime AudioContext, kept in sync
// with the store. Everything here captures the realtime context/transport once,
// because offline renders temporarily swap Tone's global context.

let graph: EngineGraph | null = null;
let transport: ReturnType<typeof Tone.getTransport> | null = null;
let started = false;
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
  Tone.setContext(new Tone.Context({ latencyHint: low ? 'interactive' : 'playback', lookAhead: low ? 0.06 : 0.12 }), true);
  transport = Tone.getTransport();
  graph = new EngineGraph({ live: true });
  configureFreeze(Tone.getContext().sampleRate, () => queueSync(getProject()));
  queueSync(getProject());
  useDaw.subscribe((s, prev) => {
    if (s.project !== prev.project) queueSync(s.project);
  });
  useTransport.subscribe((s, prev) => {
    if (s.metronome !== prev.metronome) graph?.setMetronome(s.metronome);
  });
}

function queueSync(p: Project) {
  pending = p;
  syncing = syncing.then(async () => {
    const next = pending;
    pending = null;
    if (!next || !graph) return;
    setLoading(true);
    try {
      const assets = await preloadProject(next);
      await contextLock.run(() => graph!.sync(next, assets));
      scheduleFreeze(next);
    } catch (e) {
      console.error('Engine sync failed', e);
    } finally {
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
}

export async function ensureAudio() {
  if (!started) {
    await Tone.start();
    started = true;
  }
}

export async function play(fromBeat?: number) {
  await ensureAudio();
  await engineSettled();
  if (!transport) return;
  const t = transport;
  const at = fromBeat ?? useTransport.getState().position;
  if (t.state === 'started') t.stop();
  t.ticks = Math.round(at * t.PPQ);
  t.start('+0.05');
  useTransport.getState().setPlaying(true);
  startPlayheadLoop();
}

export function stop(rewind = false) {
  if (!transport) return;
  transport.stop();
  graph?.panic();
  useTransport.getState().setPlaying(false);
  cancelAnimationFrame(raf);
  if (rewind) {
    const loop = getProject().loop;
    useTransport.getState().setPosition(loop.enabled ? loop.start : 0);
  }
}

export function pause() {
  if (!transport) return;
  const pos = transport.ticks / transport.PPQ;
  transport.pause();
  graph?.panic();
  useTransport.getState().setPlaying(false);
  useTransport.getState().setPosition(pos);
  cancelAnimationFrame(raf);
}

export async function togglePlay() {
  if (useTransport.getState().playing) pause();
  else await play();
}

export function seek(beat: number) {
  const b = Math.max(0, beat);
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
  void ensureAudio().then(() => graph?.previewNote(trackId, midi, velocity));
}

/** Audition a library sample through the master bus. */
export async function previewSample(sampleId: string) {
  await ensureAudio();
  const buf = getLoadedBuffer(sampleId) ?? (await loadBuffer(sampleId));
  if (!buf) return;
  stopPreview();
  previewSrc = new Tone.Player({ url: buf, volume: -4 }).toDestination();
  previewSrc.start();
}

export function stopPreview() {
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
