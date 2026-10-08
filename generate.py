import json
import os


# Define SVG file reference (replace with your actual SVG file path)
svg_file = 'minichord_layout_web.svg' 

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

# Define desired order of parameter groups
group_order = [
    'global_parameter',
    'chord_parameter',
    'harp_parameter',
    'chord_potentiometer',
    'harp_potentiometer',
    'modulation_potentiometer',
    'sharp_button_parameter',
    'rhythm_parameter'
]

# Define subgroup order for each group
subgroup_order = {
    'global_parameter': ['General', 'Key and tuning', 'Effects', 'MIDI', 'Knobs', 'Hover', 'Double tap'],
    'chord_parameter': ['General', 'Buttons', 'Voicing', 'Slash chords and cantus', 'Alternate layout', 'Oscillator',
                        'Envelope', 'Low pass filter', 'Tremolo', 'Vibrato', 'Formants', 'Delay', 'Reverb', 'Crunch',
                        'Output filter'],
    'harp_parameter': ['Notes', 'Plate', 'Pluck', 'String model', 'Ribbon', 'Oscillator', 'Transient', 'Envelope', 'Low pass filter', 'Tremolo', 'Vibrato', 'Delay',
                       'Reverb', 'Crunch', 'Output filter'],
    'chord_potentiometer': ['Potentiometer'],
    'harp_potentiometer': ['Potentiometer'],
    'modulation_potentiometer': ['Potentiometer'],
    'sharp_button_parameter': ['General'],
    'rhythm_parameter': ['Rhythm']
}

DELAY = ['delay length', 'delay filter frequency', 'delay filter resonance', 'delay lowpass', 'delay bandpass',
         'delay highpass', 'dry mix', 'delay mix']

# Define parameter order by name within each subgroup
parameter_name_order = {
    'rhythm_parameter': {
        'Rhythm': [
            'default bpm',
            'cycle length',
            'measure update',
            'shuffle value',
            'note pushed duration',
            'rythm pattern'  # Covers SysEx 220–235 (grid)
        ]
    },
    'global_parameter': {
        'General': ['bank color', 'led attenuation', 'usb audio'],
        'Key and tuning': ['transpose', 'sharp function', 'chord key signature', 'master tuning', 'temperament'],
        'Effects': ['pan', 'reverb size', 'reverb high damping', 'reverb low damping', 'reverb low pass', 'reverb diffusion'],
        'MIDI': ['chord channel', 'harp channel', 'harp note-off on lift', 'single port mode', 'MPE output', 'knobs send MIDI',
                 'MIDI in plays'],
        'Knobs': ['knob layer'],
        'Hover': ['hover control', 'hover value', 'hover reach'],
        'Double tap': ['double tap control', 'double tap value', 'double tap control 2', 'double tap value 2',
                       'double tap control 3', 'double tap value 3']
    },
    'chord_parameter': {
        'General': ['octave change', 'chord shuffling', 'glide chords', 'inter-note delay', 'random note delay'],
        'Buttons': ['retrigger chords', 'chord layout', 'chord frame shift', 'barry harris mode'],
        'Voicing': ['chord inversion', 'chord spacing', 'voice leading', 'voice leading range'],
        'Slash chords and cantus': ['slash level', 'slash voice', 'slash re-voice', 'cantus'],
        'Alternate layout': ['alt layout maj', 'alt layout min', 'alt layout 7th', 'alt layout maj+7th',
                             'alt layout min+7th', 'alt layout maj+min', 'alt layout all three'],
        'Formants': ['formant vowel', 'formant amount', 'formant voice size', 'formant resonance'],
        'Delay': DELAY,
        'Reverb': ['reverb level'],
        'Crunch': ['crunch level', 'crunch type'],
        'Oscillator': [
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
            'octave change',
            'harp shuffling'
        ],
        'Plate': ['harp plate', 'harp touch threshold', 'harp release threshold'],
        'Pluck': [
            'pluck on lift',
            'touch velocity',
            'touch pressure',
            'palm mute',
            'palm mute release',
            'change held strings'
        ],
        'String model': ['string model', 'string decay', 'string damping'],
        'Ribbon': ['harp ribbon', 'ribbon span', 'ribbon snap', 'ribbon glide'],
        'Delay': DELAY,
        'Reverb': ['reverb level'],
        'Crunch': ['crunch level', 'crunch type'],
        'Oscillator': ['waveform', 'frequency multiplier', 'amplitude', 'noise'],
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

DEGREES = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"]


def html_escape(text):
    return str(text).replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;').replace('>', '&gt;')


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
            </div>
        ''')
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
            </div>
        ''')
    elif ui_type == 'switch':
        html.append(f'''
            <div style="display: flex; align-items: center; margin: 8px 0;">
                {label}
                <input type="checkbox" id="param-{sysex_address}" name="{name}" class="inactive"
                       {'checked' if default_value else ''} {' '.join(attrs)}
                       style="margin: 0 8px;">
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
    return '\n'.join(html)

# Generate rhythm grid HTML
def generate_rhythm_grid_html():
    rhythm_params = [p for p in parameters.get('rhythm_parameter', []) if 220 <= p['sysex_adress'] <= 235]
    if not rhythm_params:
        return ''
    html = ['<div style="display: grid; grid-template-columns: repeat(16, 15px); gap: 5px; margin: 10px 0;">']
    rhythm_version = rhythm_params[0].get('introduction_version', 0.01) if rhythm_params else 0.01
    for step in range(16):
        html.append(f'<div style="display: flex; flex-direction: column; align-items: center;">')
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
        ('Key and tuning', ['Key and tuning']),
        ('Effects', ['Effects']),
        ('Knobs, hover and double tap', ['Knobs', 'Hover', 'Double tap']),
    ],
    'chord_parameter': [
        ('Playing', ['General', 'Buttons']),
        ('Voicing and layout', ['Voicing', 'Slash chords and cantus', 'Alternate layout']),
        ('Sound', ['Oscillator', 'Envelope', 'Low pass filter', 'Tremolo', 'Vibrato', 'Formants']),
        ('Effects', ['Delay', 'Reverb', 'Crunch', 'Output filter']),
    ],
    'harp_parameter': [
        ('Notes', ['Notes']),
        ('Playing', ['Plate', 'Pluck', 'String model', 'Ribbon']),
        ('Sound', ['Oscillator', 'Transient', 'Envelope', 'Low pass filter', 'Tremolo', 'Vibrato']),
        ('Effects', ['Delay', 'Reverb', 'Crunch', 'Output filter']),
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
        if param_group == 'hidden':
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
        # Special handling for rhythm pattern (SysEx 220–235)
        if group_name == 'rhythm_parameter' and param_group == 'Rhythm':
            rhythm_pattern_sysex = [p['sysex_adress'] for p in params if p['name'] == 'rythm pattern']
            param_order.extend(rhythm_pattern_sysex)
        # Sort parameters by defined order or fallback to sysex_adress
        sorted_params = sorted(
            grouped_params[param_group],
            key=lambda p: param_order.index(p['sysex_adress']) if p['sysex_adress'] in param_order else len(param_order) + p['sysex_adress']
        )
        subgroup_html[param_group] = (f'<h3 style="margin: 30px 0 10px; font-size: 1.5em;">{param_group}</h3>'
                                      + ''.join(generate_param_html(param) for param in sorted_params))

    param_html = []
    placed = set()
    for title, members in submenus.get(group_name, []):
        body = [subgroup_html[g] for g in members if g in subgroup_html]
        placed.update(members)
        if body:
            param_html.append(submenu_html(title, ''.join(body)))
    # anything no submenu claims, so a new subgroup still shows up somewhere
    param_html.extend(html for g, html in subgroup_html.items() if g not in placed)

    if not param_html:
        return ''
    
    display_name = group_name.replace('_parameter', '').replace('_', ' ').title() + ' Parameters'
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
    (1, 'record', 'record a new loop of what you play, in place of the last; press again to close it and play it'),
    (2, 'play', 'play the loop from the top, or close one being recorded and play it'),
    (3, 'stop', 'stop the loop, or close one being recorded and stop'),
    (5, 'overdub', 'while the loop plays, add to it what you play; press again to stop adding'),
    (4, 'clear', 'forget the loop'),
]
looper_buttons = '\n'.join(f'''          <div class="button_div">
            <button class="looper-btn inactive" data-looper-action="{action}" version="0.32" title="{title}">{label}</button>
          </div>''' for action, label, title in LOOPER_ACTIONS)
token_themes = json.dumps([t['id'] for t in THEMES if t.get('tokens')])
all_themes = json.dumps([t['id'] for t in THEMES])

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
      </div>
    </div>
    <div id="header">
      <div class="controls-container">
        <div class="section">
          <h5 style="margin: 0; font-size: 1.1em;">saving:</h5>
        </div>
        <div class="controls">
          <div class="button_div">
            <div class="select_container">
              <span style="margin-right: 5px;">target bank:</span>
              <select id="bank_number_selection" class="inactive" version="0.01">
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
          </div>
          <div class="button_div">
            <button id="save-to-bank-btn" class="inactive" version="0.01">save to bank</button>
          </div>
          <div class="button_div">
            <button id="load-bank-btn" class="inactive" version="0.21" title="switch the minichord to the target bank">load bank</button>
          </div>
        </div>
        <div class="section">
          <h5 style="margin: 0; font-size: 1.1em;">sharing:</h5>
        </div>
        <div class="controls">
          <div class="button_div">
            <button id="export-settings-btn" class="inactive" version="0.01">export settings</button>
          </div>
          <div class="button_div">
            <button id="load-settings-btn" class="inactive" version="0.01">load settings</button>
          </div>
        </div>
        <div class="section">
          <h5 style="margin: 0; font-size: 1.1em;">resetting:</h5>
        </div>
        <div class="controls">
          <div class="button_div">
            <button id="reset-bank-btn" class="inactive" version="0.01">reset bank</button>
          </div>
          <div class="button_div">
            <button id="reset-all-banks-btn" class="inactive" version="0.01">reset all banks</button>
          </div>
        </div>
        <div class="section">
          <h5 style="margin: 0; font-size: 1.1em;">all banks:</h5>
        </div>
        <div class="controls">
          <div class="button_div">
            <button id="bulk-edit-btn" class="inactive" version="0.21" onclick="open_bank_sheet()" title="read all twelve banks, then move them, set a setting in every one, or apply a profile">reorder and bulk edit</button>
          </div>
          <div class="button_div">
            <button id="backup-btn" class="inactive" version="0.21" onclick="backup_all_banks()" title="read all twelve banks into one file">back up all banks</button>
          </div>
          <div class="button_div">
            <button id="restore-btn" class="inactive" version="0.21" onclick="restore_all_banks()" title="write a backup file back to the banks, replacing what is there">restore from backup</button>
          </div>
        </div>
        <div class="section">
          <h5 style="margin: 0; font-size: 1.1em;">snapshot:</h5>
        </div>
        <div class="controls">
          <div class="button_div">
            <button id="snapshot-btn" class="inactive" version="0.21" title="remember the live settings, so every change after this can be undone">take snapshot</button>
          </div>
          <div class="button_div">
            <button id="revert-btn" class="inactive" version="0.21" title="put back the settings as they were at the snapshot">revert to snapshot</button>
          </div>
        </div>
        <div class="section">
          <h5 style="margin: 0; font-size: 1.1em;">looper:</h5>
        </div>
        <div class="controls">
{looper_buttons}
        </div>
        <div class="section">
          <h5 style="margin: 0; font-size: 1.1em;">randomising:</h5>
        </div>
        <div class="controls">
          <div class="button_div">
            <button id="randomise_btn" class="inactive" version="0.01">randomise</button>
          </div>
        </div>
        <div class="section">
          <h5 style="margin: 0; font-size: 1.1em;">theme:</h5>
        </div>
        <div class="controls">
          <div class="button_div">
            <select id="theme-select" class="always-on" aria-label="theme" data-token-themes='{token_themes}'>
{theme_options}
            </select>
          </div>
        </div>
      </div>
      <div class="svg-container">
        <img src="{svg_file}" alt="Minichord Logo" class="default-only">
        <img src="themes/arcade-minichord-wide.svg" alt="Minichord, in pixels" class="arcade-only">
      </div>
    </div>
    <details>
      <summary style="width: fit-content; font-size: 1.1em; font-weight: bold; cursor: pointer;">Connection instruction</summary>
      <ul style="padding-left: 20px;">
        <li>provide the system authorization for MIDI control</li>
        <li>use a recent version of Chrome</li>
        <li>connect the minichord with a USB cable and make sure it is on.</li>
      </ul>
      <div tabindex="1" id="information_zone">
        <strong id="information_text"></strong>
      </div>
    </div>
    <div id="instruction_zone" style="margin: 2px 0;">
      A fork of <a href="https://minichord.com/minicontrol/">Ben Poilve's minicontrol</a>, with themes by <a href="https://keyandcable.com">The Key &amp; Cable Company</a>.<br>
      For instruction on how to use this tool, please refer to the 
      <a href="https://minichord.com/user_manual/#custom-presets">minichord documentation.</a><br>
      To test and load user-submitted presets, visit the 
      <a href="https://minichord.com/minicontrol/minishop.html">minishop.</a>
    </div>
    <div id="parameters">
      {parameter_sections}
    </div>
    <footer id="page-footer">
      <p>A fork of <a href="https://minichord.com/minicontrol/">Ben Poilve's minicontrol</a>. The bank tools, knob layer, double tap pairs and the other newer settings need the unofficial <a href="https://github.com/keyandcableco/minichord/tree/test-allFeatures">test-allFeatures firmware</a> for the minichord.</p>
      <p>Made by <a href="https://keyandcable.com">The Key &amp; Cable Company</a>. Source on <a href="https://github.com/keyandcableco/minicontrol">GitHub</a>.</p>
    </footer>
  </div>
  <!-- say-thanks -->
  <p style="text-align:center;margin:28px 0 18px;font-size:14px;opacity:0.8">minicontrol by <a href="https://keyandcable.com/projects.html" target="_blank" rel="noopener" style="color:inherit">The Key &amp; Cable Company</a> &middot; <a href="https://keyandcable.com/thanks.html" target="_blank" rel="noopener" style="color:inherit;font-weight:bold">Say thanks</a></p>
  <script src="minichordcontroller.js"></script>
  <script src="index.js"></script>
  <script src="banks.js"></script>
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
parameter_sections = []
for group_name in group_order:
    if group_name not in parameters or group_name == 'sysex_name_map' or group_name == 'hidden':
        continue
    params = parameters[group_name]
    if group_name == 'rhythm_parameter':
        rhythm_params = [p for p in params if 220 <= p['sysex_adress'] <= 235]
        other_rhythm_params = [p for p in params if p['sysex_adress'] < 220 or p['sysex_adress'] > 235]
        if rhythm_params or other_rhythm_params:
            param_html = []
            if other_rhythm_params:
                grouped_rhythm_params = {}
                for param in other_rhythm_params:
                    param_group = param['group']
                    if param_group not in grouped_rhythm_params:
                        grouped_rhythm_params[param_group] = []
                    grouped_rhythm_params[param_group].append(param)
                # Use defined subgroup order for rhythm_parameter
                ordered_subgroups = subgroup_order.get(group_name, sorted(grouped_rhythm_params.keys()))
                for param_group in ordered_subgroups:
                    if param_group not in grouped_rhythm_params:
                        continue
                    # Convert name-based order to sysex_adress order
                    name_order = parameter_name_order.get(group_name, {}).get(param_group, [])
                    param_order = [
                        name_to_sysex[group_name][param_group][name]
                        for name in name_order
                        if name in name_to_sysex[group_name].get(param_group, {})
                    ]
                    sorted_params = sorted(
                        grouped_rhythm_params[param_group],
                        key=lambda p: param_order.index(p['sysex_adress']) if p['sysex_adress'] in param_order else len(param_order) + p['sysex_adress']
                    )
                    param_html.append(f'<h3 style="margin: 30px 0 10px; font-size: 1.5em;">{param_group}</h3>')
                    param_html.extend([generate_param_html(param) for param in sorted_params])
            if rhythm_params:
                param_html.append('<h3 style="margin: 30px 0 10px; font-size: 1.5em;">Rhythm Pattern</h3>')
                param_html.append(generate_rhythm_grid_html())
            parameter_sections.append(f'''
                <details style="width: fit-content; margin: 20px 0; padding: 8px; border: none; border-radius: 5px;">
                    <summary style="width: fit-content; font-size: 1.6em; font-weight: bold; cursor: pointer;">Rhythm Parameters</summary>
                    <div style="padding: 10px;">
                        {''.join(param_html)}
                    </div>
                </details>
            ''')
    else:
        parameter_sections.append(generate_details_html(group_name, params))

# Insert into HTML
html_content = html_template.format(
    parameter_sections=''.join(parameter_sections),
    svg_file=svg_file,
    theme_links=theme_links,
    theme_options=theme_options,
    theme_taglines=theme_taglines,
    looper_buttons=looper_buttons,
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