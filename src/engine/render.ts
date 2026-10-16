import * as Tone from 'tone';
import type { Project } from '../model/types';
import { beatsToSeconds, projectLength } from '../model/project';
import { EngineGraph, preloadProject } from './graph';
import { contextLock } from './lock';
import { audioBufferToPcm, encodeWav, type PcmData } from './wav';

// Offline bounce. Used for exports and — more importantly — for the agent's ears:
// it renders exactly what the user would hear and hands it to Gemini.

export interface RenderOptions {
  startBeat?: number;
  endBeat?: number;
  /** Solo these tracks (ids). */
  onlyTracks?: string[] | null;
  /** Extra seconds after the end for reverb/release tails. */
  tail?: number;
  sampleRate?: number;
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

  const buffer = await contextLock.run(() =>
    Tone.Offline(async ({ transport }) => {
      const graph = new EngineGraph({ live: false, onlyTracks: opts.onlyTracks ?? null });
      await graph.sync(p, assets);
      transport.start(0, beatsToSeconds(p, start));
      transport.stop(beatsToSeconds(p, end - start) + tail);
    }, duration, 2, sampleRate),
  );
  const raw = buffer.get();
  if (!raw) throw new Error('Render produced no audio');
  return audioBufferToPcm(raw);
}

export async function exportWav(project: Project, opts: RenderOptions = {}): Promise<Blob> {
  const pcm = await renderProject(project, { tail: 2.5, ...opts });
  return new Blob([encodeWav(pcm, 24)], { type: 'audio/wav' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
