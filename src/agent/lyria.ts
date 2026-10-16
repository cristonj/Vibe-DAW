import { useSettings, effectiveApiKey } from '../state/settings';
import { getGenAI } from './llm';
import { getFirebaseApp } from '../cloud/firebase';
import { base64ToArrayBuffer, audioBufferToPcm, slicePcm, applyEdgeFades, pcmToAudioBuffer } from '../engine/wav';
import { decodeAudio, addSample } from '../samples/library';
import { estimateTempo, firstOnset, estimateKey } from '../samples/analysis';
import type { SampleMeta } from '../model/types';

// Lyria 3 Clip generates 30 s of music from a prompt. We turn that into a usable,
// bar-aligned loop: find the downbeat, measure the tempo, trim to whole bars.

export const LYRIA_MODEL = 'lyria-3-clip-preview';

async function generateRaw(prompt: string, signal?: AbortSignal): Promise<{ data: ArrayBuffer; mime: string }> {
  const useDirect = useSettings.getState().connection === 'apikey' || !!effectiveApiKey();
  if (useDirect && effectiveApiKey()) {
    const ai = await getGenAI();
    const interaction = (await ai.interactions.create(
      { model: LYRIA_MODEL, input: prompt } as never,
      { fetchOptions: { signal } } as never,
    )) as unknown as {
      output_audio?: { data?: string; mime_type?: string };
      steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }>;
    };
    let audio = interaction.output_audio;
    if (!audio?.data) {
      for (const step of interaction.steps ?? []) for (const c of step.content ?? []) if (c.type === 'audio' && c.data) audio = c;
    }
    if (!audio?.data) throw new Error('Lyria returned no audio. Try rephrasing the prompt (no artist names or lyrics).');
    return { data: base64ToArrayBuffer(audio.data), mime: audio.mime_type ?? 'audio/mpeg' };
  }
  // Production path: a Cloud Function holds the key and enforces per-user quotas.
  const app = await getFirebaseApp();
  if (!app) throw new Error('Audio generation needs a Gemini API key (Settings) or the Firebase backend.');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const fn = httpsCallable<{ prompt: string }, { data: string; mime: string }>(getFunctions(app), 'generateMusic', { timeout: 120_000 });
  const res = await fn({ prompt });
  return { data: base64ToArrayBuffer(res.data.data), mime: res.data.mime };
}

export interface LoopRequest {
  prompt: string;
  bpm: number;
  key?: string;
  bars: number;
  beatsPerBar?: number;
  category?: string;
  name?: string;
  signal?: AbortSignal;
}

/** Build a Lyria prompt that steers toward a clean, loopable, instrumental part. */
export function lyriaPrompt(r: LoopRequest): string {
  return [
    r.prompt.trim().replace(/\.$/, ''),
    `${Math.round(r.bpm)} BPM`,
    r.key ? `in ${r.key}` : '',
    'Instrumental only, no vocals. Steady tempo from the first beat, no intro or fade-in, consistent loopable phrase, dry mix with no drums unless asked for.',
  ].filter(Boolean).join('. ');
}

export async function generateLoop(r: LoopRequest): Promise<{ meta: SampleMeta; detectedBpm?: number; note: string }> {
  const raw = await generateRaw(lyriaPrompt(r), r.signal);
  const decoded = await decodeAudio(raw.data);
  const pcm = audioBufferToPcm(decoded);
  const bpb = r.beatsPerBar ?? 4;
  // Measure what Lyria actually played.
  const tempo = estimateTempo(pcm);
  let bpm = r.bpm;
  let note = '';
  if (tempo) {
    // Pick whichever of detected / half / double is closest to what we asked for.
    const candidates = [tempo.bpm, ...tempo.alternatives];
    const best = candidates.reduce((a, b) => (Math.abs(b - r.bpm) < Math.abs(a - r.bpm) ? b : a));
    if (Math.abs(best - r.bpm) / r.bpm < 0.06) bpm = best;
    else note = `Detected ~${tempo.bpm} BPM, not ${r.bpm}; it's tagged with the requested tempo — check the groove by listening.`;
  }
  const start = firstOnset(pcm);
  const barSec = (60 / bpm) * bpb;
  const available = decoded.duration - start;
  const bars = Math.max(1, Math.min(r.bars, Math.floor(available / barSec)));
  const sliced = applyEdgeFades(slicePcm(pcm, start, start + bars * barSec), 0.003);
  const key = estimateKey(sliced);
  const buffer = pcmToAudioBuffer(sliced);
  const meta = await addSample(
    {
      name: r.name ?? r.prompt.slice(0, 42),
      category: r.category ?? 'loop',
      kind: 'loop',
      tags: ['lyria', 'generated', ...r.prompt.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 8)],
      source: 'generated',
      prompt: r.prompt,
      bpm, // the loop is cut to exactly `bars` bars at this tempo, so warp maps it cleanly
      key: r.key ?? (key && key.confidence > 0.5 ? key.key : undefined),
      skipAnalysis: true,
    },
    buffer,
  );
  if (bars < r.bars) note += ` Only ${bars} clean bars were usable.`;
  return { meta, detectedBpm: tempo?.bpm, note: note.trim() };
}
