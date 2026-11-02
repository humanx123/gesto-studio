import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const cache = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => cache.get(k) ?? null, setItem: (k: string, v: string) => cache.set(k, v), removeItem: (k: string) => cache.delete(k) } });
});
vi.mock('../engine/api', () => ({ liveChord: vi.fn(), liveNote: vi.fn(), liveRelease: vi.fn(), play: vi.fn(), currentBeat: () => 0, scheduleLive: vi.fn(), scheduleLiveRelease: vi.fn(), clearLive: vi.fn(), prepareLive: vi.fn(), lookAheadSeconds: () => 0.1 }));
import { reactiveBassStep, reactiveDrumHits, reactiveKick, type Feel } from './band';
import { feelFrame, useGesto } from './session';
import { createProject, defaultDrumLanes } from '../model/project';
import type { HandFrame } from '@gesto/input/types';

const lanes = (kit: 'trap' | 'boombap' | 'lofi' | 'house') => defaultDrumLanes(createProject(), kit);
const KICK = 36, SNARE = 38, HAT = 42, CRASH = 49;
const feel = (energy: number, more: Partial<Feel> = {}): Feel => ({ energy, tilt: 0, fillStep: null, crash: false, ...more });
const bar = (f: Feel, b = 5, kit: 'trap' | 'boombap' = 'boombap', groove: 'boombap' | 'trap' = 'boombap') =>
  Array.from({ length: 16 }, (_, i) => reactiveDrumHits(groove, i, b, lanes(kit), false, f));
const count = (bars: ReturnType<typeof bar>[], note?: number) => bars.flat(2).filter((h) => note === undefined || h.note === note).length;

describe('reactive drums', () => {
  it('more energy grows the beat: calm is kick, snare and quarter hats; full adds hats, ghosts and kicks', () => {
    const bars = (e: number) => Array.from({ length: 8 }, (_, b) => bar(feel(e), b));
    expect(count(bars(0.1), HAT)).toBe(8 * 4);
    expect(count(bars(0.95))).toBeGreaterThan(count(bars(0.5)));
    expect(count(bars(0.5))).toBeGreaterThan(count(bars(0.1)));
    expect(count(bars(0.95), KICK)).toBeGreaterThan(count(bars(0.1), KICK));
    // The skeleton never goes away: downbeat kick and backbeat snare at any energy.
    for (const e of [0, 0.5, 1]) {
      expect(bar(feel(e))[0].some((h) => h.note === KICK)).toBe(true);
      expect(bar(feel(e))[4].some((h) => h.note === SNARE)).toBe(true);
    }
  });

  it('varies from bar to bar but a bar is the same every time it is asked for', () => {
    const f = feel(0.85);
    expect(bar(f, 3)).toEqual(bar(f, 3));
    const variants = new Set(Array.from({ length: 8 }, (_, b) => JSON.stringify(bar(f, b * 4 + 1))));
    expect(variants.size).toBeGreaterThan(1);
  });

  it('tilt left is halftime: one snare, on beat 3', () => {
    const snares = bar(feel(0.6, { tilt: -0.8 })).flatMap((h, i) => (h.some((x) => x.note === SNARE && x.velocity > 0.5) ? [i] : []));
    expect(snares).toEqual([8]);
  });

  it('tilt right rolls the hats between 16ths at the end of the bar', () => {
    const rolls = bar(feel(0.6, { tilt: 0.8 })).flat().filter((h) => h.offset);
    expect(rolls.length).toBe(4);
    expect(rolls.every((h) => h.note === HAT)).toBe(true);
  });

  it('a fill is building snares, and a crash follows it', () => {
    const l = lanes('trap');
    const fill = [0, 1, 2, 3].map((s) => reactiveDrumHits('trap', 4 + s, 2, l, false, feel(0.5, { fillStep: s })));
    expect(fill.every((h) => h.some((x) => x.note === SNARE))).toBe(true);
    expect(fill[3].filter((x) => x.note === SNARE).length).toBe(2);
    expect(fill.flat().some((x) => x.note === HAT)).toBe(false);
    expect(reactiveDrumHits('trap', 8, 2, l, false, feel(0.5, { crash: true })).some((x) => x.note === CRASH)).toBe(true);
  });
});

describe('reactive bass', () => {
  it('locks to the generated kick and rings until the next one', () => {
    const f = feel(0.5);
    for (let i = 0; i < 16; i++) {
      const b = reactiveBassStep('boombap', i, 5, f);
      if (reactiveKick('boombap', i, 5, f) !== null) expect(b).not.toBeNull();
    }
    const first = reactiveBassStep('boombap', 0, 5, f)!;
    const nextKick = Array.from({ length: 15 }, (_, j) => j + 1).find((j) => reactiveKick('boombap', j, 5, f) !== null) ?? 16;
    expect(first.steps).toBe(nextKick);
  });

  it('calm hands hold long roots; high energy adds octaves and fifths', () => {
    const calm = Array.from({ length: 16 }, (_, i) => reactiveBassStep('trap', i, 1, feel(0.1))).filter(Boolean);
    expect(calm.map((b) => b!.steps)).toEqual([8, 8]);
    const busy = Array.from({ length: 32 }, (_, b) => Array.from({ length: 16 }, (_, i) => reactiveBassStep('trap', i, b, feel(0.95)))).flat().filter(Boolean);
    expect(busy.some((b) => b!.interval === 12)).toBe(true);
    expect(busy.some((b) => b!.interval === 7)).toBe(true);
  });
});

describe('feel from the hands', () => {
  const hand = (x: number, y: number) => ({ landmarks: [], label: 'Right' as const, fingerCount: 3, extendedFingers: [], tiltAngle: 0, positionX: x, positionY: y });
  const frame = (x: number, y: number): HandFrame => ({ left: hand(0.3, 0.5), right: hand(x, y), source: 'camera' });

  it('raising the right hand and moving raises the energy; holding still settles it', () => {
    let t = 0;
    for (let i = 0; i < 60; i++) feelFrame(frame(0.7, 0.5), { playing: true, volume: 0.1, tilt: 0 }, (t += 33));
    const still = useGesto.getState().energy;
    expect(still).toBeLessThan(0.3);
    for (let i = 0; i < 60; i++) feelFrame(frame(0.6 + (i % 2) * 0.05, 0.2), { playing: true, volume: 0.9, tilt: 0 }, (t += 33));
    expect(useGesto.getState().energy).toBeGreaterThan(0.75);
  });
});
