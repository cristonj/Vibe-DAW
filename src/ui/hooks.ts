import { useEffect, useRef, useState } from 'react';
import { getLoadedBuffer, loadBuffer } from '../samples/library';
import { waveformPeaks } from '../samples/analysis';

/** Requests animation frames while mounted, calling `fn` each frame. */
export function useAnimationFrame(fn: () => void, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = () => { ref.current(); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

const peakCache = new Map<string, Float32Array>();

/** Waveform peaks for a sample (2048 buckets), loading the audio if needed. */
export function usePeaks(sampleId: string | undefined, reverse = false): Float32Array | null {
  const key = `${sampleId}|${reverse}`;
  const [peaks, setPeaks] = useState<Float32Array | null>(() => peakCache.get(key) ?? null);
  useEffect(() => {
    setPeaks(peakCache.get(key) ?? null);
    if (!sampleId) return;
    const cached = peakCache.get(key);
    if (cached) { setPeaks(cached); return; }
    let alive = true;
    (async () => {
      const buf = getLoadedBuffer(sampleId) ?? (await loadBuffer(sampleId));
      if (!buf || !alive) return;
      let p = waveformPeaks(buf, 2048);
      if (reverse) p = p.slice().reverse();
      peakCache.set(key, p);
      if (peakCache.size > 256) peakCache.delete(peakCache.keys().next().value!);
      setPeaks(p);
    })().catch((e) => console.warn('Waveform could not load', e));
    return () => { alive = false; };
  }, [sampleId, key, reverse]);
  return peaks;
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}
