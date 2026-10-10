"""Bring parameters.json in line with a minichord firmware's parameters.json.

Usage: python3 sync_firmware_parameters.py path/to/firmware/generator/parameters.json

The firmware's file is the source of truth for what each SysEx address is: its name,
range, default, tooltip, firmware method and the version it arrived in. This page's
file adds how each one is shown: which section and group it sits in, the kind of
control, dropdown labels. So for every address the firmware defines:

  - an address this page already shows keeps its section, group and control, and takes
    everything else from the firmware;
  - a new address gets the placement and control from UI_OVERRIDES below, or, failing
    that, its firmware section and group with a control guessed from its range;
  - UI_OVERRIDES always wins, so decisions made here survive the next sync.

Addresses this page has and the firmware doesn't are dropped (and reported).
Afterwards run generate_sysex_name_map.py and generate.py.
"""
import json
import sys

PAGE_FILE = 'parameters.json'

# taken from the firmware for every parameter
FIRMWARE_FIELDS = ['name', 'data_type', 'min_value', 'max_value', 'default_value', 'tooltip',
                   'method', 'iterate', 'curve', 'follows_target', 'controls']

WAVEFORMS = ["Sine", "Sawtooth", "Square", "Triangle", "Bandlimited Pulse", "Pulse", "Reverse Sawtooth",
             "Sample and Hold", "Variable Triangle", "Bandlimited Sawtooth", "Reverse Bandlimited Sawtooth",
             "Bandlimited Square"]
CHORD_TYPES = ["Slot default", "Major", "Minor", "Dominant 7", "Major 7", "Minor 7", "Diminished", "Augmented",
               "Major 6", "Minor 6", "Full diminished", "m7b5", "sus4", "sus2", "7sus4", "maj9", "min9", "add9",
               "6/9", "Supermajor triad", "Subminor triad", "Neutral triad", "Harmonic 7th", "Neutral 7th",
               "Subminor 7th", "Utonal tetrad", "Harmonic 9th", "Otonal hexad", "Just augmented", "Supermajor 7th"]


def options(labels, start=0):
    return [{"value": i + start, "label": label} for i, label in enumerate(labels)]


def select(section, group, labels, start=0):
    return {"section": section, "group": group, "ui_type": "select", "options": options(labels, start)}


def control(section, group, ui_type):
    return {"section": section, "group": group, "ui_type": ui_type}


ALT_LAYOUT = lambda: select('chord_parameter', 'Alternate layout', CHORD_TYPES)
# what a harp string or chord voice sounds: its own synth, or a sampled instrument
VOICES = ["Synth", "Piano", "Pizzicato strings", "Choir", "String quartet"]

UI_OVERRIDES = {
    # the firmware's name has an underscore
    187: {"name": "default bpm"},
    # global: device
    20: {"group": "General"},
    32: {"group": "General"},
    244: select('global_parameter', 'General', ["Stock: offered as a speaker, not played",
                                                "Play along: through the minichord",
                                                "No speaker: the host keeps its sound"]),
    # global: key and tuning
    30: control('global_parameter', 'Key and tuning', 'discrete_slider'),
    31: select('global_parameter', 'Key and tuning', ["sharp", "flat"]),
    35: select('global_parameter', 'Key and tuning',
               ["C", "G", "D", "A", "E", "B", "F", "Bb", "Eb", "Ab", "Db", "Gb",
                "F#", "C#", "G#", "D#", "A#", "E#", "B#", "Fb", "Cb"]),
    # sent in tenths of a Hz, shown in Hz
    109: {"section": "global_parameter", "group": "Key and tuning", "ui_type": "slider", "data_type": "float",
          "float_multiplier": 10, "step": 0.1, "min_value": 432, "max_value": 446, "default_value": 440,
          "tooltip": "reference pitch for A4, in Hz (432.0 to 446.0, default 440.0). Retunes the synth only; "
                     "MIDI note numbers are unchanged"},
    237: select('global_parameter', 'Key and tuning',
                ["Equal", "Quarter-comma meantone", "Five-limit just (C major)", "Pythagorean",
                 "Werckmeister III", "Kirnberger III", "Vallotti", "Young no. 2", "Kellner",
                 "Sixth-comma meantone", "19-EDO", "24-EDO (quarter tones)", "31-EDO"]),
    # global: MIDI
    106: select('global_parameter', 'MIDI', [str(i) for i in range(1, 17)], start=1),
    107: select('global_parameter', 'MIDI', [str(i) for i in range(1, 17)], start=1),
    108: control('global_parameter', 'MIDI', 'switch'),
    110: control('global_parameter', 'MIDI', 'switch'),
    238: control('global_parameter', 'MIDI', 'switch'),
    8: control('global_parameter', 'MIDI', 'switch'),
    # global: hover, the harp plate as a fourth knob, which sweeps like one
    249: {"section": "global_parameter", "group": "Hover", "ui_type": "select", "none_option": "none",
          "targets": "sweep"},
    250: control('global_parameter', 'Hover', 'slider'),
    251: control('global_parameter', 'Hover', 'discrete_slider'),
    # global: knobs
    117: select('global_parameter', 'Knobs', ["Main functions", "Alternate functions"]),
    # global: double tap. The firmware calls the second and third pairs "Settings"
    200: {"section": "global_parameter", "group": "Double tap", "ui_type": "select", "none_option": "none",
          "targets": "tap"},
    209: {"section": "global_parameter", "group": "Double tap", "ui_type": "select", "none_option": "none",
          "targets": "tap"},
    211: {"section": "global_parameter", "group": "Double tap", "ui_type": "select", "none_option": "none",
          "targets": "tap"},
    201: control('global_parameter', 'Double tap', 'slider'),
    210: control('global_parameter', 'Double tap', 'slider'),
    212: control('global_parameter', 'Double tap', 'slider'),
    # potentiometers. A knob control's list holds what a knob may sweep; 0, or anything it
    # can't, leaves the knob unassigned
    10: {"section": "chord_potentiometer", "group": "Potentiometer", "targets": "sweep", "none_option": "none"},
    11: {"section": "chord_potentiometer", "group": "Potentiometer"},
    12: {"section": "harp_potentiometer", "group": "Potentiometer", "targets": "sweep", "none_option": "none"},
    13: {"section": "harp_potentiometer", "group": "Potentiometer"},
    14: {"section": "modulation_potentiometer", "group": "Potentiometer", "targets": "sweep", "none_option": "none"},
    15: {"section": "modulation_potentiometer", "group": "Potentiometer"},
    16: {"section": "modulation_potentiometer", "group": "Potentiometer", "targets": "sweep", "none_option": "none"},
    17: {"section": "modulation_potentiometer", "group": "Potentiometer"},
    # chord: buttons
    21: control('chord_parameter', 'Buttons', 'switch'),
    33: control('chord_parameter', 'Buttons', 'switch'),
    34: control('chord_parameter', 'Buttons', 'discrete_slider'),
    39: select('chord_parameter', 'Buttons', ["Standard seven", "Suspended and extended"]),
    # chord: general
    199: control('chord_parameter', 'General', 'slider'),
    # chord: voicing
    37: select('chord_parameter', 'Voicing',
               ["Root position", "First inversion", "Second inversion", "Third inversion / root up an octave"]),
    38: select('chord_parameter', 'Voicing', ["Close", "Drop 2", "Drop 3", "Drop 2 and 4", "Spread outer voices"]),
    111: select('chord_parameter', 'Voicing', ["Off", "On", "Strict"]),
    112: control('chord_parameter', 'Voicing', 'discrete_slider'),
    # chord: slash chords and cantus
    23: control('chord_parameter', 'Slash chords and cantus', 'discrete_slider'),
    113: select('chord_parameter', 'Slash chords and cantus',
                ["Slash level decides", "Bass", "Tenor", "Alto", "Soprano"]),
    114: control('chord_parameter', 'Slash chords and cantus', 'switch'),
    115: select('chord_parameter', 'Slash chords and cantus',
                ["Off", "Bass", "Tenor", "Alto", "Soprano", "Nearest voice"]),
    # chord: alternate layout
    **{address: ALT_LAYOUT() for address in range(202, 209)},
    # chord: formants
    118: control('chord_parameter', 'Formants', 'slider'),
    119: control('chord_parameter', 'Formants', 'slider'),
    239: control('chord_parameter', 'Formants', 'slider'),
    240: control('chord_parameter', 'Formants', 'slider'),
    # chord: oscillators or a sampled instrument
    265: select('chord_parameter', 'Oscillator', VOICES),
    # each chord note's own voice (firmware 41): 0 follows chord voice, then the voices one up
    **{a: select('chord_parameter', 'Oscillator', ["As the chord voice"] + VOICES) for a in (270, 271, 272, 273)},
    # chord: the ensemble, a slow stereo chorus after the chord chain
    259: control('chord_parameter', 'Ensemble', 'slider'),
    # global: the vocoder, shaped by the sound coming in over USB
    260: control('global_parameter', 'Vocoder', 'slider'),
    261: select('global_parameter', 'Vocoder', ["Chords", "Harp", "Both: the harp through the chords' effects"]),
    262: control('global_parameter', 'Vocoder', 'slider'),
    # harp: notes
    36: select('harp_parameter', 'Notes',
               ["Chord Tones", "Major Scale", "Major Pentatonic", "Minor Pentatonic", "Diminished 6th",
                "Relative Natural Minor", "Relative Harmonic Minor", "Relative Minor Pentatonic",
                "Scale Per Chord", "Scale Per Chord (Pentatonic)", "Custom Scale (key root)",
                "Custom Scale (chord root)", "Generator Scale (key root)", "Generator Scale (chord root)"]),
    40: control('harp_parameter', 'Notes', 'discrete_slider'),
    98: control('harp_parameter', 'Notes', 'switch'),
    99: control('harp_parameter', 'Notes', 'discrete_slider'),
    116: select('harp_parameter', 'Notes', ["Steps 1-12", "Steps 13-24", "Steps 25-36"], start=1),
    236: control('harp_parameter', 'Notes', 'degrees'),
    # the generator scale: one interval stacked and folded into the octave
    267: control('harp_parameter', 'Notes', 'slider'),
    268: control('harp_parameter', 'Notes', 'slider'),
    269: control('harp_parameter', 'Notes', 'slider'),
    # harp: playing, how the hands meet the harp. Each preset holds these, so the plate and its
    # thresholds sit here rather than with the instrument's own settings under General.
    # The plate fitted, and how firm a touch its zones need
    243: select('harp_parameter', 'Plate', ["Stock strip, or any plate of twelve separate zones",
                                            "Zipper 24", "Arcade wheel", "Fretless wrap"]),
    241: control('harp_parameter', 'Plate', 'slider'),
    242: control('harp_parameter', 'Plate', 'slider'),
    # when a string sounds and how firmly it's touched, and how it stops
    216: control('harp_parameter', 'Pluck', 'switch'),
    252: control('harp_parameter', 'Pluck', 'slider'),
    253: select('harp_parameter', 'Pluck', ["Off", "Follow: swells and eases off", "Swell only: keeps the firmest"]),
    213: control('harp_parameter', 'Pluck', 'discrete_slider'),
    214: control('harp_parameter', 'Pluck', 'slider'),
    22: control('harp_parameter', 'Pluck', 'switch'),
    263: control('harp_parameter', 'Pluck', 'slider'),
    # the plucked string model
    217: control('harp_parameter', 'String model', 'slider'),
    218: control('harp_parameter', 'String model', 'slider'),
    219: control('harp_parameter', 'String model', 'slider'),
    # the harp ribbon: the strip as one fretless string
    245: control('harp_parameter', 'Ribbon', 'switch'),
    246: control('harp_parameter', 'Ribbon', 'discrete_slider'),
    247: control('harp_parameter', 'Ribbon', 'slider'),
    248: control('harp_parameter', 'Ribbon', 'slider'),
    # harp: synth strings or a sampled instrument
    264: select('harp_parameter', 'Oscillator', VOICES),
    # harp: the strings fanned across the stereo field
    257: control('harp_parameter', 'Spread', 'slider'),
    258: select('harp_parameter', 'Spread', ["By pitch: low strings left, high strings right",
                                             "Alternating: neighbouring strings on opposite sides"]),
    # rhythm styles (firmware 42): written parts that follow the chord, and how they play
    274: select('rhythm_parameter', 'Rhythm',
                ["Pattern: the steps below, as always", "Alberti bass", "Waltz", "Boom-chick", "Walking bass",
                 "Boogie", "Travis picking", "Strummed guitar", "Bossa nova", "Arpeggio up",
                 "Arpeggio up and down", "Ballad", "Reggae", "6/8 arpeggio", "Habanera"]),
    275: select('rhythm_parameter', 'Rhythm', ["Plays the style's bass", "Holds the chord's bass note", "Rests"]),
    276: select('rhythm_parameter', 'Rhythm', ["Play the style's chords", "Hold the chord", "Rest"]),
    277: select('rhythm_parameter', 'Rhythm', ["Plays on", "Only while a chord is held",
                                                "While held, and the bar starts on the press"]),
    278: select('rhythm_parameter', 'Rhythm', ["On its next note", "On the next beat", "On the next bar"]),
    279: control('rhythm_parameter', 'Rhythm', 'slider'),
    280: control('rhythm_parameter', 'Rhythm', 'slider'),
}
# every waveform dropdown gets the same labels
WAVEFORM_ADDRESSES = [42, 59, 62, 93, 100, 122, 125, 128, 152, 156, 160]
for address in WAVEFORM_ADDRESSES:
    UI_OVERRIDES.setdefault(address, {})["options"] = options(WAVEFORMS)

# the rhythm section and the hidden values live in sections of their own here
RHYTHM_ADDRESSES = set(range(187, 192)) | set(range(220, 236)) | set(range(274, 281))


def guess_ui_type(param):
    if param['data_type'] == 'degrees':
        return 'degrees'
    if param['data_type'] == 'int' and param['min_value'] == 0 and param['max_value'] == 1:
        return 'switch'
    if param['data_type'] == 'int' and param['max_value'] - param['min_value'] <= 12:
        return 'discrete_slider'
    return 'slider'


def main(firmware_file):
    with open(firmware_file) as f:
        firmware = json.load(f)
    with open(PAGE_FILE) as f:
        page = json.load(f)

    current = {}  # address -> (section, entry) as this page has it
    for section, params in page.items():
        for param in params:
            current[param['sysex_adress']] = (section, param)

    merged = {section: [] for section in page}
    seen = set()
    added = []
    for fw_section, params in firmware.items():
        for fw_param in params:
            address = fw_param['sysex_adress']
            seen.add(address)
            if address in current:
                section, entry = current[address]
                entry = dict(entry)
            else:
                added.append(address)
                if fw_param['group'] == 'hidden':
                    section = 'hidden'
                elif address in RHYTHM_ADDRESSES:
                    section = 'rhythm_parameter'
                else:
                    section = fw_section
                entry = {'sysex_adress': address, 'group': fw_param['group'], 'ui_type': guess_ui_type(fw_param)}
            for field in FIRMWARE_FIELDS:
                if field in fw_param:
                    entry[field] = fw_param[field]
            if 'controls' not in fw_param:
                entry.pop('controls', None)
            # the firmware counts versions in whole numbers, this page in hundredths
            entry['introduction_version'] = round(fw_param.get('introduction_version', 2) / 100.0, 2)
            override = dict(UI_OVERRIDES.get(address, {}))
            section = override.pop('section', section)
            entry.update(override)
            if entry['data_type'] == 'int' and entry['ui_type'] != 'select':
                entry['step'] = 1
            if entry['ui_type'] == 'select' and 'options' in entry:
                entry.setdefault('step', 1)
            merged.setdefault(section, []).append(entry)

    dropped = sorted(address for address in current if address not in seen)
    for section in merged:
        merged[section].sort(key=lambda p: p['sysex_adress'])
    with open(PAGE_FILE, 'w') as f:
        json.dump(merged, f, indent=2)
        f.write('\n')
    print(f"added {len(added)}: {added}")
    print(f"dropped {len(dropped)}: {dropped}")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
