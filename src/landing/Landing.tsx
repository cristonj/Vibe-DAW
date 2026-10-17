import { useState } from 'react';
import { ArrowUpRight, ArrowRight, Code2 as Github, Heart, Copy, Check, Sparkles, SlidersHorizontal, AudioLines, MousePointer2 } from 'lucide-react';
import { donationWallets } from './donations';
import './landing.css';

const REPO = 'https://github.com/cristonj/Vibe-DAW';
const TRACKS = [
  { label: 'Glass keys', color: '#c6adfa', notes: [[0, 42, 46], [0, 57, 46], [0, 72, 46], [54, 35, 46], [54, 50, 46], [54, 65, 46], [108, 45, 46], [108, 60, 46], [108, 75, 46], [162, 40, 46], [162, 55, 46], [162, 70, 46]] },
  { label: 'Soft bass', color: '#eeac87', notes: [[0, 58, 36], [45, 58, 10], [56, 46, 34], [108, 62, 32], [151, 52, 10], [164, 55, 44]] },
  { label: 'Pocket drums', color: '#9bbfaf', notes: Array.from({ length: 32 }, (_, i) => [i * 6.7, i % 4 === 0 ? 65 : i % 4 === 2 ? 45 : 28, i % 4 === 0 ? 4 : 2]) },
];

function SessionArt() {
  return <div className="session-art" role="img" aria-label="An example Vibe arrangement with glass keys, soft bass, and drums selected for an AI edit">
    <div className="art-toolbar"><span className="art-dot" /><b>Night moves</b><span className="art-tempo">96 BPM <i /> A minor</span><span className="art-time">001 : 01</span></div>
    <div className="art-ruler"><span>TRACKS</span>{[1, 2, 3, 4, 5].map((bar) => <span key={bar}>{bar}</span>)}</div>
    {TRACKS.map((track, row) => <div className="art-track" key={track.label} style={{ '--track': track.color } as React.CSSProperties}>
      <div className="art-track-label"><i /><span>{track.label}<small>{row === 2 ? 'Drum kit' : 'Instrument'}</small></span><span className="art-meter" /></div>
      <div className="art-clips">{[0, 1].map((repeat) => <div className="art-clip" key={repeat}><span>{track.label}</span><svg viewBox="0 0 216 100" preserveAspectRatio="none" aria-hidden>{track.notes.map(([x, y, w], i) => <rect key={i} x={x} y={y} width={w} height={row === 2 ? 10 : 4} rx="1" />)}</svg></div>)}</div>
    </div>)}
    <div className="art-region"><span>12 notes selected</span></div><div className="art-playhead" />
    <div className="art-command"><div><span><Sparkles size={14} /> Edit selection</span><kbd>⌘ K</kbd></div><p>Give these drums a little more swing</p><div className="art-command-foot"><span>Just this phrase. Your call.</span><ArrowRight size={17} /></div></div>
    <div className="art-bottom"><span><span className="art-dot" /> All changes are yours to keep.</span><span>UNDO ↶</span></div>
  </div>;
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
        <div className="hero-copy"><span className="landing-eyebrow"><span className="live-dot" /> YOUR BROWSER. YOUR STUDIO.</span><h1>Less friction.<br />More <em>feeling.</em></h1><p>A music studio that moves at the speed of your ideas. Play, draw, and produce with an AI collaborator that hears what you hear.</p><div className="hero-links"><a className="landing-primary" href="/studio">Make something <ArrowUpRight size={21} /></a><a className="landing-secondary" href={REPO} target="_blank" rel="noreferrer"><Github size={17} /> Explore the code</a></div><span className="hero-note">Free &amp; open source. No install. No account needed to start.</span></div>
        <div className="hero-session"><div className="session-kicker"><span>AN IDEA, TAKING SHAPE</span><span>01 — ∞</span></div><SessionArt /><div className="session-caption"><MousePointer2 size={13} /><span>Select a phrase. Say what you feel. Keep what you love.</span></div></div>
      </section>
      <section className="landing-manifesto" id="possibilities"><span className="landing-eyebrow">BUILT FOR THE MOMENT IN BETWEEN</span><h2>From “what if”<br />to <span>one more listen.</span></h2><p>The melody in your head. The groove you almost have. Vibe gives you a place to find it, shape it, and make it yours.</p></section>
      <section className="landing-features" aria-label="Studio features">
        <article><span className="feature-index">01 / CREATE</span><AudioLines size={27} /><h3>A whole palette.<br />An empty canvas.</h3><p>Sampled keys and strings. Offline synths, basses, and mallets. Your own recordings. Explore openly licensed audio when a track needs something unexpected.</p><a href="/studio">Find your sound <ArrowUpRight size={15} /></a></article>
        <article><span className="feature-index">02 / COLLABORATE</span><Sparkles size={27} /><h3>A co-producer<br />with a pair of ears.</h3><p>Select notes or a section and describe the change. Your agent composes, listens, and edits the same session you do. Review every change. Undo the whole run.</p><a href="/studio">Follow an idea <ArrowUpRight size={15} /></a></article>
        <article><span className="feature-index">03 / SHAPE</span><SlidersHorizontal size={27} /><h3>Get into<br />the details.</h3><p>Arrange clips, shape notes, dial in effects, and bounce WAV or MP3. Background track freezing keeps completed parts light. A touch interface travels with you.</p><a href="/studio">Open your studio <ArrowUpRight size={15} /></a></article>
      </section>
      <div className="landing-ai-note">Music tools work without an AI key. The Producer uses your Gemini key, or hosted AI when enabled. Streamed instruments and online sounds need a connection on first use.</div>
      <DonationSection />
      <section className="landing-final"><span className="landing-eyebrow">THE NEXT TRACK IS YOURS.</span><h2>Find your Vibe.</h2><a className="landing-primary" href="/studio">Let’s make music <ArrowUpRight size={21} /></a></section>
    </main>
    <footer className="landing-footer"><a className="landing-brand" href="/">vibe<span> / </span></a><span>Made for human creativity.</span><a href={REPO} target="_blank" rel="noreferrer">Open source, always <ArrowUpRight size={14} /></a><span>vibedaw.org</span></footer>
  </div>;
}
