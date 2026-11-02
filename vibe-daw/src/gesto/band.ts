import type { DrumLane } from '../model/types';

// Gesto's live band: drum grooves and bass lines that follow the chord in your hands.
// Patterns are one 4/4 bar of 16ths in step strings (X accent, x hit, o ghost, . rest);
// other meters repeat them over their own bar length.

export type Groove = 'off' | 'boombap' | 'trap' | 'house' | 'lofi' | 'reggaeton' | 'dnb' | 'halftime' | 'disco';
export type BassStyle = 'off' | 'kick' | 'roots' | 'octaves' | 'walk';
export type DrumKit = 'trap' | 'boombap' | 'lofi' | 'house';

export const GROOVES: Array<{ id: Groove; name: string; kit: DrumKit; bassPreset: string }> = [
  { id: 'boombap', name: 'Boom bap', kit: 'boombap', bassPreset: 'electric_bass' },
  { id: 'trap', name: 'Trap', kit: 'trap', bassPreset: 'bass808' },
  { id: 'house', name: 'House', kit: 'house', bassPreset: 'fm_bass' },
  { id: 'lofi', name: 'Lo-fi', kit: 'lofi', bassPreset: 'electric_bass' },
  { id: 'reggaeton', name: 'Reggaetón (dembow)', kit: 'trap', bassPreset: 'sub_bass' },
  { id: 'dnb', name: 'DnB', kit: 'trap', bassPreset: 'reese' },
  { id: 'halftime', name: 'Halftime', kit: 'trap', bassPreset: 'sub_bass' },
  { id: 'disco', name: 'Disco', kit: 'house', bassPreset: 'electric_bass' },
];

export const BASS_STYLES: Array<{ id: BassStyle; name: string }> = [
  { id: 'kick', name: 'Follows the kick' },
  { id: 'roots', name: 'Roots (half notes)' },
  { id: 'octaves', name: 'Octaves (8ths)' },
  { id: 'walk', name: 'Walking (root · 5th · octave)' },
  { id: 'off', name: 'No bass' },
];

const PATTERNS: Record<Exclude<Groove, 'off'>, Record<string, string>> = {
  boombap: {
    kick: 'X......x..x.....',
    snare: '....X.......X...',
    hat: 'x.o.x.o.x.o.x.oo',
  },
  trap: {
    kick: 'X.........x..x..',
    clap: '........X.......',
    hat: 'xoxoxoxoxoxoxxxx',
  },
  house: {
    kick: 'X...X...X...X...',
    clap: '....X.......X...',
    openhat: '..x...x...x...x.',
  },
  lofi: {
    kick: 'X.....x...x.....',
    snare: '....X.......X..o',
    hat: 'x.o.x.ox.o.x.o.o',
  },
  reggaeton: {
    kick: 'X...X...X...X...',
    snare: '...X..X....X..X.',
    hat: 'x.x.x.x.x.x.x.x.',
  },
  dnb: {
    kick: 'X.......X...x...',
    snare: '....X.......X...',
    hat: 'x.x.x.x.x.x.x.x.',
  },
  halftime: {
    kick: 'X.......X.......',
    snare: '........X.......',
    hat: 'xxxxxxx.xxxxxxxx',
  },
  disco: {
    kick: 'X.X.X.X.X.X.X.X.',
    snare: '....X.......X...',
    hat: '.x.x.x.x.x.x.x.x',
  },
};

/** The extra percussion layer, on whichever percussion lane the kit has. */
const PERCUSSION: Record<Exclude<Groove, 'off'>, string> = {
  boombap: 'oxoxoxoxoxoxoxox',
  trap: '...x......x..x..',
  house: 'x..x..x...x..x..',
  lofi: 'o.xo.oxo.o.xo.ox',
  reggaeton: 'oxoxoxoxoxoxoxox',
  dnb: '...x...x...x...x',
  halftime: 'x...x...x...x...',
  disco: 'x...x...x...x...',
};

/** A missing lane falls back to its closest relative in the kit. */
const FALLBACK: Record<string, string[]> = {
  snare: ['clap', 'rim'],
  clap: ['snare', 'rim'],
  hat: ['openhat', 'shaker', 'ride'],
  openhat: ['hat', 'ride'],
  perc: ['shaker', 'perc', 'rim', 'perc2'],
};

const VELOCITY: Record<string, number> = { X: 1, x: 0.8, o: 0.45 };

export interface DrumHit { note: number; velocity: number }

function laneNote(lanes: DrumLane[], name: string): number | null {
  for (const n of [name, ...(FALLBACK[name] ?? [])]) {
    const lane = lanes.find((l) => l.name === n);
    if (lane) return lane.note;
  }
  return null;
}

/** Drum hits on one 16th step of a bar (`bar` drives the phrase ending fill). */
export function drumHits(groove: Groove, step: number, bar: number, lanes: DrumLane[], percussion: boolean): DrumHit[] {
  if (groove === 'off') return [];
  const i = step % 16;
  const hits: DrumHit[] = [];
  const lanesWanted: Array<[string, string]> = Object.entries(PATTERNS[groove]);
  if (percussion) lanesWanted.push(['perc', PERCUSSION[groove]]);
  for (const [name, pattern] of lanesWanted) {
    const c = pattern[i];
    const note = c && c !== '.' ? laneNote(lanes, name) : null;
    // Small, fixed velocity drift so repeated bars don't sound machine-stamped.
    if (note !== null) hits.push({ note, velocity: Math.max(0.2, Math.min(1, VELOCITY[c] - ((step * 7 + bar * 3) % 5) * 0.02)) });
  }
  // Every 4th bar ends with a snare pickup; every 8th starts on the crash, when the kit has one.
  if (bar % 4 === 3 && (i === 14 || i === 15)) {
    const snare = laneNote(lanes, 'snare');
    if (snare !== null && !hits.some((h) => h.note === snare)) hits.push({ note: snare, velocity: i === 15 ? 0.7 : 0.5 });
  }
  if (bar % 8 === 0 && i === 0) {
    const crash = lanes.find((l) => l.name === 'crash');
    if (crash) hits.push({ note: crash.note, velocity: 0.75 });
  }
  return hits;
}

export interface BassStep {
  /** Semitones above the chord's bass root. */
  interval: number;
  /** Length in 16th steps. */
  steps: number;
  velocity: number;
}

/** Kick steps of a groove's bar (the "follows the kick" bass plays on them). */
function kickSteps(groove: Groove): number[] {
  if (groove === 'off') return [0, 8];
  return [...PATTERNS[groove].kick].flatMap((c, i) => (c !== '.' ? [i] : []));
}

/** The bass note starting on this 16th step, if any. */
export function bassStep(style: BassStyle, groove: Groove, step: number): BassStep | null {
  const i = step % 16;
  switch (style) {
    case 'off':
      return null;
    case 'kick': {
      const kicks = kickSteps(groove);
      const at = kicks.indexOf(i);
      if (at < 0) return null;
      const next = kicks[at + 1] ?? 16;
      return { interval: 0, steps: next - i, velocity: at === 0 ? 0.95 : 0.85 };
    }
    case 'roots':
      return i % 8 === 0 ? { interval: 0, steps: 8, velocity: 0.9 } : null;
    case 'octaves':
      return i % 2 === 0 ? { interval: (i / 2) % 2 === 0 ? 0 : 12, steps: 2, velocity: (i / 2) % 2 === 0 ? 0.9 : 0.75 } : null;
    case 'walk':
      return i % 4 === 0 ? { interval: [0, 7, 12, 7][i / 4], steps: 4, velocity: i === 0 ? 0.92 : 0.8 } : null;
  }
}

/** Steps from this one to the next bass onset in the bar (how long a chord-change hit rings). */
export function stepsToNextBass(style: BassStyle, groove: Groove, step: number): number {
  const i = step % 16;
  for (let j = i + 1; j < 16; j++) if (bassStep(style, groove, j)) return j - i;
  return 16 - i;
}

/** Where the band's bass plays a chord root: C2–B2, the low register of every bass preset. */
export function bassRootFor(rootPitchClass: number): number {
  return 36 + (((rootPitchClass % 12) + 12) % 12);
}

// ---------------------------------------------------------------- reactive groove
// The band generates its bar from the hands instead of repeating the groove: the groove's
// pattern is the skeleton, and the energy of the hands decides how much of it plays and what
// grows around it. Choices are a hash of (bar, step), so a bar is stable while it plays but
// the next one varies.

/** What the hands say about the groove right now. */
export interface Feel {
  /** 0 calm … 1 full: right-hand height plus how much the hands move. */
  energy: number;
  /** Right-hand tilt, -1..1: left = halftime, right = hat rolls. */
  tilt: number;
  /** Position 0–3 inside a fill a hand flick asked for; null when none. */
  fillStep: number | null;
  /** Crash on this step (the beat after a fill). */
  crash: boolean;
}

export const CALM: Feel = { energy: 0.35, tilt: 0, fillStep: null, crash: false };

/** A stable pseudo-random number in [0, 1) for this bar, step and purpose. */
export function chance(bar: number, step: number, salt: number): number {
  let h = (bar * 374761393 + step * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const HALF_TILT = -0.45;
const ROLL_TILT = 0.45;
const KICK_EXTRA = [3, 6, 7, 10, 11, 14];
const GHOST_SNARE = [7, 9, 15];

const hitOn = (c: string | undefined, e: number) => c === 'X' || (c === 'x' && e > 0.2) || (c === 'o' && e > 0.5);

/** Whether the generated bar has a kick on this 16th (the reactive bass plays on these). */
export function reactiveKick(groove: Groove, step: number, bar: number, feel: Feel): number | null {
  const i = step % 16;
  if (groove === 'off') return i === 0 || i === 8 ? 0.9 : null;
  const e = feel.energy;
  const c = PATTERNS[groove].kick[i];
  if (feel.tilt < HALF_TILT) {
    // Halftime: the downbeat, plus one push before the snare on beat 3 when the hands are up.
    if (i === 0) return 1;
    if (i === 6 && e > 0.55) return 0.7;
    return i === 10 && e > 0.4 ? 0.8 : null;
  }
  if (hitOn(c, e)) return c === 'X' ? 1 : 0.82;
  if (e > 0.55 && KICK_EXTRA.includes(i) && chance(bar, i, 1) < (e - 0.55) * 1.6) return 0.72;
  return null;
}

/** Drum hits on one 16th of a generated bar. `offset` (beats) places roll notes between 16ths. */
export function reactiveDrumHits(groove: Groove, step: number, bar: number, lanes: DrumLane[], percussion: boolean, feel: Feel): Array<DrumHit & { offset?: number }> {
  const i = step % 16;
  const e = feel.energy;
  const hits: Array<DrumHit & { offset?: number }> = [];
  const add = (lane: string, velocity: number, offset?: number, exact = false) => {
    const note = exact ? lanes.find((l) => l.name === lane)?.note ?? null : laneNote(lanes, lane);
    if (note !== null && !hits.some((h) => h.note === note && h.offset === offset)) hits.push({ note, velocity: Math.max(0.15, Math.min(1, velocity * (0.78 + 0.22 * e))), ...(offset ? { offset } : {}) });
  };
  if (feel.crash) add('crash', 0.8, undefined, true);
  if (groove === 'off') return hits;
  const pattern = PATTERNS[groove];

  // A fill replaces the beat: snare 16ths that build, the last one doubled, kick under the first.
  if (feel.fillStep !== null) {
    add('snare', 0.55 + feel.fillStep * 0.13);
    if (feel.fillStep === 0) add('kick', 0.9);
    if (feel.fillStep === 3) add('snare', 0.9, 0.125);
    return hits;
  }

  const kick = reactiveKick(groove, step, bar, feel);
  if (kick !== null) add('kick', kick);

  // Backbeat (snare or clap, whichever the groove uses).
  const back = pattern.snare ? 'snare' : 'clap';
  const bc = pattern[back][i];
  if (feel.tilt < HALF_TILT ? i === 8 : hitOn(bc, e)) add(back, bc === 'X' || i === 8 ? 1 : 0.75);
  else if (e > 0.5 && GHOST_SNARE.includes(i) && chance(bar, i, 2) < e - 0.4) add('snare', 0.32);

  // Hats thin out when calm, fill every 16th when the hands are up, roll when tilted right.
  const hatLane = pattern.hat ? 'hat' : 'openhat';
  const hc = pattern[hatLane][i];
  const hatOn = e < 0.3 ? i % 4 === 0 : e < 0.55 ? hc === 'X' || hc === 'x' : hc !== '.' || (e > 0.75 && i % 2 === 1);
  const rolling = feel.tilt > ROLL_TILT && i >= 12;
  if (hatOn || rolling) add(hatLane, hc === 'X' ? 0.95 : hc === 'x' ? 0.75 : 0.45);
  if (rolling) add(hatLane, 0.4 + (i - 12) * 0.12, 0.125);
  if (e > 0.72 && i === 14 && hatLane === 'hat') add('openhat', 0.6, undefined, true);

  if ((percussion || e > 0.7) && PERCUSSION[groove][i] !== '.' && chance(bar, i, 3) < 0.4 + e * 0.6) add('perc', PERCUSSION[groove][i] === 'x' ? 0.7 : 0.4);

  // The phrase still breathes: a snare pickup closes every 4th bar once there is some energy.
  if (e > 0.35 && bar % 4 === 3 && (i === 14 || i === 15)) add('snare', i === 15 ? 0.7 : 0.5);
  return hits;
}

/** The bass of a generated bar: it locks to the generated kick, and grows octaves and fifths with energy. */
export function reactiveBassStep(groove: Groove, step: number, bar: number, feel: Feel): BassStep | null {
  const i = step % 16;
  const e = feel.energy;
  if (feel.fillStep !== null) return feel.fillStep === 0 ? { interval: 0, steps: 4, velocity: 0.85 } : null;
  if (e < 0.25) return i % 8 === 0 ? { interval: 0, steps: 8, velocity: 0.82 } : null;
  const kick = reactiveKick(groove, step, bar, feel);
  if (kick !== null) {
    let next = 16;
    for (let j = i + 1; j < 16; j++) if (reactiveKick(groove, j, bar, feel) !== null) { next = j; break; }
    const jump = i !== 0 && e > 0.7 && chance(bar, i, 5) < 0.35;
    return { interval: jump ? (chance(bar, i, 6) < 0.5 ? 12 : 7) : 0, steps: next - i, velocity: i === 0 ? 0.95 : 0.85 };
  }
  if (e > 0.6 && i % 4 === 2 && chance(bar, i, 7) < (e - 0.6) * 1.5) return { interval: 12, steps: 1, velocity: 0.68 };
  // Leading into the next bar: the fifth on the last 8th when the hands are high.
  if (e > 0.8 && i === 14 && chance(bar, i, 8) < 0.5) return { interval: 7, steps: 2, velocity: 0.75 };
  return null;
}

/** Steps to the next reactive bass onset in the bar (how long a chord-change hit rings). */
export function reactiveStepsToNextBass(groove: Groove, step: number, bar: number, feel: Feel): number {
  const i = step % 16;
  for (let j = i + 1; j < 16; j++) if (reactiveBassStep(groove, j, bar, feel)) return j - i;
  return 16 - i;
}
