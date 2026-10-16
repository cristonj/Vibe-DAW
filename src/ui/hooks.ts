import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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

/**
 * The Interface size setting applies CSS zoom to #root. Pointer events and element rects
 * are in screen pixels, while the app lays itself out in its own (unzoomed) CSS pixels,
 * so divide screen distances by this before turning them into beats, pitches or positions.
 */
export function uiZoom(): number {
  const root = document.getElementById('root') as (HTMLElement & { currentCSSZoom?: number }) | null;
  if (!root) return 1;
  const z = root.currentCSSZoom ?? parseFloat(getComputedStyle(root).zoom);
  return z > 0 && isFinite(z) ? z : 1;
}

/** Layout breakpoints, kept in sync with the media queries in global.css. */
export const NARROW = '(max-width: 1024px)'; // side panels become drawers
export const PHONE = '(max-width: 640px)'; // compact top bar and timeline

export function matchesMedia(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== 'function') return () => {};
      const mq = matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => matchesMedia(query),
    () => false,
  );
}
