/**
 * MIDI input source — a controller's keys, wheels and knobs become synthetic
 * HandFrames, so the same ChordReader → audio pipeline consumes them exactly
 * like camera hands or the computer keyboard.
 *
 * Why a SPLIT keyboard and not two MIDI channels (fixed 2026-11-02):
 * the first draft read harmony off channel 1 and expression off channel 2.
 * Real 25-key controllers (Arturia MiniLab / SMK25 and friends) send every
 * key on ONE channel, so the right hand never materialised — and since
 * ChordReader only sounds when BOTH hands are present, the instrument was
 * mute until you happened to touch a knob. The keyboard is split instead:
 *
 *   keys BELOW the split  → left hand: pitch class picks the scale degree
 *                           (I–VII), velocity sets loudness
 *   keys AT/ABOVE split   → right hand: how many are held picks the chord
 *                           style (1 triad · 2 inversion · 3 seventh · 4 ninth)
 *   mod wheel (CC 1)      → loudness override
 *   pitch bend            → wrist tilt (major/minor in tilt mode)
 *   sustain pedal (CC 64) → octave down (the right thumb)
 *   CC 74 / CC 10         → tone (the filter sweep)
 *
 * The right hand is IMPLIED while any left key is held, so one hand on the
 * low keys already sounds; touching the upper keys only changes the voicing.
 * A 25-key controller therefore plays the instrument on its own, and a
 * 49/61-key one gets a genuine two-hand split.
 */

import type { HandData } from '../types';
import type { HandFrame, HandInputSource, InputSource } from './types';
import { loadMidiConfig, saveMidiConfig, type MidiConfig } from './midiKeymap';

interface HeldNote {
  velocity: number;
  /** performance.now() when the key went down. */
  at: number;
}

interface MidiState {
  /** Keys held below the split point (harmony). */
  left: Map<number, HeldNote>;
  /** Keys held at/above the split point (expression). */
  right: Map<number, HeldNote>;
  /** Continuous controller values, controller number → 0-127. */
  cc: Map<number, number>;
  /** Pitch bend, -8192..8191 (0 = centred). */
  pitchBend: number;
  /** Sustain pedal (CC 64) is down. */
  sustain: boolean;
  /** performance.now() of the last message from the device, or null. */
  lastActivity: number | null;
  /** Messages seen since the device was selected (for the indicator). */
  messages: number;
}

function freshState(): MidiState {
  return {
    left: new Map(),
    right: new Map(),
    cc: new Map(),
    pitchBend: 0,
    sustain: false,
    lastActivity: null,
    messages: 0,
  };
}

/** MIDI status bytes (the channel lives in the low nibble). */
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const PITCH_BEND = 0xe0;

const CC_MOD_WHEEL = 1;
const CC_PAN = 10;
const CC_EXPRESSION = 11;
const CC_SUSTAIN = 64;
const CC_BRIGHTNESS = 74;

/**
 * Pitch class → scale degree (1–7). A black key takes the degree of the
 * white key below it, so a chromatic run never silently falls back to I.
 */
const PITCH_CLASS_DEGREE: readonly number[] = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7];

/** Scale degree (1–7) for a note, independent of octave. */
export function noteToDegree(note: number): number {
  return PITCH_CLASS_DEGREE[((note % 12) + 12) % 12];
}

/** The most recently pressed key in a region wins, so a run tracks the player. */
function newestOf(notes: Map<number, HeldNote>): { note: number; held: HeldNote } | null {
  let best: { note: number; held: HeldNote } | null = null;
  for (const [note, held] of notes) if (!best || held.at > best.held.at) best = { note, held };
  return best;
}

/**
 * Loudness 0–1 from the controller: the mod wheel (or expression pedal)
 * overrides, otherwise the velocity of the key being played.
 */
function loudnessFrom(state: MidiState, velocity: number): number {
  const wheel = state.cc.get(CC_MOD_WHEEL);
  const expression = state.cc.get(CC_EXPRESSION);
  if (wheel !== undefined && wheel > 0) return wheel / 127;
  if (expression !== undefined && expression < 127) return expression / 127;
  return Math.max(0.05, velocity / 127);
}

/**
 * ChordReader reads loudness off the right hand's HEIGHT: positionY 0 is the
 * top of frame (loud), 1 the bottom (quiet). It then clamps to 0.02–1 via
 * `1.1 - positionY`, so 0.1 maps to full and 1 to near-silence.
 */
function loudnessToPositionY(loudness: number): number {
  return Math.max(0, Math.min(1, 1.1 - loudness));
}

/** Tone (the filter sweep): brightness or pan, centred at 64 → -1..1. */
function toneFrom(state: MidiState): number {
  const brightness = state.cc.get(CC_BRIGHTNESS);
  const pan = state.cc.get(CC_PAN);
  const raw = brightness ?? pan;
  if (raw === undefined) return 0;
  return Math.max(-1, Math.min(1, (raw - 64) / 63));
}

/** Left hand: the scale degree under the player's fingers. */
function buildLeftHand(state: MidiState, config: MidiConfig): HandData | null {
  const newest = newestOf(state.left);
  if (!newest) return null;

  const degree = noteToDegree(newest.note);
  // The same shapes KeyboardSource uses, so ChordReader reads VI/VII identically:
  // VI is index+pinky, VII adds the thumb; I–V are a plain finger count.
  let extendedFingers: string[];
  let fingerCount: number;
  if (degree === 6) {
    extendedFingers = ['index', 'pinky'];
    fingerCount = 2;
  } else if (degree === 7) {
    extendedFingers = ['index', 'pinky', 'thumb'];
    fingerCount = 3;
  } else {
    extendedFingers = ['index'];
    fingerCount = degree;
  }

  // Pitch bend is the wrist: bend up for major, down for minor (tilt mode).
  const tiltAngle = config.pitchBendTilt ? Math.max(-1, Math.min(1, state.pitchBend / 8192)) : 1;

  return {
    landmarks: [],
    label: 'Left',
    fingerCount,
    extendedFingers,
    tiltAngle,
    positionY: 0.5,
    positionX: 0.3,
  };
}

/**
 * Right hand: implied as soon as a left key is held (so one hand plays), with
 * the voicing taken from however many upper keys are also down.
 */
function buildRightHand(state: MidiState, config: MidiConfig): HandData | null {
  const leftPlaying = state.left.size > 0;
  const upperHeld = state.right.size;
  if (!leftPlaying && upperHeld === 0) return null;

  // 1 key → triad, 2 → first inversion, 3 → seventh, 4+ → ninth. With no upper
  // key held the player's configured resting style applies.
  const styleFinger = upperHeld > 0 ? Math.min(4, upperHeld) : config.restingChordStyle;

  const newestLeft = newestOf(state.left);
  const loudness = loudnessFrom(state, newestLeft?.held.velocity ?? 100);

  return {
    landmarks: [],
    label: 'Right',
    fingerCount: styleFinger,
    // The right thumb is ChordReader's octave-down flag; the sustain pedal holds it.
    extendedFingers: state.sustain ? ['thumb'] : ['index'],
    tiltAngle: toneFrom(state),
    positionY: loudnessToPositionY(loudness),
    positionX: 0.7,
  };
}

/** One device as the connection indicator shows it. */
export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
}

/** Everything the connection indicator needs, in one snapshot. */
export interface MidiStatus {
  /** The browser exposes the Web MIDI API at all. */
  supported: boolean;
  devices: MidiDeviceInfo[];
  selectedId: string | null;
  selectedName: string | null;
  /** Milliseconds since the device last said anything, or null if never. */
  sinceActivityMs: number | null;
  /** Messages received from the selected device. */
  messages: number;
}

function describe(input: MIDIInput): MidiDeviceInfo {
  return {
    id: input.id,
    name: input.name || 'MIDI device',
    manufacturer: input.manufacturer || '',
  };
}

export class MidiSource implements HandInputSource {
  readonly kind: InputSource = 'midi';

  private state: MidiState = freshState();
  private access: MIDIAccess | null = null;
  private selected: MIDIInput | null = null;
  private config: MidiConfig = loadMidiConfig();
  /** Fired when devices appear/disappear, so the indicator can refresh. */
  private onDevices: (() => void) | null = null;

  /** True when the browser can talk to MIDI devices at all. */
  static get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  /** Subscribe to connect/disconnect (NOT to every message — that would thrash). */
  setOnDevices(fn: (() => void) | null): void {
    this.onDevices = fn;
  }

  /**
   * Ask the browser for MIDI access and return the inputs found. Throws when
   * the API is missing or the user denies the permission prompt.
   */
  async requestAccess(): Promise<MidiDeviceInfo[]> {
    if (!MidiSource.supported) throw new Error('This browser does not support MIDI devices.');
    if (!this.access) {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      // Hot-plug: a controller connected later must start working without a reload,
      // and re-selecting re-attaches the message handler to the new port object.
      this.access.onstatechange = () => {
        if (this.selected && this.access) {
          const live = this.access.inputs.get(this.selected.id);
          if (live && live !== this.selected) this.attach(live);
        }
        this.onDevices?.();
      };
    }
    return this.listDevices();
  }

  /** The inputs currently plugged in. */
  listDevices(): MidiDeviceInfo[] {
    if (!this.access) return [];
    return Array.from(this.access.inputs.values()).map(describe);
  }

  /**
   * Listen to one input (or null to stop listening). Returns the device
   * actually selected, so the caller can show its name.
   */
  selectDevice(inputId: string | null): MidiDeviceInfo | null {
    if (this.selected) this.selected.onmidimessage = null;
    this.selected = null;
    this.state = freshState();
    if (!inputId || !this.access) return null;
    const input = this.access.inputs.get(inputId);
    if (!input) return null;
    this.attach(input);
    return describe(input);
  }

  private attach(input: MIDIInput): void {
    this.selected = input;
    input.onmidimessage = (e) => this.handleMessage(e);
    // Some ports need an explicit open before they deliver anything.
    void input.open?.().catch(() => undefined);
  }

  /** A snapshot for the connection indicator. */
  getStatus(): MidiStatus {
    return {
      supported: MidiSource.supported,
      devices: this.listDevices(),
      selectedId: this.selected?.id ?? null,
      selectedName: this.selected ? describe(this.selected).name : null,
      sinceActivityMs: this.state.lastActivity === null ? null : performance.now() - this.state.lastActivity,
      messages: this.state.messages,
    };
  }

  /** The player's controller settings (split point, resting style, …). */
  getConfig(): MidiConfig {
    return { ...this.config };
  }

  setConfig(patch: Partial<MidiConfig>): MidiConfig {
    this.config = { ...this.config, ...patch };
    saveMidiConfig(this.config);
    return this.getConfig();
  }

  /** One frame out, built from whatever the controller is currently holding. */
  getFrame(): HandFrame {
    return {
      left: buildLeftHand(this.state, this.config),
      right: buildRightHand(this.state, this.config),
      source: 'midi',
    };
  }

  /** Forget held keys and wheels (fired on stop); the device stays selected. */
  reset(): void {
    const { lastActivity, messages } = this.state;
    this.state = freshState();
    // Keep the activity trail so the indicator does not flash "never connected".
    this.state.lastActivity = lastActivity;
    this.state.messages = messages;
  }

  /** Release the device entirely. */
  dispose(): void {
    if (this.selected) this.selected.onmidimessage = null;
    this.selected = null;
    if (this.access) this.access.onstatechange = null;
    this.state = freshState();
  }

  private handleMessage(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = data[0];
    const data1 = data[1];
    const data2 = data[2] ?? 0;
    const command = status & 0xf0;
    const channel = (status & 0x0f) + 1;

    // Channel filter: 0 (the default) listens to every channel, which is what a
    // single-channel controller needs; 1-16 pins it to one.
    if (this.config.channel !== 0 && channel !== this.config.channel) return;

    this.state.lastActivity = performance.now();
    this.state.messages++;

    switch (command) {
      case NOTE_ON:
        // Note On with velocity 0 is Note Off on most hardware.
        if (data2 > 0) this.noteDown(data1, data2);
        else this.noteUp(data1);
        break;

      case NOTE_OFF:
        this.noteUp(data1);
        break;

      case CONTROL_CHANGE:
        this.state.cc.set(data1, data2);
        if (data1 === CC_SUSTAIN) this.state.sustain = data2 >= 64;
        break;

      case PITCH_BEND:
        // 14-bit, little end first: 0..16383 centred at 8192.
        this.state.pitchBend = ((data2 << 7) | data1) - 8192;
        break;

      default:
        break;
    }
  }

  private noteDown(note: number, velocity: number): void {
    const region = note < this.config.splitNote ? this.state.left : this.state.right;
    region.set(note, { velocity, at: performance.now() });
  }

  private noteUp(note: number): void {
    // Release from both regions: the split may have moved while the key was down.
    this.state.left.delete(note);
    this.state.right.delete(note);
  }
}
