import { useEffect, useId, useState, type CSSProperties } from 'react';
import { GLYPHS, GRADIENT, MARK, WORDMARK, type Dot, type Glyph } from './glyphs';
import './brand.css';

/** `gradient` is the brand look. `mono` takes the text color, with the dot in the agent's lilac. */
type Tone = 'gradient' | 'mono';

const stops = GRADIENT.map((color, k) => <stop key={color} offset={k / (GRADIENT.length - 1)} stopColor={color} />);
// useId can contain characters that url(#…) would need escaped.
const useSvgId = () => `vibe${useId().replace(/[^\w-]/g, '')}`;
/** Slides a gradient across `span` and back over 2 × `seconds`, like the CSS color flow. */
function Flow({ span, seconds }: { span: number; seconds: number }) {
  // Read after mount, so a prerendered landing page hydrates with the same tree.
  const [reduced, setReduced] = useState(false);
  useEffect(() => { setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);
  if (!seconds || reduced) return null;
  return <animateTransform attributeName="gradientTransform" type="translate" values={`0 0;${span} 0;0 0`} keyTimes="0;0.5;1" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur={`${seconds * 2}s`} repeatCount="indefinite" />;
}
// An empty label hides the drawing from assistive tech, for when a parent already names it.
const named = (label: string) => label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };

// A slight raise, like the buttons: a soft sheen down each letter (lighter on top, a touch
// darker below) and a thin lip underneath. `sheen` is a vertical gradient in the letters' space.
const sheenStops = [<stop key="0" offset="0" stopColor="#fff" stopOpacity="0.2" />, <stop key="1" offset="0.48" stopColor="#fff" stopOpacity="0.04" />, <stop key="2" offset="0.56" stopColor="#000" stopOpacity="0" />, <stop key="3" offset="1" stopColor="#000" stopOpacity="0.14" />];

function Stroke({ glyph, paint, sheen }: { glyph: Glyph; paint: string; sheen: string }) {
  const line = { d: glyph.d, strokeWidth: glyph.weight, strokeLinejoin: glyph.join };
  return (
    <>
      <g transform={`translate(0 ${glyph.weight * 0.07})`}><path {...line} style={{ stroke: paint }} /><path {...line} style={{ stroke: 'rgba(0, 0, 0, 0.4)' }} /></g>
      <path {...line} style={{ stroke: paint }} />
      <path {...line} style={{ stroke: sheen }} />
    </>
  );
}

function DotMark({ dot, tone, sheen }: { dot: Dot; tone: Tone; sheen: string }) {
  const fill = `var(--vibe-dot, ${tone === 'gradient' ? 'var(--logo-dot, #fff)' : 'var(--agent, #b69cff)'})`;
  const { cx, cy, r } = dot;
  return (
    <g className="vibe-dot">
      <circle cx={cx} cy={cy + r * 0.1} r={r} style={{ fill }} /><circle cx={cx} cy={cy + r * 0.1} r={r} fill="rgba(0, 0, 0, 0.35)" />
      <circle cx={cx} cy={cy} r={r} style={{ fill }} />
      <circle cx={cx} cy={cy} r={r} style={{ fill: sheen }} />
    </g>
  );
}

/**
 * The Vibe wordmark. Each letter is its own group (`.vibe-v`, `.vibe-i`, `.vibe-b`, `.vibe-e`)
 * so it can be animated alone, and its own color variable (`--vibe-v` and so on, plus
 * `--vibe-dot`) so it can be restyled alone. Letter positions live in glyphs.ts.
 */
export function Wordmark({ tone = 'gradient', className = '', label = 'Vibe', style, glow = false, flow = 0 }: { tone?: Tone; className?: string; label?: string; style?: CSSProperties; glow?: boolean; flow?: number }) {
  const id = useSvgId();
  return (
    <svg className={`vibe-wordmark ${className}`} viewBox={`-2 -2 ${WORDMARK.width + 4} ${WORDMARK.height + 4}`} {...named(label)} style={style}>
      <defs>
        {tone === 'gradient' && WORDMARK.letters.map(({ name, x }) => (
          // One gradient spans the word; each letter gets it shifted to its own origin.
          <linearGradient key={name} id={`${id}-${name}`} gradientUnits="userSpaceOnUse" spreadMethod="reflect" x1={-x} y1={0} x2={WORDMARK.width - x} y2={0}>{stops}<Flow span={WORDMARK.width} seconds={flow} /></linearGradient>
        ))}
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={WORDMARK.height}>{sheenStops}</linearGradient>
        <linearGradient id={`${id}-sheen-dot`} x1={0} y1={0} x2={0} y2={1}>{sheenStops}</linearGradient>
        {/* A soft glow made of the letters themselves, blurred, so it carries their gradient. */}
        {glow && <filter id={`${id}-glow`} x="-15%" y="-35%" width="130%" height="170%">
          <feGaussianBlur stdDeviation="9" /><feComponentTransfer><feFuncA type="linear" slope="0.2" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>}
      </defs>
      <g filter={glow ? `url(#${id}-glow)` : undefined}>
      {WORDMARK.letters.map(({ name, x }, k) => {
        const glyph = GLYPHS[name], key = name.toLowerCase();
        return (
          <g key={name} transform={`translate(${x} 0)`}>
            <g className={`vibe-letter vibe-${key}`} style={{ '--i': k } as CSSProperties}>
              <Stroke glyph={glyph} paint={`var(--vibe-${key}, ${tone === 'gradient' ? `url(#${id}-${name})` : 'currentColor'})`} sheen={`url(#${id}-sheen)`} />
              {glyph.dot && <DotMark dot={glyph.dot} tone={tone} sheen={`url(#${id}-sheen-dot)`} />}
            </g>
          </g>
        );
      })}
      </g>
    </svg>
  );
}

/** The mark: the V holding the dot. For favicons, avatars, and anywhere the word won't fit. */
export function VibeMark({ tone = 'gradient', className = '', label = 'Vibe', flow = 0 }: { tone?: Tone; className?: string; label?: string; flow?: number }) {
  const id = useSvgId();
  return (
    <svg className={`vibe-mark ${className}`} viewBox={`-4 -4 ${MARK.width + 8} ${MARK.height + 8}`} {...named(label)}>
      <defs>
        {tone === 'gradient' && <linearGradient id={id} gradientUnits="userSpaceOnUse" spreadMethod="reflect" x1={0} y1={0} x2={MARK.width} y2={MARK.height}>{stops}<Flow span={MARK.width} seconds={flow} /></linearGradient>}
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={MARK.height}>{sheenStops}</linearGradient>
        <linearGradient id={`${id}-sheen-dot`} x1={0} y1={0} x2={0} y2={1}>{sheenStops}</linearGradient>
      </defs>
      <Stroke glyph={MARK.glyph} paint={`var(--vibe-v, ${tone === 'gradient' ? `url(#${id})` : 'currentColor'})`} sheen={`url(#${id}-sheen)`} />
      <DotMark dot={MARK.dot} tone={tone} sheen={`url(#${id}-sheen-dot)`} />
    </svg>
  );
}
