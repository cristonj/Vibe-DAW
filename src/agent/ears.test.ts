import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../model/project';
import { base64ToArrayBuffer } from '../engine/wav';
const mocks = vi.hoisted(() => ({
  render: vi.fn(), generate: vi.fn(), review: vi.fn(),
  settings: { listeningQuality: 'full', listeningChannels: 'stereo' },
}));
vi.mock('../engine/api', () => ({ renderProject: mocks.render }));
vi.mock('./llm', () => ({ generateText: mocks.generate }));
vi.mock('./audioReviews', () => ({ registerAudioReview: mocks.review, useAudioReviews: { getState: () => ({ reviews: new Map() }) } }));
vi.mock('../state/settings', () => ({ useSettings: { getState: () => mocks.settings } }));
import { listen } from './ears';

beforeEach(() => {
  mocks.generate.mockReset().mockResolvedValue('Keep the bass in tune.');
  mocks.review.mockReset().mockReturnValue('audio-review');
  mocks.render.mockReset().mockResolvedValue({ sampleRate: 44100, channels: [new Float32Array(4410).fill(0.1), new Float32Array(4410).fill(-0.05)] });
  mocks.settings.listeningQuality = 'full'; mocks.settings.listeningChannels = 'stereo';
});

describe('ears audio parity', () => {
  it('gives the review player the exact bytes sent to the model, outside its durable context', async () => {
    const result = await listen({ project: createProject(), startBar: 1, endBar: 2 });
    const request = mocks.generate.mock.calls[0][0];
    const sent = base64ToArrayBuffer(request.contents[0].parts[0].inlineData.data);
    expect(mocks.review.mock.calls[0][0]).toEqual(sent);
    expect(new DataView(sent).getUint16(22, true)).toBe(2);
    expect(new DataView(sent).getUint32(24, true)).toBe(44100);
    expect(result.reviewId).toBe('audio-review');
    expect(JSON.stringify(result)).not.toContain('inlineData');
  });
  it('honors compact mono and tells the critic that stereo cannot be evaluated', async () => {
    mocks.settings.listeningQuality = 'compact'; mocks.settings.listeningChannels = 'mono';
    await listen({ project: createProject() });
    const request = mocks.generate.mock.calls[0][0];
    const sent = new DataView(base64ToArrayBuffer(request.contents[0].parts[0].inlineData.data));
    expect(sent.getUint16(22, true)).toBe(1);
    expect(sent.getUint32(24, true)).toBe(16000);
    expect(JSON.stringify(request)).toContain('do not judge stereo');
  });
});
