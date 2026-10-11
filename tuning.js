// The tuning page's two tools: a Scala file read into your own temperament (firmware 67), and the
// tuning circle, which draws the octave as the minichord has it now: a tick for each step of the
// live tuning, the harp's scale on it, and the notes the minichord plays as they sound.

// --- the tunings, as the firmware has them (include/temperament_profiles.h, main.cpp) ---
// offsets from equal temperament for C, C# ... B, in cents; 10-12 divide the octave instead
const TEMPERAMENT_OFFSETS = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [10, -14, 3, 21, -3, 14, -10, 7, -17, 0, 17, -7],
  [16, 27, 20, 31, 2, 14, 6, 18, 29, 0, 12, 4],
  [-6, 8, -2, -12, 2, -8, 6, -4, 10, 0, -10, 4],
  [12, 2, 4, 6, 2, 10, 0, 8, 4, 0, 8, 4],
  [10, 0, 3, 4, -3, 8, 0, 7, 2, 0, 6, -1],
  [6, 0, 2, 4, -2, 8, -2, 4, 2, 0, 6, -4],
  [6, -4, 2, 0, -2, 4, -6, 4, -2, 0, 2, -4],
  [8, -2, 3, 2, -3, 6, -4, 5, 0, 0, 4, -1],
  [5, -7, 2, 10, -2, 7, -5, 3, -8, 0, 8, -3],
];
const OWN_TEMPERAMENT = 13;
const TUNING_DIVISIONS = {10: 19, 11: 24, 12: 31};
const EDO_INDEX = {12: 0, 19: 1, 31: 2, 24: 3};
// the key signature's root in steps of each division (edo_scale_root_offsets)
const KEY_ROOT_STEPS = [
  [0, 7, 2, 9, 4, 11, 5, 10, 3, 8, 1, 6, 6, 1, 8, 3, 10, 5, 0, 4, 11],
  [0, 11, 3, 14, 6, 17, 8, 16, 5, 13, 2, 10, 9, 1, 12, 4, 15, 7, 18, 7, 18],
  [0, 18, 5, 23, 10, 28, 13, 26, 8, 21, 3, 16, 15, 2, 20, 7, 25, 12, 30, 11, 29],
  [0, 14, 4, 18, 8, 22, 10, 20, 6, 16, 2, 12, 12, 2, 16, 6, 20, 10, 0, 8, 22],
];
// the custom scale's degrees, 1 b2 2 ... 7, read by name in each division (edo_chromatic_degrees)
const CHROMATIC_DEGREE_STEPS = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  [0, 2, 3, 5, 6, 8, 10, 11, 13, 14, 16, 17],
  [0, 3, 5, 8, 10, 13, 16, 18, 21, 23, 26, 28],
  [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
];
// the maqams in quarter-tones: up, down, with the other upper jins (main.cpp, maqam_quarter_tones)
const MAQAMS = [
  ["Rast", [0, 4, 7, 10, 14, 18, 21], [0, 4, 7, 10, 14, 18, 20], [0, 4, 7, 10, 14, 16, 22]],
  ["Bayati", [0, 3, 6, 10, 14, 16, 20], [0, 3, 6, 10, 14, 16, 20], [0, 3, 6, 10, 14, 17, 20]],
  ["Saba", [0, 3, 6, 8, 14, 16, 20], [0, 3, 6, 8, 14, 16, 20], [0, 2, 6, 8, 14, 16, 20]],
  ["Hijaz", [0, 2, 8, 10, 14, 17, 20], [0, 2, 8, 10, 14, 16, 20], [0, 2, 8, 10, 14, 16, 22]],
  ["Sikah", [0, 3, 7, 11, 14, 17, 21], [0, 3, 7, 11, 14, 17, 21], [0, 3, 7, 9, 15, 17, 21]],
  ["Nahawand", [0, 4, 6, 10, 14, 16, 22], [0, 4, 6, 10, 14, 16, 20], [0, 4, 6, 10, 14, 16, 20]],
  ["Kurd", [0, 2, 6, 10, 14, 16, 20], [0, 2, 6, 10, 14, 16, 20], [0, 2, 6, 10, 14, 16, 20]],
  ["Ajam", [0, 4, 8, 10, 14, 18, 22], [0, 4, 8, 10, 14, 18, 22], [0, 4, 8, 10, 14, 18, 20]],
];
const PITCH_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const tv = sysex => currentValues[sysex] ?? findParameterBySysex(sysex)?.default_value ?? 0;

function liveDivision() { return TUNING_DIVISIONS[tv(237)] ?? 12; }

// the twelve offsets of the live twelve-note temperament
function twelveOffsets() {
  const t = tv(237);
  if (t === OWN_TEMPERAMENT) return Array.from({length: 12}, (_, k) => (tv(359 + k) - 1000) / 10);
  return TEMPERAMENT_OFFSETS[t] ?? TEMPERAMENT_OFFSETS[0];
}

// where step s of the live tuning sits, in cents above C
function stepCents(s) {
  const division = liveDivision();
  if (division !== 12) return s * 1200 / division;
  const pc = ((s % 12) + 12) % 12;
  return s * 100 + twelveOffsets()[pc];
}

// the harp's scale as steps above its root, up and down forms, or null when the mode isn't drawn
function harpScale() {
  const division = liveDivision(), edo = EDO_INDEX[division], mode = tv(36);
  if (tv(98) === 1) return {up: [...Array(division).keys()], down: null, what: 'chromatic mode: every step'};
  const fromMask = (mask, bits) => bits.filter((_, i) => mask & (1 << i));
  const stepMask = base => {
    const steps = [];
    for (let s = 0; s < division; s++) if (tv(base + Math.floor(s / 11)) & (1 << (s % 11))) steps.push(s);
    return steps;
  };
  if (mode === 10 || mode === 11) {
    let up = division !== 12 ? stepMask(344) : [];
    if (!up.length) up = fromMask(tv(236), CHROMATIC_DEGREE_STEPS[edo]);
    let down = division !== 12 ? stepMask(353) : [];
    if (!down.length) down = fromMask(tv(352), CHROMATIC_DEGREE_STEPS[edo]);
    return {up: up.length ? up : [0], down: tv(351) && down.length ? down : null, what: 'the custom scale'};
  }
  if (mode === 14 || mode === 15) {
    const [name, up, down, alt] = MAQAMS[tv(356)] ?? MAQAMS[0];
    const round = q => Math.floor((q * division + 12) / 24);
    const u = (tv(357) ? alt : up).map(round), d = (tv(357) ? alt : down).map(round);
    return {up: u, down: tv(351) ? d : null, what: `maqam ${name}${tv(357) ? ', its other upper jins' : ''}`};
  }
  if (mode === 12 || mode === 13) {
    const g = tv(267) % division, size = Math.max(1, tv(268)), below = Math.min(tv(269), size - 1);
    const set = new Set();
    for (let k = 0; k < size; k++) set.add((((k - below) * g) % division + division) % division);
    return {up: [...set].sort((a, b) => a - b), down: null, what: 'the generator scale'};
  }
  return null;
}

// --- the notes as they sound, from the minichord's own MIDI out ---
const circleNotes = new Map();   // "channel:key" -> {cents, on, off}
const channelBend = new Array(16).fill(0);
const keyTuning = new Map();      // key -> its MTS tuning, in semitones
function noteCents(key, channel) {
  if (keyTuning.has(key)) return keyTuning.get(key) * 100;
  if (tv(110) === 1) return key * 100 + channelBend[channel] / 8192 * 48 * 100;   // MPE, a 48 semitone bend range
  return key * 100;
}
function circleMidi(d) {
  const kind = d[0] & 0xF0, channel = d[0] & 0x0F;
  if (d[0] === 0xF0 && d[4] === 0x02) {          // MTS single note tuning change: keys and their pitches
    const count = d[6];
    for (let i = 0; i < count; i++) {
      const at = 7 + i * 4;
      if (at + 3 >= d.length) break;
      keyTuning.set(d[at], d[at + 1] + ((d[at + 2] << 7) | d[at + 3]) / 16384);
    }
    return;
  }
  if (kind === 0xE0) { channelBend[channel] = ((d[2] << 7) | d[1]) - 8192; return; }
  const id = `${channel}:${d[1]}`;
  if (kind === 0x90 && d[2] > 0) circleNotes.set(id, {cents: noteCents(d[1], channel), on: performance.now(), off: 0});
  else if (kind === 0x80 || kind === 0x90) { const n = circleNotes.get(id); if (n) n.off = performance.now(); }
  else return;
  drawCircleNotes();
}

// --- drawing ---
const SVG_NS = 'http://www.w3.org/2000/svg';
const at = (cents, r) => {
  const a = (cents / 1200) * 2 * Math.PI - Math.PI / 2;
  return [r * Math.cos(a), r * Math.sin(a)];
};
function svgEl(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function refreshTuningCircle() {
  const svg = document.getElementById('tuning-circle');
  if (!svg) return;
  svg.replaceChildren();
  const division = liveDivision(), edo = EDO_INDEX[division];
  svg.appendChild(svgEl('circle', {cx: 0, cy: 0, r: 100, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.35}));
  // the twelve equal places, faintly, with their names, to read the others against
  for (let k = 0; k < 12; k++) {
    const [x, y] = at(k * 100, 112);
    const label = svgEl('text', {x, y: y + 3, 'text-anchor': 'middle', 'font-size': 8, fill: 'currentColor', 'fill-opacity': 0.55});
    label.textContent = PITCH_NAMES[k];
    svg.appendChild(label);
  }
  // a tick for every step of the live tuning
  for (let s = 0; s < division; s++) {
    const c = stepCents(s);
    const [x0, y0] = at(c, 95), [x1, y1] = at(c, 104);
    svg.appendChild(svgEl('line', {x1: x0, y1: y0, x2: x1, y2: y1, stroke: 'currentColor', 'stroke-width': 1.2}));
  }
  // the harp's scale, from the key's root (or the chord's, drawn on the key)
  const scale = harpScale();
  const caption = document.getElementById('tuning-circle-caption');
  const tuningName = findParameterBySysex(237)?.options?.find(o => o.value === tv(237))?.label ?? '';
  if (scale) {
    const rootSteps = KEY_ROOT_STEPS[edo][tv(35)] + Math.round(tv(30) * division / 12);
    const centsOf = s => stepCents(rootSteps + s);
    const upSet = new Set(scale.up);
    for (const s of scale.up) {
      const [x, y] = at(centsOf(s), 86);
      svg.appendChild(svgEl('circle', {cx: x, cy: y, r: s === 0 ? 5 : 3.6, fill: 'var(--primary-color, #c33)'}));
    }
    if (scale.down) {
      for (const s of scale.down) {
        if (upSet.has(s)) continue;
        const [x, y] = at(centsOf(s), 86);
        svg.appendChild(svgEl('circle', {cx: x, cy: y, r: 3.6, fill: 'none', stroke: 'var(--primary-color, #c33)', 'stroke-width': 1.4}));
      }
    }
    const rooted = [11, 13, 15].includes(tv(36)) ? ", from the chord's root (drawn on the key's)" : '';
    caption.textContent = `${tuningName}: ${scale.what}${rooted}${scale.down ? '; rings: the way down' : ''}`;
  } else {
    caption.textContent = `${tuningName}: the harp follows the chord or a fixed scale here, so only the tuning is drawn`;
  }
  const notes = svgEl('g', {id: 'tuning-circle-notes'});
  svg.appendChild(notes);
  drawCircleNotes();
}

function drawCircleNotes() {
  const g = document.getElementById('tuning-circle-notes');
  if (!g) return;
  g.replaceChildren();
  const now = performance.now();
  for (const [id, n] of circleNotes) {
    const fade = n.off ? 1 - (now - n.off) / 1500 : 1;
    if (fade <= 0) { circleNotes.delete(id); continue; }
    const c = ((n.cents % 1200) + 1200) % 1200;
    const [x, y] = at(c, 70);
    const [x0, y0] = at(c, 20);
    g.appendChild(svgEl('line', {x1: x0, y1: y0, x2: x, y2: y, stroke: 'currentColor', 'stroke-opacity': 0.4 * fade}));
    g.appendChild(svgEl('circle', {cx: x, cy: y, r: 5, fill: 'currentColor', 'fill-opacity': fade}));
  }
  if (circleNotes.size) requestAnimationFrame(drawCircleNotes);
}

// --- a Scala file into the own temperament ---
// A .scl: comment lines start with "!", then a description, the number of notes, and each note
// above the first, in cents (with a point) or as a ratio, the last the period.
function parseScala(text) {
  const lines = text.split(/\r?\n/).filter(l => !l.trim().startsWith('!'));
  const count = parseInt(lines[1]);
  if (count !== 12) throw new Error(`it has ${isNaN(count) ? 'no' : count} notes to the octave; your own temperament takes twelve (for 19, 24 and 31 choose them as the temperament)`);
  const cents = [];
  for (let i = 0; i < 12; i++) {
    const token = (lines[2 + i] ?? '').trim().split(/\s+/)[0];
    if (!token) throw new Error('it ends before its twelfth note');
    let c;
    if (token.includes('.')) c = parseFloat(token);
    else if (token.includes('/')) { const [a, b] = token.split('/').map(Number); c = 1200 * Math.log2(a / b); }
    else c = 1200 * Math.log2(Number(token));
    if (!isFinite(c)) throw new Error(`"${token}" isn't a pitch`);
    cents.push(c);
  }
  if (Math.abs(cents[11] - 1200) > 0.5) throw new Error(`its period is ${cents[11].toFixed(1)} cents, not an octave`);
  return {name: (lines[0] ?? '').trim(), offsets: [0, ...cents.slice(0, 11)].map((c, k) => c - 100 * k)};
}

function setOwnTemperament(offsets, select) {
  offsets.forEach((cents, k) => {
    const sysex = 359 + k, value = Math.round(cents * 10) + 1000;
    currentValues[sysex] = value;
    tempValues[sysex] = value;
    controller.sendParameter(sysex, value);
    const param = findParameterBySysex(sysex);
    if (param) applyUIValue(param, value);
  });
  if (select) {
    currentValues[237] = OWN_TEMPERAMENT;
    tempValues[237] = OWN_TEMPERAMENT;
    controller.sendParameter(237, OWN_TEMPERAMENT);
    const param = findParameterBySysex(237);
    if (param) applyUIValue(param, OWN_TEMPERAMENT);
  }
  markEdited();
  refreshTuningCircle();
}

function setupTuningTools() {
  const file = document.getElementById('scala-file');
  const status = document.getElementById('scala-status');
  if (file) {
    file.addEventListener('change', async () => {
      if (!file.files.length) return;
      try {
        const {name, offsets} = parseScala(await file.files[0].text());
        let shifted = offsets;
        if (document.getElementById('scala-keep-a')?.checked) shifted = offsets.map(c => c - offsets[9]);
        const far = shifted.findIndex(c => Math.abs(c) > 100);
        if (far >= 0) throw new Error(`its ${PITCH_NAMES[far]} is ${shifted[far].toFixed(1)} cents from equal, past the 100 the minichord holds: is its first note C?`);
        setOwnTemperament(shifted, true);
        status.textContent = `read ${name || file.files[0].name}: temperament set to your own`;
      } catch (e) {
        status.textContent = `couldn't read it: ${e.message}`;
      }
      file.value = '';
    });
  }
  document.getElementById('own-equal')?.addEventListener('click', () => {
    setOwnTemperament(new Array(12).fill(0), false);
    if (status) status.textContent = 'your own temperament set to equal';
  });
  const previous = controller.onMidi;
  controller.onMidi = d => { circleMidi(d); if (previous) previous(d); };
  refreshTuningCircle();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTuningTools);
else setupTuningTools();
