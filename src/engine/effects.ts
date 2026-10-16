import * as Tone from 'tone';
import type { Effect } from '../model/types';
import { defaultEffectParams } from '../model/catalog';

// Effect units. Each wraps one or more Tone nodes behind input/output so the
// channel strip can chain them, and supports live param updates without rebuilds.

export interface EffectUnit {
  input: Tone.ToneAudioNode;
  output: Tone.ToneAudioNode;
  update(params: Record<string, number | string>): void;
  /** Sidechain duck units get triggered by the scheduler. */
  duck?(time: number): void;
  ready: Promise<void>;
  dispose(): void;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)) ? Number(v) : d);

/** Changing these params means rebuilding the node, not just setting a value. */
export function structuralParams(e: Effect): string {
  if (e.type === 'delay') return `pp:${num(e.params.pingPong, 1) > 0.5}`;
  if (e.type === 'filter') return `mode:${e.params.mode}`;
  return '';
}

function single<T extends Tone.ToneAudioNode>(node: T, update: (p: Record<string, number | string>) => void, ready: Promise<void> = Promise.resolve(), extra: Array<{ dispose(): void }> = []): EffectUnit {
  return { input: node, output: node, update, ready, dispose: () => { node.dispose(); extra.forEach((x) => x.dispose()); } };
}

function tanhCurve(drive: number): Float32Array {
  const n = 2048;
  const k = 1 + drive * 8;
  const norm = Math.tanh(k);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

function crushCurve(bits: number): Float32Array {
  const n = 4096;
  const steps = Math.pow(2, Math.max(1, Math.min(16, Math.round(bits))));
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(x * (steps / 2)) / (steps / 2);
  }
  return c;
}

/** Wraps a dry/wet blend around an arbitrary insert. */
function wetDry(insert: { input: Tone.ToneAudioNode; output: Tone.ToneAudioNode }, wet: number) {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const dry = new Tone.Gain(1 - wet);
  const wetG = new Tone.Gain(wet);
  input.connect(dry);
  dry.connect(output);
  input.connect(insert.input);
  insert.output.connect(wetG);
  wetG.connect(output);
  return {
    input, output,
    setWet: (w: number) => { dry.gain.value = 1 - w; wetG.gain.value = w; },
    dispose: () => { input.dispose(); output.dispose(); dry.dispose(); wetG.dispose(); },
  };
}

export function createEffect(effect: Effect): EffectUnit {
  const p = { ...defaultEffectParams(effect.type), ...effect.params };
  switch (effect.type) {
    case 'eq': {
      const eq = new Tone.EQ3({ low: num(p.low, 0), mid: num(p.mid, 0), high: num(p.high, 0), lowFrequency: num(p.lowFrequency, 250), highFrequency: num(p.highFrequency, 3500) });
      return single(eq, (q) => {
        if (q.low !== undefined) eq.low.value = num(q.low, 0);
        if (q.mid !== undefined) eq.mid.value = num(q.mid, 0);
        if (q.high !== undefined) eq.high.value = num(q.high, 0);
        if (q.lowFrequency !== undefined) eq.lowFrequency.value = num(q.lowFrequency, 250);
        if (q.highFrequency !== undefined) eq.highFrequency.value = num(q.highFrequency, 3500);
      });
    }
    case 'filter': {
      const mode = (['lowpass', 'highpass', 'bandpass'].includes(String(p.mode)) ? p.mode : 'lowpass') as BiquadFilterType;
      const f = new Tone.Filter({ type: mode, frequency: num(p.frequency, 1200), Q: num(p.q, 1), rolloff: -24 });
      return single(f, (q) => {
        if (q.frequency !== undefined) f.frequency.rampTo(num(q.frequency, 1200), 0.02);
        if (q.q !== undefined) f.Q.value = num(q.q, 1);
      });
    }
    case 'compressor': {
      const c = new Tone.Compressor({ threshold: num(p.threshold, -18), ratio: num(p.ratio, 4), attack: num(p.attack, 0.01), release: num(p.release, 0.15) });
      const makeup = new Tone.Gain(Tone.dbToGain(num(p.makeup, 0)));
      c.connect(makeup);
      return {
        input: c, output: makeup, ready: Promise.resolve(),
        update: (q) => {
          if (q.threshold !== undefined) c.threshold.value = num(q.threshold, -18);
          if (q.ratio !== undefined) c.ratio.value = num(q.ratio, 4);
          if (q.attack !== undefined) c.attack.value = num(q.attack, 0.01);
          if (q.release !== undefined) c.release.value = num(q.release, 0.15);
          if (q.makeup !== undefined) makeup.gain.value = Tone.dbToGain(num(q.makeup, 0));
        },
        dispose: () => { c.dispose(); makeup.dispose(); },
      };
    }
    case 'reverb': {
      const r = new Tone.Reverb({ decay: num(p.decay, 2.5), preDelay: num(p.preDelay, 0.02), wet: num(p.wet, 0.3) });
      let lastDecay = num(p.decay, 2.5);
      return single(r, (q) => {
        if (q.wet !== undefined) r.wet.value = num(q.wet, 0.3);
        if (q.preDelay !== undefined) r.preDelay = num(q.preDelay, 0.02);
        if (q.decay !== undefined && num(q.decay, lastDecay) !== lastDecay) {
          lastDecay = num(q.decay, lastDecay);
          r.decay = lastDecay; // regenerates the impulse asynchronously
        }
      }, r.ready.then(() => undefined));
    }
    case 'delay': {
      const time = String(p.time || '8n.');
      const pp = num(p.pingPong, 1) > 0.5;
      const d = pp
        ? new Tone.PingPongDelay({ delayTime: time, feedback: num(p.feedback, 0.35), wet: num(p.wet, 0.25), maxDelay: 4 })
        : new Tone.FeedbackDelay({ delayTime: time, feedback: num(p.feedback, 0.35), wet: num(p.wet, 0.25), maxDelay: 4 });
      return single(d, (q) => {
        if (q.time !== undefined) d.delayTime.value = Tone.Time(String(q.time)).toSeconds();
        if (q.feedback !== undefined) d.feedback.value = num(q.feedback, 0.35);
        if (q.wet !== undefined) d.wet.value = num(q.wet, 0.25);
      });
    }
    case 'distortion': {
      const d = new Tone.Distortion({ distortion: num(p.amount, 0.4), oversample: '4x', wet: num(p.wet, 1) });
      const comp = new Tone.Gain(1 / (1 + num(p.amount, 0.4)));
      d.connect(comp);
      return {
        input: d, output: comp, ready: Promise.resolve(),
        update: (q) => {
          if (q.amount !== undefined) { d.distortion = num(q.amount, 0.4); comp.gain.value = 1 / (1 + num(q.amount, 0.4)); }
          if (q.wet !== undefined) d.wet.value = num(q.wet, 1);
        },
        dispose: () => { d.dispose(); comp.dispose(); },
      };
    }
    case 'saturation': {
      const ws = new Tone.WaveShaper(tanhCurve(num(p.drive, 0.3)), 2048);
      ws.oversample = '4x';
      const wd = wetDry({ input: ws, output: ws }, num(p.wet, 1));
      return {
        input: wd.input, output: wd.output, ready: Promise.resolve(),
        update: (q) => {
          if (q.drive !== undefined) ws.curve = tanhCurve(num(q.drive, 0.3));
          if (q.wet !== undefined) wd.setWet(num(q.wet, 1));
        },
        dispose: () => { ws.dispose(); wd.dispose(); },
      };
    }
    case 'bitcrusher': {
      const ws = new Tone.WaveShaper(crushCurve(num(p.bits, 8)), 4096);
      const wd = wetDry({ input: ws, output: ws }, num(p.wet, 0.5));
      return {
        input: wd.input, output: wd.output, ready: Promise.resolve(),
        update: (q) => {
          if (q.bits !== undefined) ws.curve = crushCurve(num(q.bits, 8));
          if (q.wet !== undefined) wd.setWet(num(q.wet, 0.5));
        },
        dispose: () => { ws.dispose(); wd.dispose(); },
      };
    }
    case 'chorus': {
      const c = new Tone.Chorus({ frequency: num(p.frequency, 1.5), delayTime: num(p.delayTime, 3.5), depth: num(p.depth, 0.6), wet: num(p.wet, 0.5), spread: 180 }).start();
      return single(c, (q) => {
        if (q.frequency !== undefined) c.frequency.value = num(q.frequency, 1.5);
        if (q.depth !== undefined) c.depth = num(q.depth, 0.6);
        if (q.delayTime !== undefined) c.delayTime = num(q.delayTime, 3.5);
        if (q.wet !== undefined) c.wet.value = num(q.wet, 0.5);
      });
    }
    case 'phaser': {
      const ph = new Tone.Phaser({ frequency: num(p.frequency, 0.5), octaves: num(p.octaves, 3), baseFrequency: 350, wet: num(p.wet, 0.5) });
      return single(ph, (q) => {
        if (q.frequency !== undefined) ph.frequency.value = num(q.frequency, 0.5);
        if (q.octaves !== undefined) ph.octaves = num(q.octaves, 3);
        if (q.wet !== undefined) ph.wet.value = num(q.wet, 0.5);
      });
    }
    case 'tremolo': {
      const t = new Tone.Tremolo({ frequency: num(p.frequency, 4), depth: num(p.depth, 0.5) }).start();
      return single(t, (q) => {
        if (q.frequency !== undefined) t.frequency.value = num(q.frequency, 4);
        if (q.depth !== undefined) t.depth.value = num(q.depth, 0.5);
      });
    }
    case 'widener': {
      // Ours: 0 = mono, 0.5 = unchanged, 1 = extra wide. Tone's 1 is pure side (phase-cancels in mono), so cap it.
      const toTone = (x: number) => (x <= 0.5 ? x : 0.5 + (x - 0.5) * 0.5);
      const w = new Tone.StereoWidener({ width: toTone(num(p.width, 0.7)) });
      return single(w, (q) => { if (q.width !== undefined) w.width.value = toTone(num(q.width, 0.7)); });
    }
    case 'lofi': {
      const input = new Tone.Gain(1);
      const wow = new Tone.Vibrato({ frequency: 0.55, depth: num(p.wow, 0.35) * 0.25, maxDelay: 0.01 });
      const flutter = new Tone.Vibrato({ frequency: 7, depth: num(p.wow, 0.35) * 0.04, maxDelay: 0.005 });
      const lp = new Tone.Filter({ type: 'lowpass', frequency: 2500 + num(p.tone, 0.45) * 9000, rolloff: -24 });
      const hp = new Tone.Filter({ type: 'highpass', frequency: 110, rolloff: -12 });
      const sat = new Tone.WaveShaper(tanhCurve(0.25), 2048);
      const noise = new Tone.Noise('pink').start();
      const noiseHp = new Tone.Filter({ type: 'highpass', frequency: 1800 });
      // Vinyl noise follows the music: an envelope follower on the input drives the
      // noise level, so there's no hiss/static when the track is silent or stopped.
      const noiseGain = new Tone.Gain(0);
      const follower = new Tone.Follower(0.08);
      const noiseAmount = new Tone.Multiply(num(p.noise, 0.15) * 0.12);
      input.connect(follower);
      follower.connect(noiseAmount);
      noiseAmount.connect(noiseGain.gain);
      const chainOut = new Tone.Gain(1);
      input.chain(wow, flutter, sat, hp, lp, chainOut);
      noise.chain(noiseHp, noiseGain, chainOut);
      const wd = wetDry({ input, output: chainOut }, num(p.wet, 1));
      return {
        input: wd.input, output: wd.output, ready: Promise.resolve(),
        update: (q) => {
          if (q.wow !== undefined) { wow.depth.value = num(q.wow, 0.35) * 0.25; flutter.depth.value = num(q.wow, 0.35) * 0.04; }
          if (q.tone !== undefined) lp.frequency.value = 2500 + num(q.tone, 0.45) * 9000;
          if (q.noise !== undefined) noiseAmount.factor.value = num(q.noise, 0.15) * 0.12;
          if (q.wet !== undefined) wd.setWet(num(q.wet, 1));
        },
        dispose: () => { [input, wow, flutter, lp, hp, sat, noise, noiseHp, noiseGain, follower, noiseAmount, chainOut].forEach((n) => n.dispose()); wd.dispose(); },
      };
    }
    case 'limiter': {
      // Tone.Limiter's default attack lets transients through; a zero-attack, hard-knee
      // compressor uses the browser's built-in lookahead and actually holds the ceiling.
      const l = new Tone.Compressor({ threshold: num(p.threshold, -1), ratio: 20, attack: 0, release: 0.25, knee: 0 }); // slow release: a fast one distorts bass
      return single(l, (q) => { if (q.threshold !== undefined) l.threshold.value = num(q.threshold, -1); });
    }
    case 'duck': {
      const g = new Tone.Gain(1);
      let depth = num(p.depth, 0.6);
      let release = num(p.release, 0.18);
      return {
        input: g, output: g, ready: Promise.resolve(),
        update: (q) => {
          if (q.depth !== undefined) depth = num(q.depth, 0.6);
          if (q.release !== undefined) release = num(q.release, 0.18);
        },
        duck: (time) => {
          g.gain.cancelScheduledValues(time);
          g.gain.setValueAtTime(g.gain.getValueAtTime(time), time);
          g.gain.linearRampToValueAtTime(1 - depth, time + 0.008);
          g.gain.exponentialRampToValueAtTime(1, time + 0.008 + release);
        },
        dispose: () => g.dispose(),
      };
    }
  }
}
