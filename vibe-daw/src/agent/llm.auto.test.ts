import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const cache = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => cache.get(k) ?? null, setItem: (k: string, v: string) => cache.set(k, v), removeItem: (k: string) => cache.delete(k) } });
  return cache;
});
vi.mock('../cloud/firebase', () => ({ getFirebaseApp: async () => null }));

import { streamGenerate, resetCooldowns } from './llm';
import { useSettings } from '../state/settings';
import { acknowledgeAi } from '../legal/acceptance';

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
  return new Response(new TextEncoder().encode(body), { status: 200 });
}

const limited = (status = 429) => new Response(JSON.stringify({ error: { message: 'Rate limit' } }), { status, headers: { 'retry-after': '30' } });

/** Which host a recorded fetch call went to. */
const hostOf = (call: unknown[]) => {
  const url = String(call[0]);
  if (url.includes('groq.com')) return 'groq';
  if (url.includes('cerebras.ai')) return 'cerebras';
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('/api/kilo')) return 'kilo';
  if (url.includes('pollinations')) return 'free';
  if (url.includes('127.0.0.1')) return 'freellmapi';
  return url;
};

const fetchMock = vi.fn();
const ask = (h = {}) => streamGenerate({ contents: [{ role: 'user', parts: [{ text: 'make a beat' }] }] }, h);

beforeEach(() => {
  store.clear();
  resetCooldowns();
  acknowledgeAi(true);
  useSettings.getState().set({
    provider: 'auto',
    groqKey: 'gsk_test', cerebrasKey: 'csk_test', openrouterKey: 'sk-or-test',
    freellmapiKey: '', // left out so the chain starts at Groq
  });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('Auto rotation', () => {
  it('uses the first host in the chain when it answers', async () => {
    fetchMock.mockResolvedValueOnce(sse('Done.'));
    const res = await ask();
    expect(res.content.parts).toEqual([{ text: 'Done.' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hostOf(fetchMock.mock.calls[0])).toBe('groq');
  });

  it('moves to the next host when the first is rate-limited', async () => {
    fetchMock
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(sse('Second host here.'));
    const res = await ask();
    expect(res.content.parts).toEqual([{ text: 'Second host here.' }]);
    expect(fetchMock.mock.calls.map(hostOf)).toEqual(['groq', 'cerebras']);
  });

  it('walks past several exhausted hosts in one turn', async () => {
    fetchMock
      .mockResolvedValueOnce(limited())
      .mockResolvedValueOnce(limited(402))
      .mockResolvedValueOnce(limited(500))
      .mockResolvedValueOnce(sse('Fourth one answered.'));
    const res = await ask();
    expect(res.content.parts).toEqual([{ text: 'Fourth one answered.' }]);
    expect(fetchMock.mock.calls.map(hostOf)).toEqual(['groq', 'cerebras', 'openrouter', 'kilo']);
  });

  it('says which host it moved to, so a slow turn is explainable', async () => {
    fetchMock.mockResolvedValueOnce(limited()).mockResolvedValueOnce(sse('ok'));
    const notes: string[] = [];
    await ask({ onNote: (m: string) => notes.push(m) });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/Groq is unavailable/);
    expect(notes[0]).toMatch(/Cerebras/);
  });

  it('skips a host still cooling down on the NEXT turn, not just this one', async () => {
    fetchMock.mockResolvedValueOnce(limited()).mockResolvedValueOnce(sse('first'));
    await ask();
    fetchMock.mockReset();
    // Groq said "retry after 30s", so the second turn should not waste a call on it.
    fetchMock.mockResolvedValueOnce(sse('second'));
    await ask();
    expect(fetchMock.mock.calls.map(hostOf)).toEqual(['cerebras']);
  });

  it('fails over on a network error too, not only on an HTTP status', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sse('recovered'));
    const res = await ask();
    expect(res.content.parts).toEqual([{ text: 'recovered' }]);
    expect(fetchMock.mock.calls.map(hostOf)).toEqual(['groq', 'cerebras']);
  });

  it('does NOT hop hosts on a real request error — that would hide the bug', async () => {
    // 400 means the request itself was wrong; every host would reject it the same way.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'bad tools' } }), { status: 400 }));
    await expect(ask()).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes FreeLLMAPI first once its key is set', async () => {
    useSettings.getState().set({ freellmapiKey: 'freellmapi-test' });
    fetchMock.mockResolvedValueOnce(sse('gateway'));
    await ask();
    expect(hostOf(fetchMock.mock.calls[0])).toBe('freellmapi');
  });

  it('still works with no keys at all, on the keyless hosts alone', async () => {
    useSettings.getState().set({ groqKey: '', cerebrasKey: '', openrouterKey: '', freellmapiKey: '' });
    fetchMock.mockResolvedValueOnce(limited()).mockResolvedValueOnce(sse('keyless'));
    const res = await ask();
    expect(res.content.parts).toEqual([{ text: 'keyless' }]);
    expect(fetchMock.mock.calls.map(hostOf)).toEqual(['kilo', 'free']);
  });

  it('identifies the caller to OpenRouter, which it asks for', async () => {
    useSettings.getState().set({ groqKey: '', cerebrasKey: '', freellmapiKey: '' });
    fetchMock.mockResolvedValueOnce(sse('ok'));
    await ask();
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['X-Title']).toBe('Gesto Studio');
    expect(headers.Authorization).toBe('Bearer sk-or-test');
  });

  it('keeps a hand-picked provider on a single host, with no failover', async () => {
    useSettings.getState().set({ provider: 'groq' });
    fetchMock.mockResolvedValue(limited());
    await expect(ask()).rejects.toThrow(/Groq 429/);
    // The retry logic may ask Groq again, but never another host.
    expect(new Set(fetchMock.mock.calls.map(hostOf))).toEqual(new Set(['groq']));
  });
});
