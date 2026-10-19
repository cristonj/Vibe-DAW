import { useEffect, useState, type AnimationEvent, type PointerEvent } from 'react';
import { Wordmark } from '../brand/Wordmark';
import { donationWallets } from './donations';
import './landing.css';

const REPO = 'https://github.com/cristonj/Vibe-DAW';

// Crops of the real studio from scripts/capture-landing-screenshots.mjs (npm run screenshots).
const SHOTS = {
  arrangement: { src: '/screenshots/arrangement.webp', width: 2880, height: 878 },
  review: { src: '/screenshots/review.webp', width: 774, height: 236 },
  producer: { src: '/screenshots/producer.webp', width: 782, height: 1148 },
  inlineEdit: { src: '/screenshots/inline-edit.webp', width: 1124, height: 822 },
  pianoRoll: { src: '/screenshots/piano-roll.webp', width: 2880, height: 586 },
  drums: { src: '/screenshots/drums.webp', width: 2880, height: 332 },
  mixer: { src: '/screenshots/mixer.webp', width: 1236, height: 858 },
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

function Support() {
  const [copied, setCopied] = useState('');
  const [status, setStatus] = useState('');
  const [qr, setQr] = useState('');
  const copy = async (address: string) => {
    try { await navigator.clipboard.writeText(address); setCopied(address); setStatus('Address copied'); }
    catch { setStatus('Copy is unavailable. Select the address to copy it manually.'); }
  };
  if (!donationWallets.length) return <p className="lp-support-line">If Vibe helps you make something, a star or a pull request on <a href={REPO} target="_blank" rel="noreferrer">GitHub</a> helps it grow.</p>;
  return <div className="lp-wallets" id="support">
    <p className="lp-support-line">If Vibe helps you make something, you can help it grow. Donations are always optional. Use the network shown for each address.</p>
    {donationWallets.map((wallet) => {
      const open = qr === wallet.name, panel = `qr-${wallet.name.toLowerCase()}`;
      return <div className="lp-wallet" key={wallet.name}>
        <span>{wallet.name}<small>{wallet.network}</small></span>
        <code>{wallet.address}</code>
        <button onClick={() => void copy(wallet.address)} aria-label={`Copy ${wallet.name} address`}>{copied === wallet.address ? 'Copied' : 'Copy'}</button>
        <button onClick={() => setQr(open ? '' : wallet.name)} aria-expanded={open} aria-controls={panel} aria-label={`${open ? 'Hide' : 'Show'} ${wallet.name} QR code`}>{open ? 'Hide QR' : 'Show QR'}</button>
        {open && <div className="lp-qr-panel" id={panel}><Qr uri={`${wallet.scheme}${wallet.address}${wallet.suffix ?? ''}`} name={wallet.name} /></div>}
      </div>;
    })}
    <span className="lp-status" role="status">{status}</span>
  </div>;
}

/** Bounce the letter under the pointer. A class rather than :hover, so it finishes the bounce. */
const bop = (e: PointerEvent) => (e.target as Element).closest('.vibe-letter')?.classList.add('bop');
const unbop = (e: AnimationEvent) => { if (e.animationName === 'lp-bop') (e.target as Element).classList.remove('bop'); };

export function Landing() {
  return <div className="landing">
    <main>
      <section className="lp-hero lp-wrap">
        <div onPointerOver={bop} onAnimationEnd={unbop}><Wordmark className="lp-wordmark" /></div>
        <h1>The open source agentic DAW built to <mark>augment, not replace,</mark> human creativity.</h1>
        <div className="lp-actions lp-hero-actions"><a className="lp-btn" href="/studio">Open the studio</a><a className="lp-btn ghost" href={REPO} target="_blank" rel="noreferrer">View the code</a></div>
        <figure className="lp-hero-shot">
          <div className="lp-frame lp-bleed"><Shot eager shot={SHOTS.arrangement} alt="A Vibe arrangement: drums, Rhodes, bass and pad tracks across intro, verse and hook, lyric cues above, and a new flute part in lilac waiting for review." /></div>
          <Shot className="lp-float" shot={SHOTS.review} alt="The Changes to review card with Keep and Undo all buttons." />
        </figure>
      </section>

      <section className="lp-split lp-wrap">
        <div className="lp-copy">
          <h2>You ask for a part. It shows its work.</h2>
          <p>Describe what you want in plain words. The Producer plans it, auditions sounds, writes the notes, then bounces your song and listens before it answers. You get a summary of every change, with Keep and Undo all.</p>
          <ul className="lp-facts">
            <li>Every message is a checkpoint you can go back to.</li>
            <li>Ask mode gives notes on the mix without touching it.</li>
            <li>Attach a reference track and it pulls a production recipe from it.</li>
          </ul>
        </div>
        <figure className="lp-frame lp-producer"><Shot shot={SHOTS.producer} alt="The Producer panel: a request for a breathy flute melody, the tool calls it made, a mix review of what it heard, its reply, and the Changes to review card." /></figure>
      </section>

      <section className="lp-band">
        <div className="lp-split lp-wrap reverse">
          <figure className="lp-frame"><Shot shot={SHOTS.inlineEdit} alt="Four bars of bass and pad selected across two tracks with the inline edit box open: Walk the bass up into the hook." /></figure>
          <div className="lp-copy">
            <h2>Select a phrase. Press <kbd>Ctrl</kbd><kbd>K</kbd>. Say what you want.</h2>
            <p>Shift-drag across tracks or select notes in the piano roll. The agent gets the exact notes and timing, and rewrites that phrase and nothing else. On a touchscreen, Range and Edit selection do the same thing.</p>
          </div>
        </div>
      </section>

      <section className="lp-daw lp-wrap">
        <div className="lp-daw-head">
          <h2>A real DAW underneath.</h2>
          <p>Arrangement, piano roll, step sequencer and mixer. 31 instruments, sampled and synthesized, and 16 effects. Record your own audio, freeze finished tracks, bounce WAV or MP3. The agent edits the same session you do, so you can always take over by hand.</p>
        </div>
        <div className="lp-grid">
          <figure className="lp-frame wide"><Shot shot={SHOTS.pianoRoll} alt="The piano roll showing the flute melody with note velocities." /><figcaption>Piano roll</figcaption></figure>
          <figure className="lp-frame wide"><Shot shot={SHOTS.drums} alt="The step sequencer with kick, snare, hat, rim and shaker lanes." /><figcaption>Step sequencer</figcaption></figure>
          <figure className="lp-frame mixer"><Shot shot={SHOTS.mixer} alt="The mixer with a channel strip for each track and the master bus." /><figcaption>Mixer</figcaption></figure>
          <div className="lp-promise">
            <h3>It never prints audio from a prompt.</h3>
            <p>Every sound is a real instrument, your own recording, or synthesized from parameters. The agent composes and produces. What comes out is still your song.</p>
          </div>
        </div>
      </section>

      <section className="lp-end lp-wrap">
        <h2>Free, open source, and yours to change.</h2>
        <p>MIT licensed. No install, and no account needed to start. The music tools work without an AI key. The Producer uses your Gemini key, or hosted AI when it is enabled.</p>
        <div className="lp-actions"><a className="lp-btn" href="/studio">Open the studio</a><a className="lp-btn ghost" href={REPO} target="_blank" rel="noreferrer">Star it on GitHub</a></div>
        <Support />
      </section>
    </main>
    <footer className="lp-foot lp-wrap"><a className="lp-brand" href="/" aria-label="Vibe home"><Wordmark tone="mono" label="" /></a><span>vibedaw.org</span><a href={REPO} target="_blank" rel="noreferrer">GitHub</a></footer>
  </div>;
}
