// Time-stretch without changing pitch (WSOLA: waveform-similarity overlap-add).
// Runs once per (sample, ratio) and is cached, so stretched loops sound identical in
// playback and in bounces — and at full level, unlike granular playback.

const FRAME = 2048;
const HOP_OUT = FRAME / 2;
const TOLERANCE = 512;
const DECIMATE = 4;

const hann = (() => {
  const w = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  return w;
})();

/**
 * Stretch audio so it plays `speed` times faster (speed 1.25 → 80% as long).
 * Channels are aligned using a mono mix so the stereo image stays intact.
 */
export function wsola(channels: Float32Array[], speed: number): Float32Array[] {
  if (!channels.length || Math.abs(speed - 1) < 1e-4) return channels.map((c) => c.slice());
  const inLen = channels[0].length;
  const outLen = Math.max(1, Math.round(inLen / speed));
  const hopIn = HOP_OUT * speed;
  const mono = new Float32Array(inLen);
  for (const ch of channels) for (let i = 0; i < inLen; i++) mono[i] += ch[i] / channels.length;

  const out = channels.map(() => new Float32Array(outLen + FRAME));
  const norm = new Float32Array(outLen + FRAME);
  let prevPos = 0; // where the previous frame was taken from
  let outPos = 0;
  let frame = 0;
  while (outPos < outLen) {
    const ideal = Math.round(frame * hopIn);
    let pos = ideal;
    if (frame > 0) {
      // The audio that would naturally follow the previous frame:
      const natural = prevPos + HOP_OUT;
      let best = -Infinity;
      const lo = Math.max(0, ideal - TOLERANCE);
      const hi = Math.min(inLen - FRAME, ideal + TOLERANCE);
      for (let cand = lo; cand <= hi; cand += DECIMATE) {
        let c = 0;
        for (let k = 0; k < HOP_OUT; k += DECIMATE) {
          const a = natural + k < inLen ? mono[natural + k] : 0;
          c += a * mono[cand + k];
        }
        if (c > best) { best = c; pos = cand; }
      }
    }
    pos = Math.max(0, Math.min(Math.max(0, inLen - 1), pos));
    for (let k = 0; k < FRAME; k++) {
      const src = pos + k;
      if (src >= inLen) break;
      const w = hann[k];
      for (let c = 0; c < channels.length; c++) out[c][outPos + k] += channels[c][src] * w;
      norm[outPos + k] += w;
    }
    prevPos = pos;
    outPos += HOP_OUT;
    frame++;
  }
  return out.map((ch) => {
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) res[i] = norm[i] > 1e-3 ? ch[i] / norm[i] : ch[i];
    return res;
  });
}

const cache = new Map<string, AudioBuffer>();

/** Cached stretched copy of `buf` playing `speed`× faster at the same pitch. */
export function stretchedBuffer(key: string, buf: AudioBuffer, speed: number): AudioBuffer {
  const k = `${key}|${speed.toFixed(5)}`;
  let hit = cache.get(k);
  if (!hit) {
    const chans: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    const res = wsola(chans, speed);
    hit = new AudioBuffer({ length: res[0].length, numberOfChannels: res.length, sampleRate: buf.sampleRate });
    res.forEach((d, i) => hit!.copyToChannel(d as Float32Array<ArrayBuffer>, i));
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    cache.set(k, hit);
  }
  return hit;
}
