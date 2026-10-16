import type { Project } from '../model/types';
import { barToBeat, beatsPerBar, beatsToSeconds, projectLength } from '../model/project';
import { formatKey } from '../model/theory';
import { renderProject } from '../engine/api';
import { arrayBufferToBase64, audioBufferToPcm, encodeWav, slicePcm, toMono, type PcmData } from '../engine/wav';
import { describeStats, mixStats, estimatePitch, estimateTempo, estimateKey } from '../samples/analysis';
import { decodeAudio, getSampleMeta, loadBuffer, updateSampleMeta } from '../samples/library';
import { generateText } from './llm';

// The agent's ears. Gemini hears the actual rendered audio (not the MIDI), and we
// pair what it hears with objective measurements so feedback is grounded.

const LISTEN_RATE = 16000; // Gemini downsamples audio to ~16 kHz mono anyway
const MAX_LISTEN_SECONDS = 90;

function toWavBase64(pcm: PcmData, maxSeconds = MAX_LISTEN_SECONDS): string {
  const mono = toMono(pcm, LISTEN_RATE);
  const clipped = mono.channels[0].length > maxSeconds * LISTEN_RATE ? slicePcm(mono, 0, maxSeconds) : mono;
  return arrayBufferToBase64(encodeWav(clipped, 16));
}

const EARS_SYSTEM = `You are the ears of an AI music producer working inside a DAW. You will hear a rendered audio excerpt.
Listen closely and report what is actually audible — never guess from the description alone.
Be concrete and critical like a top mix engineer and A&R: name the instruments you hear, the vibe, groove, tuning/key clashes,
timing problems, low-end conflicts (kick vs 808), muddiness, harshness, masking, stereo image, levels, energy and arrangement.
Use bar numbers when pointing at moments (the user tells you which bar the excerpt starts on and the bar length in seconds).
Keep it under 180 words, as short bullet points. End with the 1-3 highest-impact fixes.`;

export interface ListenRequest {
  project: Project;
  startBar?: number;
  endBar?: number;
  trackIds?: string[] | null;
  question?: string;
  goal?: string;
  signal?: AbortSignal;
}

export interface ListenResult {
  heard: string;
  stats: string;
  seconds: number;
  startBar: number;
  endBar: number;
}

export async function listen(req: ListenRequest): Promise<ListenResult> {
  const p = req.project;
  const bpb = beatsPerBar(p);
  const lastBar = Math.ceil(projectLength(p) / bpb) + 1;
  const startBar = Math.max(1, Math.floor(req.startBar ?? 1));
  let endBar = Math.min(lastBar, Math.ceil(req.endBar ?? lastBar));
  const barSec = beatsToSeconds(p, bpb);
  if ((endBar - startBar) * barSec > MAX_LISTEN_SECONDS) endBar = startBar + Math.floor(MAX_LISTEN_SECONDS / barSec);
  if (endBar <= startBar) endBar = startBar + 1;

  const pcm = await renderProject(p, {
    startBeat: barToBeat(p, startBar),
    endBeat: barToBeat(p, endBar),
    onlyTracks: req.trackIds?.length ? req.trackIds : null,
    tail: 0.5,
    sampleRate: 22050, // Gemini hears ~16 kHz anyway; halves render time
  });
  const stats = mixStats(pcm);
  const trackNames = req.trackIds?.length
    ? p.tracks.filter((t) => req.trackIds!.includes(t.id)).map((t) => t.name).join(', ')
    : 'full mix';

  const prompt = [
    `Excerpt: bars ${startBar}–${endBar - 1} (${trackNames}). ${p.bpm} BPM, ${formatKey(p.key)}, ${p.timeSignature.join('/')}. One bar = ${barSec.toFixed(2)} s; 0:00 in the audio is the start of bar ${startBar}.`,
    req.goal ? `What the producer is going for: ${req.goal}` : '',
    `Measured: ${describeStats(stats)}.`,
    req.question ? `Question: ${req.question}` : 'Give your honest critique.',
  ].filter(Boolean).join('\n');

  const heard = await generateText({
    system: EARS_SYSTEM,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: toWavBase64(pcm) } }, { text: prompt }] }],
    thinking: 'LOW',
    signal: req.signal,
  });
  return { heard, stats: describeStats(stats), seconds: stats.durationSec, startBar, endBar };
}

const SAMPLE_SYSTEM = `You are auditioning a sample for a music producer. Listen and describe it in 2-4 short lines:
what it is (instrument/sound), character and texture, apparent pitch/key and tempo feel if any, genres it fits, and anything wrong (clicks, noise, off-tempo, clipped, fades).
Be literal about what you hear. No preamble.`;

export async function audition(sampleId: string, question?: string, signal?: AbortSignal): Promise<string> {
  const meta = getSampleMeta(sampleId);
  if (!meta) throw new Error(`No sample with id ${sampleId}`);
  if (!question && meta.aiDescription) return meta.aiDescription;
  const buf = await loadBuffer(sampleId);
  if (!buf) throw new Error(`Couldn't load audio for ${meta.name}`);
  const pcm = audioBufferToPcm(buf);
  const facts: string[] = [`Duration ${buf.duration.toFixed(2)} s`, `category "${meta.category}"`];
  if (meta.bpm) facts.push(`tagged ${meta.bpm} BPM`);
  if (meta.key) facts.push(`tagged key ${meta.key}`);
  if (meta.kind === 'loop' && !meta.bpm) {
    const t = estimateTempo(pcm);
    if (t) facts.push(`detected tempo ≈${t.bpm}`);
  }
  if (meta.kind === 'oneshot') {
    const pitch = estimatePitch(pcm);
    if (pitch) facts.push(`detected pitch ≈${pitch.note}`);
  } else {
    const k = estimateKey(pcm);
    if (k && k.confidence > 0.4) facts.push(`detected key ≈${k.key}`);
  }
  const text = await generateText({
    system: SAMPLE_SYSTEM,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: toWavBase64(pcm, 30) } }, { text: `Sample "${meta.name}". ${facts.join(', ')}.${question ? `\nQuestion: ${question}` : ''}` }] }],
    thinking: 'MINIMAL',
    signal,
  });
  if (!question) updateSampleMeta(sampleId, { aiDescription: text });
  return text;
}

/** Listen to arbitrary user-provided audio (a reference track) and extract a production brief. */
export async function analyzeReference(data: ArrayBuffer, name: string, signal?: AbortSignal): Promise<string> {
  const buf = await decodeAudio(data);
  const pcm = audioBufferToPcm(buf);
  const tempo = estimateTempo(pcm);
  const key = estimateKey(pcm);
  return generateText({
    system: 'You are a producer breaking down a reference track so another producer can make something in the same style (not a copy). Be specific.',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'audio/wav', data: toWavBase64(pcm, 75) } },
        { text: `Reference "${name}". Measured tempo ≈${tempo?.bpm ?? '?'} BPM (could be half/double), key ≈${key?.key ?? '?'}.\nBreak it down: tempo feel, key/mood, drum pattern (kick/snare/hat placement, rolls), bass/808 behavior, melodic instruments & processing, arrangement, mix character. Then give a recipe as bullet points.` },
      ],
    }],
    thinking: 'LOW',
    signal,
  });
}
