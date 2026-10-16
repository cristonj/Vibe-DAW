import { useAgent } from '../../src/agent/agent';
import { getProject } from '../../src/state/store';
import { registerAudioReview } from '../../src/agent/audioReviews';
import { encodeWav } from '../../src/engine/wav';

/** Local UI fixture; uses no provider, credentials or persisted project edits. */
export function showReviewFixture() {
  const wave = Float32Array.from({ length: 44100 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 220 * i / 44100));
  const id = registerAudioReview(encodeWav({ sampleRate: 44100, channels: [wave, wave] }), 'Mix · bars 1–2 · 44.1 kHz · stereo');
  useAgent.setState({ items: [
    { id: 'fixture-request', kind: 'user', text: 'Keep the melody, tighten the low end.', checkpoint: getProject() },
    { id: 'fixture-plan', kind: 'plan', steps: [{ title: 'Audition the chosen sounds', status: 'done' }, { title: 'Check the low end in context', status: 'active' }, { title: 'Review the finished arrangement', status: 'pending' }] },
    { id: 'fixture-review', kind: 'tool', name: 'listen', args: {}, status: 'done', summary: 'Listened to bars 1–2', heard: '- The bass is in tune and centered.\n- The guitar has room to breathe.\n- Shorten the kick tail slightly to give the bass more space.', audioReviewIds: [id] },
    ...Array.from({ length: 15 }, (_, i) => ({ id: `fixture-${i}`, kind: 'assistant' as const, text: `Checked section ${i + 1}. Keeping the melody and reviewing the balance.`, thinking: '', streaming: false })),
  ] });
}
