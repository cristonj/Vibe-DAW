import { create } from 'zustand';
import { accentFill, accentFillStrong, accentInk, accentSolid, accentStops, colorAt, lightenColor, rgbOf, sanitizeAccent } from './accent';

// Themes are sets of CSS variable overrides on :root. Accent recolors the agent ink
// (AI changes, focus rings and primary buttons); see accent.ts. Filled surfaces paint
// --agent-fill with --agent-ink text, and thin lines and text use --agent, its solid middle.

export const THEMES = {
  dark: { name: 'Dark', vars: {} as Record<string, string> },
  light: {
    name: 'Light',
    vars: {
      '--bg': '#eef0f5', '--panel': '#ffffff', '--panel-2': '#f4f5f9', '--raised': '#e6e8ef', '--hover': '#dcdfe8', '--line': '#d3d6e0', '--line-soft': '#e3e5ec',
      '--text': '#1b1d27', '--muted': '#4f5367', '--faint': '#7d8195', '--lane-a': '#f7f8fb', '--lane-b': '#f1f2f7',
      '--grid-bar': 'rgba(0,0,0,0.12)', '--grid-beat': 'rgba(0,0,0,0.05)', '--roll-white': '#f3f4f8', '--roll-inkey': '#eae6fb', '--roll-black': '#dfe1e9',
      '--lcd-bg': '#1b1d27', '--meter-bg': '#d9dbe3', '--tooltip-bg': '#1b1d27', '--shadow-pop': '0 18px 50px rgba(20,22,40,0.18), 0 0 0 1px #d3d6e0',
      '--logo-dot': '#1b1d27', '--app-bg': '#dfe3eb',
      '--display-bg': '#e9ebf1', '--display-text': '#1b1d27', '--display-pos': '#b56a00', '--display-glow': 'transparent', '--display-inset': 'rgba(20,22,40,0.12)', '--edge': 'rgba(255,255,255,0.9)', '--lift': '0 1px 2px rgba(20,22,40,0.08), 0 12px 30px -18px rgba(20,22,40,0.3)',
    } as Record<string, string>,
  },
} as const;
/** Themes from before there were only two, and where they went. */
const OLD_THEMES: Record<string, ThemeId> = { midnight: 'dark', graphite: 'dark', oled: 'dark', daylight: 'light' };

export type ThemeId = keyof typeof THEMES;

interface ThemeState {
  theme: ThemeId;
  accent: string;
  scale: number;
  set: (patch: Partial<Pick<ThemeState, 'theme' | 'accent' | 'scale'>>) => void;
}

const KEY = 'vibe:theme';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } })();

/** Valid theme id and accent, falling back to defaults (also used for synced preferences). */
export function sanitizeAppearance(v: { theme?: unknown; accent?: unknown }): { theme: ThemeId; accent: string } {
  return {
    theme: typeof v.theme !== 'string' ? 'dark' : Object.hasOwn(THEMES, v.theme) ? (v.theme as ThemeId) : Object.hasOwn(OLD_THEMES, v.theme) ? OLD_THEMES[v.theme] : 'dark',
    accent: sanitizeAccent(v.accent),
  };
}

export const useTheme = create<ThemeState>((set, get) => ({
  ...sanitizeAppearance(saved),
  scale: typeof saved.scale === 'number' ? saved.scale : 1,
  set: (patch) => {
    set(patch);
    const { theme, accent, scale } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ theme, accent, scale })); } catch { /* storage off */ }
    applyTheme();
  },
}));

let applied: string[] = [];

export function applyTheme() {
  const { theme, accent, scale } = useTheme.getState();
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  const vars: Record<string, string> = { ...THEMES[theme].vars };
  const solid = accentSolid(accent), [r, g, b] = rgbOf(solid);
  vars['--agent'] = solid;
  vars['--agent-strong'] = lightenColor(solid);
  vars['--agent-wash'] = `rgba(${r}, ${g}, ${b}, 0.14)`;
  vars['--agent-line'] = `rgba(${r}, ${g}, ${b}, 0.55)`;
  vars['--agent-fill'] = accentFill(accent);
  vars['--agent-fill-strong'] = accentFillStrong(accent);
  vars['--agent-ink'] = accentInk(accent);
  const stops = accentStops(accent);
  [0, 0.5, 1].forEach((t, k) => { vars[`--ink-${k}`] = colorAt(stops, t); });
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applied = Object.keys(vars);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  (document.getElementById('root') as HTMLElement | null)?.style.setProperty('zoom', String(scale));
}
