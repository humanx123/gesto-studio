import { beforeEach, describe, expect, it, vi } from 'vitest';

// localStorage is read when the settings store is first imported.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  },
});

import { useSettings, autoChain, providerReady, AUTO_ORDER, sanitizeSettings, type Provider } from '../state/settings';

const settings = () => ({ ...useSettings.getState() });

beforeEach(() => {
  useSettings.getState().set(sanitizeSettings({}));
  vi.restoreAllMocks();
});

describe('providerReady', () => {
  it('counts the keyless hosts as always available', () => {
    const s = settings();
    expect(providerReady('kilo', s)).toBe(true);
    expect(providerReady('free', s)).toBe(true);
  });

  it('needs a key for the keyed hosts', () => {
    const s = settings();
    expect(providerReady('groq', s)).toBe(false);
    expect(providerReady('openrouter', s)).toBe(false);
    expect(providerReady('cerebras', s)).toBe(false);
    expect(providerReady('freellmapi', s)).toBe(false);
  });

  it('accepts a host once its key is set', () => {
    useSettings.getState().set({ openrouterKey: 'sk-or-v1-test' });
    expect(providerReady('openrouter', settings())).toBe(true);
  });

  it('ignores a key that is only whitespace', () => {
    useSettings.getState().set({ groqKey: '   ' });
    expect(providerReady('groq', settings())).toBe(false);
  });
});

describe('autoChain', () => {
  it('always has the keyless hosts to fall back on, so Auto is never empty', () => {
    const chain = autoChain(settings());
    expect(chain).toContain('kilo');
    expect(chain).toContain('free');
    expect(chain.length).toBeGreaterThan(0);
  });

  it('grows as keys are added', () => {
    const before = autoChain(settings()).length;
    useSettings.getState().set({ groqKey: 'gsk-test', cerebrasKey: 'csk-test' });
    const after = autoChain(settings());
    expect(after.length).toBe(before + 2);
    expect(after).toContain('groq');
    expect(after).toContain('cerebras');
  });

  it('keeps the configured order so the most generous host is tried first', () => {
    useSettings.getState().set({ groqKey: 'g', cerebrasKey: 'c', openrouterKey: 'o', freellmapiKey: 'f' });
    const chain = autoChain(settings());
    const positions = chain.map((p) => AUTO_ORDER.indexOf(p));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // FreeLLMAPI pools many providers itself, so it leads.
    expect(chain[0]).toBe('freellmapi');
    // The keyless stand-ins are last, being the slowest.
    expect(chain[chain.length - 1]).toBe('free');
  });

  it('never lists Gemini: it is a different transport, not an OpenAI-style host', () => {
    useSettings.getState().set({ apiKey: 'AIza-test' });
    expect(autoChain(settings())).not.toContain('gemini' as Provider);
  });
});

describe('provider setting', () => {
  it('accepts every provider it offers', () => {
    for (const p of ['auto', 'gemini', 'groq', 'free', 'freellmapi', 'kilo', 'openrouter', 'cerebras'] as Provider[]) {
      expect(sanitizeSettings({ provider: p }).provider).toBe(p);
    }
  });

  it('falls back to Gemini for an unknown provider', () => {
    expect(sanitizeSettings({ provider: 'nonsense' }).provider).toBe('gemini');
  });

  it('keeps the new providers across a save and reload', () => {
    useSettings.getState().set({ provider: 'auto', openrouterKey: 'sk-or-v1-x', cerebrasModel: 'qwen-3-32b' });
    const reloaded = sanitizeSettings(JSON.parse(store.get('vibe:settings')!));
    expect(reloaded.provider).toBe('auto');
    expect(reloaded.openrouterKey).toBe('sk-or-v1-x');
    expect(reloaded.cerebrasModel).toBe('qwen-3-32b');
  });
});
