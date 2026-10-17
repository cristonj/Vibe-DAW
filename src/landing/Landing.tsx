import { useState } from 'react';
import { ArrowUpRight, Code2 as Github, Heart, Copy, Check, Sparkles, SlidersHorizontal, AudioLines, MousePointer2 } from 'lucide-react';
import { donationWallets } from './donations';
import './landing.css';

const REPO = 'https://github.com/cristonj/Vibe-DAW';
// Real studio captures from scripts/capture-landing-screenshots.mjs. Regenerate when the UI changes.
const SHOTS = {
  studio: { src: '/screenshots/studio.webp', width: 2880, height: 1800 },
  instruments: { src: '/screenshots/instruments.webp', width: 496, height: 1040 },
  inlineEdit: { src: '/screenshots/inline-edit.webp', width: 2096, height: 1040 },
  mixer: { src: '/screenshots/mixer.webp', width: 1256, height: 600 },
};

function Shot({ shot, alt, eager = false }: { shot: typeof SHOTS[keyof typeof SHOTS]; alt: string; eager?: boolean }) {
  return <img src={shot.src} width={shot.width / 2} height={shot.height / 2} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchPriority: 'high' as const } : {})} />;
}

function DonationSection() {
  const [copied, setCopied] = useState('');
  const [status, setStatus] = useState('');
  const copy = async (address: string) => {
    try { await navigator.clipboard.writeText(address); setCopied(address); setStatus('Address copied'); }
    catch { setStatus('Copy is unavailable. Select the address to copy it manually.'); }
  };
  return <section className="landing-support" id="support" aria-labelledby="support-title">
    <div><span className="landing-eyebrow"><Heart size={14} /> INDEPENDENT BY DESIGN</span><h2 id="support-title">Help keep the<br />good ideas coming.</h2></div>
    <div className="support-body"><p>Vibe is open source and free to use. If it helps you make something you love, you can help it grow. Donations are always optional.</p>
      {donationWallets.length ? <div className="wallets">{donationWallets.map((wallet) => <div className="wallet" key={wallet.name}><div><b>{wallet.name}</b><small>{wallet.network}</small></div><code>{wallet.address}</code><button onClick={() => void copy(wallet.address)} aria-label={`Copy ${wallet.name} address`}>{copied === wallet.address ? <Check size={16} /> : <Copy size={16} />}</button><a href={`${wallet.scheme}${wallet.address}${wallet.suffix ?? ''}`} aria-label={`Open ${wallet.name} wallet`}><ArrowUpRight size={16} /></a></div>)}<small>Use the network shown for each address.</small></div> : <a className="landing-text-link" href={REPO} target="_blank" rel="noreferrer"><Github size={17} /> Star Vibe or contribute on GitHub <ArrowUpRight size={16} /></a>}
      <span className="support-status" role="status">{status}</span>
    </div>
  </section>;
}

export function Landing() {
  return <div className="landing">
    <nav className="landing-nav" aria-label="Main navigation"><a className="landing-brand" href="/" aria-label="Vibe home"><svg viewBox="0 0 32 32" aria-hidden><path d="M3 19c4 0 4-10 8-10s4 15 8 15S23 5 27 5s2 9 3 9" /></svg>vibe<span> / </span></a><div><a href="#possibilities">The possibilities</a><a href="#support">Support Vibe</a><a className="nav-open" href="/studio">Open studio <ArrowUpRight size={15} /></a></div></nav>
    <main>
      <section className="landing-hero">
        <div className="hero-copy"><span className="landing-eyebrow"><span className="live-dot" /> OPEN SOURCE. RUNS IN YOUR BROWSER.</span><h1>The open source agentic DAW built to <em>augment, not replace,</em> human creativity.</h1>
          <div className="hero-row"><p>Arrangement, piano roll, step sequencer, mixer, and effects, with a producer agent that listens to what it makes. Everything it does is ordinary session state you can edit by hand, and one undo takes back a whole run.</p>
            <div><div className="hero-links"><a className="landing-primary" href="/studio">Make something <ArrowUpRight size={21} /></a><a className="landing-secondary" href={REPO} target="_blank" rel="noreferrer"><Github size={17} /> Explore the code</a></div><span className="hero-note">Free &amp; open source. No install. No account needed to start.</span></div></div></div>
        <figure className="hero-shot"><Shot eager shot={SHOTS.studio} alt="The Vibe studio: a five-track arrangement with drums, Rhodes, bass, pad and a new flute hook drawn in lilac, the hook open in the piano roll, and the Producer panel showing the run with Keep and Undo all buttons." /><figcaption><MousePointer2 size={13} /><span>The actual studio. The Producer’s new flute part stays lilac until you keep it.</span></figcaption></figure>
      </section>
      <section className="landing-manifesto" id="possibilities"><span className="landing-eyebrow">BUILT FOR THE MOMENT IN BETWEEN</span><h2>From “what if”<br />to <span>one more listen.</span></h2><p>The melody in your head. The groove you almost have. Vibe gives you a place to find it, shape it, and make it yours.</p></section>
      <section className="landing-features" aria-label="Studio features">
        <article><div className="feature-copy"><span className="feature-index">01 / CREATE</span><AudioLines size={27} /><h3>A whole palette.<br />An empty canvas.</h3><p>Sampled keys and strings. Offline synths, basses, and mallets. Your own recordings. Explore openly licensed audio when a track needs something unexpected.</p><a href="/studio">Find your sound <ArrowUpRight size={15} /></a></div>
          <figure className="feature-shot tall"><Shot shot={SHOTS.instruments} alt="The Instruments browser listing Grand Piano, Electric Piano, Organ, Chip Keys and guitars, each with a short description." /></figure></article>
        <article><div className="feature-copy"><span className="feature-index">02 / COLLABORATE</span><Sparkles size={27} /><h3>A co-producer<br />with a pair of ears.</h3><p>Shift-drag across tracks, press Ctrl+K, and describe the change. Your agent gets the exact notes, edits the same session you do, and listens back. Review every change. Undo the whole run.</p><a href="/studio">Follow an idea <ArrowUpRight size={15} /></a></div>
          <figure className="feature-shot"><Shot shot={SHOTS.inlineEdit} alt="A range selected across the bass and pad tracks with the Ctrl+K edit box open, reading “Walk the bass up into the hook”, above suggested edits." /></figure></article>
        <article><div className="feature-copy"><span className="feature-index">03 / SHAPE</span><SlidersHorizontal size={27} /><h3>Get into<br />the details.</h3><p>Arrange clips, shape notes, dial in effects, and bounce WAV or MP3. Background track freezing keeps completed parts light. A touch interface travels with you.</p><a href="/studio">Open your studio <ArrowUpRight size={15} /></a></div>
          <figure className="feature-shot"><Shot shot={SHOTS.mixer} alt="The mixer with channel strips for each track, pan knobs, faders, effect counts, and the master bus." /></figure></article>
      </section>
      <div className="landing-ai-note">Music tools work without an AI key. The Producer uses your Gemini key, or hosted AI when enabled. Streamed instruments and online sounds need a connection on first use.</div>
      <DonationSection />
      <section className="landing-final"><span className="landing-eyebrow">THE NEXT TRACK IS YOURS.</span><h2>Find your Vibe.</h2><a className="landing-primary" href="/studio">Let’s make music <ArrowUpRight size={21} /></a></section>
    </main>
    <footer className="landing-footer"><a className="landing-brand" href="/">vibe<span> / </span></a><span>Made for human creativity.</span><a href={REPO} target="_blank" rel="noreferrer">Open source, always <ArrowUpRight size={14} /></a><span>vibedaw.org</span></footer>
  </div>;
}
