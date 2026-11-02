import { beforeEach, describe, expect, it } from 'vitest';
import { MidiSource, noteToDegree } from '../input/midiSource';
import { ChordReader } from '../chordReader';
import { DEFAULT_MIDI_CONFIG } from '../input/midiKeymap';

// A fake MIDI port: we drive onmidimessage by hand, exactly as the browser would.
class FakeInput {
  onmidimessage: ((e: { data: Uint8Array }) => void) | null = null;
  constructor(readonly id: string, readonly name: string, readonly manufacturer = 'Test') {}
  open() { return Promise.resolve(this); }
}

function fakeAccess(inputs: FakeInput[]) {
  return {
    inputs: new Map(inputs.map((i) => [i.id, i])),
    onstatechange: null as unknown,
  };
}

/** Wire a MidiSource to a fake device and return both plus a message sender. */
async function connect(config = {}) {
  const input = new FakeInput('dev-1', 'Arturia MiniLab mkII');
  const access = fakeAccess([input]);
  (globalThis as unknown as { navigator: unknown }).navigator = {
    requestMIDIAccess: () => Promise.resolve(access),
  };
  const midi = new MidiSource();
  midi.setConfig({ ...DEFAULT_MIDI_CONFIG, ...config });
  const devices = await midi.requestAccess();
  midi.selectDevice('dev-1');
  const send = (...bytes: number[]) => input.onmidimessage?.({ data: new Uint8Array(bytes) });
  return { midi, send, devices };
}

const NOTE_ON_CH1 = 0x90;
const NOTE_OFF_CH1 = 0x80;
const CC_CH1 = 0xb0;
const BEND_CH1 = 0xe0;

beforeEach(() => {
  // midiKeymap persists through localStorage; keep each test independent.
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  });
});

describe('noteToDegree', () => {
  it('maps the white keys of an octave to degrees I-VII', () => {
    // C D E F G A B
    expect([60, 62, 64, 65, 67, 69, 71].map(noteToDegree)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('is octave independent', () => {
    expect(noteToDegree(48)).toBe(noteToDegree(72));
  });

  it('gives a black key the degree below it instead of falling back to I', () => {
    // The first draft returned 1 for every black key, so a chromatic run
    // collapsed onto the tonic.
    expect(noteToDegree(61)).toBe(1); // C# → I
    expect(noteToDegree(66)).toBe(4); // F# → IV, not I
    expect(noteToDegree(70)).toBe(6); // A# → VI, not I
  });
});

describe('MidiSource split keyboard', () => {
  it('sounds from the low keys ALONE (the two-channel draft stayed mute)', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 60, 100); // middle C is at the split, so one below it:
    midi.selectDevice('dev-1');
    const again = await connect();
    again.send(NOTE_ON_CH1, 55, 100); // G3, below the C4 split

    const frame = again.midi.getFrame();
    expect(frame.left).not.toBeNull();
    // The old build left this null until a knob moved, and ChordReader needs
    // BOTH hands, so the instrument was silent.
    expect(frame.right).not.toBeNull();

    const reading = new ChordReader().read(frame, { harmony: 'diatonicMajor', style: 'fingers' }, 1000);
    expect(reading.playing).toBe(true);
  });

  it('reads the scale degree from the newest low key', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 48, 100); // C3 → I
    expect(midi.getFrame().left?.fingerCount).toBe(1);
    send(NOTE_ON_CH1, 53, 100); // F3 → IV, pressed later so it wins
    expect(midi.getFrame().left?.fingerCount).toBe(4);
  });

  it('uses the VI / VII finger shapes ChordReader expects', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 57, 100); // A3 → VI
    expect(midi.getFrame().left?.extendedFingers).toEqual(['index', 'pinky']);
    send(NOTE_OFF_CH1, 57, 0);
    send(NOTE_ON_CH1, 59, 100); // B3 → VII
    expect(midi.getFrame().left?.extendedFingers).toEqual(['index', 'pinky', 'thumb']);

    // And ChordReader resolves them to degrees 5 and 6 (0-indexed VI and VII).
    const reading = new ChordReader().read(midi.getFrame(), { harmony: 'diatonicMajor', style: 'fingers' }, 1000);
    expect(reading.chordIndex).toBe(6);
  });

  it('picks the voicing from how many upper keys are held', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 100); // harmony
    expect(midi.getFrame().right?.fingerCount).toBe(1); // resting = triad
    send(NOTE_ON_CH1, 72, 100);
    expect(midi.getFrame().right?.fingerCount).toBe(1);
    send(NOTE_ON_CH1, 74, 100);
    expect(midi.getFrame().right?.fingerCount).toBe(2);
    send(NOTE_ON_CH1, 76, 100);
    expect(midi.getFrame().right?.fingerCount).toBe(3);
    send(NOTE_ON_CH1, 77, 100);
    expect(midi.getFrame().right?.fingerCount).toBe(4);
    // A fifth key cannot push it past the ninth.
    send(NOTE_ON_CH1, 79, 100);
    expect(midi.getFrame().right?.fingerCount).toBe(4);
  });

  it('releases a key regardless of which side of the split it was on', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 100);
    send(NOTE_OFF_CH1, 55, 0);
    expect(midi.getFrame().left).toBeNull();
    expect(midi.getFrame().right).toBeNull();
  });

  it('treats Note On velocity 0 as Note Off (what most hardware sends)', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 100);
    send(NOTE_ON_CH1, 55, 0);
    expect(midi.getFrame().left).toBeNull();
  });

  it('moves the split point when configured', async () => {
    const { midi, send } = await connect({ splitNote: 48 });
    send(NOTE_ON_CH1, 55, 100); // now ABOVE the split → voicing, not harmony
    const frame = midi.getFrame();
    expect(frame.left).toBeNull();
    expect(frame.right).not.toBeNull();
  });
});

describe('MidiSource expression', () => {
  it('lets velocity set the loudness ChordReader reads', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 127);
    const loud = new ChordReader().read(midi.getFrame(), { harmony: 'diatonicMajor', style: 'fingers' }, 1000).volume;
    send(NOTE_OFF_CH1, 55, 0);
    send(NOTE_ON_CH1, 55, 20);
    const quiet = new ChordReader().read(midi.getFrame(), { harmony: 'diatonicMajor', style: 'fingers' }, 2000).volume;
    expect(loud).toBeGreaterThan(quiet);
  });

  it('gives the mod wheel priority over velocity', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 10); // played softly
    send(CC_CH1, 1, 127); // mod wheel wide open
    const reading = new ChordReader().read(midi.getFrame(), { harmony: 'diatonicMajor', style: 'fingers' }, 1000);
    expect(reading.volume).toBeGreaterThan(0.9);
  });

  it('holds the octave down while the sustain pedal is down', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 100);
    expect(midi.getFrame().right?.extendedFingers).toEqual(['index']);
    send(CC_CH1, 64, 127);
    expect(midi.getFrame().right?.extendedFingers).toEqual(['thumb']);
    send(CC_CH1, 64, 0);
    expect(midi.getFrame().right?.extendedFingers).toEqual(['index']);
  });

  it('turns pitch bend into wrist tilt, centred at rest', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 100);
    send(BEND_CH1, 0, 64); // centre (8192)
    expect(midi.getFrame().left?.tiltAngle).toBeCloseTo(0, 2);
    send(BEND_CH1, 0x7f, 0x7f); // fully up
    expect(midi.getFrame().left!.tiltAngle).toBeGreaterThan(0.9);
    send(BEND_CH1, 0, 0); // fully down
    expect(midi.getFrame().left!.tiltAngle).toBeLessThan(-0.9);
  });

  it('keeps tilt at major when pitch-bend tilt is switched off', async () => {
    const { midi, send } = await connect({ pitchBendTilt: false });
    send(NOTE_ON_CH1, 55, 100);
    send(BEND_CH1, 0, 0);
    expect(midi.getFrame().left?.tiltAngle).toBe(1);
  });

  it('maps a tone knob to the filter sweep', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 100);
    expect(midi.getFrame().right?.tiltAngle).toBe(0);
    send(CC_CH1, 74, 127);
    expect(midi.getFrame().right!.tiltAngle).toBeGreaterThan(0.9);
  });
});

describe('MidiSource channels and devices', () => {
  it('listens to every channel by default (single-channel controllers)', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1 | 0x05, 55, 100); // channel 6
    expect(midi.getFrame().left).not.toBeNull();
  });

  it('ignores other channels once pinned to one', async () => {
    const { midi, send } = await connect({ channel: 1 });
    send(NOTE_ON_CH1 | 0x05, 55, 100); // channel 6 — filtered out
    expect(midi.getFrame().left).toBeNull();
    send(NOTE_ON_CH1, 55, 100); // channel 1 — accepted
    expect(midi.getFrame().left).not.toBeNull();
  });

  it('reports the connected device for the indicator', async () => {
    const { midi, devices } = await connect();
    expect(devices).toEqual([{ id: 'dev-1', name: 'Arturia MiniLab mkII', manufacturer: 'Test' }]);
    const status = midi.getStatus();
    expect(status.selectedId).toBe('dev-1');
    expect(status.selectedName).toBe('Arturia MiniLab mkII');
    expect(status.messages).toBe(0);
    expect(status.sinceActivityMs).toBeNull();
  });

  it('counts messages so the indicator can prove data is arriving', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 100);
    send(CC_CH1, 1, 64);
    const status = midi.getStatus();
    expect(status.messages).toBe(2);
    expect(status.sinceActivityMs).not.toBeNull();
    expect(status.sinceActivityMs!).toBeLessThan(1000);
  });

  it('keeps the activity trail across a reset so the indicator does not flicker', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 100);
    midi.reset();
    expect(midi.getFrame().left).toBeNull(); // held keys forgotten
    expect(midi.getStatus().messages).toBe(1); // but the device is still known good
  });

  it('drops held keys when the device is swapped', async () => {
    const { midi, send } = await connect();
    send(NOTE_ON_CH1, 55, 100);
    expect(midi.getFrame().left).not.toBeNull();
    midi.selectDevice(null);
    expect(midi.getFrame().left).toBeNull();
    expect(midi.getStatus().selectedId).toBeNull();
  });

  it('ignores a malformed short message instead of throwing', async () => {
    const { midi, send } = await connect();
    expect(() => send(NOTE_ON_CH1)).not.toThrow();
    expect(midi.getFrame().left).toBeNull();
  });
});
