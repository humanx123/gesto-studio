import { create } from 'zustand';
import { hostedAiEnabled } from '../cloud/config';
import { hasAiConsent } from '../legal/acceptance';

// User preferences, persisted to localStorage. When signed in, they also sync to the
// user's own Firestore tree (see cloud/prefs.ts); the API key is otherwise only sent
// to Google's Gemini endpoint.

export const MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', blurb: 'Fast, strong producer. Default.' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', blurb: 'Most capable. Best ears and arrangement sense.' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', blurb: 'Cheapest and quickest. Good for small edits.' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

// Groq hosts open models behind an OpenAI-style API (llm.ts). Any id from
// console.groq.com/docs/models works; these are suggestions known to handle tools.
export const GROQ_MODELS = [
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', blurb: 'Strongest tool use on Groq. Default.' },
  { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', blurb: 'Balanced and quick.' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', blurb: 'Fast, no thinking step.' },
] as const;
export const DEFAULT_GROQ_MODEL = GROQ_MODELS[0].id;

// Pollinations serves open models free, without a key (an optional token raises its limits).
export const FREE_MODELS = [
  { id: 'openai', name: 'GPT-OSS 20B (free)', blurb: 'No key needed. One reply every ~30 s without a token; composes and edits, cannot listen.' },
] as const;
export const DEFAULT_FREE_MODEL = FREE_MODELS[0].id;

// FreeLLMAPI: the user's own gateway (github.com/tashfeenahmed/freellmapi) that pools many free
// providers behind one OpenAI-style API. It runs on their device, so the browser talks to it
// directly; the server must list this site in DASHBOARD_ORIGINS for CORS.
export const DEFAULT_FREELLMAPI_URL = 'http://127.0.0.1:31415/v1';
export const FREELLMAPI_MODELS = [
  { id: 'auto', name: 'Auto (FreeLLMAPI)', blurb: 'The gateway picks the best free model that is up right now.' },
  { id: 'gemma-4-26b-a4b-it-musica', name: 'Gemma 4 26B Música', blurb: 'Tuned for music. Needs a Routeway key in the FreeLLMAPI dashboard.' },
] as const;
export const DEFAULT_FREELLMAPI_MODEL = FREELLMAPI_MODELS[0].id;

// Kilo's gateway serves free models without a key. It sends no CORS headers, so the site's
// own Worker relays it at /api/kilo (worker/index.js, free routes only).
export const KILO_URL = '/api/kilo/v1';
export const KILO_MODELS = [
  { id: 'kilo-auto/free', name: 'Kilo Auto (free)', blurb: 'No key. Kilo picks a free model that is up. About 200 replies an hour.' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra (free)', blurb: 'Large and careful. No key.' },
  { id: 'reflection/beam-free', name: 'Beam 1.0 (free)', blurb: 'Quick tool use. No key.' },
] as const;
export const DEFAULT_KILO_MODEL = KILO_MODELS[0].id;

// OpenRouter fronts hundreds of models, dozens of them free (ids ending in ":free").
// A free-tier key is needed; it allows browser calls, so no relay is required.
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_MODELS = [
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (free)', blurb: 'Strong reasoning and tool use. Default.' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (free)', blurb: 'Fast and reliable, no thinking step.' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B (free)', blurb: 'Balanced; good at structured edits.' },
] as const;
export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODELS[0].id;

// Cerebras serves open models on their own silicon — the quickest free tier of the lot.
export const CEREBRAS_URL = 'https://api.cerebras.ai/v1';
export const CEREBRAS_MODELS = [
  { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', blurb: 'Very fast. Default.' },
  { id: 'qwen-3-32b', name: 'Qwen 3 32B', blurb: 'Quick, handles tools well.' },
] as const;
export const DEFAULT_CEREBRAS_MODEL = CEREBRAS_MODELS[0].id;

export type Provider = 'auto' | 'gemini' | 'groq' | 'free' | 'freellmapi' | 'kilo' | 'openrouter' | 'cerebras';

/** Providers the 'auto' chain walks, most generous first. */
export const AUTO_ORDER: Provider[] = ['freellmapi', 'groq', 'cerebras', 'openrouter', 'kilo', 'free'];
export type Connection = 'firebase' | 'apikey';
export type Thinking = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ListeningQuality = 'full' | 'balanced' | 'compact';
export type ListeningChannels = 'stereo' | 'mono';

interface SettingsState {
  /** Which model host the agent talks to. Listening (ears) needs Gemini. */
  provider: Provider;
  model: ModelId;
  connection: Connection;
  apiKey: string;
  groqKey: string;
  groqModel: string;
  /** Optional Pollinations token for the free provider. */
  freeKey: string;
  freeModel: string;
  /** Base URL of the user's FreeLLMAPI server, ending in /v1. */
  freellmapiUrl: string;
  freellmapiKey: string;
  freellmapiModel: string;
  kiloModel: string;
  openrouterKey: string;
  openrouterModel: string;
  cerebrasKey: string;
  cerebrasModel: string;
  thinking: Thinking;
  /** Let the agent bounce and listen to its own work without asking. */
  autoListen: boolean;
  /** Producer preferences applied to Agent, Ask, and inline chats. */
  customInstructions: string;
  /** Live output buffer: 'stable' (bigger, no crackles) or 'low' (snappier). */
  latency: 'stable' | 'low';
  listeningQuality: ListeningQuality;
  listeningChannels: ListeningChannels;
  /** Browser noise suppression on voice messages. Off keeps humming and sung notes intact. */
  micNoiseSuppression: boolean;
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
const THINKING: Thinking[] = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];

export const MAX_CUSTOM_INSTRUCTIONS = 4000;

export type SettingsValues = Omit<SettingsState, 'set'>;

/** Fill defaults and drop invalid values, for localStorage and for settings synced from another device. */
export function sanitizeSettings(saved: Partial<Record<keyof SettingsValues, unknown>>): SettingsValues {
  return {
    provider: (['auto', 'groq', 'free', 'freellmapi', 'kilo', 'openrouter', 'cerebras'] as Provider[]).includes(saved.provider as Provider) ? (saved.provider as Provider) : 'gemini',
    model: MODELS.some((m) => m.id === saved.model) ? (saved.model as ModelId) : 'gemini-3.8-flash',
    connection: hostedAiEnabled ? (saved.connection === 'apikey' ? 'apikey' : 'firebase') : 'apikey',
    apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
    groqKey: typeof saved.groqKey === 'string' ? saved.groqKey : '',
    groqModel: typeof saved.groqModel === 'string' && saved.groqModel.trim() ? saved.groqModel.trim() : DEFAULT_GROQ_MODEL,
    freeKey: typeof saved.freeKey === 'string' ? saved.freeKey : '',
    freeModel: typeof saved.freeModel === 'string' && saved.freeModel.trim() ? saved.freeModel.trim() : DEFAULT_FREE_MODEL,
    freellmapiUrl: typeof saved.freellmapiUrl === 'string' && /^https?:\/\//.test(saved.freellmapiUrl.trim()) ? saved.freellmapiUrl.trim().replace(/\/+$/, '') : DEFAULT_FREELLMAPI_URL,
    freellmapiKey: typeof saved.freellmapiKey === 'string' ? saved.freellmapiKey : '',
    freellmapiModel: typeof saved.freellmapiModel === 'string' && saved.freellmapiModel.trim() ? saved.freellmapiModel.trim() : DEFAULT_FREELLMAPI_MODEL,
    kiloModel: typeof saved.kiloModel === 'string' && saved.kiloModel.trim() ? saved.kiloModel.trim() : DEFAULT_KILO_MODEL,
    openrouterKey: typeof saved.openrouterKey === 'string' ? saved.openrouterKey : '',
    openrouterModel: typeof saved.openrouterModel === 'string' && saved.openrouterModel.trim() ? saved.openrouterModel.trim() : DEFAULT_OPENROUTER_MODEL,
    cerebrasKey: typeof saved.cerebrasKey === 'string' ? saved.cerebrasKey : '',
    cerebrasModel: typeof saved.cerebrasModel === 'string' && saved.cerebrasModel.trim() ? saved.cerebrasModel.trim() : DEFAULT_CEREBRAS_MODEL,
    thinking: THINKING.includes(saved.thinking as Thinking) ? (saved.thinking as Thinking) : 'MEDIUM',
    autoListen: typeof saved.autoListen === 'boolean' ? saved.autoListen : true,
    customInstructions: typeof saved.customInstructions === 'string' ? saved.customInstructions.slice(0, MAX_CUSTOM_INSTRUCTIONS) : '',
    latency: saved.latency === 'low' ? 'low' : 'stable',
    listeningQuality: saved.listeningQuality === 'balanced' || saved.listeningQuality === 'compact' ? saved.listeningQuality : 'full',
    listeningChannels: saved.listeningChannels === 'mono' ? 'mono' : 'stereo',
    micNoiseSuppression: typeof saved.micNoiseSuppression === 'boolean' ? saved.micNoiseSuppression : true,
  };
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...sanitizeSettings(load()),
  set: (patch) => {
    set(sanitizeSettings({ ...get(), ...patch }));
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

/** Does this provider have what it needs to answer right now? */
export function providerReady(p: Provider, s: SettingsValues): boolean {
  switch (p) {
    case 'free':
    case 'kilo': return true; // no key needed
    case 'freellmapi': return !!s.freellmapiKey.trim();
    case 'groq': return !!s.groqKey.trim();
    case 'openrouter': return !!s.openrouterKey.trim();
    case 'cerebras': return !!s.cerebrasKey.trim();
    case 'gemini': return s.connection === 'firebase' ? hostedAiEnabled : !!(s.apiKey.trim() || envKey.trim());
    default: return false;
  }
}

/** The providers 'auto' can actually reach, in rotation order. Kilo and Pollinations
 *  need no key, so this is never empty. */
export function autoChain(s: SettingsValues = useSettings.getState()): Provider[] {
  return AUTO_ORDER.filter((p) => providerReady(p, s));
}

export function aiAvailable(): { ok: boolean; reason?: string } {
  if (!hasAiConsent()) return { ok: false, reason: 'Review the AI terms and data notice in Settings before using the agent.' };
  const s = useSettings.getState();
  if (s.provider === 'auto') return { ok: true }; // Kilo and Pollinations always stand in
  if (s.provider === 'free' || s.provider === 'kilo') return { ok: true };
  if (s.provider === 'openrouter') {
    return s.openrouterKey.trim() ? { ok: true } : { ok: false, reason: 'Add an OpenRouter API key in Settings to use the agent.' };
  }
  if (s.provider === 'cerebras') {
    return s.cerebrasKey.trim() ? { ok: true } : { ok: false, reason: 'Add a Cerebras API key in Settings to use the agent.' };
  }
  if (s.provider === 'freellmapi') {
    return s.freellmapiKey.trim() ? { ok: true } : { ok: false, reason: 'Add your FreeLLMAPI key in Settings to use the agent.' };
  }
  if (s.provider === 'groq') {
    return s.groqKey.trim() ? { ok: true } : { ok: false, reason: 'Add a Groq API key in Settings to use the agent.' };
  }
  if (s.connection === 'firebase') {
    return hostedAiEnabled ? { ok: true } : { ok: false, reason: 'Add your Gemini API key in Settings to use the agent.' };
  }
  return effectiveApiKey() ? { ok: true } : { ok: false, reason: 'Add a Gemini API key in Settings to use the agent.' };
}

export interface GatewayModel { id: string; name: string; available: boolean }

/** The models an OpenAI-style gateway (FreeLLMAPI, Kilo) offers, available ones first. Throws when it can't be reached. */
export async function fetchFreellmapiModels(url: string, key: string, signal?: AbortSignal): Promise<GatewayModel[]> {
  const res = await fetch(`${url.replace(/\/+$/, '')}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal });
  if (!res.ok) throw new Error(`FreeLLMAPI ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id?: unknown; name?: unknown; available?: unknown }> };
  return (body.data ?? [])
    .filter((m): m is { id: string; name?: unknown; available?: unknown } => typeof m.id === 'string')
    .map((m) => ({ id: m.id, name: typeof m.name === 'string' ? m.name : m.id, available: m.available !== false }))
    .sort((a, b) => Number(b.available) - Number(a.available));
}
