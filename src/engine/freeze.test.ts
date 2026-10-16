import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMidiClip, createProject, createTrack } from '../model/project';
import type { Project } from '../model/types';
import type { RenderOptions } from './render';
import type { PcmData } from './wav';

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./render', () => ({ renderProject: render }));

let freeze: typeof import('./freeze');
let jobs: Array<{ project: Project; opts: RenderOptions; resolve(pcm: PcmData): void; reject(error: Error): void; settled?: boolean }>;
const changed = vi.fn();
const pcm = (sampleRate = 48000): PcmData => ({ sampleRate, channels: [new Float32Array([0.25, -0.25]), new Float32Array([0.5, -0.5])] });

function fixture(lengths: number[]) {
  const p = createProject();
  for (const length of lengths) {
    const t = createTrack(p, 'instrument', { preset: 'sub_bass' });
    t.clips.push(createMidiClip(p, 8, length));
    p.tracks.push(t);
  }
  return p;
}

async function finish(index: number, error?: Error) {
  const job = jobs[index];
  job.settled = true;
  if (error) job.reject(error);
  else job.resolve(pcm(job.opts.sampleRate));
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { hardwareConcurrency: 3 });
  vi.stubGlobal('AudioBuffer', class {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    private channels: Float32Array[];
    constructor(opts: AudioBufferOptions) {
      this.length = opts.length;
      this.numberOfChannels = opts.numberOfChannels ?? 1;
      this.sampleRate = opts.sampleRate;
      this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
    }
    copyToChannel(data: Float32Array, channel: number) { this.channels[channel].set(data); }
    getChannelData(channel: number) { return this.channels[channel]; }
  });
  jobs = [];
  render.mockImplementation((project: Project, opts: RenderOptions) => new Promise<PcmData>((resolve, reject) => {
    jobs.push({ project, opts, resolve, reject });
  }));
  freeze = await import('./freeze');
  freeze.configureFreeze(48000, changed);
});

afterEach(async () => {
  vi.clearAllTimers();
  for (let i = 0; i < jobs.length; i++) if (!jobs[i].settled) await finish(i);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('background freezing', () => {
  it('overlaps bounded renders, starts longest tracks first, and fills freed slots without duplicates', async () => {
    const p = fixture([4, 32, 8, 16, 2]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs.map((j) => j.opts.onlyTracks)).toEqual([[p.tracks[1].id], [p.tracks[3].id]]);
    await finish(0);
    expect(jobs).toHaveLength(3);
    expect(jobs[2].opts.onlyTracks).toEqual([p.tracks[2].id]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(3);
    for (let i = 1; i < jobs.length; i++) await finish(i);
    expect(jobs).toHaveLength(5);
    expect(new Set(jobs.map((j) => j.opts.onlyTracks![0])).size).toBe(5);
    for (const t of p.tracks) {
      const f = freeze.frozenFor(p, t)!;
      expect(f.startBeat).toBe(8);
      expect(f.buffer.getChannelData(0)).toEqual(pcm().channels[0]);
    }
    expect(changed).toHaveBeenCalledTimes(5);
  });

  it.each([[1, 1], [2, 1], [16, 4]])('uses %i cores with at most %i active renders', async (cores, active) => {
    vi.stubGlobal('navigator', { hardwareConcurrency: cores });
    freeze.scheduleFreeze(fixture([4, 4, 4, 4, 4]));
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(active);
  });

  it('does not let mixer or UI edits postpone freezing and keeps mixer controls live', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(800);
    const next = { ...p, tracks: p.tracks.map((t) => ({ ...t, volumeDb: -24, pan: 0.7, mute: true, solo: true, name: 'Renamed', color: '#fff' })) };
    freeze.scheduleFreeze(next);
    await vi.advanceTimersByTimeAsync(400);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].project.tracks[0]).toMatchObject({ volumeDb: 0, pan: 0, mute: false, solo: false });
    expect(jobs[0].opts).toMatchObject({ startBeat: 8, endBeat: 12, master: false, reuseFrozen: false });
    await finish(0);
    expect(freeze.frozenFor(next, next.tracks[0])).not.toBeNull();
    freeze.scheduleFreeze(next);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(1);
  });

  it('debounces sound edits before starting work', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(800);
    const next = { ...p, bpm: p.bpm + 10 };
    freeze.scheduleFreeze(next);
    await vi.advanceTimersByTimeAsync(1199);
    expect(jobs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(jobs[0].project.bpm).toBe(next.bpm);
  });

  it('discards an edited in-flight render and freezes the latest sound', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    const next = { ...p, bpm: p.bpm + 10 };
    freeze.scheduleFreeze(next);
    await finish(0);
    expect(freeze.frozenFor(next, next.tracks[0])).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(2);
    expect(jobs[1].project.bpm).toBe(next.bpm);
    await finish(1);
    expect(freeze.frozenFor(next, next.tracks[0])).not.toBeNull();
  });

  it('rejects old renders even when switching away and back to the same project', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    freeze.scheduleFreeze({ ...p, id: 'other' });
    freeze.scheduleFreeze(p);
    await finish(0);
    expect(changed).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(2);
    await finish(1);
    expect(freeze.frozenFor(p, p.tracks[0])).not.toBeNull();
  });

  it('does not install audio rendered at an obsolete sample rate', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    freeze.configureFreeze(44100, changed);
    freeze.scheduleFreeze(p);
    await finish(0);
    expect(changed).not.toHaveBeenCalled();
    expect(jobs[1].opts.sampleRate).toBe(44100);
    await finish(1);
    expect(freeze.frozenFor(p, p.tracks[0])?.buffer.sampleRate).toBe(44100);
  });

  it('reports the playback rate that exports should render at', () => {
    freeze.configureFreeze(44100, changed);
    expect(freeze.playbackSampleRate()).toBe(44100);
    freeze.configureFreeze(48000, changed);
    expect(freeze.playbackSampleRate()).toBe(48000);
  });

  it('isolates failures and retries only after the failed sound changes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fixture([8, 4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    await finish(0, new Error('render failed'));
    await finish(1);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(2);
    expect(freeze.frozenFor(p, p.tracks[1])).not.toBeNull();
    freeze.scheduleFreeze({ ...p, bpm: p.bpm + 10 });
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(4);
    vi.restoreAllMocks();
  });
});
