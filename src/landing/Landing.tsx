import { useEffect, useState, type AnimationEvent, type PointerEvent } from 'react';
import { Wordmark } from '../brand/Wordmark';
import { donationWallets } from './donations';
import './landing.css';

const REPO = 'https://github.com/cristonj/Vibe-DAW';

// Crops of the real studio from scripts/capture-landing-screenshots.mjs (npm run screenshots).
const SHOTS = {
  studio: { src: '/screenshots/studio.webp', width: 2880, height: 1800 },
  producer: { src: '/screenshots/producer.webp', width: 784, height: 1660 },
  inlineEdit: { src: '/screenshots/inline-edit.webp', width: 1124, height: 806 },
  pianoRoll: { src: '/screenshots/piano-roll.webp', width: 2060, height: 538 },
  drums: { src: '/screenshots/drums.webp', width: 2088, height: 332 },
  mixer: { src: '/screenshots/mixer.webp', width: 1220, height: 850 },
};

function Shot({ shot, alt, eager = false, className = '' }: { shot: typeof SHOTS[keyof typeof SHOTS]; alt: string; eager?: boolean; className?: string }) {
  return <img className={className} src={shot.src} width={shot.width / 2} height={shot.height / 2} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchPriority: 'high' as const } : {})} />;
}

/** A scannable payment link, drawn as one path of dark modules. The encoder loads on first use. */
function Qr({ uri, name }: { uri: string; name: string }) {
  const [code, setCode] = useState<{ size: number; d: string } | 'error' | null>(null);
  useEffect(() => {
    let live = true;
    import('uqr').then(({ encode }) => {
      const { data, size } = encode(uri, { ecc: 'M', border: 0 });
      let d = '';
      data.forEach((row, y) => {
        for (let x = 0; x < size; x++) {
          if (!row[x]) continue;
          let run = 1;
          while (row[x + run]) run++;
          d += `M${x} ${y}h${run}v1h${-run}z`;
          x += run;
        }
      });
      if (live) setCode({ size, d });
    }, () => { if (live) setCode('error'); });
    return () => { live = false; };
  }, [uri]);
  if (code === 'error') return <p className="lp-qr-note">The QR code could not load. Copy the address instead.</p>;
  return <figure className="lp-qr">
    {/* Four modules of quiet zone, as scanners expect. */}
    {code ? <svg viewBox={`-4 -4 ${code.size + 8} ${code.size + 8}`} role="img" aria-label={`QR code for the ${name} address`} shapeRendering="crispEdges"><path d={code.d} /></svg> : <div className="lp-qr-wait" />}
    <figcaption>Scan with your {name} wallet app.</figcaption>
  </figure>;
}

/** Unfolds when opened and folds away when closed, then leaves the page. */
function QrPanel({ open, id, uri, name }: { open: boolean; id: string; uri: string; name: string }) {
  const [shown, setShown] = useState(open);
  useEffect(() => { if (open) setShown(true); }, [open]);
  if (!shown) return null;
  return <div className={`lp-qr-panel${open ? '' : ' closing'}`} id={id} aria-hidden={!open || undefined} onAnimationEnd={(e) => { if (!open && e.target === e.currentTarget) setShown(false); }}>
    <div><Qr uri={uri} name={name} /></div>
  </div>;
}

function Support() {
  const [copied, setCopied] = useState('');
  const [status, setStatus] = useState('');
  const [qr, setQr] = useState('');
  const copy = async (address: string) => {
    try { await navigator.clipboard.writeText(address); setCopied(address); setStatus('Address copied'); }
    catch { setStatus('Copy is unavailable. Select the address to copy it manually.'); }
  };
  if (!donationWallets.length) return <p className="lp-support-line">Vibe is free. If it helps you make music, a star or a pull request on <a href={REPO} target="_blank" rel="noreferrer">GitHub</a> helps keep it going.</p>;
  return <div className="lp-wallets">
    <p className="lp-support-line">Vibe is free. If it helps you make music, you can help keep it going. Donations are optional. Send each coin only on its own network.</p>
    {donationWallets.map((wallet) => {
      const open = qr === wallet.name, panel = `qr-${wallet.name.toLowerCase()}`;
      return <div className="lp-wallet" key={wallet.name}>
        <span>{wallet.name}<small>{wallet.symbol}{wallet.network === wallet.name ? '' : ` · ${wallet.network}`}</small></span>
        <code>{wallet.address}</code>
        <button onClick={() => void copy(wallet.address)} aria-label={`Copy ${wallet.name} address`}>{copied === wallet.address ? 'Copied' : 'Copy'}</button>
        <button onClick={() => setQr(open ? '' : wallet.name)} aria-expanded={open} aria-controls={panel} aria-label={`${open ? 'Hide' : 'Show'} ${wallet.name} QR code`}>{open ? 'Hide QR' : 'Show QR'}</button>
        <QrPanel open={open} id={panel} uri={`${wallet.scheme}${wallet.address}${wallet.suffix ?? ''}`} name={wallet.name} />
      </div>;
    })}
    <span className="lp-status" role="status">{status}</span>
  </div>;
}

function Arrow() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" /></svg>;
}

/** Things people ask the Producer, for the ticker. */
const PROMPTS = [
  ['sad trap beat with guitar', 'add hi-hat rolls', 'walk the bass up into the hook', 'lo-fi study beat at 82 BPM', 'give the hook a breathy flute', 'make the drums hit harder', 'leave room for a vocal'],
  ['turn this into a delicate arpeggio', 'add a riser before the drop', 'make it sadder', 'house groove, four on the floor', 'tighten the low end', 'answer the melody an octave up', 'what is muddy in this mix?'],
];

function Ticker() {
  return <section className="lp-ticker" aria-label="Things you can ask the Producer">
    {PROMPTS.map((row, k) => <div key={k} className="lp-ticker-row">
      {/* Two copies, so the row can loop seamlessly. The second is for the eye only. */}
      {[0, 1].map((copy) => <ul key={copy} aria-hidden={copy === 1 || undefined}>{row.map((p) => <li key={p}>{p}</li>)}</ul>)}
    </div>)}
  </section>;
}

/** Bounce the letter under the pointer. A class rather than :hover, so it finishes the bounce. */
const bop = (e: PointerEvent) => (e.target as Element).closest('.vibe-letter')?.classList.add('bop');
const unbop = (e: AnimationEvent) => { if (e.animationName === 'lp-bop') (e.target as Element).classList.remove('bop'); };

export function Landing() {
  return <div className="landing">
    <main>
      <section className="lp-hero lp-wrap">
        <div className="lp-aurora" aria-hidden><i /><i /><i /></div>
        <div className="lp-wordmark-wrap" onPointerOver={bop} onAnimationEnd={unbop}><Wordmark className="lp-wordmark" glow flow={12} /></div>
        <h1>The open source agentic DAW built to <mark>enhance, not replace,</mark> human creativity.</h1>
        <div className="lp-hero-actions"><a className="lp-btn lp-cta" href="/studio"><span>Open the studio</span><Arrow /></a><a className="lp-support-link" href="#support">Support the project</a></div>
        <figure className="lp-hero-shot">
          <div className="lp-frame lp-bleed"><Shot eager shot={SHOTS.studio} alt="The Vibe studio: five tracks on the timeline with a new flute part outlined in the agent's gradient, the Producer's run and its Changes to review card on the right, and the mixer below." /></div>
        </figure>
      </section>

      <Ticker />

      <section className="lp-split lp-wrap lp-reveal">
        <div className="lp-copy">
          <h2>Describe it. The Producer builds it.</h2>
          <p>Ask in plain words for a beat, a part, or a fix. The Producer picks real instruments, writes the notes, sets up the mix, then listens to the result before it answers.</p>
          <ul className="lp-facts">
            <li>Every change is listed. Keep it, or undo the whole run in one click.</li>
            <li>Ask mode reviews your mix without touching it.</li>
            <li>Attach a reference track and it pulls out the production recipe.</li>
          </ul>
        </div>
        <figure className="lp-frame lp-producer"><Shot shot={SHOTS.producer} alt="The Producer panel: a request for a breathy flute melody, the tools it used, its mix review, its reply, and the Changes to review card with Undo all and Keep." /></figure>
      </section>

      <section className="lp-band lp-reveal">
        <div className="lp-split lp-wrap reverse">
          <figure className="lp-frame"><Shot shot={SHOTS.inlineEdit} alt="Four bars of bass and pad selected across two tracks with the inline edit box open: Walk the bass up into the hook." /></figure>
          <div className="lp-copy">
            <h2>Select. Press <kbd>Ctrl</kbd><kbd>K</kbd>. Say what to change.</h2>
            <p>Select notes or drag across tracks. The agent gets the exact notes and timing and rewrites only your selection, so the rest of the song stays as it was. On touchscreens, use Range and Edit selection.</p>
          </div>
        </div>
      </section>

      <section className="lp-daw lp-wrap">
        <div className="lp-daw-head lp-reveal">
          <h2>A full DAW, not a demo.</h2>
          <p>Arrangement, piano roll, step sequencer and mixer. 31 instruments and 16 effects, plus any effect the agent writes for you in code. Record audio, freeze tracks, export WAV or MP3. You and the agent edit the same session, so you can take over at any point.</p>
        </div>
        <div className="lp-grid">
          <figure className="lp-frame wide lp-reveal"><Shot shot={SHOTS.pianoRoll} alt="The piano roll showing the flute melody with note velocities." /><figcaption>Piano roll</figcaption></figure>
          <figure className="lp-frame wide lp-reveal"><Shot shot={SHOTS.drums} alt="The step sequencer with kick, snare, hat, rim and shaker lanes." /><figcaption>Step sequencer</figcaption></figure>
          <figure className="lp-frame lp-mixer lp-reveal"><Shot shot={SHOTS.mixer} alt="The mixer with a channel strip for each track and the master bus." /><figcaption>Mixer</figcaption></figure>
          <div className="lp-promise lp-reveal">
            <h3>No AI-generated audio.</h3>
            <p>Every sound is a sampled instrument, a synth, or your own recording. The agent writes and arranges notes; it never renders a song from a prompt. What you make is yours.</p>
          </div>
        </div>
      </section>

      <section className="lp-end lp-wrap" id="support">
        <h2>Free and open source.</h2>
        <p>MIT licensed. Runs in your browser with no install and no account. Every music tool works without AI. The Producer uses your own Gemini key, which has a free tier.</p>
        <div className="lp-actions"><a className="lp-btn lp-cta" href="/studio"><span>Open the studio</span><Arrow /></a><a className="lp-btn ghost" href={REPO} target="_blank" rel="noreferrer">Star it on GitHub</a></div>
        <Support />
      </section>
    </main>
  </div>;
}
