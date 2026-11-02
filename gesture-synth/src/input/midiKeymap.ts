/**
 * MIDI controller settings (2026-11-02).
 *
 * The first draft of this file declared 22 rebindable "actions" (one per knob,
 * transport button and wheel) — but MidiSource.handleMessage read hardcoded
 * controller numbers and ignored the map entirely, so nothing a player changed
 * here had any effect. It is now the small set of settings that MidiSource
 * actually reads, persisted to localStorage, plus the fixed control reference
 * the settings UI prints.
 *
 * Controls that are genuinely standard (mod wheel CC 1, sustain CC 64,
 * brightness CC 74, pan CC 10, expression CC 11, pitch bend) stay fixed:
 * every class-compliant controller sends them on those numbers, so a rebinding
 * UI would be ceremony with no payoff.
 */

export interface MidiConfig {
  /**
   * Keys below this note drive harmony, keys at or above it drive the voicing.
   * Default 60 (C4) splits a 25-key C3–C5 controller into 12 + 13 keys.
   */
  splitNote: number;
  /**
   * MIDI channel to listen on: 0 = every channel (right for single-channel
   * controllers such as the SMK25), 1-16 pins it to one.
   */
  channel: number;
  /** Chord style while no upper key is held: 1 triad · 2 inv · 3 seventh · 4 ninth. */
  restingChordStyle: number;
  /** Pitch bend acts as wrist tilt (major/minor in tilt harmony mode). */
  pitchBendTilt: boolean;
}

export const DEFAULT_MIDI_CONFIG: MidiConfig = {
  splitNote: 60,
  channel: 0,
  restingChordStyle: 1,
  pitchBendTilt: true,
};

/** Split-point choices offered in the settings UI, with the octave named. */
export const SPLIT_OPTIONS: ReadonlyArray<{ note: number; label: string }> = [
  { note: 48, label: 'C3 — all keys play the voicing' },
  { note: 55, label: 'G3' },
  { note: 60, label: 'C4 (middle C) — recommended for 25 keys' },
  { note: 67, label: 'G4' },
  { note: 72, label: 'C5 — all keys play harmony' },
];

export const CHORD_STYLE_LABELS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Triad' },
  { value: 2, label: 'First inversion' },
  { value: 3, label: 'Seventh' },
  { value: 4, label: 'Ninth' },
];

/** What each control does — printed in the settings panel, not editable. */
export const MIDI_CONTROL_REFERENCE: ReadonlyArray<{ control: string; does: string }> = [
  { control: 'Keys below the split', does: 'Scale degree I–VII (the chord), velocity sets loudness' },
  { control: 'Keys above the split', does: 'How many you hold picks the voicing: 1 triad · 2 inversion · 3 seventh · 4 ninth' },
  { control: 'Mod wheel (CC 1)', does: 'Loudness, overriding velocity' },
  { control: 'Pitch bend', does: 'Wrist tilt — bend up for major, down for minor (tilt harmony mode)' },
  { control: 'Sustain pedal (CC 64)', does: 'Drops the chord an octave while held' },
  { control: 'Knob on CC 74 or CC 10', does: 'Tone (the filter sweep)' },
  { control: 'Expression pedal (CC 11)', does: 'Loudness, like the mod wheel' },
];

const STORAGE_KEY = 'gesto-midi-config';

export function loadMidiConfig(): MidiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MIDI_CONFIG };
    const saved = JSON.parse(raw) as Partial<Record<keyof MidiConfig, unknown>>;
    return {
      splitNote: typeof saved.splitNote === 'number' && saved.splitNote >= 0 && saved.splitNote <= 127
        ? Math.round(saved.splitNote) : DEFAULT_MIDI_CONFIG.splitNote,
      channel: typeof saved.channel === 'number' && saved.channel >= 0 && saved.channel <= 16
        ? Math.round(saved.channel) : DEFAULT_MIDI_CONFIG.channel,
      restingChordStyle: typeof saved.restingChordStyle === 'number' && saved.restingChordStyle >= 1 && saved.restingChordStyle <= 4
        ? Math.round(saved.restingChordStyle) : DEFAULT_MIDI_CONFIG.restingChordStyle,
      pitchBendTilt: typeof saved.pitchBendTilt === 'boolean' ? saved.pitchBendTilt : DEFAULT_MIDI_CONFIG.pitchBendTilt,
    };
  } catch {
    return { ...DEFAULT_MIDI_CONFIG };
  }
}

export function saveMidiConfig(config: MidiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage unavailable (private mode, quota) — settings just won't persist.
  }
}

/** Note name for a MIDI number, e.g. 60 → "C4". */
export function noteName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}
