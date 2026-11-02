# SMK25 MIDI Controller Support for Gesto Studio

## Architecture Overview

The existing system has a clean input abstraction (`HandInputSource`) that produces `HandFrame` objects. We'll add a `MidiSource` that implements this interface, mapping MIDI messages to the same hand-gesture semantics.

### Key Design Decisions

1. **Reuse existing pipeline**: MidiSource emits `HandFrame` with synthetic `HandData`, same as KeyboardSource
2. **Web MIDI API**: Use `navigator.requestMIDIAccess()` for device access
3. **SMK25-specific mapping**: Default mappings for the Arturia MiniLab / SMK25 layout
4. **Customizable mappings**: Like keyboard keymap, allow per-control rebinding
5. **Integration points**: 
   - Add "MIDI" option to GestoPanel input selector (Camera/Keyboard/Off)
   - Add MIDI settings modal tab
   - Handle transport controls (play/stop/record) from controller

## Implementation Plan

### Phase 1: Core MIDI Infrastructure (gesture-synth)

1. **Create `/gesture-synth/src/input/midiSource.ts`**
   - Implement `HandInputSource` interface
   - Web MIDI API integration
   - Device selection/connection management
   - MIDI message → HandFrame translation
   - Default SMK25 mapping

2. **Update `/gesture-synth/src/input/types.ts`**
   - Add `'midi'` to `InputSource` type
   - Export `MidiSource` class

3. **Update `/gesture-synth/src/input/index.ts`** (or create barrel export)
   - Export MidiSource

4. **Add MIDI keymap system** (similar to keyboard keymap)
   - `/gesture-synth/src/input/midiKeymap.ts`
   - Default SMK25 mappings
   - Customization/localStorage persistence

5. **Update Gesture Synth App.tsx** (for standalone testing)
   - Add MIDI input option to input selector
   - Wire up MidiSource

### Phase 2: Vibe DAW Integration

6. **Update `/vibe-daw/src/gesto/session.ts`**
   - Import and use MidiSource
   - Add 'midi' to `GestoInput` type
   - Wire startMidi()/stopMidi()

7. **Update `/vibe-daw/src/ui/components/GestoPanel.tsx`**
   - Add "MIDI" button to input selector
   - Show connected device name
   - Handle transport controls from MIDI (play/stop/record)

8. **Add MIDI settings to Modals.tsx**
   - Device selection dropdown
   - Mapping editor (like KeyboardSettings)
   - Channel selection
   - Test panel

### Phase 3: SMK25-Specific Features

9. **Default SMK25 Mapping** (25 keys + 8 knobs + wheels + transport)
   - Keys: Note on/off → chord degrees (like keyboard degrees 1-7)
   - Knobs: CC → volume, filter, expression parameters
   - Pitch bend wheel → tilt/octave
   - Mod wheel → volume/expression
   - Transport: Play/Stop/Record → transport controls
   - Octave up/down → octave shift

10. **Advanced features**
    - Velocity sensitivity for chord volume
    - Sustain pedal support
    - Multiple MIDI channels (e.g., channel 1 = left hand, channel 2 = right hand)
    - MIDI learn mode

## File Changes Summary

### New Files:
- `/root/projects/combined-app/gesture-synth/src/input/midiSource.ts`
- `/root/projects/combined-app/gesture-synth/src/input/midiKeymap.ts`
- `/root/projects/combined-app/gesture-synth/src/input/index.ts` (barrel)

### Modified Files:
- `/root/projects/combined-app/gesture-synth/src/input/types.ts` - add 'midi' type
- `/root/projects/combined-app/gesture-synth/src/App.tsx` - integrate MIDI input
- `/root/projects/combined-app/vibe-daw/src/gesto/session.ts` - integrate MidiSource
- `/root/projects/combined-app/vibe-daw/src/ui/components/GestoPanel.tsx` - add MIDI button
- `/root/projects/combined-app/vibe-daw/src/ui/components/Modals.tsx` - add MIDI settings tab

## SMK25 Default Mapping

| SMK25 Control | MIDI Message | Gesto Function |
|---|---|---|
| Keys C3-C5 (25 keys) | Note On/Off Ch 1 | Left hand: degrees I-VII (velocity → volume) |
| Keys C3-C5 (25 keys) | Note On/Off Ch 2 | Right hand: chord style, octave, expression |
| Knob 1 (CC 7) | CC 7 Ch 1 | Master volume |
| Knob 2 (CC 10) | CC 10 Ch 1 | Filter/tilt |
| Knob 3 (CC 74) | CC 74 Ch 1 | Expression/brightness |
| Knob 4 (CC 71) | CC 71 Ch 1 | Resonance |
| Knob 5 (CC 91) | CC 91 Ch 1 | Reverb send |
| Knob 6 (CC 93) | CC 93 Ch 1 | Chorus send |
| Knob 7 (CC 5) | CC 5 Ch 1 | Portamento time |
| Knob 8 (CC 84) | CC 84 Ch 1 | Portamento control |
| Pitch Bend Wheel | Pitch Bend Ch 1 | Tilt (-1 to +1) |
| Mod Wheel | CC 1 Ch 1 | Volume/expression |
| Octave Down | Note On/Off (specific notes) | Octave -1 |
| Octave Up | Note On/Off (specific notes) | Octave +1 |
| Play | CC/Note (configurable) | Transport play |
| Stop | CC/Note (configurable) | Transport stop |
| Record | CC/Note (configurable) | Transport record |
| Tap Tempo | CC/Note (configurable) | Tap tempo |
| Sustain Pedal | CC 64 | Sustain held chords |

