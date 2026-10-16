import { create } from 'zustand';

// Themes are sets of CSS variable overrides on :root. Accent recolors the agent ink
// (the purple used for AI changes, focus rings and primary buttons).

export const THEMES = {
  midnight: { name: 'Midnight', vars: {} as Record<string, string> },
  graphite: {
    name: 'Graphite',
    vars: { '--bg': '#18181b', '--panel': '#1f1f23', '--panel-2': '#25252a', '--raised': '#2e2e34', '--hover': '#38383f', '--line': '#34343b', '--line-soft': '#2a2a30', '--lane-a': '#1b1b1f', '--lane-b': '#1e1e22', '--roll-white': '#222227', '--roll-inkey': '#26262c', '--roll-black': '#19191d', '--lcd-bg': '#111113', '--meter-bg': '#0e0e10', '--tooltip-bg': '#0f0f11' },
  },
  oled: {
    name: 'OLED black',
    vars: { '--bg': '#000000', '--panel': '#0a0a0c', '--panel-2': '#111114', '--raised': '#1a1a1f', '--hover': '#24242b', '--line': '#24242a', '--line-soft': '#18181c', '--lane-a': '#050506', '--lane-b': '#08080a', '--roll-white': '#0e0e11', '--roll-inkey': '#121216', '--roll-black': '#050506', '--lcd-bg': '#000000', '--meter-bg': '#000000', '--tooltip-bg': '#111114' },
  },
  daylight: {
    name: 'Daylight',
    vars: {
      '--bg': '#eef0f5', '--panel': '#ffffff', '--panel-2': '#f4f5f9', '--raised': '#e6e8ef', '--hover': '#dcdfe8', '--line': '#d3d6e0', '--line-soft': '#e3e5ec',
      '--text': '#1b1d27', '--muted': '#4f5367', '--faint': '#7d8195', '--lane-a': '#f7f8fb', '--lane-b': '#f1f2f7',
      '--grid-bar': 'rgba(0,0,0,0.12)', '--grid-beat': 'rgba(0,0,0,0.05)', '--roll-white': '#f3f4f8', '--roll-inkey': '#eae6fb', '--roll-black': '#dfe1e9',
      '--lcd-bg': '#1b1d27', '--meter-bg': '#d9dbe3', '--tooltip-bg': '#1b1d27', '--shadow-pop': '0 18px 50px rgba(20,22,40,0.18), 0 0 0 1px #d3d6e0',
    },
  },
} as const;

export type ThemeId = keyof typeof THEMES;

export const ACCENTS = ['#b69cff', '#5cc8ff', '#3ddc97', '#ffb547', '#ff7aa2', '#f7a8ff'];

interface ThemeState {
  theme: ThemeId;
  accent: string;
  scale: number;
  set: (patch: Partial<Pick<ThemeState, 'theme' | 'accent' | 'scale'>>) => void;
}

const KEY = 'vibe:theme';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } })();

export const useTheme = create<ThemeState>((set, get) => ({
  theme: saved.theme in THEMES ? saved.theme : 'midnight',
  accent: typeof saved.accent === 'string' ? saved.accent : ACCENTS[0],
  scale: typeof saved.scale === 'number' ? saved.scale : 1,
  set: (patch) => {
    set(patch);
    const { theme, accent, scale } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ theme, accent, scale })); } catch { /* storage off */ }
    applyTheme();
  },
}));

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

let applied: string[] = [];

export function applyTheme() {
  const { theme, accent, scale } = useTheme.getState();
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  const vars: Record<string, string> = { ...THEMES[theme].vars };
  const [r, g, b] = hexToRgb(accent);
  vars['--agent'] = accent;
  vars['--agent-strong'] = `rgb(${Math.min(255, r + 25)}, ${Math.min(255, g + 25)}, ${Math.min(255, b + 25)})`;
  vars['--agent-wash'] = `rgba(${r}, ${g}, ${b}, 0.14)`;
  vars['--agent-line'] = `rgba(${r}, ${g}, ${b}, 0.55)`;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applied = Object.keys(vars);
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'daylight' ? 'light' : 'dark';
  (document.getElementById('root') as HTMLElement | null)?.style.setProperty('zoom', String(scale));
}
