/// <reference lib="webworker" />
import { Mp3Encoder } from '@breezystack/lamejs';

// Float32 stereo PCM in, MP3 chunks out. Runs off the main thread.

interface Job { left: Float32Array; right: Float32Array; sampleRate: number; kbps: number }

function toInt16(src: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from);
  for (let i = from; i < to; i++) {
    const s = Math.max(-1, Math.min(1, src[i]));
    out[i - from] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = (e: MessageEvent<Job>) => {
  try {
    const { left, right, sampleRate, kbps } = e.data;
    const enc = new Mp3Encoder(2, sampleRate, kbps);
    const chunks: Uint8Array[] = [];
    const block = 1152 * 64;
    for (let i = 0; i < left.length; i += block) {
      const end = Math.min(left.length, i + block);
      const out = enc.encodeBuffer(toInt16(left, i, end), toInt16(right, i, end));
      if (out.length) chunks.push(new Uint8Array(out));
      self.postMessage({ progress: end / left.length });
    }
    const last = enc.flush();
    if (last.length) chunks.push(new Uint8Array(last));
    self.postMessage({ data: chunks });
  } catch (err) {
    self.postMessage({ error: (err as Error).message ?? String(err) });
  }
};
