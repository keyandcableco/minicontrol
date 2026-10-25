import json
import os


# Load source JSON
with open('parameters.json', 'r') as f:
    parameters = json.load(f)

# Load sysex name map, fallback to empty dict if file not found
sysex_name_map = {}
if os.path.exists('sysex_name_map.json'):
    with open('sysex_name_map.json', 'r') as f:
        sysex_name_map = json.load(f)

# Which controls may move each setting, as the firmware has it: "all" (the knobs, hover and the
# double tap), "tap" (the double tap only) or "none". A target list says which kind of control it
# belongs to: the knobs and hover sweep, so they take "all"; the double tap sets an exact value,
# so it takes "tap" too.
controls_by_address = {str(param['sysex_adress']): param.get('controls', 'all')
                       for params in parameters.values() for param in params}
TARGETS = {'sweep': ('all',), 'tap': ('all', 'tap')}

# Create a mapping of parameter names to sysex_adress for each section and group
# (names repeat across groups: every envelope has an attack)
name_to_sysex = {}
for group_name, params in parameters.items():
    if group_name == 'sysex_name_map':
        continue
    for param in params:
        name_to_sysex.setdefault(group_name, {}).setdefault(param['group'], {})[param['name']] = param['sysex_adress']

# Define subgroup order for each group
subgroup_order = {
    'global_parameter': ['General', 'Key and tuning', 'Own temperament', 'Drone', 'Effects', 'Vocoder', 'Organ', 'Phone', 'MIDI', 'Knobs', 'Hover', 'Double tap'],
    'chord_parameter': ['General', 'Buttons', 'Voicing', 'Slash chords and cantus', 'Alternate layout', 'Oscillator',
                        'Envelope', 'Low pass filter', 'Tremolo', 'Vibrato', 'Formants', 'Delay', 'Reverb', 'Crunch',
                        'Output filter', 'Ensemble'],
    'harp_parameter': ['Notes', 'Plate', 'Drum pads', 'Pluck', 'Ribbon', 'Oscillator', 'String model', 'Transient', 'Envelope', 'Low pass filter', 'Tremolo', 'Vibrato', 'Delay',
                       'Reverb', 'Crunch', 'Output filter', 'Spread'],
    'sharp_button_parameter': ['General'],
    'rhythm_parameter': ['Style', 'Sections', 'Drums', 'Tempo', 'Chord changes', 'Pattern', 'Looper']
}

DELAY = ['delay length', 'delay filter frequency', 'delay filter resonance', 'delay lowpass', 'delay bandpass',
         'delay highpass', 'dry mix', 'delay mix']

# Define parameter order by name within each subgroup
parameter_name_order = {
    'rhythm_parameter': {
        'Style': ['rhythm style', 'rhythm bass', 'rhythm chords', 'rhythm articulation', 'rhythm accents'],
        'Sections': ['rhythm style B', 'fill on modifier and hold', 'rhythm intro', 'rhythm ending', 'rhythm palm break'],
        'Drums': ['drums', 'drum groove', 'drum groove B', 'drum kit', 'drum level', 'drum humanize', 'count-in', 'drums only',
                  'drum MIDI out'],
        'Tempo': ['default bpm', 'tap tempo counts', 'shuffle value', 'MIDI clock out'],
        'Chord changes': ['rhythm follows hands', 'rhythm chord change', 'measure update', 'MIDI chords'],
        'Pattern': ['cycle length', 'note pushed duration'],  # then the grid of steps (SysEx 220–235)
        'Looper': ['looper length', 'looper count-in', 'looper click', 'looper click level', 'looper quantize']
    },
    'global_parameter': {
        'General': ['bank color', 'led attenuation', 'usb audio'],
        'Key and tuning': ['transpose', 'sharp function', 'chord key signature', 'master tuning', 'temperament',
                           'modifier step', 'purity'],
        'Effects': ['reverb size', 'reverb high damping', 'reverb low damping', 'reverb low pass', 'reverb diffusion', 'pan'],
        'Vocoder': ['vocoder', 'vocoder carrier', 'vocoder consonants'],
        'Organ': ['organ drawbars', 'organ percussion'],
        'Phone': ['phone follow 1 control', 'phone follow 1 value', 'phone follow 1 band', 'phone follow 1 release',
                  'phone follow 2 control', 'phone follow 2 value', 'phone follow 2 band', 'phone follow 2 release',
                  'phone beat', 'phone kick stab', 'phone kick note', 'phone filter', 'phone filter resonance', 'phone echo',
                  'phone echo time', 'phone echo feedback', 'phone strum'],
        'MIDI': ['chord channel', 'harp channel', 'harp note-off on lift', 'single port mode', 'MPE output', 'knobs send MIDI',
                 'MIDI in plays'],
        'Knobs': ['knob layer'],
        'Hover': ['hover control', 'hover value', 'hover reach', 'hover alternate control', 'hover alternate value'],
        'Double tap': ['double tap control', 'double tap value', 'double tap control 2', 'double tap value 2',
                       'double tap control 3', 'double tap value 3', 'double tap hold', 'modifier with up and down']
    },
    'chord_parameter': {
        'General': ['octave change', 'chord shuffling', 'glide chords', 'fingered glide', 'inter-note delay', 'random note delay'],
        'Buttons': ['retrigger chords', 'chord layout', 'chord frame shift', 'barry harris mode'],
        'Voicing': ['chord inversion', 'press again in hold', 'chord spacing', 'voice leading', 'voice leading range'],
        'Slash chords and cantus': ['slash level', 'slash voice', 'slash re-voice', 'cantus'],
        'Alternate layout': ['alt layout maj', 'alt layout min', 'alt layout 7th', 'alt layout maj+7th',
                             'alt layout min+7th', 'alt layout maj+min', 'alt layout all three'],
        'Formants': ['formant vowel', 'formant amount', 'formant voice size', 'formant resonance'],
        'Delay': DELAY,
        'Reverb': ['reverb level'],
        'Crunch': ['crunch level', 'crunch type'],
        'Oscillator': [
            'chord voice',
            'waveform 1',
            'amplitude 1',
            'frequency multiplier 1',
            'waveform 2',
            'amplitude 2',
            'frequency multiplier 2',
            'waveform 3',
            'amplitude 3',
            'frequency multiplier 3',
            'noise',
            'first note',
            'second note',
            'third note',
            'fourth note'
        ],
        'Envelope': ['attack', 'hold', 'decay', 'sustain', 'release', 'retrigger release'],
        'Low pass filter': [
            'base frequency',
            'keytrack value',
            'resonance',
            'attack',
            'hold',
            'decay',
            'sustain',
            'release',
            'retrigger release',
            'LFO waveform',
            'LFO frequency',
            'LFO amplitude',
            'filter sensitivity'
        ],
        'Tremolo': ['waveform', 'frequency', 'keytrack value', 'amplitude'],
        'Vibrato': ['waveform', 'frequency', 'keytrack value', 'amplitude']
    },
    'harp_parameter': {
        'Notes': [
            'chromatic mode',
            'harp rank',
            'scalar harp mode',
            'custom scale',
            'generator',
            'generator notes',
            'generator mode',
            'octave change',
            'harp shuffling'
        ],
        'Plate': ['harp plate', 'plate detect', 'harp touch threshold', 'harp release threshold'],
        # harp drums, on any plate, then the drum pads' own (harp plate 13) and the resting hand's (firmware 101)
        'Drum pads': ['harp drums', 'drum seams', 'melodic pads', 'drum press', 'pads mute the groove'],
        'Pluck': [
            'pluck on lift',
            'touch velocity',
            'touch pressure',
            'strum velocity',
            'palm mute',
            'palm mute release',
            'change held strings',
            'hammer-on'
        ],
        'String model': ['string model', 'string decay', 'string damping'],
        'Ribbon': ['harp ribbon', 'ribbon span', 'ribbon snap', 'ribbon glide'],
        'Spread': ['string spread', 'spread pattern'],
        'Delay': DELAY,
        'Reverb': ['reverb level'],
        'Crunch': ['crunch level', 'crunch type'],
        'Oscillator': ['harp voice', 'waveform', 'frequency multiplier', 'amplitude', 'noise'],
        'Envelope': ['attack', 'decay', 'sustain', 'release', 'retrigger release'],
        'Low pass filter': [
            'base frequency',
            'keytrack value',
            'resonance',
            'attack',
            'hold',
            'decay',
            'sustain',
            'release',
            'retrigger release',
            'filter sensitivity'
        ],
        'Transient': ['waveform', 'amplitude', 'note level', 'attack', 'hold', 'decay'],
        'Tremolo': ['waveform', 'frequency', 'amplitude'],
        'Vibrato': [
            'waveform',
            'frequency',
            'amplitude',
            'attack',
            'hold',
            'decay',
            'sustain',
            'release',
            'retrigger release',
            'pitch bend',
            'attack bend',
            'hold bend',
            'decay bend',
            'retrigger release bend',
            'intensity'
        ],
        'Output filter': [
            'frequency',
            'resonance',
            'lowpass',
            'bandpass',
            'highpass',
            'LFO waveform',
            'LFO frequency',
            'LFO amplitude',
            'filter LFO sensitivity',
            'output amplifier'
        ]
    },
    'chord_potentiometer': {
        'Potentiometer': ['chord alternate control', 'chord alternate range']
    },
    'harp_potentiometer': {
        'Potentiometer': ['harp alternate control', 'harp alternate percent range']
    },
    'modulation_potentiometer': {
        'Potentiometer': [
            'mod main control',
            'mod main percent range',
            'mod alternate control',
            'mod alternate percent range'
        ]
    }
}

# Where each of the firmware's subgroups is shown: (section, subgroup) -> (place, subgroup there).
# A place is a sheet the drawing opens (controls.js), or "controls", what the knobs, hover and the
# double tap are set to, which the drawing's own sheets edit and which shows only among every
# setting. Subgroups not named here stay in their section, which is a place of the same name.
PLACES = {
    ('global_parameter', 'Key and tuning'): ('tuning', 'Key and tuning'),
    ('global_parameter', 'Own temperament'): ('tuning', 'Own temperament'),
    ('global_parameter', 'Drone'): ('drone', 'Drone'),
    ('global_parameter', 'Effects'): ('effects', 'Reverb and pan'),
    ('global_parameter', 'Vocoder'): ('vocoder', 'Vocoder'),
    # the tonewheel organ (voice 13), one registration shared by the harp and the chords
    ('global_parameter', 'Organ'): ('organ', 'Organ'),
    ('global_parameter', 'Phone'): ('phone', 'Phone'),
    ('global_parameter', 'General'): ('device', 'USB'),
    ('global_parameter', 'MIDI'): ('device', 'MIDI'),
    ('chord_potentiometer', 'Potentiometer'): ('controls', 'Chord knob'),
    ('harp_potentiometer', 'Potentiometer'): ('controls', 'Harp knob'),
    ('modulation_potentiometer', 'Potentiometer'): ('controls', 'Mod knob'),
    ('global_parameter', 'Knobs'): ('controls', 'Knob layer'),
    ('global_parameter', 'Hover'): ('controls', 'Hover'),
    ('global_parameter', 'Double tap'): ('controls', 'Double tap'),
}
# single settings placed apart from their subgroup: the light's colour and brightness
PLACES_BY_ADDRESS = {20: ('light', 'Light'), 32: ('light', 'Light')}
for (section, group), (place, new) in PLACES.items():
    parameter_name_order.setdefault(place, {})[new] = parameter_name_order.get(section, {}).get(group, [])
    subgroup_order.setdefault(place, []).append(new)
subgroup_order['light'] = ['Light']
SECTION_TITLES = {'controls': 'Controls'}

# Each sheet: its name, where it is on the minichord, and a line on what the control does where it
# needs one. Sheets sit inside #parameters, so the sections' styles reach their settings; as
# popovers they take no place in its grid until "show every setting" lays them out there.
SHEETS = {
    'chord_parameter': ('chord', 'the 21 square buttons', ''),
    'harp_parameter': ('harp', 'the touch plate', ''),
    'rhythm_parameter': ('rhythm', 'the button at the top right',
        'Press: chords hold until the next. Hold down: rhythm mode on or off. In rhythm mode a press taps the tempo.'),
    'tuning': ('tuning', 'for the chords and the harp', ''),
    'drone': ('drone', 'a tanpura on the key\'s root', ''),
    'effects': ('effects', 'the reverb room and pan, shared by the chords and the harp', ''),
    'vocoder': ('vocoder', 'the chords or the harp, shaped by sound over USB', ''),
    'organ': ('organ', 'the tonewheel organ, chord voice or harp voice 13', ''),
    'phone': ('phone', 'sound from a phone or computer, over USB', ''),
    'light': ('light', 'the round light under the buttons', ''),
    'device': ('device and MIDI', 'how the minichord talks to a computer', ''),
}
PLACE_ORDER = ['chord_parameter', 'harp_parameter', 'rhythm_parameter', 'tuning', 'drone', 'effects', 'vocoder', 'organ', 'phone',
               'light', 'device', 'controls']


def sheet_html(group_name, section):
    title, where, intro = SHEETS[group_name]
    key = title.split()[0]
    section = section.replace('<details style=', '<details open class="sheet-section" style=', 1)
    return f'''
        <div id="{key}-sheet" class="minishop-sheet controls-sheet {key}-sheet" popover aria-labelledby="{key}-sheet-title">
          <div class="minishop-head">
            <div>
              <h2 id="{key}-sheet-title">{title}</h2>
              <p class="controls-sheet-where">{where}</p>
            </div>
            <button type="button" class="settings-close always-on" popovertarget="{key}-sheet" popovertargetaction="hide" aria-label="close"><span class="glyph">✕</span></button>
          </div>
          <div class="controls-sheet-body">
            {f'<p class="cs-intro">{intro}</p>' if intro else ''}
            <div class="sheet-quick" data-quick="{key}"></div>
            {section}
          </div>
        </div>'''


DEGREES = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"]


def html_escape(text):
    return str(text).replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;').replace('>', '&gt;')


# The padlock beside a setting the minichord may keep as its own, whatever preset is loaded (the
# locks, firmware 76): a setting whose "lock" in parameters.json isn't "never" gets one, hidden
# until a minichord that answers for its locks is connected (index.js paints them). USB audio and
# upside down are "fixed": the instrument's by their own code, shown locked and not to be clicked.
LOCK_TITLE = ("lock: keep this setting as the minichord's own, whatever preset is loaded. Locked, loading a preset "
              "leaves it alone, and a change to it is kept in the minichord itself rather than in the preset. "
              "Click to lock or unlock. Firmware 76 or later")


def lock_html(param):
    policy = param.get('lock', 'allowed')
    if policy == 'never' or param.get('group') == 'hidden':
        return ''
    address = param['sysex_adress']
    if policy == 'fixed':
        return (f'<button type="button" class="lock-btn locked fixed always-on" data-lock="{address}" hidden disabled '
                f'title="the minichord\'s own setting, always: a preset never changes it">locked</button>')
    return f'<button type="button" class="lock-btn always-on" data-lock="{address}" hidden title="{html_escape(LOCK_TITLE)}">lock</button>'


# Generate HTML for parameter controls
def generate_param_html(param):
    html = []
    sysex_address = param['sysex_adress']
    name = param['name']
    ui_type = param.get('ui_type', 'hidden')
    tooltip = param.get('tooltip', name)
    data_type = param.get('data_type', 'int')
    min_value = param.get('min_value', 0)
    max_value = param.get('max_value', 1)
    step = param.get('step', 0.01 if data_type == 'float' else 1)
    default_value = param.get('default_value', 0)
    float_multiplier = param.get('float_multiplier', 100.0 if data_type == 'float' else 1)
    introduction_version = param.get('introduction_version', 0.01)  # Default to 0.01

    # the device takes whole numbers: a float is sent multiplied, so its slider runs in sent units
    device_step = round(step * float_multiplier) if data_type == 'float' else 1
    decimals = len(str(step).split('.')[1]) if data_type == 'float' and '.' in str(step) else 0

    attrs = [
        f'data-sysex-address="{sysex_address}"',
        f'data-ui-type="{ui_type}"',
        f'data-data-type="{data_type}"',
        f'data-float-multiplier="{float_multiplier}"',
        f'title="{html_escape(tooltip)}"',
        f'version="{introduction_version}"'  # Add version attribute
    ]
    if 'special_handling' in param:
        attrs.append(f'data-special-handling="{param["special_handling"]}"')
    if 'dependent_addresses' in param:
        attrs.append(f'data-dependent-addresses="{json.dumps(param["dependent_addresses"])}"')
    if 'rhythm_step' in param:
        attrs.append(f'data-rhythm-step="{param["rhythm_step"]}"')
    if 'follows_target' in param:
        attrs.append(f'data-follows-target="{param["follows_target"]}"')

    label = f'<label for="param-{sysex_address}" title="{html_escape(tooltip)}" style="width: 150px; font-weight: bold;">{name}</label>'
    if ui_type == 'slider' or ui_type == 'discrete_slider':
        display_value = default_value if data_type == 'float' else default_value
        display_value_str = f"{display_value:.{decimals}f}" if data_type == 'float' else str(display_value)
        slider_value = round(default_value * float_multiplier) if data_type == 'float' else default_value
        html.append(f'''
            <div style="display: flex; align-items: center; margin: 8px 0;">
                {label}
                <input type="range" id="param-{sysex_address}" name="{name}" class="inactive"
                       min="{round(min_value * float_multiplier)}" max="{round(max_value * float_multiplier)}"
                       step="{device_step}"
                       value="{slider_value}"
                       {"data-discrete='true'" if ui_type == 'discrete_slider' else ''}
                       {' '.join(attrs)}
                       style="width: 150px; margin: 0 8px;">
                <input type="number" id="value-{sysex_address}" class="inactive"
                       value="{display_value_str}"
                       min="{min_value}" max="{max_value}" step="{step if data_type == 'float' else 1}"
                       style="width: 50px; text-align: right; border: none; padding: 2px;">
                {lock_html(param)}
            </div>
        ''')
        if sysex_address == 260:
            # the vocoder hears what comes in over USB: a voice to loop into it, filled by talk.js
            html.append('<div id="talk-vocoder" class="talk-slot talk-beside"></div>')
    elif ui_type == 'select':
        options_html = ''
        if 'none_option' in param:
            options_html += f'<option value="0">{param["none_option"]}</option>'
        if 'options' in param:
            options_html += ''.join([
                f'<option value="{opt["value"]}">{opt["label"]}</option>'
                for opt in param.get('options', [])
            ])
        else:
            option_addresses = param.get('option_addresses', list(sysex_name_map.keys()))
            allowed = TARGETS[param.get('targets', 'tap')]
            options_html += ''.join([
                f'<option value="{key}">{value}</option>'
                for key, value in sorted(sysex_name_map.items(), key=lambda x: x[1].lower())
                if key in option_addresses and controls_by_address.get(key, 'none') in allowed
            ])
        html.append(f'''
            <div style="display: flex; align-items: center; margin: 8px 0;">
                {label}
                <select id="param-{sysex_address}" name="{name}" class="inactive" {' '.join(attrs)}
                        style="width: 150px; padding: 5px; margin: 0 8px;">
                    {options_html}
                </select>
                {lock_html(param)}
            </div>
        ''')
        if sysex_address == 244:
            # the minichord's own sound, from its USB recording, through this phone or computer: listen.js
            html.append('<div id="listen-usb" class="talk-slot talk-beside"></div>')
        if sysex_address == 337:
            # your own kit (drum kit 13): sound files read, mapped to the voices and sent (kits.js)
            html.append(user_kit_html(param))
    elif ui_type == 'switch':
        html.append(f'''
            <div style="display: flex; align-items: center; margin: 8px 0;">
                {label}
                <input type="checkbox" id="param-{sysex_address}" name="{name}" class="inactive"
                       {'checked' if default_value else ''} {' '.join(attrs)}
                       style="margin: 0 8px;">
                {lock_html(param)}
            </div>
        ''')
    elif ui_type == 'degrees':
        # twelve checkboxes, one per chromatic degree, each a bit of the one value
        boxes = ''.join(
            f'''<label class="degree" title="{degree}">
                    <input type="checkbox" class="degree-box inactive" id="param-{sysex_address}-bit-{bit}"
                           data-sysex-address="{sysex_address}" data-bit="{bit}" version="{introduction_version}"
                           {'checked' if default_value & (1 << bit) else ''}>
                    <span>{degree}</span>
                </label>'''
            for bit, degree in enumerate(DEGREES))
        html.append(f'''
            <div style="display: flex; align-items: center; margin: 8px 0;">
                <label style="width: 150px; font-weight: bold;" title="{html_escape(tooltip)}">{name}</label>
                <div id="param-{sysex_address}" class="degree-row" {' '.join(attrs)}>
                    {boxes}
                </div>
            </div>
        ''')
    elif ui_type == 'cents':
        # an own temperament's offset, shown in cents; the device takes tenths of a cent from 1000
        first = sysex_address == 359
        html.append(f'''
            {SCALA_IMPORT_HTML if first else ''}
            <div class="cents-line" style="display: flex; align-items: center; margin: 4px 0;">
                <label style="width: 150px; font-weight: bold;" title="{html_escape(tooltip)}">{name.replace('own temperament ', '')}</label>
                <input type="number" id="param-{sysex_address}" class="cents-input inactive" step="0.1" min="-100" max="100"
                       value="{(default_value - 1000) / 10:.1f}" {' '.join(attrs)} style="width: 80px; margin: 0 8px;">
                <span>cents</span>
            </div>
        ''')
    elif ui_type == 'steps':
        # one checkbox per step of the division this address holds, from its first step; the
        # page hides the steps the live tuning doesn't have, and the rows in twelve
        first = param['first_step']
        bits = (max_value + 1).bit_length() - 1
        boxes = ''.join(
            f'''<label class="degree" title="step {first + bit}">
                    <input type="checkbox" class="degree-box inactive" id="param-{sysex_address}-bit-{bit}"
                           data-sysex-address="{sysex_address}" data-bit="{bit}" data-step="{first + bit}"
                           version="{introduction_version}" {'checked' if default_value & (1 << bit) else ''}>
                    <span>{first + bit}</span>
                </label>'''
            for bit in range(bits))
        html.append(f'''
            <div class="step-scale-line" data-first-step="{first}" style="display: flex; align-items: center; margin: 8px 0;">
                <label style="width: 150px; font-weight: bold;" title="{html_escape(tooltip)}">{name}</label>
                <div id="param-{sysex_address}" class="degree-row step-row" {' '.join(attrs)}>
                    {boxes}
                </div>
            </div>
        ''')
    if sysex_address == 422:
        html.append(PLATE_TEACH_HTML)
    return '\n'.join(html)

# Plate detect (422, firmware 98): teaching the plate fitted and forgetting every plate taught are
# actions written once, like the looper's (index.js, plate buttons); the switch above keeps 0 or 1.
# Choosing a plate in harp plate teaches it too: the button is for the plate already chosen.
PLATE_TEACH_HTML = '''
            <div class="plate-teach" style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px;">
                <div class="button_div">
                    <button type="button" class="plate-btn inactive" data-plate-action="3" version="0.98" title="learn the plate fitted now as the plate harp plate shows: keep your hands off the harp until the LED flashes white three times; one long red flash means it reads as another plate already learned">teach this plate</button>
                </div>
                <div class="button_div">
                    <button type="button" class="plate-btn inactive" data-plate-action="2" version="0.98" title="forget every plate this minichord has learned; plate detect stays on, and each plate needs teaching again">forget all plates</button>
                </div>
                <div style="font-size: 0.85em; opacity: 0.8; max-width: 340px;">To teach a plate: fit it, choose it in harp plate (or press teach if it is already chosen), then keep your hands off the harp until the LED flashes white three times. From then on two white flashes mean the minichord found that plate by itself.</div>
            </div>'''

# A Scala file (.scl) of twelve notes read into the own temperament (tuning.js)
SCALA_IMPORT_HTML = '''
            <div class="scala-import" style="margin: 8px 0 12px;">
                <label style="font-weight: bold;" title="a Scala scale file of twelve notes, its first note on C: each note's offset from equal temperament goes into the twelve below, and the temperament becomes your own">Read a Scala file</label>
                <input type="file" id="scala-file" accept=".scl,.txt" class="always-on" style="margin: 0 8px;">
                <label title="move the offsets together so A stays on the master tuning pitch"><input type="checkbox" id="scala-keep-a" class="always-on" checked> keep A at the master pitch</label>
                <button type="button" id="own-equal" class="always-on" style="margin-left: 8px;">all to equal</button>
                <div id="scala-status" style="font-size: 0.85em; opacity: 0.8; margin-top: 4px;"></div>
            </div>'''

# Your own drum kit (kits.js, firmware 113): sound files, a folder or a .mckit read in, a voice each,
# processed into one image and sent to the minichord, which plays it as drum kit 13. Shown whatever the
# firmware, so a kit can be made and saved as a .mckit with no minichord at hand; kits.js says what the
# minichord has room for. The voice rows are drawn by kits.js once there are files.
def user_kit_html(param):
    base_kits = ''.join(f'<option value="{o["value"]}"{" selected" if o["value"] == 4 else ""}>{html_escape(o["label"])}</option>'
                        for o in param.get('options', []) if 1 <= o['value'] <= 12)
    return f'''
            <div id="user-kit" class="user-kit">
                <div class="user-kit-head">
                    <label style="font-weight: bold;" title="up to thirteen of your own one-shots in place of the drum machine's voices: drum kit 13, your own. Give it sound files (WAV, AIFF, FLAC, MP3, Ogg, Opus, M4A), a folder of them, or a .mckit kit file; each file goes to the voice its name suggests, and each hit is trimmed, faded and levelled before it is sent">Your own kit</label>
                    <span id="kit-info" class="kit-info"></span>
                </div>
                <div class="kit-load">
                    <label class="kit-pick-btn" title="sound files, or a .mckit kit file">sound files <input type="file" id="kit-files" class="always-on" multiple accept="audio/*,.wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.opus,.m4a,.aac,.mckit"></label>
                    <label class="kit-pick-btn" title="a folder of sound files: its folders' names help say which is which">a folder <input type="file" id="kit-folder" class="always-on" webkitdirectory multiple></label>
                    <div id="kit-drop" class="kit-drop">or drop sound files, a folder or a .mckit here</div>
                    <button type="button" id="kit-resend" class="always-on" hidden title="the last kit sent from this browser, kept here">send your last kit again</button>
                </div>
                <div id="kit-card" class="kit-card" hidden>
                    <div class="kit-fields">
                        <label title="the kit's name, up to 20 characters of plain ASCII: drum kit shows it">name <input type="text" id="kit-name" class="always-on" maxlength="20" autocomplete="off"></label>
                        <label title="who made the sounds, kept in the .mckit">author <input type="text" id="kit-author" class="always-on" autocomplete="off"></label>
                        <label title="what plays for a voice left empty, and the grit (bits, hold and drive) of the whole kit">base kit <select id="kit-base" class="always-on">{base_kits}</select></label>
                        <button type="button" id="kit-reset" class="always-on" title="the guess from the file names again, every voice back to its defaults">reset mapping</button>
                    </div>
                    <label class="kit-licence" title="the sounds' licence, from a licence or readme file in the folder, or as you type it: kept in the .mckit">licence
                        <textarea id="kit-licence" class="always-on" rows="2"></textarea></label>
                    <div id="kit-licence-note" class="kit-licence-note"></div>
                    <label id="kit-filter-box" class="kit-filter" hidden title="with this many files, each voice's list and the not-used bin show only some: this finds the others by part of a name or folder">find a file <input type="search" id="kit-filter" class="always-on" autocomplete="off" placeholder="part of its name or folder"></label>
                    <div id="kit-voices" class="kit-voices"></div>
                    <div id="kit-unused" class="kit-unused" hidden></div>
                    <div class="kit-meter-line">
                        <meter id="kit-meter" min="0" max="262144" value="0"></meter>
                        <span id="kit-meter-text"></span>
                    </div>
                    <div class="kit-actions">
                        <button type="button" id="kit-send" class="always-on" disabled title="write the kit to the minichord and set drum kit to your own; a bank keeps it once saved">send to the minichord</button>
                        <button type="button" id="kit-save" class="always-on" disabled title="the kit as a .mckit file, to keep or share">save as a .mckit</button>
                    </div>
                </div>
                <div id="kit-progress-box" class="kit-progress" hidden>
                    <progress id="kit-progress" max="1" value="0" aria-labelledby="kit-progress-text"></progress>
                    <span id="kit-progress-text"></span>
                    <span id="kit-progress-said" class="kit-said" aria-live="polite"></span>
                </div>
                <div id="kit-status" class="kit-status" role="status"></div>
            </div>'''

# The tuning circle (tuning.js): the octave as a circle, the live tuning's steps, the harp's scale,
# and the notes the minichord plays as they sound
TUNING_CIRCLE_HTML = '''
            <h3 style="margin: 30px 0 10px; font-size: 1.5em;">Tuning circle</h3>
            <div class="tuning-circle" title="the octave as a circle, C at the top: a tick for each step of the tuning, a dot for each note of the harp's scale, and the notes the minichord plays as they sound (with MPE output or MTS output on, at their true pitch)">
                <svg id="tuning-circle" viewBox="-120 -120 240 240" width="260" height="260" role="img" aria-label="tuning circle"></svg>
                <div id="tuning-circle-caption" style="font-size: 0.85em; opacity: 0.8;"></div>
            </div>'''

# Generate rhythm grid HTML
def generate_rhythm_grid_html():
    rhythm_params = [p for p in parameters.get('rhythm_parameter', []) if 220 <= p['sysex_adress'] <= 235]
    if not rhythm_params:
        return ''
    # sized in index.css, which lets the sixteen steps share a phone's width
    html = ['<div class="rhythm-grid">']
    rhythm_version = rhythm_params[0].get('introduction_version', 0.01) if rhythm_params else 0.01
    for step in range(16):
        html.append(f'<div class="rhythm-step">')
        for voice in range(7):
            sysex_address = 220 + step
            html.append(f'''
                <input type="checkbox" id="rhythm-checkbox-{step}-{voice}" class="inactive"
                       data-sysex-address="{sysex_address}" data-rhythm-step="{step}"
                       data-voice="{voice}" version="{rhythm_version}" style="margin: 2px;">
            ''')
        html.append('</div>')
    html.append('</div>')
    return '\n'.join(html)

# Generate HTML for parameter controls with group headers
# Submenus within a section, each a list of the subgroups it holds, in order. What shapes the
# sound is kept apart from what decides which notes play, so neither has to be scrolled past to
# reach the other. Subgroups not named here stay at the top level of their section.
submenus = {
    'global_parameter': [
        ('Device and MIDI', ['General', 'MIDI']),
        ('Key and tuning', ['Key and tuning', 'Own temperament']),
        # a tanpura or a shruti box on the key's Sa
        ('Drone', ['Drone']),
        ('Effects', ['Effects', 'Vocoder', 'Organ']),
        # what plays into the minichord over USB, moving settings and keeping the rhythm on its beat
        ('The phone\'s sound', ['Phone']),
    ],
    'controls': [
        ('Knobs', ['Chord knob', 'Harp knob', 'Mod knob', 'Knob layer']),
        ('Hover', ['Hover']),
        ('Double tap and ♯', ['Double tap']),
    ],
    'chord_parameter': [
        ('Playing', ['General', 'Buttons']),
        ('Voicing and layout', ['Voicing', 'Slash chords and cantus', 'Alternate layout']),
        ('Sound', ['Oscillator', 'Envelope', 'Low pass filter', 'Tremolo', 'Vibrato', 'Formants']),
        ('Effects', ['Delay', 'Reverb', 'Crunch', 'Ensemble', 'Output filter']),
    ],
    'harp_parameter': [
        ('Notes', ['Notes']),
        # harp drums and the drum pads' settings (firmware 101) beside the plate
        ('Playing', ['Plate', 'Drum pads', 'Pluck', 'Ribbon']),
        ('Sound', ['Oscillator', 'String model', 'Transient', 'Envelope', 'Low pass filter', 'Tremolo', 'Vibrato']),
        ('Effects', ['Delay', 'Reverb', 'Crunch', 'Spread', 'Output filter']),
    ],
    # the looper sits with rhythm mode, whose beat and bars it keeps
    'rhythm_parameter': [
        ('Style', ['Style']),
        # style B, fills, the intro, the ending and the palm's break
        ('Fills and sections', ['Sections']),
        # a synthesized kit on the rhythm's clock and its grooves (harp drums, the harp as its pads, is with the harp's plate)
        ('Drums', ['Drums']),
        ('Tempo', ['Tempo']),
        ('Chord changes', ['Chord changes']),
        ('Pattern', ['Pattern']),
        ('Looper', ['Looper']),
    ],
}

def submenu_html(title, body):
    return f'''
                <details class="submenu">
                    <summary>{title}</summary>
                    <div class="submenu-body">
                        {body}
                    </div>
                </details>
    '''

def generate_details_html(group_name, params):
    grouped_params = {}
    for param in params:
        param_group = param['group']
        if param_group == 'hidden' or 220 <= param['sysex_adress'] <= 235:  # the rhythm grid's steps
            continue
        if param_group not in grouped_params:
            grouped_params[param_group] = []
        grouped_params[param_group].append(param)
    
    subgroup_html = {}
    # Use defined subgroup order or fallback to sorted
    ordered_subgroups = subgroup_order.get(group_name, sorted(grouped_params.keys()))
    for param_group in ordered_subgroups:
        if param_group not in grouped_params:
            continue
        # Convert name-based order to sysex_adress order
        name_order = parameter_name_order.get(group_name, {}).get(param_group, [])
        param_order = [
            name_to_sysex[group_name][param_group][name]
            for name in name_order
            if name in name_to_sysex[group_name].get(param_group, {})
        ]
        # Sort parameters by defined order or fallback to sysex_adress
        sorted_params = sorted(
            grouped_params[param_group],
            key=lambda p: param_order.index(p['sysex_adress']) if p['sysex_adress'] in param_order else len(param_order) + p['sysex_adress']
        )
        subgroup_html[param_group] = ''.join(generate_param_html(param) for param in sorted_params)
        if group_name == 'rhythm_parameter' and param_group == 'Pattern':
            subgroup_html[param_group] += generate_rhythm_grid_html()
        if param_group == 'Key and tuning':
            subgroup_html[param_group] += TUNING_CIRCLE_HTML

    def heading(g):
        return f'<h3 style="margin: 30px 0 10px; font-size: 1.5em;">{g}</h3>'

    param_html = []
    placed = set()
    for title, members in submenus.get(group_name, []):
        # a subgroup named as its submenu is ("Pattern" in Pattern) needs no heading of its own
        body = [('' if g == title else heading(g)) + subgroup_html[g] for g in members if g in subgroup_html]
        placed.update(members)
        if body:
            param_html.append(submenu_html(title, ''.join(body)))
    # anything no submenu claims, so a new subgroup still shows up somewhere; in a sheet of one
    # subgroup the sheet's name is its heading
    single = len(subgroup_html) == 1 and group_name in SHEETS
    param_html.extend(('' if single else heading(g)) + html for g, html in subgroup_html.items() if g not in placed)

    if not param_html:
        return ''
    
    # "Parameters" goes on a phone (index.css), where every section name would wrap with it
    display_name = SECTION_TITLES.get(group_name) or (
        group_name.replace('_parameter', '').replace('_', ' ').title() + '<span class="section-suffix"> Parameters</span>')
    return f'''
        <details style="width: fit-content; margin: 20px 0; padding: 8px; border: none; border-radius: 5px;">
            <summary style="width: fit-content; font-size: 1.6em; font-weight: bold; cursor: pointer;">{display_name}</summary>
            <div style="padding: 10px;">
                {''.join(param_html)}
            </div>
        </details>
    '''

# The themes in the picker. "tokens" themes are drawn by themes/common.css from the colours and
# fonts their own stylesheet sets; light and dark are index.css itself, arcade is its own sheet.
# A tagline (shown while disconnected, connected) sits under the title.
THEMES = [
    {'id': 'light', 'label': 'light'},
    {'id': 'dark', 'label': 'dark'},
    {'id': 'arcade', 'label': 'arcade', 'tagline': ('insert coin', 'player 1 ready')},
    {'id': 'omnichord', 'label': "omnichord '81", 'tokens': True,
     'tagline': ('power off · plug in your minichord', 'sonic strings ready')},
    {'id': 'notebook', 'label': 'lab notebook', 'tokens': True,
     'tagline': ('fig. 1 — awaiting the instrument', 'experiment in progress')},
    {'id': 'choir', 'label': 'choir', 'tokens': True,
     'tagline': ('the choir is silent', 'the choir is assembled')},
    {'id': 'chiptune', 'label': 'chiptune', 'tokens': True,
     'tagline': ('&gt; waiting for device', '&gt; device ready')},
    {'id': 'contrast', 'label': 'high contrast', 'tokens': True},
    {'id': 'stage', 'label': 'stage', 'tokens': True},
]
theme_links = '\n'.join(
    ['  <link href="themes/fonts.css" rel="stylesheet" />', '  <link href="themes/common.css" rel="stylesheet" />'] +
    [f'  <link href="themes/{t["id"]}.css" rel="stylesheet" />' for t in THEMES if t['id'] not in ('light', 'dark')])
theme_options = '\n'.join(f'              <option value="{t["id"]}">{t["label"]}</option>' for t in THEMES)
theme_taglines = '\n'.join(
    f'        <div class="theme-tagline" data-for="{t["id"]}"><span class="off">{t["tagline"][0]}</span><span class="on">{t["tagline"][1]}</span></div>'
    for t in THEMES if 'tagline' in t)
# The looper (setting 256, firmware 32 on) records what the minichord plays and loops it. The
# setting is an action, never kept: each button writes it once (index.js, looper buttons).
LOOPER_ACTIONS = [
    (1, '<span class="glyph">●</span>', 'record', 'record a new loop of what you play, in place of the last; press again to close it and play it'),
    (2, '<span class="glyph">▶</span>', 'play', 'play the loop from the top, or close one being recorded and play it'),
    (3, '<span class="glyph">■</span>', 'stop', 'stop the loop, or close one being recorded and stop'),
    (5, 'overdub', 'overdub', 'while the loop plays, add to it what you play; press again to stop adding'),
    (4, 'clear', 'clear', 'forget the loop'),
]
looper_buttons = '\n'.join(f'''            <div class="button_div">
              <button class="looper-btn inactive" data-looper-action="{action}" version="0.32" aria-label="{name}" title="{name}: {title}">{label}</button>
            </div>''' for action, label, name, title in LOOPER_ACTIONS)
# Chord memory (setting 287, firmware 47 on), as on an Omnichord: a progression recorded in time with
# rhythm mode, played back by itself. An action like the looper's, written once a button.
CHORD_MEMORY_ACTIONS = [
    (1, '<span class="glyph">●</span>', 'record', 'record a chord progression in time with rhythm mode, from the next bar line (it turns rhythm mode on); press again to close it on the nearest bar line and play it'),
    (2, '<span class="glyph">▶</span>', 'play', 'play the progression from the next bar line, the accompaniment and the harp following it, or close one being recorded and play it'),
    (3, '<span class="glyph">■</span>', 'stop', 'stop the progression, or close one being recorded and stop'),
    (4, 'clear', 'clear', 'forget the progression'),
]
chord_memory_buttons = '\n'.join(f'''            <div class="button_div">
              <button class="looper-btn inactive" data-looper-action="{action}" data-address="287" version="0.47" aria-label="chord memory {name}" title="chord memory {name}: {title}">{label}</button>
            </div>''' for action, label, name, title in CHORD_MEMORY_ACTIONS)
token_themes = json.dumps([t['id'] for t in THEMES if t.get('tokens')])
all_themes = json.dumps([t['id'] for t in THEMES])

# The firmware, installed from this page over USB (WebHID): flash.js writes it in the minichord's update
# mode, update.js runs the steps. Which parts show, and what they say, depends on the firmware the
# minichord has, the computer and the browser, so update.js shows and fills them; nothing is fetched
# until the sheet opens. PJRC's permission rule, which Chrome on Linux needs for the update mode, is
# given where an update fails for want of it and under "if it doesn't work".
RELEASE_PAGE = 'https://github.com/keyandcableco/minichord/releases/latest'
LINUX_RULE_HTML = '''<div class="fw-rule">
                <pre><code>sudo wget -O /etc/udev/rules.d/00-teensy.rules https://www.pjrc.com/teensy/00-teensy.rules
sudo udevadm control --reload-rules &amp;&amp; sudo udevadm trigger</code></pre>
                <button type="button" class="always-on fw-quiet fw-copy" title="copy the two commands, to paste into a terminal">copy the commands</button>
              </div>'''
FIRMWARE_SHEET_HTML = f'''
    <!-- the minichord's firmware, installed from here over USB: flash.js writes it, update.js runs the steps -->
    <div id="firmware-sheet" class="minishop-sheet firmware-sheet" popover aria-labelledby="firmware-title">
      <div class="minishop-head">
        <div>
          <h2 id="firmware-title">update the firmware</h2>
          <p class="controls-sheet-where">the minichord's own program, installed from this page over USB</p>
        </div>
        <button type="button" class="settings-close always-on" popovertarget="firmware-sheet" popovertargetaction="hide" aria-label="close the firmware update"><span class="glyph">✕</span></button>
      </div>
      <div class="firmware-body">
        <div id="fw-unsupported" class="fw-box" hidden>
          <p class="fw-text">Updating the firmware from this page needs Chrome or Edge on a computer.</p>
          <p class="fw-text">In this browser, update it the old way, with Teensy Loader: the <a href="{RELEASE_PAGE}" target="_blank" rel="noopener">release page</a> has the file and the steps.</p>
        </div>
        <div id="fw-main" hidden>
          <p id="fw-now" class="fw-now"></p>
          <p id="fw-newest" class="fw-newest"></p>
          <div class="fw-buttons" id="fw-lookup-row" hidden>
            <button type="button" id="fw-lookup-again" class="always-on">try again</button>
          </div>
          <details id="fw-other" class="fw-other">
            <summary>other firmware</summary>
            <div class="fw-choices">
              <label class="fw-choice"><input type="radio" name="fw-pick" value="newest" class="always-on"> <span id="fw-pick-newest">the newest firmware</span></label>
              <label class="fw-choice"><input type="radio" name="fw-pick" value="classic" class="always-on"> Ben's classic firmware</label>
              <p class="settings-hint fw-under">It has fewer features, and the advanced settings on this page stop working with it.</p>
              <label class="fw-choice"><input type="radio" name="fw-pick" value="file" class="always-on"> a .hex file from this computer</label>
              <div class="fw-under"><input type="file" id="fw-file" class="always-on" accept=".hex" aria-label="a .hex file from this computer"></div>
              <p id="fw-file-said" class="fw-under fw-small"></p>
            </div>
          </details>
          <p id="fw-get" class="fw-get"></p>
          <div class="fw-buttons" id="fw-get-row" hidden>
            <button type="button" id="fw-get-again" class="always-on">try again</button>
          </div>
          <ol id="fw-steps" class="fw-steps">
            <li id="fw-step-backup" class="fw-step">
              <h3>Back up your banks</h3>
              <p id="fw-backup-text" class="fw-text"></p>
              <label id="fw-backup-box" class="fw-check"><input type="checkbox" id="fw-backup-check" class="always-on" checked> back up my banks first (recommended)</label>
              <div class="fw-buttons">
                <button type="button" id="fw-backup-btn" class="always-on" title="read all twelve banks into a file, and keep them here to put back after the update">back up my banks</button>
              </div>
            </li>
            <li id="fw-step-restart" class="fw-step">
              <h3>Restart it into update mode</h3>
              <p id="fw-restart-text" class="fw-text"></p>
              <div class="fw-buttons">
                <button type="button" id="fw-restart-btn" class="always-on" title="restart the minichord into update mode, ready for the new firmware">restart into update mode</button>
              </div>
            </li>
            <li id="fw-step-install" class="fw-step">
              <h3>Install it</h3>
              <p id="fw-install-text" class="fw-text"></p>
              <div class="fw-buttons">
                <button type="button" id="fw-install-btn" class="always-on">install</button>
                <button type="button" id="fw-pin-btn" class="always-on fw-quiet">use the pin instead</button>
              </div>
            </li>
          </ol>
          <div id="fw-finish" class="fw-box" hidden>
            <p class="fw-text">If it's plugged in and its light is off, it may be waiting in update mode, after an update that stopped partway or a restart into update mode.</p>
            <div class="fw-buttons">
              <button type="button" id="fw-finish-btn" class="always-on">finish an update</button>
              <button type="button" id="fw-leave-btn" class="always-on fw-quiet">leave update mode</button>
            </div>
            <p id="fw-finish-text" class="fw-text fw-small"></p>
          </div>
          <div id="fw-progress-box" class="fw-progress" hidden>
            <progress id="fw-progress" max="1" value="0" aria-labelledby="fw-progress-text"></progress>
            <span id="fw-progress-text"></span>
            <span id="fw-progress-said" class="fw-said" aria-live="polite"></span>
          </div>
          <div id="fw-status" class="fw-status" role="status"></div>
          <div id="fw-rule-box" hidden>
              {LINUX_RULE_HTML}
          </div>
          <div class="fw-buttons" id="fw-after-row" hidden>
            <button type="button" id="fw-again-btn" class="always-on" hidden>try again</button>
            <button type="button" id="fw-restore-btn" class="always-on" hidden title="write the banks backed up before the update back to the minichord">put my banks back</button>
          </div>
          <details class="fw-help">
            <summary>if it doesn't work</summary>
            <ul>
              <li>Close Teensy Loader if it is open: with Auto on, it takes the minichord as soon as it is in update mode.</li>
              <li>Nothing in Chrome's box? Press the little button through the hole in the back of the minichord with a pin, a quick press: it appears after a moment.</li>
              <li class="fw-linux-only">On Linux, Chrome needs a permission rule for the update mode, once. Run these two commands in a terminal:
              {LINUX_RULE_HTML}</li>
              <li>Use a USB cable that carries data, plugged straight into the computer rather than through a hub.</li>
              <li>The old way still works: Teensy Loader, with the file from the <a href="{RELEASE_PAGE}" target="_blank" rel="noopener">release page</a>.</li>
            </ul>
          </details>
        </div>
      </div>
    </div>'''

# Define HTML template
html_template = '''<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <link href="index.css" rel="stylesheet" />
{theme_links}
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>minicontrol</title>
  <meta name="description" content="Edit, organise and back up the presets on a minichord, over USB MIDI.">
  <link rel="canonical" href="https://minicontrol.keyandcable.com/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Key &amp; Cable">
  <meta property="og:title" content="minicontrol">
  <meta property="og:description" content="Shape every sound on your minichord, then set it across all twelve banks, save profiles and back them up. In the browser, over USB.">
  <meta property="og:url" content="https://minicontrol.keyandcable.com/">
  <meta property="og:image" content="https://minicontrol.keyandcable.com/card.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="minicontrol in pixel type beside the pixel minichord, above twelve coloured bank slots">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="minicontrol">
  <meta name="twitter:description" content="Shape every sound on your minichord, then set it across all twelve banks, save profiles and back them up. In the browser, over USB.">
  <meta name="twitter:image" content="https://minicontrol.keyandcable.com/card.png">
  <link rel="icon" href="icons/icon.svg" type="image/svg+xml">
  <link rel="icon" href="icons/icon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#d92626">
  <meta name="apple-mobile-web-app-title" content="minicontrol">
  <meta name="mobile-web-app-capable" content="yes">
  <script>
    // the saved theme, set before the page draws so it doesn't flash light first
    // (index.js keeps the same rules in setTheme and loadTheme)
    (function () {{
      var themes = {all_themes}, tokenThemes = {token_themes}, theme = null;
      try {{ theme = localStorage.getItem('theme'); }} catch (e) {{}}
      if (themes.indexOf(theme) < 0) theme = window.matchMedia && matchMedia('(prefers-contrast: more)').matches ? 'contrast' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      if (tokenThemes.indexOf(theme) >= 0) document.documentElement.setAttribute('data-themed', '');
    }})();
  </script>
</head>
<body>
  <div id="container" style="max-width: 100vw; margin: 0 auto;">
    <div class="status-header">
      <div class="title-container">
        <h1>minicontrol</h1>
{theme_taglines}
        <span id="notification-bubble">
          <span id="dot">●</span>
          <span id="connection-text"></span>
        </span>
        <span id="tour-nudge" class="tour-nudge" hidden>New here? <button type="button" class="always-on" data-tour-start>take the tour</button> <button type="button" class="always-on tour-nudge-close" id="tour-nudge-close" aria-label="not now">✕</button></span>
      </div>
      <button type="button" class="settings-toggle always-on" popovertarget="settings-drawer" title="how to connect, the firmware, manage all banks, back up and restore, the vocoder voice, the theme, and reset"><span class="glyph">⚙</span> settings</button>
    </div>
    <div id="firmware-note" role="status" hidden></div>
    <div id="header">
      <div class="controls-container">
        <!-- what a session at the minichord reaches for; the rest is in the settings drawer below -->
        <div class="toolbar">
          <div class="tool-group" role="group" aria-labelledby="tool-bank">
            <span class="tool-label" id="tool-bank">bank</span>
            <div class="tool-buttons">
              <div class="button_div">
                <select id="bank_number_selection" class="inactive" version="0.01" aria-label="target bank" title="the target bank: the one load, save and reset act on">
                <option value="0">1</option>
                <option value="1">2</option>
                <option value="2">3</option>
                <option value="3">4</option>
                <option value="4">5</option>
                <option value="5">6</option>
                <option value="6">7</option>
                <option value="7">8</option>
                <option value="8">9</option>
                <option value="9">10</option>
                <option value="10">11</option>
                <option value="11">12</option>
                </select>
              </div>
              <div class="button_div">
                <button id="load-bank-btn" class="inactive" version="0.21" title="switch the minichord to the target bank">load</button>
              </div>
              <div class="button_div">
                <button id="save-to-bank-btn" class="inactive" version="0.01" title="save the live settings into the target bank">save</button>
              </div>
            </div>
          </div>
          <!-- the live sound's name (firmware 50), which save keeps with the preset as every setting -->
          <div class="tool-group" role="group" aria-labelledby="tool-name">
            <label class="tool-label" id="tool-name" for="preset-name">name</label>
            <div class="tool-buttons">
              <div class="button_div">
                <input type="text" id="preset-name" class="inactive" version="0.5" maxlength="24" placeholder="no name" autocomplete="off" spellcheck="false" title="the live sound's name, up to 24 plain letters: save to a bank to keep it with the preset">
              </div>
            </div>
          </div>
          <div class="tool-group" role="group" aria-labelledby="tool-sound">
            <span class="tool-label" id="tool-sound">sound</span>
            <div class="tool-buttons">
              <div class="button_div">
                <button id="snapshot-btn" class="inactive" version="0.21" title="remember the live settings, so every change after this can be undone">snapshot</button>
              </div>
              <div class="button_div">
                <button id="revert-btn" class="inactive" version="0.21" title="put back the settings as they were at the snapshot">revert</button>
              </div>
              <div class="button_div">
                <button id="randomise_btn" class="inactive" version="0.01" title="replace the live sound with a random one near a shared preset; save to a bank to keep it">randomise</button>
              </div>
            </div>
          </div>
          <div class="tool-group" role="group" aria-labelledby="tool-share">
            <span class="tool-label" id="tool-share">preset code</span>
            <div class="tool-buttons">
              <div class="button_div">
                <button id="export-settings-btn" class="inactive" version="0.01" title="copy the live settings to the clipboard as a preset code">copy</button>
              </div>
              <div class="button_div">
                <button id="load-settings-btn" class="inactive" version="0.01" title="paste a preset code over the live settings; save to a bank to keep it">paste</button>
              </div>
              <div class="button_div">
                <button id="minishop-btn" class="inactive" version="0.01" title="pick a preset from the minishop to hear on the minichord; save to a bank to keep it">minishop</button>
              </div>
              <div class="button_div">
                <button type="button" id="banksets-btn" class="always-on" title="sets of twelve presets: take a whole set, or mix your own twelve from them">bank sets</button>
              </div>
            </div>
          </div>
          <div class="tool-group" role="group" aria-labelledby="tool-looper">
            <span class="tool-label" id="tool-looper">looper <a class="tool-link" href="https://chordlab.keyandcable.com/looper/" target="_blank" rel="noopener" title="the Minichord Lab's looper: layers, a click, and the minichord's sound and MIDI together">full looper ↗</a></span>
            <div class="tool-buttons looper-buttons">
{looper_buttons}
            </div>
          </div>
          <div class="tool-group" role="group" aria-labelledby="tool-chord-memory">
            <span class="tool-label" id="tool-chord-memory" title="as on an Omnichord: a progression recorded in time with rhythm mode, played back by itself while both hands play the harp">chord memory</span>
            <div class="tool-buttons looper-buttons">
{chord_memory_buttons}
            </div>
          </div>
        </div>
        <div class="tool-group describe-group" role="group" aria-labelledby="tool-describe">
          <span class="tool-label" id="tool-describe">describe</span>
          <!-- a description or an instruction in words, staged before it changes the live sound or any bank; filled by describe.js and commands.js -->
          <div id="describe-preset" class="describe-box"></div>
        </div>
      </div>
      <!-- the minichord, each control labelled with what it does in the live preset and each chord
           button with its chord; choosing one opens the controls sheet. controls.js draws it -->
      <div class="minichord-map" id="minichord-map">
        <div class="map-head">
          <div class="map-layers" id="map-layers" role="group" aria-label="what the drawing shows">
            <button type="button" class="always-on" data-layer="0" aria-pressed="true" title="what each control does as it is">turning</button>
            <button type="button" class="always-on" data-layer="1" aria-pressed="false" title="what each control does with ♯ held down, and the chords a semitone up">holding ♯</button>
            <button type="button" class="always-on" data-layer="2" aria-pressed="false" title="hold ▲ and ▼ together, then press a chord button to change key: the drone follows">▲▼ key</button>
          </div>
          <span id="map-layer-note" class="map-layer-note" hidden title="knob layer is on alternate functions: the knobs and hover play their ♯ settings without ♯ held">knob layer: on the ♯ settings</span>
          <span id="map-key-note" class="map-layer-note" hidden></span>
        </div>
        <svg id="map-svg" viewBox="-30 -175 2390 1000" role="group" aria-label="the minichord's controls"></svg>
        <ul id="map-list" class="map-list"></ul>
        <p class="map-hint">Choose any part of the minichord to change what it does.</p>
        <!-- what the instrument has no button for, as a row of pedals beside it -->
        <div class="map-pedals" role="group" aria-label="more of the sound">
{pedal_buttons}
        </div>
      </div>
    </div>
    <!-- what a control on the drawing does, to change there and then; controls.js fills it -->
    <div id="controls-sheet" class="minishop-sheet controls-sheet" popover aria-labelledby="controls-sheet-title">
      <div class="minishop-head">
        <div>
          <h2 id="controls-sheet-title">controls</h2>
          <p id="controls-sheet-where" class="controls-sheet-where"></p>
        </div>
        <button type="button" class="settings-close always-on" popovertarget="controls-sheet" popovertargetaction="hide" aria-label="close"><span class="glyph">✕</span></button>
      </div>
      <div id="controls-sheet-body" class="controls-sheet-body"></div>
    </div>
    <!-- the minishop's presets, to hear one on the minichord and save it to a bank (index.js fills
         the list). The idea is Sound Lab's. -->
    <div id="minishop-sheet" class="minishop-sheet" popover aria-labelledby="minishop-title">
      <div class="minishop-head">
        <h2 id="minishop-title">minishop</h2>
        <button type="button" class="settings-close always-on" popovertarget="minishop-sheet" popovertargetaction="hide" aria-label="close the minishop"><span class="glyph">✕</span></button>
      </div>
      <p class="settings-hint">Presets players have shared. Load one to hear it on the minichord, then save it to a bank to keep it.
        The idea comes from <a href="https://minichorddrawn.github.io/minichord-soundlab/" target="_blank" rel="noopener">MinichordDrawn's Sound Lab</a>.</p>
      <div id="minishop-list" class="minishop-list"></div>
      <div class="minishop-foot">
        <span id="minishop-loaded" class="minishop-loaded" aria-live="polite">nothing loaded from here yet</span>
        <span class="minishop-save">
          <select id="minishop-bank" class="always-on" aria-label="the bank to save to" title="the target bank, as in the toolbar"></select>
          <button type="button" id="minishop-save-btn" class="always-on" title="save the live settings into this bank">save</button>
        </span>
      </div>
    </div>
    <!-- sets of twelve presets, and your own twelve mixed from them (banksets.js fills it) -->
    <div id="banksets-sheet" class="minishop-sheet banksets-sheet" popover aria-labelledby="banksets-title">
      <div class="minishop-head">
        <div>
          <h2 id="banksets-title">bank sets</h2>
          <p class="controls-sheet-where">take a whole set, or mix your own twelve</p>
        </div>
        <button type="button" class="settings-close always-on" popovertarget="banksets-sheet" popovertargetaction="hide" aria-label="close bank sets"><span class="glyph">✕</span></button>
      </div>
      <div id="banksets-body" class="banksets-body"></div>
      <div class="banksets-foot">
        <div id="banksets-save"></div>
        <div class="banksets-bar">
          <span id="banksets-summary" class="banksets-summary" aria-live="polite"></span>
          <button type="button" id="banksets-save-btn" class="always-on bs-quiet">save as a set file</button>
          <button type="button" id="banksets-write" class="always-on">write to the minichord</button>
        </div>
      </div>
    </div>{firmware_sheet}
    <!-- what is reached for now and then, out of the way until the settings button opens it -->
    <div id="settings-drawer" class="settings-drawer" popover aria-labelledby="settings-title">
      <div class="settings-panel">
        <div class="settings-head">
          <h2 id="settings-title">settings</h2>
          <button type="button" class="settings-close always-on" popovertarget="settings-drawer" popovertargetaction="hide" aria-label="close settings"><span class="glyph">✕</span></button>
        </div>
        <section class="settings-section">
          <details id="connection-help">
            <summary class="tool-label">connecting</summary>
            <ul>
              <li>provide the system authorization for MIDI control</li>
              <li>use a recent version of Chrome</li>
              <li>connect the minichord with a USB cable and make sure it is on.</li>
            </ul>
            <div tabindex="1" id="information_zone">
              <strong id="information_text"></strong>
            </div>
          </details>
        </section>
        <section class="settings-section" id="settings-device">
          <h5 class="tool-label">the minichord</h5>
          <div class="settings-buttons">
            <div class="button_div">
              <button type="button" class="always-on" popovertarget="device-sheet" title="MIDI channels and ports, MPE, tuning sent over MIDI, and USB audio">device and MIDI</button>
            </div>
          </div>
        </section>
        <section class="settings-section" id="settings-firmware">
          <h5 class="tool-label">firmware</h5>
          <p class="settings-hint" id="firmware-hint">The minichord's own program: the newest installs from here, over USB.</p>
          <div class="settings-buttons">
            <div class="button_div">
              <button type="button" id="firmware-btn" class="always-on" data-close-settings title="install the newest firmware on the minichord from this page, its banks backed up first">update the firmware</button>
            </div>
          </div>
        </section>
        <section class="settings-section" id="settings-all-banks">
          <h5 class="tool-label">all banks</h5>
          <div class="settings-buttons">
            <div class="button_div">
              <button type="button" id="banksets-drawer-btn" class="always-on" data-close-settings title="sets of twelve presets: take a whole set, or mix your own twelve from them">bank sets</button>
            </div>
            <div class="button_div">
              <button id="bulk-edit-btn" class="inactive" version="0.21" onclick="open_bank_sheet()" data-close-settings title="read all twelve banks, then move them, set a setting in every one, or apply a profile">reorder and bulk edit</button>
            </div>
            <div class="button_div">
              <button id="backup-btn" class="inactive" version="0.21" onclick="backup_all_banks()" data-close-settings title="read all twelve banks into one file">back up all banks</button>
            </div>
            <div class="button_div">
              <button id="restore-btn" class="inactive" version="0.21" onclick="restore_all_banks()" data-close-settings title="write a backup file back to the banks, replacing what is there">restore from backup</button>
            </div>
          </div>
        </section>
        <section class="settings-section">
          <h5 class="tool-label">vocoder voice</h5>
          <!-- a voice looped into the minichord's USB speaker for the vocoder to shape; filled by talk.js -->
          <div id="talk-main" class="talk-slot"></div>
        </section>
        <section class="settings-section" id="settings-theme">
          <h5 class="tool-label"><label for="theme-select">theme</label></h5>
          <select id="theme-select" class="always-on" data-token-themes='{token_themes}'>
{theme_options}
          </select>
        </section>
        <section class="settings-section">
          <h5 class="tool-label">this page</h5>
          <div class="settings-buttons">
            <div class="button_div">
              <button type="button" class="always-on" data-tour-start data-close-settings title="a walk round the page: the banks, the drawing, the sheets, the drawer and the bank sets">take the tour</button>
            </div>
          </div>
        </section>
        <section class="settings-section">
          <h5 class="tool-label">locks</h5>
          <p class="settings-hint">A locked setting is the minichord's own, whatever preset is loaded: the harp plate, the touch thresholds and the master tuning to begin with. The padlock beside a setting locks or unlocks it. Firmware 76 or later.</p>
          <div class="settings-buttons">
            <div class="button_div">
              <button id="lock-defaults-btn" class="inactive" version="0.76" title="lock the harp plate, the touch and release thresholds and the master tuning again, at their present values, and nothing else">lock the defaults</button>
            </div>
            <div class="button_div">
              <button id="unlock-all-btn" class="inactive" version="0.76" title="unlock every setting, so presets set them all again">unlock everything</button>
            </div>
          </div>
        </section>
        <section class="settings-section settings-danger">
          <h5 class="tool-label">reset</h5>
          <p class="settings-hint">Back to factory settings. This erases what the bank holds and can't be undone.</p>
          <div class="settings-buttons">
            <div class="button_div">
              <button id="reset-bank-btn" class="inactive" version="0.01" title="erase the target bank, back to its factory settings">reset bank</button>
            </div>
            <div class="button_div">
              <button id="reset-all-banks-btn" class="inactive" version="0.01" title="erase all twelve banks, back to their factory settings">reset all banks</button>
            </div>
          </div>
        </section>
      </div>
    </div>
    <div id="instruction_zone" style="margin: 2px 0;">
      For instruction on how to use this tool, please refer to the 
      <a href="https://minichord.com/user_manual/#custom-presets">minichord documentation.</a><br>
      To test and load user-submitted presets, visit the 
      <a href="https://minichord.com/minicontrol/minishop.html">minishop.</a><br>
      New to this page? <button type="button" id="tour-btn" class="always-on tour-link" data-tour-start>Take the tour.</button>
      <span class="manual-link" hidden><br>The newer settings and gestures, drawn with the hands that play them, are in the <a href="manual/">advanced manual</a>.</span>
    </div>
    <!-- any setting by name, and every setting laid out at once, as the page used to be (controls.js) -->
    <div id="settings-finder" class="settings-finder">
      <input type="search" id="finder-input" class="always-on" placeholder="find a setting: reverb, attack, MIDI channel…" aria-label="find a setting" autocomplete="off">
      <button type="button" id="show-every-setting" class="always-on" aria-pressed="false" title="every setting on the page at once, in its sections">show every setting</button>
      <ul id="finder-results" class="finder-results" hidden></ul>
    </div>
    <div id="parameters">
      {parameter_sections}
    </div>
    <footer id="page-footer">
      <p>A fork of <a href="https://minichord.com/minicontrol/">Ben Poilve's minicontrol</a>. The bank tools, knob layer, double tap pairs and the other newer settings need the unofficial <a href="https://github.com/keyandcableco/minichord/releases/latest">advanced firmware</a> for the minichord. It is experimental and may have bugs, and it isn't made or endorsed by Ben Poilve: back up your banks before installing it.</p>
      <p>Made by <a href="https://keyandcable.com">The Key &amp; Cable Company</a>. Source on <a href="https://github.com/keyandcableco/minicontrol">GitHub</a>.<span class="manual-link" hidden> The <a href="manual/">advanced manual</a> explains the newer settings.</span></p>
    </footer>
  </div>
  <!-- say-thanks -->
  <p style="text-align:center;margin:28px 0 18px;font-size:14px;opacity:0.8">minicontrol by <a href="https://keyandcable.com/projects.html" target="_blank" rel="noopener" style="color:inherit">The Key &amp; Cable Company</a> &middot; <a href="https://keyandcable.com/thanks.html" target="_blank" rel="noopener" style="color:inherit;font-weight:bold">Say thanks</a></p>
  <script src="minichordcontroller.js"></script>
  <script src="index.js"></script>
  <script src="banks.js"></script>
  <script src="banksets.js"></script>
  <script src="describe.js"></script>
  <script src="commands.js"></script>
  <script src="talk.js"></script>
  <script src="listen.js"></script>
  <script src="tuning.js"></script>
  <script src="kits.js"></script>
  <script src="flash.js"></script>
  <script src="update.js"></script>
  <script src="controls.js"></script>
  <script src="envelope.js"></script>
  <script src="waveforms.js"></script>
  <script src="filters.js"></script>
  <script src="pedals.js"></script>
  <script src="tour.js"></script>
  <script>
    // installable, and opens offline once visited (see sw.js)
    if ('serviceWorker' in navigator) {{
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {{}}));
    }}
  </script>
</body>
</html>
'''
# Generate parameter sections in specified order
sections = {}
for name, params in parameters.items():
    for p in params:
        place, group = PLACES_BY_ADDRESS.get(p['sysex_adress']) or PLACES.get((name, p['group'])) or (name, p['group'])
        sections.setdefault(place, []).append(dict(p, group=group))
        name_to_sysex.setdefault(place, {}).setdefault(group, {})[p['name']] = p['sysex_adress']
parameter_sections = []
for group_name in PLACE_ORDER:
    section = generate_details_html(group_name, sections[group_name])
    if group_name in SHEETS:
        section = sheet_html(group_name, section)
    else:
        section = section.replace('<details style=', '<details class="every-only" style=', 1)
    parameter_sections.append(section)

# Insert into HTML
# the sheets with no part of the minichord to open them, under the drawing
PEDALS = ['tuning', 'drone', 'effects', 'vocoder', 'organ', 'phone']
pedal_buttons = '\n'.join(f'''          <button type="button" class="map-pedal always-on" data-sheet="{p}" aria-haspopup="dialog">
            <span class="map-pedal-name">{p}</span><span class="map-pedal-value" data-status="{p}"></span>
          </button>''' for p in PEDALS)
html_content = html_template.format(
    pedal_buttons=pedal_buttons,
    parameter_sections=''.join(parameter_sections),
    theme_links=theme_links,
    theme_options=theme_options,
    theme_taglines=theme_taglines,
    looper_buttons=looper_buttons,
    chord_memory_buttons=chord_memory_buttons,
    firmware_sheet=FIRMWARE_SHEET_HTML,
    token_themes=token_themes,
    all_themes=all_themes
)

# Write to index.html
with open('index.html', 'w') as f:
    f.write(html_content)

# Define sysex_handler_template with escaped braces
sysex_handler_template = '''#ifndef SYSEX_HANDLER_H
#define SYSEX_HANDLER_H

void apply_audio_parameter(int adress, int value) {{
    switch(adress) {{
{switch_cases}
        default:
            break;
    }}
}}

#endif // SYSEX_HANDLER_H
'''

# Generate switch cases
switch_cases = []
for group_name, param_list in parameters.items():
    if group_name == 'sysex_name_map':
        continue
    for param in param_list:
        sysex_address = param['sysex_adress']
        method = param.get('method', '')
        if not method:
            continue
        # Apply scaling for float parameters
        # floats are sent in hundredths, unless the parameter says otherwise (master tuning is in tenths)
        if param.get('data_type') == 'float' and 'float_multiplier' not in param:
            method = method.replace('value', 'value/100.0')
        # Ensure method ends with semicolon
        method = method.rstrip(';') + ';'
        # Handle iteration if specified
        iterate = param.get('iterate', 1)
        switch_case = f'''
        case {sysex_address}:'''
        if iterate > 1:
            switch_case += f'''
            for (int i=0;i<{iterate};i++){{
                {method}
            }}'''
        else:
            switch_case += f'''
            {method}'''
        switch_case += '''
            break;'''
        switch_cases.append(switch_case)

# Sort switch cases by sysex_address for readability
switch_cases.sort(key=lambda x: int(x.split('case ')[1].split(':')[0]))

# Write to sysex_handler.h
with open('sysex_handler.h', 'w') as f:
    f.write(sysex_handler_template.format(switch_cases=''.join(switch_cases)))

print("Generated index.html and sysex_handler.h")