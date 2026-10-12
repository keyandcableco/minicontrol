// The minichord drawn on the front page, with what each of its controls does in this preset: the
// three knobs, hover over the harp, the double tap on ♯ and ♯ with ▲ ▼, each labelled where it
// sits, and the chord each button plays. Choosing one opens a sheet that changes it. The sheet
// writes through the settings' own controls further down the page (setParam), so sending,
// unsaved edits and the double tap value's range all work as they do there.

// The drawing's parts, from minichord_layout_web.svg (one path there, split into its pieces here)
const MAP_SHAPES = {
 "body": "M1102.3,0.5 c -14.6 -0.1 -31.5 0.2 -51 0.7 c -70.9 1.9 -52.2 0.4 -307.5 24.6 c -316.1 30 -337.4 32 -431.5 41 c -49.5 4.7 -104 9.9 -121 11.5 c -46.4 4.4 -61.3 7.9 -87 20.5 c -20.8 10.2 -37.6 22.4 -53.2 38.9 c -47.4 50 -62.8 120.7 -40.9 187.2 c 18.4 56 60.3 99.7 115.9 121.2 c 7.3 2.8 137 38.7 189.2 52.3 c 19.9 5.2 45.1 10.3 66 13.4 c 38.6 5.7 55.6 6.6 114.1 6.6 c 46.3 0 60.1 0.6 76.9 3.1 c 52.5 7.9 99.5 25.8 143 54.4 c 26.8 17.6 47.5 36.4 68 61.5 c 27.3 33.5 53.3 58.3 91 86.6 c 32.9 24.7 53.9 36.8 86 49.5 c 35.1 13.9 75.1 23.5 118.5 28.5 c 16.1 1.8 56.2 1.3 75 -1 c 74.5 -9.1 144.9 -38.6 203 -85.2 c 15.5 -12.4 40.3 -36.3 52.9 -50.9 c 51.4 -59.5 84.2 -132.5 94.5 -210.5 c 15 -113.7 -19.4 -228.7 -94.5 -315.5 c -11.4 -13.2 -35.7 -36.9 -48.9 -47.7 c -58.7 -48 -127.4 -77.7 -203.5 -87.9 c -12.9 -1.7 -30.7 -2.6 -55 -2.7 z",
 "jacks": [
  "M952.3,61.8 l -0.3 18 l 0.2 19.2 h 20 h 19.6 l -0.3 -18 l -0.3 -19.2 h -19.5 z",
  "M914.8,66.3 v 14.3 v 15 l 11 0.4 l 9.5 -0.3 l 0.3 -14.8 l 0.3 -14.8 h -10.5 z"
 ],
 "plate": "M1087.2,143.3 c -3.4 0 -4.6 0.8 -6.2 3.7 c -0.9 1.6 -1.2 65.7 -1.2 252.1 v 249.9 l 2.1 2.6 c 1.1 1.4 3.1 2.6 4.2 2.6 c 2.6 0 98.6 -12.9 100.4 -13.5 c 0.9 -0.3 1.2 -2.9 1.2 -8.3 c 0 -9 0.6 -8.4 -10.5 -9.6 c -10.3 -1.1 -9.6 -0.3 -9.3 -11.8 l 0.3 -10.2 l 8.3 -1.2 c 11.8 -1.7 11.2 -1.1 11.2 -9.7 c 0 -8.4 0.8 -7.8 -11 -9.1 c -9.7 -1.1 -9.1 -0.3 -8.8 -11.8 l 0.3 -10.2 l 8.3 -1.2 c 11.8 -1.7 11.2 -1.1 11.2 -9.8 v -7.5 l -3.2 -0.6 c -1.8 -0.3 -6.2 -0.9 -9.8 -1.3 l -6.5 -0.7 l -0.3 -10.2 c -0.3 -11.7 -1.5 -10.4 11.2 -12.3 c 3.8 -0.6 7.3 -1.3 7.8 -1.6 c 1.4 -0.9 1 -15.4 -0.4 -15.5 c -0.7 -0 -5.1 -0.6 -9.8 -1.3 l -8.5 -1.2 l -0.3 -10.2 c -0.3 -9.9 -0.2 -10.2 2 -10.7 c 2.3 -0.5 16.2 -2.6 17.2 -2.6 c 0.3 0 0.6 -3.6 0.6 -7.9 v -7.9 l -4.2 -0.6 c -2.3 -0.3 -6.7 -0.9 -9.8 -1.3 l -5.5 -0.7 l -0.3 -10.2 c -0.3 -9.9 -0.2 -10.2 2 -10.7 c 2.3 -0.5 16.2 -2.6 17.2 -2.6 c 0.3 0 0.6 -3.6 0.6 -7.9 v -7.9 l -4.2 -0.6 c -2.3 -0.3 -6.7 -0.9 -9.8 -1.3 l -5.5 -0.7 l -0.3 -10.2 c -0.3 -9.9 -0.2 -10.2 2 -10.7 c 2.3 -0.5 16.2 -2.6 17.2 -2.6 c 0.3 0 0.6 -3.5 0.6 -7.9 v -7.9 l -3.2 -0.6 c -1.8 -0.3 -6.3 -0.9 -10 -1.2 l -6.8 -0.7 v -10.3 v -10.3 l 2.8 -0.6 c 3.3 -0.7 15.4 -2.6 16.5 -2.6 c 0.4 -0 0.8 -3.6 0.8 -7.9 v -7.9 l -7.5 -1.1 c -4.1 -0.6 -8.6 -1.1 -10 -1.1 c -2.5 0 -2.5 -0 -2.5 -10.4 v -10.4 l 2.8 -0.5 c 1.5 -0.3 4.8 -0.8 7.2 -1.1 c 10.8 -1.5 10 -0.8 10 -9 c 0 -4 -0.4 -7.6 -1 -8 c -0.5 -0.3 -5 -1.1 -10 -1.7 l -9 -1.1 v -10.3 v -10.3 l 2.8 -0.5 c 1.5 -0.3 4.8 -0.8 7.2 -1.1 c 10.8 -1.5 10 -0.8 10 -9 c 0 -4 -0.4 -7.6 -1 -8 c -0.5 -0.3 -5 -1.1 -10 -1.7 l -9 -1.1 v -10.2 v -10.2 l 7.2 -1.1 c 14.2 -2.2 12.8 -1.2 12.8 -9.6 c 0 -4 -0.4 -7.6 -0.8 -7.9 c -0.5 -0.3 -5 -1.1 -10 -1.7 l -9.2 -1.2 v -10.3 c 0 -5.7 0.3 -10.3 0.8 -10.3 c 1.1 -0 13.2 -1.9 16.5 -2.6 c 2.7 -0.6 2.8 -0.6 2.8 -8.4 c 0 -4.3 -0.4 -8.1 -0.8 -8.4 c -1.4 -0.8 -96.8 -18.6 -99.9 -18.6 z",
 "plateDots": [
  "M1158.7,246.4 c -5.8 0.2 -10.4 7 -6.3 12.8 c 0.9 1.3 2.6 2.7 3.8 3.2 c 1.2 0.5 2.3 0.9 2.4 0.9 c 0.2 0 1.8 -0.6 3.6 -1.3 c 6 -2.5 6.8 -10.3 1.4 -14 c -1.6 -1.1 -3.3 -1.6 -5 -1.6 z",
  "M1159.1,372.3 c -2 -0 -4 0.7 -5.8 2.5 c -3 3 -3.2 7.3 -0.4 10.9 c 1.5 1.9 3 2.6 5.6 2.6 c 4.7 0 6.9 -1.4 8.2 -5 c 2.1 -6 -2.5 -11 -7.6 -11 z",
  "M1159.1,498.3 c -7.3 0 -10.9 8.5 -5.8 13.5 c 4.4 4.4 11.3 2.9 13.5 -2.9 c 1.9 -5 -2.2 -10.7 -7.7 -10.7 z",
  "M1159.4,623.6 c -2.3 -0.1 -4.6 0.9 -6.5 2.9 c -3.6 3.9 -1.8 10.7 3.3 12.8 c 2.8 1.1 3.1 1.2 6.1 0 c 1.4 -0.5 3.3 -2.5 4.2 -4.4 c 1.4 -2.9 1.4 -3.8 0.2 -6.2 c -1.6 -3.3 -4.4 -5.1 -7.3 -5.2 z"
 ],
 "up": "M1374.4,521.3 c 5 0 5.3 0.3 16.8 17.2 l 8.7 12.7 v 7.9 c 0 4.8 -0.5 8.4 -1.2 9.1 c -0.9 0.9 -7.8 1.2 -25 1.2 c -27.8 0 -26.3 0.6 -25.7 -11.4 l 0.4 -7.1 l 9.4 -13.5 c 5.1 -7.4 10.1 -14.1 10.9 -14.8 c 0.9 -0.7 3.4 -1.2 5.7 -1.2 z",
 "down": "M1364.9,586.3 c 2.7 -0 5.8 0 9.3 0 c 21.3 0 24.4 0.2 25 1.6 c 0.3 0.9 0.6 5 0.6 9.1 v 7.5 l -8.7 12.7 c -4.8 7 -9.7 13.7 -11 14.9 c -2.2 2.3 -6.9 2.9 -10.5 1.4 c -0.9 -0.4 -6.1 -7 -11.5 -14.7 l -9.8 -14 l -0.4 -7.1 c -0.6 -10.5 -1.8 -11.3 16.9 -11.4 z"
};
// the 21 chord buttons, row by row (major, minor, seventh), each 80 wide and 78 high, and the
// letters their columns are named for, left to right
const MAP_ROWS = [
  { y: 137, xs: [190, 296, 402, 509, 615, 721, 827] },
  { y: 243, xs: [229, 335, 441, 547, 653, 759, 866] },
  { y: 350, xs: [267, 373, 480, 586, 692, 798, 904] },
];
const MAP_LETTERS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const MAP_KNOBS = { chord: [1368, 191], harp: [1365, 322], mod: [1367, 452] };
const MAP_SHARP = { x: 126, y: 137, w: 39, h: 40 };
const MAP_LED = [977, 530];
// the whole drawing with its labels, and on a phone the instrument alone (the labels are a list
// under it there, as they would be too small to read)
const MAP_VIEW_WIDE = '-30 -175 2390 1000';
const MAP_VIEW_NARROW = '-30 -10 1580 830';
const narrowMap = window.matchMedia('(max-width: 600px)');

// What each control is set by. A knob's turn and its turn with ♯ held each have a target and a
// range; hover's have a target and the value it reaches; the chord and harp knobs' turn is their
// volume on every preset, which can't be moved.
const CONTROLS = {
  chord: { name: 'chord knob', where: 'the top knob', kind: 'knob',
           main: { fixed: 'chord volume' },
           alt: { control: 10, range: 11 } },
  harp: { name: 'harp knob', where: 'the middle knob', kind: 'knob',
          main: { fixed: 'harp volume' },
          alt: { control: 12, range: 13 } },
  mod: { name: 'mod knob', where: 'the bottom knob', kind: 'knob',
         main: { control: 14, range: 15 }, alt: { control: 16, range: 17 } },
  hover: { name: 'hover', where: 'a hand held over the harp', kind: 'hover',
           main: { control: 249, value: 250 }, alt: { control: 325, value: 326 } },
  tap: { name: 'double tap ♯', where: 'two quick taps of ♯', kind: 'tap',
         slots: [[200, 201], [209, 210], [211, 212]] },
  updown: { name: '♯ with ▲ ▼', where: 'holding ♯ and pressing up or down', kind: 'updown' },
  // the parts that open one of the page's sheets (generate.py builds them from the settings)
  chords: { name: 'chord buttons', kind: 'sheet', sheet: 'chord' },
  strings: { name: 'harp strings', kind: 'sheet', sheet: 'harp' },
  rhythm: { name: 'rhythm', kind: 'sheet', sheet: 'rhythm' },
  light: { name: 'light', kind: 'sheet', sheet: 'light' },
};
// which control's sheet edits each of these settings, for the search
const CONTROL_OF = { 117: 'mod', 251: 'hover', 321: 'tap', 322: 'updown' };
Object.entries(CONTROLS).forEach(([key, c]) => {
  [c.main, c.alt].forEach(slot => slot && [slot.control, slot.range, slot.value].forEach(a => { if (a) CONTROL_OF[a] = key; }));
  (c.slots ?? []).flat().forEach(a => CONTROL_OF[a] = key);
});
const KNOB_LAYER = 117;
// what the target lists offer first, where a control can take them
const SUGGESTED = {
  sweep: [143, 49, 145, 163, 118, 183, 24, 380, 35],
  tap: [39, 117, 98, 256, 287, 198, 35],
};
// a section's group, shortened where the name says it already or the group says little
const GROUP_SHORT = { 'low pass filter': 'filter' };
const GROUP_SILENT = new Set(['general', 'oscillator', 'notes', 'effects', 'key and tuning', 'buttons', 'voicing',
  'knobs', 'midi', 'style', 'tempo', 'sections', 'pattern', 'chord changes', 'slash chords and cantus',
  'alternate layout', 'string model', 'transient', 'plate', 'pluck', 'ribbon', 'drone', 'phone', 'vocoder', 'drums', 'looper']);

let mapLayer = 0;          // which layer the drawing shows: 0 turning, 1 holding ♯
let sheetControl = null;   // the control the sheet is open on
let pickingFor = null;     // the target list open in the sheet, by the setting it sets
let pickQuery = '';

const num = sysex => parseInt(currentValues[sysex] ?? 0) || 0;
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const knobLayerOn = () => num(KNOB_LAYER) === 1;
// the layer a knob or hover is on in the drawing: knob layer 1 puts them on their ♯ jobs for good
const shownLayer = () => (mapLayer === 1 || knobLayerOn()) ? 'alt' : 'main';

// a control's setting, as the page's own control for it (greyed with no minichord, or for an
// older firmware) has it
function locked(sysex) {
  const element = document.getElementById(`param-${sysex}`);
  return element ? element.classList.contains('inactive') : !controller.isConnected();
}

// Set a setting through its own control, which sends it and marks the bank edited
function setParam(sysex, value) {
  const element = document.getElementById(`param-${sysex}`);
  const param = findParameterBySysex(sysex);
  if (!element || !param) return;
  const uiType = param.ui_type || '';
  if (uiType === 'switch') {
    element.checked = value === 1;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (uiType === 'select') {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ---- what the targets are called ----

// The settings a control can be pointed at, from its own dropdown: "chord: delay: delay mix" and
// the like, with a short name for the drawing
const targetCache = {};
function targetsOf(controlSysex) {
  if (targetCache[controlSysex]) return targetCache[controlSysex];
  const select = document.getElementById(`param-${controlSysex}`);
  if (!select) return [];
  const list = [...select.options].map(o => {
    const value = parseInt(o.value);
    const parts = o.textContent.split(': ').map(s => s.trim());
    const section = parts.length > 1 ? parts[0] : 'other';
    const group = parts.length > 2 ? parts[1] : '';
    const name = parts[parts.length - 1];
    return { value, text: o.textContent.trim(), section, group, name, short: shortName(section, group, name) };
  });
  return (targetCache[controlSysex] = list);
}

function shortName(section, group, name) {
  if (section === 'other') return name;
  const lead = name.toLowerCase();
  let words = [];
  if (section !== 'global' && !lead.startsWith(section)) words.push(section);
  const g = GROUP_SHORT[group] ?? group;
  const groupWord = g.split(' ').pop().replace(/s$/, '');
  if (g && !GROUP_SILENT.has(group) && !lead.includes(groupWord)) words.push(g);
  words.push(name);
  return words.join(' ');
}

function targetName(controlSysex, value) {
  if (!value) return null;
  const known = targetsOf(controlSysex).find(t => t.value === value);
  if (known) return known.short;
  return findParameterBySysex(value)?.name ?? `setting ${value}`;
}

// a setting's choices, from its own entry or its dropdown on the page
function choicesOf(param) {
  if (!param) return null;
  if (param.options) return param.options;
  if (param.ui_type !== 'select') return null;
  const select = document.getElementById(`param-${param.sysex_adress}`);
  return select ? [...select.options].map(o => ({ value: parseInt(o.value), label: o.textContent.trim() })) : null;
}

// what a double tap or hover value means for the setting it is applied to
function valueText(target, raw) {
  if (target === 256) return raw === 7 ? 'next step, on the computer\'s looper' : 'next step';
  const param = findParameterBySysex(target);
  if (!param) return String(raw);
  const choice = choicesOf(param)?.find(c => c.value === raw);
  if (choice) return choice.label;
  if (param.ui_type === 'switch') return raw ? 'on' : 'off';
  if (param.data_type === 'float') return (raw / getFloatMultiplier(param)).toFixed(decimalsFor(param));
  return String(raw);
}

// ---- what each control does, for the drawing ----

function slotSummary(key, layer) {
  const c = CONTROLS[key];
  if (c.kind === 'tap') {
    const set = c.slots.filter(([control]) => num(control));
    if (!set.length) return { text: 'nothing', assigned: false };
    const parts = set.map(([control, value]) =>
      num(control) === 256 ? 'the looper' : `${targetName(control, num(control))} → ${valueText(num(control), num(value))}`);
    return { text: parts.join(' · '), first: parts[0] + (parts.length > 1 ? ` +${parts.length - 1}` : ''), assigned: true };
  }
  if (c.kind === 'updown') return num(322) ? { text: '▼ revert · ▲ panic', assigned: true } : { text: 'nothing', assigned: false };
  if (key === 'chords') return { text: `key of ${KEY_NAMES[num(35)] ?? 'C'}${num(39) === 1 ? ', alternate layout' : ''}` };
  if (key === 'strings') return { text: `${valueText(264, num(264)).toLowerCase()}${num(98) ? ', chromatic' : ''}` };
  if (key === 'light') return { text: 'the bank\'s colour' };
  if (key === 'rhythm') {
    const style = num(274);
    const parts = [style ? valueText(274, style) : 'its step pattern'];
    if (num(334)) parts.push('drums');
    parts.push(`${valueText(187, num(187))} bpm`);
    return { text: parts.join(' · '), assigned: true };
  }
  const slot = c[layer];
  if (slot.fixed) return { text: slot.fixed, assigned: true, fixed: true };
  let control = num(slot.control);
  // hover with no ♯ setting of its own moves its own on both layers
  if (!control && key === 'hover' && layer === 'alt') {
    control = num(c.main.control);
    if (control) return { text: targetName(249, control), assigned: true, same: true };
  }
  return control ? { text: targetName(slot.control, control), assigned: true } : { text: 'nothing', assigned: false };
}

// ---- the chords on the buttons ----

const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
// keys by chord key signature (setting 35): sharps, then flats, as the firmware's get_root_button
const KEY_SHARPS = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 12: 6, 13: 7, 14: 7, 15: 7, 16: 7, 17: 7, 18: 7 };
const KEY_FLATS = { 6: 1, 7: 2, 8: 3, 9: 4, 10: 5, 11: 6, 19: 7, 20: 7 };
const KEY_NAMES = ['C', 'G', 'D', 'A', 'E', 'B', 'F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'E♯', 'B♯', 'F♭', 'C♭'];
const CHORD_SUFFIX = {
  'Major': '', 'Minor': 'm', 'Dominant 7': '7', 'Major 7': 'maj7', 'Minor 7': 'm7', 'Diminished': '°',
  'Augmented': '+', 'Major 6': '6', 'Minor 6': 'm6', 'Full diminished': '°7', 'm7b5': 'ø7', 'sus4': 'sus4',
  'sus2': 'sus2', '7sus4': '7sus4', 'maj9': 'maj9', 'min9': 'm9', 'add9': 'add9', '6/9': '6/9',
  'Supermajor triad': 'SM', 'Subminor triad': 'sm', 'Neutral triad': 'n', 'Harmonic 7th': 'h7',
  'Neutral 7th': 'n7', 'Subminor 7th': 'sm7', 'Utonal tetrad': 'ut', 'Harmonic 9th': 'h9',
  'Otonal hexad': 'ot', 'Just augmented': '+j', 'Supermajor 7th': 'SM7',
};
const ACCIDENTAL = { '-2': '♭♭', '-1': '♭', 0: '', 1: '♯', 2: '♯♯' };

function keyAccidentals(key) {
  const acc = { F: 0, C: 0, G: 0, D: 0, A: 0, E: 0, B: 0 };
  if (key in KEY_SHARPS) {
    MAP_LETTERS.slice(0, KEY_SHARPS[key]).forEach(l => acc[l] = 1);
    if (key >= 14) MAP_LETTERS.slice(0, key - 13).forEach(l => acc[l] = 2);   // G♯ on: double sharps
  } else if (key in KEY_FLATS) {
    [...MAP_LETTERS].reverse().slice(0, KEY_FLATS[key]).forEach(l => acc[l] = -1);
    if (key === 19) acc.B = -2;                                              // F♭: B double flat
  }
  return acc;
}

// each column's root, as the key signature spells it, transposed, and a semitone up with ♯ held
// (named by its pitch then, F♯ going to G rather than F double sharp, as a player would call it)
function columnRoots(sharp) {
  const key = num(35);
  const acc = keyAccidentals(key);
  const transpose = TEMPERAMENT_DIVISIONS[num(237)] ? 0 : num(30) % 12;   // semitones only mean that in twelve
  const names = key in KEY_FLATS ? FLAT_NAMES : SHARP_NAMES;
  return MAP_LETTERS.map(letter => {
    if (!transpose && !sharp) return letter + (ACCIDENTAL[acc[letter]] ?? '');
    const pc = NATURAL[letter] + acc[letter] + transpose + (sharp ? 1 : 0);
    return names[((pc % 12) + 12) % 12];
  });
}
// ♯ sharpens the chords, except in the alternate layout (the firmware's sharp_active)
const sharpensChords = () => num(39) !== 1;

// the kind of chord each row plays, as a suffix and in words
function rowKinds() {
  const catalogue = findParameterBySysex(202)?.options ?? [];
  const label = v => catalogue.find(o => o.value === v)?.label ?? '';
  let labels;
  if (num(39) === 1) labels = [202, 203, 204].map((a, i) => label(num(a) || [12, 13, 14][i]));
  else labels = num(33) === 1 ? ['Major 6', 'Minor 6', 'Dominant 7'] : ['Major', 'Minor', 'Dominant 7'];
  return labels.map(l => ({ suffix: CHORD_SUFFIX[l] ?? l, words: l.toLowerCase() }));
}

// ---- the drawing ----

function knobShape(key) {
  const [cx, cy] = MAP_KNOBS[key];
  return `<circle class="map-hit" cx="${cx}" cy="${cy}" r="62"/><circle class="map-shape" cx="${cx}" cy="${cy}" r="33"/>` +
    `<line class="map-tick" x1="${cx}" y1="${cy - 12}" x2="${cx}" y2="${cy - 30}"/>`;
}

function mapLabel(key, x, y, anchor, lead) {
  const c = CONTROLS[key];
  const s = slotSummary(key, shownLayer());
  const text = s.first ?? s.text;
  const shown = text.length > 30 ? text.slice(0, 29) + '…' : text;
  const extra = s.fixed ? ' · built in' : s.same ? ' · as turning' : '';
  return `<g class="map-label${s.assigned ? '' : ' unset'}" data-control="${key}">` +
    (lead ? `<polyline class="map-lead" points="${lead}"/>` : '') +
    `<text class="map-name" x="${x}" y="${y}" text-anchor="${anchor}">${esc(c.name)}${esc(extra)}</text>` +
    `<text class="map-value" x="${x}" y="${y + 50}" text-anchor="${anchor}"><title>${esc(s.text)}</title>${esc(shown)}</text></g>`;
}

function controlGroup(key, inner) {
  const c = CONTROLS[key];
  const s = slotSummary(key, shownLayer());
  const lit = s.assigned && !s.fixed && c.kind !== 'sheet';
  return `<g class="map-ctl${lit ? ' assigned' : ''}" data-control="${key}" tabindex="0" role="button" ` +
    `aria-label="${esc(c.name)}: ${esc(s.text)}. Change it">${inner}</g>`;
}

function renderMinichordMap() {
  const svg = document.getElementById('map-svg');
  if (!svg || !parameters) return;
  const sharp = mapLayer === 1;
  const roots = columnRoots(sharp && sharpensChords());
  const kinds = rowKinds();
  let buttons = '';
  MAP_ROWS.forEach((row, r) => row.xs.forEach((x, col) => {
    const root = roots[col], suffix = kinds[r].suffix;
    // a short name on one line; a long one with its kind under the root
    const text = (root + suffix).length <= 4
      ? `<text class="map-chord" x="${x + 40}" y="${row.y + 40}" style="font-size:${(root + suffix).length <= 2 ? 34 : 28}px">${esc(root + suffix)}</text>`
      : `<text class="map-chord" x="${x + 40}" y="${row.y + 25}" style="font-size:30px">${esc(root)}</text>` +
        `<text class="map-chord" x="${x + 40}" y="${row.y + 56}" style="font-size:${suffix.length <= 4 ? 24 : 20}px">${esc(suffix)}</text>`;
    buttons += `<rect class="map-shape" x="${x}" y="${row.y}" width="80" height="78" rx="4"><title>${esc(root)} ${esc(kinds[r].words)}</title></rect>` + text;
  }));
  const s = MAP_SHAPES;
  svg.setAttribute('viewBox', narrowMap.matches ? MAP_VIEW_NARROW : MAP_VIEW_WIDE);
  svg.innerHTML =
    `<path class="map-body" d="${s.body}"/>` +
    `<path class="map-part" d="${s.jacks[1]}"><title>the rhythm light</title></path>` +
    controlGroup('rhythm', `<rect class="map-hit" x="930" y="40" width="85" height="80"/><path class="map-shape" d="${s.jacks[0]}"/>`) +
    controlGroup('light', `<circle class="map-hit" cx="${MAP_LED[0]}" cy="${MAP_LED[1]}" r="50"/>` +
      `<circle class="map-led" cx="${MAP_LED[0]}" cy="${MAP_LED[1]}" r="22"><title>the light, in the bank's colour</title></circle>`) +
    controlGroup('chords', `<rect class="map-hit" x="180" y="128" width="815" height="310"/>${buttons}`) +
    controlGroup('tap', `<rect class="map-hit" x="100" y="110" width="90" height="95"/>` +
      `<rect class="map-shape${sharp ? ' pressed' : ''}" x="${MAP_SHARP.x}" y="${MAP_SHARP.y}" width="${MAP_SHARP.w}" height="${MAP_SHARP.h}" rx="4"/>` +
      `<text class="map-glyph" x="${MAP_SHARP.x + 20}" y="${MAP_SHARP.y + 21}">♯</text>`) +
    controlGroup('strings', `<path class="map-shape" d="${s.plate}"/>` + s.plateDots.map(d => `<path class="map-part" d="${d}"/>`).join('')) +
    ['chord', 'harp', 'mod'].map(k => controlGroup(k, knobShape(k))).join('') +
    controlGroup('updown', `<rect class="map-hit" x="1320" y="500" width="100" height="150"/>` +
      `<path class="map-shape" d="${s.up}"/><path class="map-shape" d="${s.down}"/>`) +
    `<g class="map-labels">` +
      mapLabel('chord', 1585, 180, 'start', `1410,191 1570,191`) +
      mapLabel('harp', 1585, 311, 'start', `1405,322 1570,322`) +
      mapLabel('mod', 1585, 441, 'start', `1408,452 1570,452`) +
      mapLabel('updown', 1585, 572, 'start', `1410,583 1570,583`) +
      mapLabel('hover', 1585, 703, 'start', `1192,620 1570,703`) +
      mapLabel('rhythm', 1000, -115, 'start', `972,58 972,-40 1000,-40`) +
      mapLabel('tap', 100, -115, 'start', `145,130 145,-40`) +
    `</g>`;
  renderMapList();
  renderLayerToggle();
  renderPedals();
}

// what the pedals under the drawing are set to
function renderPedals() {
  const status = {
    tuning: `${KEY_NAMES[num(35)] ?? 'C'} · ${valueText(237, num(237)).toLowerCase()}`,
    drone: num(372) ? valueText(372, num(372)).toLowerCase() : 'off',
    effects: `reverb ${valueText(24, num(24))}${num(260) ? ' · vocoder' : ''}`,
    phone: num(311) || num(303) || num(307) ? 'following' : '',
  };
  document.querySelectorAll('[data-status]').forEach(el => { el.textContent = status[el.dataset.status] ?? ''; });
}

// on a phone, the labels as a list under the drawing
function renderMapList() {
  const list = document.getElementById('map-list');
  if (!list) return;
  const keys = ['chord', 'harp', 'mod', 'hover', 'tap', 'updown', 'rhythm', 'chords', 'strings', 'light'];
  list.innerHTML = keys.map(key => {
    const s = slotSummary(key, shownLayer());
    const extra = s.fixed ? ' · built in' : s.same ? ' · as turning' : '';
    return `<li><button type="button" class="map-row always-on${s.assigned ? '' : ' unset'}" data-control="${key}">` +
      `<span class="map-row-name">${esc(CONTROLS[key].name)}</span><span class="map-row-value">${esc(s.text)}${esc(extra)}</span></button></li>`;
  }).join('');
}

function renderLayerToggle() {
  document.querySelectorAll('#map-layers button').forEach(b => b.setAttribute('aria-pressed', String(parseInt(b.dataset.layer) === mapLayer)));
  const note = document.getElementById('map-layer-note');
  if (note) note.hidden = !knobLayerOn();
}

let mapPending = false;
function scheduleMinichordMap() {
  if (mapPending) return;
  mapPending = true;
  requestAnimationFrame(() => {
    mapPending = false;
    renderMinichordMap();
    renderQuick();
    if (typeof refreshEnvelopes === 'function') refreshEnvelopes();
    if (typeof refreshWaves === 'function') refreshWaves();
    if (typeof refreshFilters === 'function') refreshFilters();
    if (sheetControl && !document.getElementById('controls-sheet')?.contains(document.activeElement)) renderSheet();
  });
}

// ---- the sheet ----

// a setting's own control, for the sheet: a dropdown, a switch or a slider with its value
function paramControl(sysex, label) {
  const base = findParameterBySysex(sysex);
  if (!base) return '';
  const target = base.follows_target != null ? findParameterBySysex(num(base.follows_target)) : null;
  const shape = target ?? base;
  const p = effectiveParam(base);
  const value = num(sysex);
  const off = locked(sysex) ? ' disabled' : '';
  const tip = esc(base.tooltip ?? '');
  const id = `cs-${sysex}`;
  const head = `<label class="cs-label" for="${id}" title="${tip}">${esc(label)}</label>`;
  if (target?.sysex_adress === 256) {
    return head + `<select id="${id}" class="always-on" data-set="${sysex}"${off}>` +
      `<option value="6"${value !== 7 ? ' selected' : ''}>the minichord's looper</option>` +
      `<option value="7"${value === 7 ? ' selected' : ''}>a looper on the computer</option></select>`;
  }
  if (shape.ui_type === 'switch') {
    return `<label class="cs-switch" title="${tip}"><input type="checkbox" class="always-on" data-set="${sysex}"${value ? ' checked' : ''}${off}> ${esc(label)}</label>`;
  }
  const choices = choicesOf(shape);
  if (choices && (shape.ui_type === 'select' || shape.options)) {
    return head + `<select id="${id}" class="always-on" data-set="${sysex}"${off}>` +
      choices.map(c => `<option value="${c.value}"${c.value === value ? ' selected' : ''}>${esc(c.label)}</option>`).join('') + `</select>`;
  }
  const m = getFloatMultiplier(p);
  const min = Math.round(p.min_value * m), max = Math.round(p.max_value * m);
  const step = p.data_type === 'float' ? Math.max(1, Math.round((p.step ?? 0.01) * m)) : 1;
  return head + `<span class="cs-slider"><input type="range" id="${id}" class="always-on" data-set="${sysex}" min="${min}" max="${max}" step="${step}" value="${value}"${off}>` +
    `<output data-shows="${sysex}">${esc(displayOf(p, value))}</output></span>`;
}

function displayOf(p, value) {
  return p.data_type === 'float' ? (value / getFloatMultiplier(p)).toFixed(decimalsFor(p)) : String(value);
}

// the button that names a slot's target, and the list under it while it is open
function targetPicker(controlSysex, kind) {
  const value = num(controlSysex);
  const off = locked(controlSysex) ? ' disabled' : '';
  const open = pickingFor === controlSysex;
  let html = `<button type="button" class="cs-target always-on" data-pick="${controlSysex}" aria-expanded="${open}"${off}>` +
    `<span>${esc(targetName(controlSysex, value) ?? 'nothing')}</span><span class="glyph" aria-hidden="true">${open ? '▴' : '▾'}</span></button>`;
  if (open) html += `<div class="cs-picker"><input type="search" class="cs-search always-on" placeholder="search: filter, reverb, vibrato…" value="${esc(pickQuery)}" aria-label="search the settings">` +
    `<div class="cs-options" role="listbox">${pickerOptions(controlSysex, kind)}</div></div>`;
  return html;
}

function pickerOptions(controlSysex, kind) {
  const all = targetsOf(controlSysex);
  const current = num(controlSysex);
  const q = pickQuery.trim().toLowerCase();
  const option = t => `<button type="button" class="cs-option always-on${t.value === current ? ' current' : ''}" role="option" ` +
    `aria-selected="${t.value === current}" data-choose="${t.value}" title="${esc(t.text)}">${esc(t.value ? (q ? t.short : t.name) : 'nothing')}</button>`;
  let html = '';
  if (!q) {
    const suggested = SUGGESTED[kind].map(v => all.find(t => t.value === v)).filter(Boolean);
    if (suggested.length) html += `<div class="cs-group">suggested</div>` + suggested.map(t => option({ ...t, name: t.short })).join('');
    html += option(all.find(t => t.value === 0) ?? { value: 0, text: 'nothing', short: 'nothing', name: 'nothing' });
  }
  const matches = all.filter(t => t.value && (!q || t.text.toLowerCase().includes(q)));
  let heading = null;
  matches.forEach(t => {
    const h = t.section === 'other' ? 'actions' : t.section + (t.group ? ` · ${t.group}` : '');
    if (h !== heading) { html += `<div class="cs-group">${esc(h)}</div>`; heading = h; }
    html += option(t);
  });
  return html || `<p class="cs-empty">No setting has "${esc(pickQuery)}" in its name.</p>`;
}

// what the range comes to, in the setting's own units
function spanSentence(rangeSysex) {
  const { text } = knobSpanText(rangeSysex);
  return text ? text.replace('→', 'sweeps') : '';
}

function rangeBlock(rangeSysex) {
  return paramControl(rangeSysex, 'how far it reaches') + `<p class="cs-note" data-span="${rangeSysex}">${esc(spanSentence(rangeSysex))}</p>`;
}

function layerBlock(key, layer) {
  const c = CONTROLS[key];
  const slot = c[layer];
  const title = layer === 'main' ? 'turning' : 'holding ♯ and turning';
  const live = shownLayer() === layer;
  let html = `<section class="cs-layer${live ? ' live' : ''}"><h3>${key === 'hover' ? (layer === 'main' ? 'a hand over the harp' : 'holding ♯, a hand over the harp') : title}</h3>`;
  if (slot.fixed) return html + `<p class="cs-fixed">${esc(slot.fixed)} <span class="cs-dim">· built in</span></p></section>`;
  html += targetPicker(slot.control, 'sweep');
  if (num(slot.control)) {
    if (slot.range) html += rangeBlock(slot.range);
    if (slot.value) html += paramControl(slot.value, 'hand close');
  } else if (key === 'hover' && layer === 'alt') {
    html += `<p class="cs-note">same as without ♯</p>`;
  }
  return html + '</section>';
}

function sheetBody(key) {
  const c = CONTROLS[key];
  if (c.kind === 'knob' || c.kind === 'hover') {
    let html = c.kind === 'hover' ? `<p class="cs-intro">A hand over the plate, like a fourth knob.</p>` : '';
    html += `<div class="cs-layers">${layerBlock(key, 'main')}${layerBlock(key, 'alt')}</div>`;
    if (c.kind === 'hover') html += `<section class="cs-extra">${paramControl(251, 'how high it starts')}</section>`;
    html += `<section class="cs-extra">${paramControl(KNOB_LAYER, 'knob layer')}` +
      `<p class="cs-note">alternate: the ♯ settings, without holding ♯</p></section>`;
    return html;
  }
  if (c.kind === 'tap') {
    let html = `<p class="cs-intro">Two quick taps switch these; two more switch them back.</p>`;
    c.slots.forEach(([control, value], i) => {
      html += `<section class="cs-layer"><h3>switch ${i + 1}</h3>${targetPicker(control, 'tap')}`;
      if (num(control)) html += paramControl(value, num(control) === 256 ? 'which looper' : 'to');
      html += `</section>`;
    });
    html += `<section class="cs-extra">${paramControl(321, 'tap, then hold: only while held')}</section>`;
    return html;
  }
  if (c.kind === 'updown') {
    return `<p class="cs-intro">With ♯ held: ▼ reverts the preset, ▲ stops every sound.</p>` +
      `<section class="cs-extra">${paramControl(322, 'on')}</section>`;
  }
  return '';
}

// ---- the page's sheets ----

// a few things on top of a sheet's own settings: the key the buttons are spelled in on the chord
// sheet, and hover on the harp's
function quickBody(name) {
  if (name === 'chord') {
    return `<section class="cs-extra">${paramControl(35, 'key')}${paramControl(30, 'transpose')}</section>`;
  }
  if (name === 'harp') {
    const s = slotSummary('hover', 'main');
    return `<section class="cs-extra"><button type="button" class="cs-target always-on" data-open-control="hover">` +
      `<span>hover · ${esc(s.text)}</span><span class="glyph" aria-hidden="true">›</span></button></section>`;
  }
  return '';
}

function renderQuick() {
  document.querySelectorAll('.sheet-quick').forEach(box => {
    if (box.contains(document.activeElement)) return;
    box.innerHTML = quickBody(box.dataset.quick);
    box.querySelectorAll('input[type="range"]').forEach(paintSlider);
  });
}

function openSheet(name) {
  const sheet = document.getElementById(`${name}-sheet`);
  if (!sheet) return;
  renderQuick();
  if (!sheet.matches(':popover-open')) sheet.showPopover();
}

// ---- finding a setting, and every setting at once ----

const everyOn = () => document.getElementById('parameters')?.classList.contains('show-all');
let finderIndex = null;

// every setting the page shows, by its label, with where it is
function buildFinderIndex() {
  finderIndex = [...document.querySelectorAll('#parameters label[for^="param-"]')].map(label => {
    const sysex = parseInt(label.htmlFor.slice(6));
    const sheet = label.closest('[popover]');
    const place = sheet ? sheet.querySelector('h2')?.textContent : 'controls';
    // the heading over its row says most (Envelope, Vibrato), else the submenu it is in
    const row = label.closest('div[style*="display: flex"]');
    let heading = (row?.closest('.picture') ?? row)?.previousElementSibling;
    while (heading && heading.tagName !== 'H3') heading = heading.previousElementSibling;
    const group = heading?.textContent ?? label.closest('details.submenu')?.querySelector('summary')?.textContent;
    return { sysex, name: label.textContent.trim(), where: [place, group].filter(Boolean).join(' · '), tip: (label.title || '').toLowerCase() };
  });
}

function finderMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (!finderIndex) buildFinderIndex();
  const rank = e => {
    const name = e.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (e.where.toLowerCase().includes(q)) return 2;
    return e.tip.includes(q) ? 3 : -1;
  };
  return finderIndex.map(e => ({ e, r: rank(e) })).filter(m => m.r >= 0).sort((a, b) => a.r - b.r).slice(0, 12).map(m => m.e);
}

function renderFinder() {
  const input = document.getElementById('finder-input');
  const list = document.getElementById('finder-results');
  if (!input || !list) return;
  const found = finderMatches(input.value);
  list.hidden = !input.value.trim();
  list.innerHTML = found.length
    ? found.map(e => `<li><button type="button" class="finder-result always-on" data-reveal="${e.sysex}">` +
        `<span class="finder-name">${esc(e.name)}</span><span class="finder-where">${esc(e.where)}</span></button></li>`).join('')
    : `<li class="cs-empty">No setting by that name.</li>`;
}

// open what holds a setting, and point at it
function revealSetting(sysex) {
  const element = document.getElementById(`param-${sysex}`);
  if (!element) return;
  if (!everyOn() && element.closest('.every-only')) {
    if (CONTROL_OF[sysex]) openControlSheet(CONTROL_OF[sysex]);
    return;
  }
  for (let d = element.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  const sheet = element.closest('[popover]');
  if (sheet && !everyOn()) openSheet(sheet.id.replace(/-sheet$/, ''));
  const row = element.closest('div[style*="display: flex"]') || element;
  requestAnimationFrame(() => {
    row.scrollIntoView({ block: 'center' });
    row.classList.add('found');
    setTimeout(() => row.classList.remove('found'), 1800);
  });
}

const EVERY_KEY = 'minicontrol_every_setting';
function showEverySetting(on) {
  document.getElementById('parameters')?.classList.toggle('show-all', on);
  document.getElementById('show-every-setting')?.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem(EVERY_KEY, on ? '1' : ''); } catch (e) {}
}

function setupFinder() {
  const input = document.getElementById('finder-input');
  const list = document.getElementById('finder-results');
  const every = document.getElementById('show-every-setting');
  if (!input || !list || !every) return;
  input.addEventListener('input', renderFinder);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') list.querySelector('[data-reveal]')?.click();
    if (e.key === 'Escape') { input.value = ''; renderFinder(); }
  });
  list.addEventListener('click', e => {
    const hit = e.target.closest('[data-reveal]');
    if (!hit) return;
    input.value = '';
    renderFinder();
    revealSetting(parseInt(hit.dataset.reveal));
  });
  every.addEventListener('click', () => showEverySetting(!everyOn()));
  let saved = false;
  try { saved = localStorage.getItem(EVERY_KEY) === '1'; } catch (e) {}
  showEverySetting(saved);
}

// a slider's track filled to its value in the bank colour, as index.js paints the page's own
function paintSlider(slider) {
  const value = (slider.value - slider.min) / (slider.max - slider.min) * 100;
  const track = sliderTrackColor();
  slider.style.background = `linear-gradient(to right, var(--primary-color) 0%, var(--primary-color) ${value}%, ${track} ${value}%, ${track} 100%)`;
}

function renderSheet() {
  const sheet = document.getElementById('controls-sheet');
  if (!sheet || !sheetControl) return;
  const c = CONTROLS[sheetControl];
  document.getElementById('controls-sheet-title').textContent = c.name;
  document.getElementById('controls-sheet-where').textContent = c.where;
  const body = document.getElementById('controls-sheet-body');
  const offline = !controller.isConnected();
  body.innerHTML = (offline ? `<p class="cs-offline">Connect the minichord to change these.</p>` : '') + sheetBody(sheetControl);
  body.querySelectorAll('input[type="range"]').forEach(paintSlider);
}

function openControlSheet(key) {
  if (CONTROLS[key].kind === 'sheet') return openSheet(CONTROLS[key].sheet);
  const sheet = document.getElementById('controls-sheet');
  if (!sheet) return;
  sheetControl = key;
  pickingFor = null;
  pickQuery = '';
  renderSheet();
  if (!sheet.matches(':popover-open')) sheet.showPopover();
}

// a slider in a sheet moved: send it, and say what it now comes to
function slide(set, root) {
  if (!set || set.type !== 'range') return;
  const sysex = parseInt(set.dataset.set);
  setParam(sysex, parseInt(set.value));
  paintSlider(set);
  const out = root.querySelector(`[data-shows="${sysex}"]`);
  if (out) out.textContent = displayOf(effectiveParam(findParameterBySysex(sysex)), parseInt(set.value));
  const span = root.querySelector(`[data-span="${sysex}"]`);
  if (span) span.textContent = spanSentence(sysex);
}

function setupMinichordMap() {
  const map = document.getElementById('minichord-map');
  const sheet = document.getElementById('controls-sheet');
  if (!map || !sheet) return;

  const open = e => {
    const target = e.target.closest('[data-control]');
    if (target) openControlSheet(target.dataset.control);
  };
  map.addEventListener('click', e => {
    const layer = e.target.closest('#map-layers button');
    if (layer) { mapLayer = parseInt(layer.dataset.layer); renderMinichordMap(); return; }
    const pedal = e.target.closest('[data-sheet]');
    if (pedal) { openSheet(pedal.dataset.sheet); return; }
    open(e);
  });
  map.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.map-ctl')) { e.preventDefault(); open(e); }
  });
  narrowMap.addEventListener('change', renderMinichordMap);

  sheet.addEventListener('toggle', e => { if (e.newState === 'closed') { sheetControl = null; pickingFor = null; } });
  sheet.addEventListener('click', e => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const sysex = parseInt(pick.dataset.pick);
      pickingFor = pickingFor === sysex ? null : sysex;
      pickQuery = '';
      renderSheet();
      sheet.querySelector('.cs-search')?.focus();
      return;
    }
    const choose = e.target.closest('[data-choose]');
    if (choose && pickingFor != null) {
      const control = pickingFor;
      pickingFor = null;
      setParam(control, parseInt(choose.dataset.choose));
      renderSheet();
      sheet.querySelector(`[data-pick="${control}"]`)?.focus();
    }
  });
  sheet.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pickingFor != null) {
      e.preventDefault();
      const control = pickingFor;
      pickingFor = null;
      renderSheet();
      sheet.querySelector(`[data-pick="${control}"]`)?.focus();
    }
  });
  sheet.addEventListener('input', e => {
    if (e.target.matches('.cs-search')) {
      pickQuery = e.target.value;
      const list = sheet.querySelector('.cs-options');
      const kind = CONTROLS[sheetControl].kind === 'tap' ? 'tap' : 'sweep';
      if (list) list.innerHTML = pickerOptions(pickingFor, kind);
      return;
    }
    slide(e.target.closest('[data-set]'), sheet);
  });
  sheet.addEventListener('change', e => {
    const set = e.target.closest('[data-set]');
    if (!set || set.type === 'range') return;
    setParam(parseInt(set.dataset.set), set.type === 'checkbox' ? (set.checked ? 1 : 0) : parseInt(set.value));
    renderSheet();
  });

  // the controls on top of the chord and harp sheets
  document.addEventListener('click', e => {
    const link = e.target.closest('.sheet-quick [data-open-control]');
    if (link) openControlSheet(link.dataset.openControl);
  });
  document.addEventListener('input', e => {
    const box = e.target.closest('.sheet-quick');
    if (box) slide(e.target.closest('[data-set]'), box);
  });
  document.addEventListener('change', e => {
    const set = e.target.closest('.sheet-quick [data-set]');
    if (set && set.type !== 'range') setParam(parseInt(set.dataset.set), set.type === 'checkbox' ? (set.checked ? 1 : 0) : parseInt(set.value));
  });
  setupFinder();

  // a setting changed anywhere on the page (by hand, by the describer or a bank coming in)
  document.addEventListener('input', e => { if (e.target.id?.startsWith('param-')) scheduleMinichordMap(); });
  document.addEventListener('change', e => { if (e.target.id?.startsWith('param-')) scheduleMinichordMap(); });
  scheduleMinichordMap();
}

// parameters arrive asynchronously; draw once they are in, and again on every change after
(function waitForParameters() {
  if (parameters && document.getElementById('param-14')?.options.length) setupMinichordMap();
  else setTimeout(waitForParameters, 100);
})();
