import { useId, type CSSProperties } from 'react';
import { GLYPHS, GRADIENT, MARK, WORDMARK, type Dot, type Glyph } from './glyphs';
import './brand.css';

/** `gradient` is the brand look. `mono` takes the text color, with the dot in the agent's lilac. */
type Tone = 'gradient' | 'mono';

const stops = GRADIENT.map((color, k) => <stop key={color} offset={k / (GRADIENT.length - 1)} stopColor={color} />);
// useId can contain characters that url(#…) would need escaped.
const useSvgId = () => `vibe${useId().replace(/[^\w-]/g, '')}`;
// An empty label hides the drawing from assistive tech, for when a parent already names it.
const named = (label: string) => label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };

function Stroke({ glyph, paint }: { glyph: Glyph; paint: string }) {
  return <path d={glyph.d} strokeWidth={glyph.weight} strokeLinejoin={glyph.join} style={{ stroke: paint }} />;
}

function DotMark({ dot, tone }: { dot: Dot; tone: Tone }) {
  return <circle className="vibe-dot" cx={dot.cx} cy={dot.cy} r={dot.r} style={{ fill: `var(--vibe-dot, ${tone === 'gradient' ? '#fff' : 'var(--agent, #b69cff)'})` }} />;
}

/**
 * The Vibe wordmark. Each letter is its own group (`.vibe-v`, `.vibe-i`, `.vibe-b`, `.vibe-e`)
 * so it can be animated alone, and its own color variable (`--vibe-v` and so on, plus
 * `--vibe-dot`) so it can be restyled alone. Letter positions live in glyphs.ts.
 */
export function Wordmark({ tone = 'gradient', className = '', label = 'Vibe', style }: { tone?: Tone; className?: string; label?: string; style?: CSSProperties }) {
  const id = useSvgId();
  return (
    <svg className={`vibe-wordmark ${className}`} viewBox={`-2 -2 ${WORDMARK.width + 4} ${WORDMARK.height + 4}`} {...named(label)} style={style}>
      {tone === 'gradient' && <defs>{WORDMARK.letters.map(({ name, x }) => (
        // One gradient spans the word; each letter gets it shifted to its own origin.
        <linearGradient key={name} id={`${id}-${name}`} gradientUnits="userSpaceOnUse" x1={-x} y1={0} x2={WORDMARK.width - x} y2={0}>{stops}</linearGradient>
      ))}</defs>}
      {WORDMARK.letters.map(({ name, x }, k) => {
        const glyph = GLYPHS[name], key = name.toLowerCase();
        return (
          <g key={name} transform={`translate(${x} 0)`}>
            <g className={`vibe-letter vibe-${key}`} style={{ '--i': k } as CSSProperties}>
              <Stroke glyph={glyph} paint={`var(--vibe-${key}, ${tone === 'gradient' ? `url(#${id}-${name})` : 'currentColor'})`} />
              {glyph.dot && <DotMark dot={glyph.dot} tone={tone} />}
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** The mark: the V holding the dot. For favicons, avatars, and anywhere the word won't fit. */
export function VibeMark({ tone = 'gradient', className = '', label = 'Vibe' }: { tone?: Tone; className?: string; label?: string }) {
  const id = useSvgId();
  return (
    <svg className={`vibe-mark ${className}`} viewBox={`-4 -4 ${MARK.width + 8} ${MARK.height + 8}`} {...named(label)}>
      {tone === 'gradient' && <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={MARK.width} y2={MARK.height}>{stops}</linearGradient></defs>}
      <Stroke glyph={MARK.glyph} paint={`var(--vibe-v, ${tone === 'gradient' ? `url(#${id})` : 'currentColor'})`} />
      <DotMark dot={MARK.dot} tone={tone} />
    </svg>
  );
}
