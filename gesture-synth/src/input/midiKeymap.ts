/**
 * Customizable MIDI controller mappings (2026-11).
 *
 * Like the keyboard keymap, this is the single source of truth for default
 * bindings, their display copy, and localStorage persistence of player overrides.
 * MidiSource reads/writes through this so nothing drifts.
 */

export interface MidiMessageSpec {
  type: 'note' | 'cc' | 'pitchbend' | 'program';
  channel: number; // 1-16
  note?: number;   // for note type
  controller?: number; // for cc type
  /** Human-readable description */
  label: string;
}

export type MidiAction =
  // Left hand (harmony) - note messages on channel 1
  | 'leftNoteOn' | 'leftNoteOff'
  // Right hand (expression) - note messages on channel 2
  | 'rightNoteOn' | 'rightNoteOff'
  // Expression controls (CCs)
  | 'volume'        // CC 7 - master volume
  | 'pan'           // CC 10 - pan/tilt
  | 'expression'    // CC 11 - expression
  | 'modWheel'      // CC 1 - mod wheel
  | 'brightness'    // CC 74 - brightness/filter
  | 'resonance'     // CC 71 - resonance
  | 'reverbSend'    // CC 91 - reverb send
  | 'chorusSend'    // CC 93 - chorus send
  | 'portamentoTime' // CC 5 - portamento time
  | 'portamentoControl' // CC 84 - portamento control
  // Special controls
  | 'pitchBend'     // Pitch bend wheel
  | 'sustain'       // CC 64 - sustain pedal
  // Transport (configurable notes/CCs)
  | 'transportPlay'
  | 'transportStop'
  | 'transportRecord'
  | 'tapTempo'
  | 'octaveDown'
  | 'octaveUp';

export interface MidiActionMeta {
  label: string;
  group: 'harmony' | 'expression' | 'transport' | 'special';
  /** Default message spec for this action */
  defaultSpec: MidiMessageSpec;
}

export const MIDI_ACTION_META: Record<MidiAction, MidiActionMeta> = {
  leftNoteOn:   { label: 'Left hand notes (Ch 1)', group: 'harmony',   defaultSpec: { type: 'note', channel: 1, note: 0, label: 'Note On Ch 1' } },
  leftNoteOff:  { label: 'Left hand release (Ch 1)', group: 'harmony', defaultSpec: { type: 'note', channel: 1, note: 0, label: 'Note Off Ch 1' } },
  rightNoteOn:  { label: 'Right hand notes (Ch 2)', group: 'expression', defaultSpec: { type: 'note', channel: 2, note: 0, label: 'Note On Ch 2' } },
  rightNoteOff: { label: 'Right hand release (Ch 2)', group: 'expression', defaultSpec: { type: 'note', channel: 2, note: 0, label: 'Note Off Ch 2' } },
  volume:       { label: 'Volume (CC 7)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 7, label: 'CC 7 Volume' } },
  pan:          { label: 'Pan / Tilt (CC 10)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 10, label: 'CC 10 Pan' } },
  expression:   { label: 'Expression (CC 11)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 11, label: 'CC 11 Expression' } },
  modWheel:     { label: 'Mod Wheel (CC 1)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 1, label: 'CC 1 Mod Wheel' } },
  brightness:   { label: 'Brightness (CC 74)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 74, label: 'CC 74 Brightness' } },
  resonance:    { label: 'Resonance (CC 71)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 71, label: 'CC 71 Resonance' } },
  reverbSend:   { label: 'Reverb Send (CC 91)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 91, label: 'CC 91 Reverb' } },
  chorusSend:   { label: 'Chorus Send (CC 93)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 93, label: 'CC 93 Chorus' } },
  portamentoTime: { label: 'Portamento Time (CC 5)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 5, label: 'CC 5 Portamento Time' } },
  portamentoControl: { label: 'Portamento Ctrl (CC 84)', group: 'expression', defaultSpec: { type: 'cc', channel: 1, controller: 84, label: 'CC 84 Portamento Ctrl' } },
  pitchBend:    { label: 'Pitch Bend Wheel', group: 'special', defaultSpec: { type: 'pitchbend', channel: 1, label: 'Pitch Bend Ch 1' } },
  sustain:      { label: 'Sustain Pedal (CC 64)', group: 'special', defaultSpec: { type: 'cc', channel: 1, controller: 64, label: 'CC 64 Sustain' } },
  transportPlay:  { label: 'Play', group: 'transport', defaultSpec: { type: 'note', channel: 1, note: 117, label: 'Note 117 (F#8) Play' } },
  transportStop:  { label: 'Stop', group: 'transport', defaultSpec: { type: 'note', channel: 1, note: 118, label: 'Note 118 (G8) Stop' } },
  transportRecord:{ label: 'Record', group: 'transport', defaultSpec: { type: 'note', channel: 1, note: 119, label: 'Note 119 (G#8) Record' } },
  tapTempo:     { label: 'Tap Tempo', group: 'transport', defaultSpec: { type: 'note', channel: 1, note: 120, label: 'Note 120 (A8) Tap' } },
  octaveDown:   { label: 'Octave Down', group: 'transport', defaultSpec: { type: 'note', channel: 1, note: 36, label: 'Note 36 (C2) Octave Down' } },
  octaveUp:     { label: 'Octave Up', group: 'transport', defaultSpec: { type: 'note', channel: 1, note: 37, label: 'Note 37 (C#2) Octave Up' } },
};

export const MIDI_ACTION_ORDER: MidiAction[] = [
  'leftNoteOn', 'leftNoteOff', 'rightNoteOn', 'rightNoteOff',
  'volume', 'pan', 'expression', 'modWheel', 'brightness', 'resonance',
  'reverbSend', 'chorusSend', 'portamentoTime', 'portamentoControl',
  'pitchBend', 'sustain',
  'transportPlay', 'transportStop', 'transportRecord', 'tapTempo',
  'octaveDown', 'octaveUp',
];

/** Default mapping for Arturia MiniLab MkII / SMK25 */
export const DEFAULT_MIDI_MAP: MidiMap = {
  leftNoteOn:   { type: 'note', channel: 1, note: 0, label: 'Note On Ch 1 (any)' },
  leftNoteOff:  { type: 'note', channel: 1, note: 0, label: 'Note Off Ch 1 (any)' },
  rightNoteOn:  { type: 'note', channel: 2, note: 0, label: 'Note On Ch 2 (any)' },
  rightNoteOff: { type: 'note', channel: 2, note: 0, label: 'Note Off Ch 2 (any)' },
  volume:       { type: 'cc', channel: 1, controller: 7, label: 'CC 7 Volume' },
  pan:          { type: 'cc', channel: 1, controller: 10, label: 'CC 10 Pan' },
  expression:   { type: 'cc', channel: 1, controller: 11, label: 'CC 11 Expression' },
  modWheel:     { type: 'cc', channel: 1, controller: 1, label: 'CC 1 Mod Wheel' },
  brightness:   { type: 'cc', channel: 1, controller: 74, label: 'CC 74 Brightness' },
  resonance:    { type: 'cc', channel: 1, controller: 71, label: 'CC 71 Resonance' },
  reverbSend:   { type: 'cc', channel: 1, controller: 91, label: 'CC 91 Reverb' },
  chorusSend:   { type: 'cc', channel: 1, controller: 93, label: 'CC 93 Chorus' },
  portamentoTime: { type: 'cc', channel: 1, controller: 5, label: 'CC 5 Portamento Time' },
  portamentoControl: { type: 'cc', channel: 1, controller: 84, label: 'CC 84 Portamento Ctrl' },
  pitchBend:    { type: 'pitchbend', channel: 1, label: 'Pitch Bend Ch 1' },
  sustain:      { type: 'cc', channel: 1, controller: 64, label: 'CC 64 Sustain' },
  transportPlay:  { type: 'note', channel: 1, note: 117, label: 'Note 117 Play' },
  transportStop:  { type: 'note', channel: 1, note: 118, label: 'Note 118 Stop' },
  transportRecord:{ type: 'note', channel: 1, note: 119, label: 'Note 119 Record' },
  tapTempo:     { type: 'note', channel: 1, note: 120, label: 'Note 120 Tap' },
  octaveDown:   { type: 'note', channel: 1, note: 36, label: 'Note 36 Octave Down' },
  octaveUp:     { type: 'note', channel: 1, note: 37, label: 'Note 37 Octave Up' },
};

export interface MidiKeymapPreset {
  id: string;
  label: string;
  map: MidiMap;
}

export type MidiMap = Record<MidiAction, MidiMessageSpec>;

/** Built-in presets for common controllers */
export const MIDI_KEYMAP_PRESETS: MidiKeymapPreset[] = [
  { id: 'smk25', label: 'Arturia MiniLab / SMK25 (default)', map: { ...DEFAULT_MIDI_MAP } },
  { id: 'generic', label: 'Generic (Ch 1 = harmony, Ch 2 = expression)', map: { ...DEFAULT_MIDI_MAP } },
];

export function matchingMidiPresetId(map: MidiMap): string {
  const preset = MIDI_KEYMAP_PRESETS.find((p) => MIDI_ACTION_ORDER.every((a) => {
    const saved = p.map[a];
    const current = map[a];
    return saved.type === current.type && saved.channel === current.channel &&
           saved.note === current.note && saved.controller === current.controller;
  }));
  return preset?.id ?? 'custom';
}

const MIDI_STORAGE_KEY = 'gesto-midi-keymap';

export function loadMidiMap(): MidiMap {
  try {
    const raw = localStorage.getItem(MIDI_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MIDI_MAP };
    const saved = JSON.parse(raw) as Partial<MidiMap>;
    return { ...DEFAULT_MIDI_MAP, ...saved };
  } catch {
    return { ...DEFAULT_MIDI_MAP };
  }
}

export function saveMidiMap(map: MidiMap): void {
  try {
    localStorage.setItem(MIDI_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable
  }
}

/** Display helper for MIDI messages */
export function displayMidiMessage(spec: MidiMessageSpec): string {
  switch (spec.type) {
    case 'note': return `Note ${spec.note} Ch ${spec.channel}`;
    case 'cc': return `CC ${spec.controller} Ch ${spec.channel}`;
    case 'pitchbend': return `Pitch Bend Ch ${spec.channel}`;
    case 'program': return `Program Ch ${spec.channel}`;
    default: return 'Unknown';
  }
}
