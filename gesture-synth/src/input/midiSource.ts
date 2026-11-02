/**
 * MIDI input source — maps MIDI controller messages to synthetic HandFrames
 * so the same chord reader / audio pipeline can consume them.
 *
 * Default mapping targets the Arturia MiniLab / SMK25 layout but is fully
 * customizable via midiKeymap.ts (player overrides persisted to localStorage).
 */

import type { HandData } from '../types';
import type { HandFrame, HandInputSource, InputSource } from './types';
import { DEFAULT_MIDI_MAP, loadMidiMap, saveMidiMap, type MidiAction, type MidiMap } from './midiKeymap';

interface MidiState {
  /** Currently held notes on channel 1 (left hand: harmony) */
  leftNotes: Map<number, { velocity: number; timestamp: number }>;
  /** Currently held notes on channel 2 (right hand: expression) */
  rightNotes: Map<number, { velocity: number; timestamp: number }>;
  /** CC values (controller number -> 0-127) */
  cc: Map<number, number>;
  /** Pitch bend value (-8192..8191) */
  pitchBend: number;
  /** Last activity timestamp for auto-reset detection */
  lastActivity: number;
  /** Sustain pedal state (CC 64) */
  sustain: boolean;
}

const DEFAULT_STATE: MidiState = {
  leftNotes: new Map(),
  rightNotes: new Map(),
  cc: new Map(),
  pitchBend: 0,
  lastActivity: 0,
  sustain: false,
};

// Note ranges for SMK25 (25 keys = C3 to C5, MIDI 48-72)
const LEFT_HAND_CHANNEL = 1;  // MIDI channel 1 (0-indexed = 0)
const RIGHT_HAND_CHANNEL = 2; // MIDI channel 2 (0-indexed = 1)
const NOTE_MIN = 48; // C3

/** Convert a held note to a scale degree (1-7) based on C major as reference */
function noteToDegree(note: number): number {
  const normalized = ((note - NOTE_MIN) % 12 + 12) % 12;
  const degreeMap: Record<number, number> = { 0: 1, 2: 2, 4: 3, 5: 4, 7: 5, 9: 6, 11: 7 };
  return degreeMap[normalized] ?? 1;
}

/** Build a synthetic left hand from currently held notes on channel 1 */
function buildLeftHand(state: MidiState): HandData | null {
  if (state.leftNotes.size === 0) return null;

  // Find the lowest held note as the root (degree)
  let lowestNote = Infinity;
  for (const [note] of state.leftNotes) {
    if (note < lowestNote) lowestNote = note;
  }

  const degree = noteToDegree(lowestNote);
  // Determine extended fingers like keyboard source
  let extendedFingers: string[];
  let fingerCount: number;
  if (degree === 6) { extendedFingers = ['index', 'pinky']; fingerCount = 2; }
  else if (degree === 7) { extendedFingers = ['index', 'pinky', 'thumb']; fingerCount = 3; }
  else { extendedFingers = degree >= 1 ? ['index'] : []; fingerCount = degree; }

  // Pitch bend -> tilt (-1..1)
  const tilt = state.pitchBend / 8192;

  // Mod wheel (CC 1) or CC 7 -> volume (positionY: 0 top=loud, 1 bottom=quiet)
  const modWheel = state.cc.get(1) ?? 0;
  const cc7 = state.cc.get(7) ?? 127;
  const volume = Math.max(modWheel, cc7) / 127;
  const positionY = 1 - volume; // invert: high positionY = low volume

  return {
    landmarks: [],
    label: 'Left',
    fingerCount,
    extendedFingers,
    tiltAngle: tilt,
    positionY,
    positionX: 0.3,
  };
}

/** Build a synthetic right hand from currently held notes on channel 2 + CCs */
function buildRightHand(state: MidiState): HandData | null {
  // Right hand exists if we have notes on channel 2 OR relevant CCs moving
  const hasRightNotes = state.rightNotes.size > 0;
  const hasExpressionCC = state.cc.size > 0;

  if (!hasRightNotes && !hasExpressionCC) return null;

  // Chord style from lowest held note on channel 2 (or default to triad)
  let styleFinger = 1;
  if (hasRightNotes) {
    let lowest = Infinity;
    for (const note of state.rightNotes.keys()) if (note < lowest) lowest = note;
    const normalized = ((lowest - NOTE_MIN) % 12 + 12) % 12;
    // Map chromatic to 1-4: C=1, C#=2, D=3, D#=4, E=1...
    styleFinger = (normalized % 4) + 1;
  }

  // Octave down from sustain pedal or specific note
  const thumb = state.sustain;

  // CC 74 (brightness) or CC 10 (pan) -> tiltAngle (-1..1)
  const cc74 = state.cc.get(74) ?? 64;
  const cc10 = state.cc.get(10) ?? 64;
  const tiltAngle = ((cc74 - 64) + (cc10 - 64)) / 64; // -2..2, clamp later
  const clampedTilt = Math.max(-1, Math.min(1, tiltAngle));

  // CC 1 (mod wheel) or CC 11 (expression) -> volume/positionY
  const cc1 = state.cc.get(1) ?? 0;
  const cc11 = state.cc.get(11) ?? 127;
  const exprVolume = Math.max(cc1, cc11) / 127;
  const positionY = 1 - exprVolume;

  return {
    landmarks: [],
    label: 'Right',
    fingerCount: styleFinger,
    extendedFingers: thumb ? ['thumb'] : ['index'],
    tiltAngle: clampedTilt,
    positionY,
    positionX: 0.7,
  };
}

export class MidiSource implements HandInputSource {
  readonly kind: InputSource = 'midi';

  private state: MidiState = structuredClone(DEFAULT_STATE);
  private access: MIDIAccess | null = null;
  private selectedInputId: string | null = null;
  private onStateChange: (() => void) | null = null;
  private map: MidiMap = loadMidiMap();

  /** Call when the mapping changes to notify UI */
  setOnChange(fn: () => void): void { this.onStateChange = fn; }

  /** Request MIDI access and list available inputs */
  async requestAccess(): Promise<MIDIInput[]> {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI API not supported in this browser.');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = (e: Event) => this.handleStateChange(e);
    return Array.from(this.access.inputs.values());
  }

  /** Select which MIDI input device to use */
  selectInput(inputId: string | null): void {
    this.selectedInputId = inputId;
    this.reset();
    // Attach listeners to the new input
    if (this.access && inputId) {
      const input = this.access.inputs.get(inputId);
      if (input) input.onmidimessage = (e) => this.handleMessage(e);
    }
  }

  /** Get currently available MIDI inputs */
  getInputs(): MIDIInput[] {
    return this.access ? Array.from(this.access.inputs.values()) : [];
  }

  /** Get the currently selected input ID */
  getSelectedInputId(): string | null { return this.selectedInputId; }

  /** Get the current MIDI map (for settings UI) */
  getMap(): MidiMap { return { ...this.map }; }

  /** Update a single mapping */
  setMapping(action: MidiAction, message: MidiMessageSpec): void {
    this.map[action] = message;
    saveMidiMap(this.map);
    this.onStateChange?.();
  }

  /** Reset all mappings to defaults */
  resetMappings(): void {
    this.map = { ...DEFAULT_MIDI_MAP };
    saveMidiMap(this.map);
    this.onStateChange?.();
  }

  /** Produce the current HandFrame (polling-based, called each rAF) */
  getFrame(): HandFrame {
    const left = buildLeftHand(this.state);
    const right = buildRightHand(this.state);
    return { left, right, source: 'midi' };
  }

  /** Reset per-session state */
  reset(): void {
    this.state = structuredClone(DEFAULT_STATE);
  }

  private handleStateChange(_e: Event): void {
    // Device connected/disconnected - could trigger UI update
    this.onStateChange?.();
  }

  private handleMessage(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data) return;
    const status = data[0];
    const data1 = data[1];
    const data2 = data[2] ?? 0;
    const channel = (status & 0x0f) + 1; // 1-16
    const cmd = status & 0xf0;
    const now = performance.now();
    this.state.lastActivity = now;

    switch (cmd) {
      case 0x90: // Note On
        if (data2 > 0) {
          if (channel === LEFT_HAND_CHANNEL) {
            this.state.leftNotes.set(data1, { velocity: data2, timestamp: now });
          } else if (channel === RIGHT_HAND_CHANNEL) {
            this.state.rightNotes.set(data1, { velocity: data2, timestamp: now });
          }
        } else {
          // Note On with velocity 0 = Note Off
          if (channel === LEFT_HAND_CHANNEL) this.state.leftNotes.delete(data1);
          else if (channel === RIGHT_HAND_CHANNEL) this.state.rightNotes.delete(data1);
        }
        break;

      case 0x80: // Note Off
        if (channel === LEFT_HAND_CHANNEL) this.state.leftNotes.delete(data1);
        else if (channel === RIGHT_HAND_CHANNEL) this.state.rightNotes.delete(data1);
        break;

      case 0xB0: // Control Change
        this.state.cc.set(data1, data2);
        // Sustain pedal (CC 64)
        if (data1 === 64) this.state.sustain = data2 >= 64;
        break;

      case 0xE0: // Pitch Bend
        this.state.pitchBend = (data2 << 7) | data1; // 0-16383
        // Convert to -8192..8191
        this.state.pitchBend -= 8192;
        break;

      default:
        break;
    }
    this.onStateChange?.();
  }
}

/** MIDI message specification for mapping UI */
export interface MidiMessageSpec {
  type: 'note' | 'cc' | 'pitchbend' | 'program';
  channel: number; // 1-16
  note?: number;   // for note type
  controller?: number; // for cc type
  /** Human-readable description */
  label: string;
}

// Re-export for convenience
export type { MidiAction, MidiMap };
export { loadMidiMap, saveMidiMap, DEFAULT_MIDI_MAP } from './midiKeymap';
