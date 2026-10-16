import * as Tone from 'tone';
import type { Project } from '../model/types';
import { beatsToSeconds, projectLength } from '../model/project';
import { EngineGraph, preloadProject } from './graph';
import { contextLock } from './lock';
import { audioBufferToPcm, encodeWav, type PcmData } from './wav';
import type { ExportFormat } from './exportFormats';

// Offline bounce. Used for exports and — more importantly — for the agent's ears:
// it renders exactly what the user would hear and hands it to Gemini.
//
// Tone normally runs the whole transport before rendering, which creates every
// note's audio nodes up front; long songs then drag thousands of idle nodes through
// every block. Instead we render in windows: the native OfflineAudioContext suspends
// each second, we advance Tone's clock one window ahead, and finished voices get
// cleaned up as we go.

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
}

const WINDOW_SEC = 1;
const AHEAD_SEC = 0.25;

interface OfflineInternals {
  _currentTime: number;
  emit(event: 'tick'): void;
}

export async function renderProject(project: Project, opts: RenderOptions = {}): Promise<PcmData> {
  const start = Math.max(0, opts.startBeat ?? 0);
  const end = Math.max(start + 0.25, opts.endBeat ?? projectLength(project));
  const tail = opts.tail ?? 1.5;
  const duration = beatsToSeconds(project, end - start) + tail;
  const sampleRate = opts.sampleRate ?? 44100;
  // Render a loop-free copy: bounces always run straight through.
  const p: Project = { ...project, loop: { ...project.loop, enabled: false } };
  const assets = await preloadProject(p);

  const raw = await contextLock.run(async () => {
    const previous = Tone.getContext();
    // Hand Tone a native OfflineAudioContext. Tone's default wrapper builds offline
    // nodes only when rendering starts, so voices created in later windows would be
    // silent; native nodes join the graph immediately.
    const nativeCtx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const ctx = new Tone.OfflineContext(nativeCtx as never);
    Tone.setContext(ctx);
    try {
      const graph = new EngineGraph({ live: false, onlyTracks: opts.onlyTracks ?? null });
      await graph.sync(p, assets);
      ctx.transport.start(0, beatsToSeconds(p, start));
      ctx.transport.stop(beatsToSeconds(p, end - start) + tail);

      const clock = ctx as unknown as OfflineInternals;
      const block = 128 / sampleRate;
      const advance = (to: number) => {
        const limit = Math.min(to, duration);
        while (clock._currentTime < limit) {
          clock.emit('tick');
          clock._currentTime += block;
        }
      };
      const native = nativeCtx;
      let failure: unknown = null;
      if (native && typeof native.suspend === 'function') {
        advance(WINDOW_SEC + AHEAD_SEC);
        for (let t = WINDOW_SEC; t < duration - block; t += WINDOW_SEC) {
          const at = Math.round((t * sampleRate) / 128) * 128 / sampleRate;
          native.suspend(at).then(() => {
            // Always resume, even if a scheduled callback throws — otherwise the bounce hangs.
            try {
              if (!failure) advance(at + WINDOW_SEC + AHEAD_SEC);
            } catch (e) {
              failure = e;
            }
            opts.onProgress?.(at / duration);
            return native.resume();
          }, () => { /* suspend time already passed; nothing to do */ });
        }
      } else {
        advance(duration); // no suspend support: fall back to Tone's all-at-once behavior
      }
      const rendered = await nativeCtx.startRendering();
      if (failure) throw failure;
      opts.onProgress?.(1);
      graph.dispose();
      return rendered as unknown as AudioBuffer;
    } finally {
      Tone.setContext(previous);
    }
  });
  return audioBufferToPcm(raw);
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
