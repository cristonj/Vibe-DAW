import { create } from 'zustand';
import { hostedAiEnabled } from '../cloud/config';

// User preferences, persisted to localStorage. The API key never leaves this browser
// except in requests to Google's Gemini endpoint.

export const MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', blurb: 'Fast, strong producer. Default.' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', blurb: 'Most capable. Best ears and arrangement sense.' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', blurb: 'Cheapest and quickest. Good for small edits.' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];
export type Connection = 'firebase' | 'apikey';
export type Thinking = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ListeningQuality = 'full' | 'balanced' | 'compact';
export type ListeningChannels = 'stereo' | 'mono';

interface SettingsState {
  model: ModelId;
  connection: Connection;
  apiKey: string;
  thinking: Thinking;
  /** Let the agent bounce and listen to its own work without asking. */
  autoListen: boolean;
  /** Live output buffer: 'stable' (bigger, no crackles) or 'low' (snappier). */
  latency: 'stable' | 'low';
  listeningQuality: ListeningQuality;
  listeningChannels: ListeningChannels;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

const KEY = 'vibe:settings';

function load(): Partial<SettingsState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

const envKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';
const saved = load();

export const useSettings = create<SettingsState>((set, get) => ({
  model: MODELS.some((m) => m.id === saved.model) ? (saved.model as ModelId) : 'gemini-3.8-flash',
  connection: hostedAiEnabled ? saved.connection ?? 'firebase' : 'apikey',
  apiKey: saved.apiKey ?? '',
  thinking: saved.thinking ?? 'MEDIUM',
  autoListen: saved.autoListen ?? true,
  latency: saved.latency === 'low' ? 'low' : 'stable',
  listeningQuality: saved.listeningQuality === 'balanced' || saved.listeningQuality === 'compact' ? saved.listeningQuality : 'full',
  listeningChannels: saved.listeningChannels === 'mono' ? 'mono' : 'stereo',
  set: (patch) => {
    set(patch);
    const { set: _s, ...rest } = { ...get() };
    void _s;
    try {
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch { /* storage full or disabled */ }
  },
}));

/** The key to use for direct Gemini calls: user-provided first, then the dev build key. */
export function effectiveApiKey(): string {
  return useSettings.getState().apiKey.trim() || envKey.trim();
}

export function aiAvailable(): { ok: boolean; reason?: string } {
  const s = useSettings.getState();
  if (s.connection === 'firebase') {
    return hostedAiEnabled ? { ok: true } : { ok: false, reason: 'Add your Gemini API key in Settings to use the agent.' };
  }
  return effectiveApiKey() ? { ok: true } : { ok: false, reason: 'Add a Gemini API key in Settings to use the agent.' };
}
