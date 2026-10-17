import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { decode } = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock('../samples/library', () => ({ decodeAudio: decode }));

let load: typeof import('./multisamples').loadMultisample;
const buffer = {} as AudioBuffer;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  decode.mockReset().mockResolvedValue(buffer);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  load = (await import('./multisamples')).loadMultisample;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('instrument sample loading', () => {
  it('deduplicates and caches successful downloads', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
    vi.stubGlobal('fetch', fetcher);
    const first = load('organ');
    expect(load('organ')).toBe(first);
    const zones = await first;
    expect(Object.keys(zones)).toHaveLength(11);
    expect(await load('organ')).toBe(zones);
    expect(fetcher).toHaveBeenCalledTimes(11);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts stalled downloads, releases playback, and retries on the next load', async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((_url, options) => { signals.push(options.signal); return new Promise(() => {}); });
    vi.stubGlobal('fetch', fetcher);
    const failed = expect(load('organ')).rejects.toThrow("Couldn't download");
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
    expect(signals.every((s) => s.aborted)).toBe(true);
    fetcher.mockImplementation(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
    expect(Object.keys(await load('organ'))).toHaveLength(11);
    expect(fetcher).toHaveBeenCalledTimes(22);
  });

  it('keeps usable zones when another download stalls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/C1.mp3')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
      return new Promise(() => {});
    }));
    const loaded = load('organ');
    await vi.advanceTimersByTimeAsync(15000);
    expect(await loaded).toEqual({ C1: buffer });
  });

  it('bounds decoding as well as the network request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
    decode.mockImplementation(() => new Promise(() => {}));
    const failed = expect(load('organ')).rejects.toThrow("Couldn't download");
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
  });
});
