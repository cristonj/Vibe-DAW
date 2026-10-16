import { create } from 'zustand';

export interface AudioReview { id: string; label: string; url: string; bytes: number }
export const useAudioReviews = create<{ reviews: Map<string, AudioReview> }>(() => ({ reviews: new Map() }));
const LIMIT_BYTES = 64 * 1024 * 1024;
let sequence = 0;

/** Audio stays in bounded, local UI memory, outside chat and model context. */
export function registerAudioReview(data: ArrayBuffer, label: string): string {
  const id = `review-${++sequence}`;
  const reviews = new Map(useAudioReviews.getState().reviews);
  let used = [...reviews.values()].reduce((sum, r) => sum + r.bytes, 0);
  while (reviews.size && (used + data.byteLength > LIMIT_BYTES || reviews.size >= 24)) {
    const oldest = reviews.keys().next().value!;
    const previous = reviews.get(oldest)!;
    used -= previous.bytes;
    URL.revokeObjectURL(previous.url);
    reviews.delete(oldest);
  }
  reviews.set(id, { id, label, url: URL.createObjectURL(new Blob([data], { type: 'audio/wav' })), bytes: data.byteLength });
  useAudioReviews.setState({ reviews });
  return id;
}

export function clearAudioReviews() {
  for (const r of useAudioReviews.getState().reviews.values()) URL.revokeObjectURL(r.url);
  useAudioReviews.setState({ reviews: new Map() });
}
