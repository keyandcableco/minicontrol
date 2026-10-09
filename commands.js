//-->>COMMANDS: INSTRUCTIONS IN WORDS, FOR THE LIVE SOUND OR FOR ANY BANKS
// "turn off hover", "assign the mod pot to key signature on banks 2 and 4", "set the chord attack
// to 200 ms", "raise the harp release a lot", "make bank 5 like bank 2", "reset the reverb on every
// bank". The grammar of an instruction lives here: its verbs, which banks it is for, numbers and
// their units, and the words a dropdown offers. What a setting is called, and every description of
// a sound ("warmer", "plucky harp", a famous song), is describe.js's, so the words stay the ones
// the minichord repository's preset maker knows: anything this file doesn't read as an instruction
// goes to describe.js as it is, once for each bank it is meant for, so "darker" is darker than
// what each bank holds.
//
// Nothing here talks to the minichord. plan() changes working copies of the stored values that
// the page hands it, one per place the words name (the live sound, or a bank), and the page shows
// what changed for the player to keep or take back before anything is sent.

(function (root) {
"use strict";

const describe = root.describe || (typeof require !== "undefined" ? require("./describe.js") : null);

let D = null;          // describe_data.json
let PARAMS = null;     // address -> describe.js's facts about the setting
let OPTIONS = {};      // address -> [{value, label}], the page's dropdown words
let NAMES = null;      // a setting's names -> its addresses
let SECTION = null;    // a section word -> "chord" or "harp"

const BANKS = 12;
const LOCKED = new Set([0, 1, 2, 3, 4, 5, 6, 7, 241, 242, 243, 244, 256, 382, 383, 510, 511]);
const RHYTHM_STEPS = [220, 235];
const KNOBS = { mod: [14, 15], mod_alt: [16, 17], chord_knob: [10, 11], harp_knob: [12, 13] };
const TAPS = [[200, 201], [209, 210], [211, 212]];
const CONTROL_NAME = { mod: "mod knob", mod_alt: "modifier + mod knob", chord_knob: "modifier + chord knob",
                       harp_knob: "modifier + harp knob", hover: "hover", tap: "double tap" };
// groups a bare name most likely means: "attack" is the envelope's before the filter's
const CORE_GROUPS = new Set(["Envelope", "Oscillator", "Effects", "General", "Notes", "Key and tuning", "Buttons",
                             "Voicing", "Device", "MIDI", "Potentiometer", "Hover", "Double tap"]);
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
                       eleven: 11, twelve: 12, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
                       seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };

function setup(data, parameters) {
  D = data;
  PARAMS = describe.params();
  OPTIONS = {};
  for (const list of Object.values(parameters || {})) {
    if (!Array.isArray(list)) continue;
    for (const p of list) if (Array.isArray(p.options)) OPTIONS[p.sysex_adress] = p.options;
  }
  SECTION = new Map();
  for (const [s, words] of Object.entries(D.section_words)) for (const w of words) SECTION.set(w, s);
  NAMES = new Map();
  const add = (key, a) => {
    key = words(key).join(" ");
    if (!key) return;
    if (!NAMES.has(key)) NAMES.set(key, new Set());
    NAMES.get(key).add(a);
  };
  for (const k of Object.keys(PARAMS)) {
    const a = +k;
    if (!settable(a)) continue;
    const p = PARAMS[a], n = p.name.trim(), g = p.group;
    add(n, a);
    add(`${g} ${n}`, a);
    if (p.section !== "global") {
      for (const s of [p.section, p.section + "s"]) {
        add(`${s} ${n}`, a);
        add(`${s} ${g} ${n}`, a);
      }
    }
  }
}

// ---- words ----

function normalise(text) {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    .replace(/→|->|=>/g, " to ").replace(/&/g, " and ").replace(/\+/g, " plus ")
    .replace(/(\d)\s*%/g, "$1 percent ").replace(/%/g, " percent ")
    .replace(/\b([a-g])\s*#/g, "$1 sharp")
    .replace(/(\d)\s*-\s*(\d)/g, "$1 to $2")
    .replace(/(?<=[a-z])-(?=[a-z])/g, " ")
    .replace(/'s\b/g, "").replace(/'/g, "");
}
function words(text) { return text.toLowerCase().match(/@\d+|[a-z0-9#]+(?:\.\d+)?|\.\d+/g) || []; }
function single(w) { return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w; }

// Levenshtein within one, for a slip of the fingers on a long word
function near(a, b) {
  if (a === b) return true;
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function settable(a) {
  const p = PARAMS[a];
  return p && !LOCKED.has(a) && p.group !== "hidden" && !(a >= RHYTHM_STEPS[0] && a <= RHYTHM_STEPS[1]);
}

const PLAIN_GROUPS = ["Effects", "General", "Notes", "Oscillator", "Envelope", "Settings", "Potentiometer", "Device",
                      "Buttons", "Voicing", "Key and tuning", "MIDI", "Double tap", "Hover", "hidden", "Rythm"];
// "chord attack", "harp low pass filter resonance": what a setting is called in what this says back
function nameOf(a) {
  const p = PARAMS[a];
  let name = p.name.trim().replace(/_/g, " ").replace(/^default bpm$/, "tempo");
  if (p.group === "Rythm") return `rhythm ${name}`;
  if (!PLAIN_GROUPS.includes(p.group) && !name.toLowerCase().includes(p.group.toLowerCase().replace(/s+$/, "")))
    name = `${p.group.toLowerCase()} ${name}`;
  if (p.section === "global" || name.toLowerCase().includes(p.section)) return name;
  return `${p.section} ${name}`;
}

// ---- values: describe.js keeps stored values; words use the setting's own units ----

// The setting a value is in: a double tap or hover value is in its target's units
function unitsOf(a, values) {
  const p = PARAMS[a];
  if (p.follows_target == null) return p;
  const t = values[p.follows_target];
  return PARAMS[t] || p;
}
function human(a, values) {
  const p = unitsOf(a, values);
  const v = values[a] || 0;
  return p.data_type === "float" ? Math.round(v) / 100 : v;
}
function isTime(p) {
  const n = (p.group + " " + p.name).toLowerCase();
  return p.data_type === "int" && p.max_value >= 250 &&
    /attack|hold|decay|release|delay length|glide|duration|palm mute release/.test(n) && !/frequency/.test(n);
}
function isSelector(p) { return p.data_type !== "float" && p.max_value - p.min_value <= 30; }
function fmt(v) { return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(2))); }

function optionLabel(a, v) {
  const o = (OPTIONS[a] || []).find(x => x.value === v);
  return o ? o.label : null;
}
function shown(a, v, values) {
  if (TARGET_ADDRESSES.has(a)) return v ? nameOf(v) : "nothing";
  const label = optionLabel(a, v);
  if (label) return label;
  const p = unitsOf(a, values);
  if (p.min_value >= 1000 && /tuning/.test(p.name)) return fmt(v / 10) + " Hz";
  return fmt(v) + (isTime(p) ? " ms" : / bpm$|default_bpm/.test(p.name) ? " bpm" : "");
}
const TARGET_ADDRESSES = new Set([10, 12, 14, 16, 200, 209, 211, 249]);

// A key name to the key signature's choice: "e flat" is Eb; a minor key is its relative major's
function keyChoice(text, a) {
  const m = text.match(/^([a-g])\s*(sharp|flat|#|b)?(?:\s+(major|minor|maj|min|m))?$/);
  if (!m) return null;
  const opts = OPTIONS[a] || [];
  const acc = m[2] === "sharp" || m[2] === "#" ? "#" : m[2] === "flat" || m[2] === "b" ? "b" : "";
  if (m[3] && m[3].startsWith("min") || m[3] === "m") {
    const semis = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]] + (acc === "#" ? 1 : acc === "b" ? -1 : 0);
    const major = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][((semis + 3) % 12 + 12) % 12];
    const o = opts.find(x => x.label === major);
    return o ? o.value : null;
  }
  const want = m[1].toUpperCase() + acc;
  const o = opts.find(x => x.label === want);
  return o ? o.value : null;
}

// Words for a value of setting `a`, in its units: a number with or without units, a choice its
// dropdown offers, or max, min, half, default, on and off. {value} or {error}.
function parseValue(text, a, values) {
  const p = unitsOf(a, values);
  const t = text.replace(/^(?:to|at|=|be|is|of|around|about|roughly|exactly|equal to)\s+/, "")
                .replace(/\s+(?:please|instead|now)$/, "").replace(/^(?:the|a|an)\s+/, "")
                .replace(/\s+(?:one|mode|setting|option|choice)$/, "").trim();
  if (!t) return null;
  const lo = p.min_value, hi = p.max_value;
  if (/^(?:max|maximum|full|fully|all the way(?: up)?|highest|the most|top|100 percent)$/.test(t)) return { value: hi };
  if (/^(?:min|minimum|lowest|the least|bottom|all the way down)$/.test(t)) return { value: lo };
  if (/^(?:zero|nothing|none|0 percent)$/.test(t)) return { value: Math.max(lo, 0) };
  if (/^(?:half|halfway|half way|the middle|middle|centre|center|mid)$/.test(t)) return { value: (lo + hi) / 2 };
  if (/^(?:default|its default|the default|factory|normal|stock|original)(?: value| setting)?$/.test(t)) return { value: p.default_value };
  if (hi - lo === 1 && p.data_type !== "float") {
    if (/^(?:on|yes|true|enabled?|active)$/.test(t)) return { value: String(a) in D.on_value ? D.on_value[String(a)] : hi };
    if (/^(?:off|no|false|disabled?|inactive)$/.test(t)) return { value: lo };
    // a choice of two: "the alternate one", "the standard one"
    if (/^(?:alt|alternate|alternative|other|second|2nd)$/.test(t)) return { value: hi };
    if (/^(?:standard|regular|usual|first|1st|classic)$/.test(t)) return { value: lo };
  }
  if (/^(?:off|silent)$/.test(t)) return { value: Math.max(lo, 0) };
  if (a === 20 && D.colors && D.colors[t] != null) return { value: D.colors[t] };
  // a dropdown's own words, or a key, or a waveform's name as describe.js knows them
  const opts = OPTIONS[unitsOf(a, values) === p ? (PARAMS[a] === p ? a : values[PARAMS[a].follows_target]) : a] || [];
  if (/key signature/.test(p.name)) {
    const k = keyChoice(t.replace(/^(?:the\s+)?key\s+of\s+/, ""), a);
    if (k != null) return { value: k };
  }
  if (/waveform/.test(p.name) && D.wave_names) {
    const w = D.wave_names[t] != null ? D.wave_names[t] : D.wave_names[t.replace(/\s+wave$/, "")];
    if (w != null) return { value: w };
  }
  if (opts.length) {
    const tw = words(t).map(single);
    const exact = opts.find(o => words(o.label).map(single).join(" ") === tw.join(" "));
    if (exact) return { value: exact.value };
    const partial = opts.filter(o => { const ow = words(o.label).map(single); return tw.every(w => ow.some(x => near(w, x))); });
    if (partial.length === 1) return { value: partial[0].value };
    if (partial.length > 1 && !/^\d/.test(t))
      return { error: `"${t}" could be ${partial.map(o => o.label).join(", ")}; say which` };
  }
  const m = t.match(/^(-?\d*\.?\d+)\s*(percent|per cent|pc|ms|milliseconds?|millis|s|secs?|seconds?|hz|hertz|khz|kilohertz|cm|centimet(?:er|re)s?|bpm|semitones?|steps?|octaves?|cents?)?$/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const unit = m[2] || "";
  if (/^per/.test(unit) || unit === "pc") {
    v = lo + (hi - lo) * v / 100;
  } else if (/^(?:s|secs?|seconds?)$/.test(unit)) {
    v = isTime(p) ? v * 1000 : v;
  } else if (/^(?:khz|kilohertz)$/.test(unit)) {
    v *= 1000;
  } else if (!unit) {
    // tuning is kept in tenths of a hertz; a float setting given a number over its top is a percentage
    if (lo >= 1000 && v * 10 >= lo && v * 10 <= hi) v *= 10;
    else if (p.data_type === "float" && v > hi && v <= 100 && hi <= 5) v = lo + (hi - lo) * v / 100;
  }
  if (opts.length && !Number.isInteger(v)) v = Math.round(v);
  return { value: v };
}

// ---- which banks: "on banks 2 and 4", "every bank but 3", "this bank", "from bank 6" ----

const BANKNUM = "(?:1[0-2]|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|" +
                "fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)";
const BANKLIST = `${BANKNUM}(?:\\s*(?:,\\s*(?:and\\s+)?|and|or|to|through|thru|until)\\s*${BANKNUM})*`;
const PREP = "(?:(on|in|for|to|into|onto|across|at|from|of|with)\\s+)?(?:the\\s+|my\\s+)?";
const SCOPE_PATTERNS = [
  ["all", new RegExp(`\\b${PREP}(?:(?:all|every|each)\\s+(?:(?:of\\s+)?(?:the|my)\\s+)?(?:twelve\\s+|12\\s+)?(?:banks?|presets?|slots?)|(?:all|every|each)\\s+(?:twelve|12)|(?:banks?|presets?)\\s+all)` +
                      `(?:\\s+(?:except|but(?:\\s+not)?|apart\\s+from|other\\s+than|besides|excluding)\\s+(?:(?:for\\s+)?(?:banks?|presets?)\\s+)?(${BANKLIST}))?`, "g")],
  ["list", new RegExp(`\\b${PREP}(?:banks?|presets?|slots?)\\s+(?:number\\s+|numbers\\s+|#\\s*)?(${BANKLIST})\\b`, "g")],
  ["ordinal", new RegExp(`\\b${PREP}(${BANKLIST})(?:st|nd|rd|th)?\\s+(?:and\\s+(${BANKLIST})(?:st|nd|rd|th)?\\s+)?(?:banks?|presets?|slots?)\\b`, "g")],
  ["this", /\b(?:(on|in|for|to|into|onto|at|from|of)\s+)?(?:this|the\s+current|current|the\s+active|active|the\s+loaded|my\s+current|the\s+selected)\s+(?:bank|slot|saved\s+preset)\b/g],
  ["live", /\b(?:(on|in|for|to|into|onto|at|from|of)\s+)?(?:the\s+)?(?:live(?:\s+(?:sound|settings?|preset|edits?))?|current\s+sound|sound\s+(?:i(?:m|\s+am)\s+)?(?:hearing|playing)\s+now|what\s+(?:is|s)\s+playing(?:\s+now)?|right\s+now)\b/g],
];

function bankNumbers(list) {
  const toks = list.replace(/,/g, " , ").split(/\s+/).filter(Boolean);
  const out = [];
  let prev = null, range = false;
  for (const t of toks) {
    if (/^(?:to|through|thru|until)$/.test(t)) { range = true; continue; }
    if (!/^\d+$/.test(t) && !(t in NUMBER_WORDS)) continue;
    const n = /^\d+$/.test(t) ? +t : NUMBER_WORDS[t];
    if (range && prev != null) for (let k = Math.min(prev, n) + 1; k < Math.max(prev, n); k++) out.push(k);
    out.push(n);
    prev = n;
    range = false;
  }
  return [...new Set(out)].filter(n => n >= 1 && n <= BANKS).map(n => n - 1);
}

// Each place words name, taken out of the text and left as a marker «n», so a list like
// "2, 4 and 6" isn't split into clauses. A place is {keys: ["live"] or ["b1", "b3"], from, text}.
function markScopes(text, currentBank) {
  const scopes = [];
  for (const [kind, re] of SCOPE_PATTERNS) {
    text = text.replace(re, (whole, prep, a, b) => {
      let keys;
      if (kind === "all") {
        const except = new Set(a ? bankNumbers(a) : []);
        keys = [...Array(BANKS).keys()].filter(n => !except.has(n)).map(n => "b" + n);
      } else if (kind === "list") keys = bankNumbers(a).map(n => "b" + n);
      else if (kind === "ordinal") keys = bankNumbers(a + (b ? " , " + b : "")).map(n => "b" + n);
      else if (kind === "this") keys = currentBank >= 0 ? ["b" + currentBank] : ["live"];
      else keys = ["live"];
      if (!keys.length) return whole;
      scopes.push({ keys, from: prep === "from" || prep === "of" || prep === "with", text: whole.trim() });
      return ` «${scopes.length - 1}» `;
    });
  }
  return { text, scopes };
}

function scopeName(keys) {
  if (keys.length === 1 && keys[0] === "live") return "live";
  const n = keys.map(k => +k.slice(1) + 1);
  if (n.length === BANKS) return "every bank";
  return (n.length === 1 ? "bank " : "banks ") + (n.length > 1 ? n.slice(0, -1).join(", ") + " and " + n[n.length - 1] : n[0]);
}

// ---- clauses ----

const VERB = "(?:turn|switch|set|make|put|assign|map|route|link|unassign|clear|disable|enable|activate|deactivate|" +
             "raise|lower|increase|decrease|reduce|boost|bump|double|halve|reset|restore|revert|copy|duplicate|change|" +
             "give|remove|mute|unmute|kill|bring|drop|use|have|let|crank|shorten|lengthen|cut|add)";
const LEAD = /^(?:(?:and|also|then|now|so|ok|okay|please|plus|next|finally|lastly|first|after that|and then|can you|could you|would you|will you|i want(?: to)?|i d like(?: to)?|id like(?: to)?|i would like(?: to)?|lets|let us|go ahead and|try|maybe|just)\s+)+/;
const TAIL = /\s+(?:please|too|as well|for me|thanks|thank you|if you can|instead)$/;

// Sentences, then clauses at commas, semicolons and "then", and at an "and" that starts a new
// instruction ("turn off hover and set the reverb to 40"); an "and" inside a description stays.
function clauses(text) {
  const out = [];
  for (const sentence of text.split(/(?<!\d)\.(?!\d)|[;!?\n]+/)) {
    const parts = sentence.split(/,|\bthen\b|\band also\b|\bafter that\b/);
    const sentenceOut = [];
    for (const part of parts) {
      for (const piece of part.split(new RegExp(`\\band\\s+(?=(?:also\\s+|then\\s+|please\\s+)?${VERB}\\b)`)))
        if (piece.trim()) sentenceOut.push(piece.trim());
    }
    if (sentenceOut.length) out.push(sentenceOut);
  }
  return out;
}

// ---- naming a setting: "the chord attack", "harp filter resonance", "key signature" ----

const CONTROL_RE = [
  ["mod_alt", /\b(?:(?:the|my)\s+)?(?:alt(?:ernate)?|second(?:ary)?|shift(?:ed)?|modifier(?:\s+plus)?|modified|other)\s+mod(?:ulation)?(?:\s+(?:knob|pot|potentiometer|wheel|dial|control))?\b|\bmod(?:ulation)?\s+(?:knob|pot|potentiometer|dial)\s+(?:alt(?:ernate)?|with\s+(?:the\s+)?modifier|shifted)\b/],
  ["mod", /\b(?:(?:the|my)\s+)?(?:mod(?:ulation)?\s+(?:knob|pot|potentiometer|wheel|dial|control)|mod)\b/],
  ["chord_knob", /\b(?:(?:the|my)\s+)?(?:(?:alt(?:ernate)?|modifier(?:\s+plus)?|shift(?:ed)?)\s+)?chords?\s+(?:knob|pot|potentiometer|dial)\b/],
  ["harp_knob", /\b(?:(?:the|my)\s+)?(?:(?:alt(?:ernate)?|modifier(?:\s+plus)?|shift(?:ed)?)\s+)?harp\s+(?:knob|pot|potentiometer|dial)\b/],
  ["hover", /\b(?:(?:the|my)\s+)?(?:hover(?:ing)?|proximity)(?:\s+(?:control|sensor|sensing|assignment|target))?\b(?!\s+(?:reach|distance|range|height|value))/],
  ["tap", /\b(?:(?:the|my)\s+)?(?:(first|second|third|1st|2nd|3rd)\s+)?double\s*tap(?:\s+(?:slot\s+)?(1|2|3|one|two|three))?(?:\s+(?:control|slot|assignment))?\b/],
];

function findControl(s) {
  for (const [kind, re] of CONTROL_RE) {
    const m = s.match(re);
    if (!m) continue;
    let slot = null;
    if (kind === "tap") {
      const w = m[1] || m[2];
      if (w) slot = { first: 0, "1st": 0, 1: 0, one: 0, second: 1, "2nd": 1, 2: 1, two: 1, third: 2, "3rd": 2, 3: 2, three: 2 }[w];
    }
    return { kind, slot, index: m.index, length: m[0].length, text: m[0] };
  }
  return null;
}

const ARTICLES = /^(?:the|my|a|an|its|their|our|this|that|some|all the|all of the|both|both the)\s+/;
// A setting's name to its addresses: {addrs, name} when it is clear, {choices} when it could be
// several, null when it names none. `section` narrows it ("chord", "harp").
function resolve(phrase, section) {
  let s = phrase.trim().replace(/\s+(?:setting|settings|parameter|param|amount|knob)$/, "").trim();
  while (ARTICLES.test(s)) s = s.replace(ARTICLES, "");
  if (!s) return null;
  const direct = s.match(/^@(\d+)$/);
  if (direct && settable(+direct[1])) return { addrs: [+direct[1]] };
  let toks = words(s);
  // a section named in the phrase: "harp release", "the release on the chords", "chords and harp"
  const sections = new Set();
  const rest = [];
  for (let i = 0; i < toks.length; i++) {
    const two = toks.slice(i, i + 2).join(" ");
    if (SECTION.has(two) && !NAMES.has(toks.join(" "))) { sections.add(SECTION.get(two)); i++; continue; }
    if (SECTION.has(toks[i]) && !NAMES.has(toks.join(" ")) && !/^(?:string|strings|strum)$/.test(toks[i])) {
      sections.add(SECTION.get(toks[i])); continue;
    }
    if (/^(?:on|in|for|of|the|and|both)$/.test(toks[i])) continue;
    rest.push(toks[i]);
  }
  if (section && !sections.size) sections.add(section);
  const inSection = a => !sections.size || PARAMS[a].section === "global" || sections.has(PARAMS[a].section);
  const key = rest.join(" ");
  // describe.js's words for a setting: "filter" is the cutoff, "echo" the delay, "attack" the envelope's
  const role = key ? targetRole(key) : null;
  if (role && D.roles[role]) {
    const where = D.roles[role];
    let addrs = "global" in where ? [where.global] : Object.entries(where).filter(([sec]) => !sections.size || sections.has(sec)).map(([, a]) => a);
    addrs = addrs.filter(a => a != null && settable(a));
    if (addrs.length) return { addrs };
  }
  // the whole name as the page has it
  const whole = NAMES.get(toks.join(" "));
  if (whole) {
    const addrs = [...whole].filter(inSection);
    if (addrs.length) return pick(addrs, sections);
  }
  if (!rest.length) return null;
  const named = NAMES.get(key);
  if (named) {
    const addrs = [...named].filter(inSection);
    if (addrs.length) return pick(addrs, sections);
  }
  // every word found in a setting's section, group and name; the fewest words left over wins
  const want = rest.map(single);
  let best = [], bestScore = Infinity;
  for (const k of Object.keys(PARAMS)) {
    const a = +k;
    if (!settable(a) || !inSection(a)) continue;
    const p = PARAMS[a];
    const have = words(`${p.section} ${p.group} ${p.name}`).map(single);
    if (!want.every(w => have.some(h => near(w, h)))) continue;
    const score = have.filter(h => !want.includes(h) && h !== p.section && h !== "global").length +
                  (CORE_GROUPS.has(p.group) ? 0 : 1.5);
    if (score < bestScore) { best = [a]; bestScore = score; }
    else if (score === bestScore) best.push(a);
  }
  if (!best.length) return null;
  // "the midi channel for the chords": a global setting named for a section
  if (sections.size === 1 && best.length > 1) {
    const sec = [...sections][0];
    const named = best.filter(a => PARAMS[a].name.toLowerCase().includes(sec));
    if (named.length) best = named;
  }
  return pick(best, sections);
}

// Every setting in a group: "the envelope", "the harp low pass filter", "the vibrato"
function groupAddrs(phrase) {
  let toks = words(phrase.replace(ARTICLES, ""));
  const sections = new Set();
  toks = toks.filter(t => SECTION.has(t) && !/^(?:string|strings|strum)$/.test(t) ? (sections.add(SECTION.get(t)), false) : true);
  const want = toks.map(single).join(" ");
  if (!want) return null;
  const addrs = Object.keys(PARAMS).map(Number).filter(a => settable(a) &&
    words(PARAMS[a].group).map(single).join(" ") === want && (!sections.size || sections.has(PARAMS[a].section)));
  return addrs.length > 1 ? addrs : null;
}

function targetRole(key) {
  for (const [role, list] of Object.entries(D.targets)) {
    if (list.split(",").some(w => w.trim() === key)) return role;
  }
  return null;
}

// One setting, or the chords' and the harp's of the same name together; otherwise a question
function pick(addrs, sections) {
  if (addrs.length === 1) return { addrs };
  // the envelope's attack before the filter's or the vibrato's
  const core = addrs.filter(a => CORE_GROUPS.has(PARAMS[a].group));
  if (core.length && core.length < addrs.length) return pick(core, sections);
  const ps = addrs.map(a => PARAMS[a]);
  const twins = addrs.length === 2 && ps[0].name === ps[1].name && ps[0].group === ps[1].group &&
                new Set(ps.map(p => p.section)).size === 2 && ps.every(p => p.section === "chord" || p.section === "harp");
  if (twins) return { addrs: addrs.slice().sort((x, y) => PARAMS[x].section < PARAMS[y].section ? -1 : 1) };
  return { choices: addrs.slice(0, 8) };
}

// ---- the instructions ----

const UP = "raise|increase|boost|bump up|bump|turn up|bring up|push up|push|crank up|crank|lengthen|extend|up|higher|more|add more|add";
const DOWN = "lower|decrease|reduce|turn down|bring down|cut back|cut|drop|shorten|lessen|dial back|back off|tame|less|down";
const COMPARE_UP = "longer|higher|louder|bigger|faster|wider|stronger|deeper|brighter|more";
const COMPARE_DOWN = "shorter|lower|quieter|softer|smaller|slower|narrower|weaker|shallower|darker|less";
const MUCH = { "a bit": 0.5, "a little": 0.5, "a touch": 0.5, slightly: 0.5, "a tad": 0.5, "a little bit": 0.5,
               "a lot": 2, much: 2, "way": 2, "loads": 2, "heaps": 2, "a ton": 2, "way more": 2, "lots": 2 };
const MUCH_RE = "(a little bit|a little|a bit|a touch|a tad|slightly|a lot|much|way|loads|heaps|a ton|lots)";

class Planner {
  constructor(ctx) {
    this.ctx = ctx;            // {values(key) -> stored array, why(key, addr, reason), currentBank, presetNames}
    this.out = { understood: [], notes: [], unknown: [], questions: [], heardAs: [] };
  }

  say(keys, text) {
    const where = keys.length === 1 && keys[0] === "live" ? "" : scopeName(keys) + ": ";
    this.out.understood.push(where + text);
  }
  note(text) { if (!this.out.notes.includes(text)) this.out.notes.push(text); }

  // Changes in the words' units, through describe.applyChanges, in every place named
  change(keys, changes, reason) {
    const made = [];
    for (const key of keys) {
      const values = this.ctx.values(key);
      const r = describe.applyChanges(values, changes, true);
      for (const n of r.notes) this.note(n);
      for (const [a, , v] of r.made) {
        values[a] = v;
        this.ctx.why(key, a, reason);
      }
      made.push(...r.made);
    }
    return made;
  }

  run(text) {
    const { text: marked, scopes } = markScopes(normalise(text), this.ctx.currentBank);
    this.scopes = scopes;
    for (const sentence of clauses(marked)) {
      // a place goes with the clauses after it, "on bank 2, turn off hover, raise the reverb", and
      // said at the end of a sentence, with all of it: "turn off hover, raise the reverb on bank 2"
      const own = sentence.map(c => this.placesIn(c));
      const firstPlaced = own.findIndex(o => o.to);
      const atEnd = firstPlaced === own.length - 1 && /»\s*$/.test(sentence[firstPlaced]);
      let last = atEnd ? own[firstPlaced].to : null;
      let pendingDescribe = [];
      let lastVerb = null;
      const flush = () => {
        if (!pendingDescribe.length) return;
        const keys = pendingDescribe[0].keys;
        this.describeText(pendingDescribe.map(p => p.text).join(", "), keys);
        pendingDescribe = [];
      };
      sentence.forEach((c, i) => {
        const places = own[i];
        const copying = /^(?:copy|duplicate|clone|transfer|bring|paste|take)\b|\b(?:like|same as|match|copy of)\b/.test(c);
        if (!places.to && places.from && !copying) places.to = places.from;
        const keys = places.to || last || ["live"];
        if (places.to) last = places.to;
        const s = c.replace(/«\d+»/g, " ").replace(/\s+/g, " ").trim().replace(LEAD, "").replace(TAIL, "").trim();
        if (!s && !places.copy) return;
        const done = this.command(s, keys, places, lastVerb);
        if (done) {
          flush();
          lastVerb = done === true ? null : done;
          return;
        }
        lastVerb = null;
        if (pendingDescribe.length && pendingDescribe[0].keys.join() !== keys.join()) flush();
        pendingDescribe.push({ text: s, keys });
      });
      flush();
    }
    return this.out;
  }

  placesIn(c) {
    const marks = [...c.matchAll(/«(\d+)»/g)].map(m => this.scopes[+m[1]]);
    const to = marks.filter(m => !m.from);
    const from = marks.filter(m => m.from);
    return { to: to.length ? [...new Set(to.flatMap(m => m.keys))] : null, from: from.length ? from[0].keys : null,
             copy: marks.length >= 2 || from.length > 0 || (to.length === 1 && to[0].keys.length === 2), marks };
  }

  // A description, as describe.js reads it, over each place's own values
  describeText(text, keys) {
    let said = null;
    for (const key of keys) {
      const values = this.ctx.values(key);
      const r = describe.describePreset(text.replace(/(\d)\s+percent\b/g, "$1%"), values, { first: false, presetNames: this.ctx.presetNames });
      const reasons = {};
      for (const c of r.changes) reasons[c.address] = c.reason;
      const next = r.values;
      for (let a = 2; a < next.length; a++) {
        if (a === 7 || next[a] === values[a] || LOCKED.has(a)) continue;
        values[a] = next[a];
        this.ctx.why(key, a, reasons[a] || (r.base ? `from ${r.base}` : "described"));
      }
      if (!said) said = r;
    }
    if (!said) return;
    if (said.base) this.say(keys, `starting from ${said.base}`);
    for (const u of said.understood) this.say(keys, u);
    for (const n of said.notes) this.note(n);
    for (const w of said.unknown)
      if (!this.out.unknown.includes(w) && !new RegExp(`^${VERB}$`).test(w)) this.out.unknown.push(w);
    for (const h of said.heardAs) this.out.heardAs.push(h);
  }

  // One clause as an instruction. True (or the verb, for a list that carries on in the next
  // clause) when it was one; false to hand it to describe.js.
  command(s, keys, places, lastVerb) {
    if (places.copy && this.copy(s, keys, places)) return true;
    let m;
    // a list that carries on: "turn off the reverb, the delay and the chorus"
    if (lastVerb && !new RegExp(`^${VERB}\\b`).test(s)) {
      const items = this.items(s);
      if (items && items.every(it => it.addrs || it.control)) return this.command(`${lastVerb} ${s}`, keys, places, null);
    }
    // two settings in one: "set the delay length to 300 and the delay mix to 30 percent"
    if ((m = s.match(/^(.+?\s(?:to|at|=)\s.+?)\s+and\s+(.+?\s(?:to|at|=)\s.+)$/)) && !findControl(s)) {
      const lead = m[1].match(new RegExp(`^(${VERB})\\s`));
      const right = lead && !new RegExp(`^${VERB}\\b`).test(m[2]) ? `${lead[1]} ${m[2]}` : m[2];
      if (this.command(m[1], keys, places, null)) {
        if (!this.command(right, keys, places, null)) this.describeText(right, keys);
        return true;
      }
    }
    if (this.control(s, keys)) return true;
    // muting a section: "mute the harp", "unmute the chords"
    if ((m = s.match(/^(mute|silence|unmute)\s+(?:the\s+)?(.+)$/)) && SECTION.has(m[2]) && D.roles.level) {
      const sec = SECTION.get(m[2]);
      const a = D.roles.level[sec];
      if (a != null) {
        const on = m[1] === "unmute";
        this.change(keys, [{ address: a, value: on ? PARAMS[a].default_value : 0, reason: on ? "unmuted" : "muted" }], on ? "unmuted" : "muted");
        this.say(keys, `${nameOf(a)} → ${on ? "default" : "0"}`);
        return true;
      }
    }
    // reset
    if ((m = s.match(/^(?:reset|restore|revert|default)\s+(.+?)(?:\s+(?:to|back to)\s+(?:its\s+|their\s+|the\s+)?(?:defaults?|factory(?:\s+settings?)?|normal|original|stock)(?:\s+(?:values?|settings?))?)?$/)) ||
        (m = s.match(/^(?:put|set|bring|turn|change)\s+(.+?)\s+back(?:\s+to\s+(?:its\s+|their\s+|the\s+)?(?:defaults?|normal|original|factory|stock)(?:\s+(?:values?|settings?))?)?$/)) ||
        (m = s.match(/^(?:set\s+|put\s+|return\s+)?(.+?)\s+(?:back\s+)?to\s+(?:its\s+|their\s+|the\s+)?(?:defaults?|factory\s+settings?|factory)(?:\s+(?:values?|settings?))?$/))) {
      return this.reset(m[1], keys) ? "reset" : false;
    }
    // off and on
    if ((m = s.match(/^(?:turn|switch|shut)\s+off\s+(.+)$/)) || (m = s.match(/^(?:turn|switch|shut)\s+(.+?)\s+off$/)) ||
        (m = s.match(/^(?:disable|deactivate|bypass|kill|get rid of|no more|lose|ditch)\s+(.+)$/)) ||
        (m = s.match(/^(.+?)\s+(?:off|disabled)$/))) {
      return this.onOff(m[1], false, keys) ? "turn off" : false;
    }
    if ((m = s.match(/^(?:turn|switch)\s+on\s+(.+)$/)) || (m = s.match(/^(?:turn|switch)\s+(.+?)\s+on$/)) ||
        (m = s.match(/^(?:enable|activate)\s+(.+)$/)) || (m = s.match(/^(.+?)\s+(?:on|enabled)$/))) {
      return this.onOff(m[1], true, keys) ? "turn on" : false;
    }
    // double and halve
    if ((m = s.match(/^(double|halve|triple)\s+(.+)$/)) || (m = s.match(/^(?:cut|reduce)\s+(.+?)\s+(in half|by half)$/))) {
      const factor = m[1] === "double" ? 2 : m[1] === "triple" ? 3 : 0.5;
      return this.scale(m[1].startsWith("in") || m[1] === "halve" ? m[2] || m[1] : m[2], factor, keys,
                        m[1] === "double" ? "doubled" : m[1] === "triple" ? "tripled" : "halved") ? true : false;
    }
    // up and down, by an amount or by a step
    const up = new RegExp(`^(?:make\\s+)?(${UP}|${DOWN})\\s+(?:the\\s+)?(.+?)(?:\\s+by\\s+(.+?))?(?:\\s+${MUCH_RE})?$`);
    const after = new RegExp(`^(?:turn\\s+|bring\\s+|push\\s+|move\\s+)?(.+?)\\s+(up|down|higher|lower)(?:\\s+by\\s+(.+?))?(?:\\s+${MUCH_RE})?$`);
    const compare = new RegExp(`^(?:make|give|set)\\s+(?:the\\s+)?(.+?)\\s+(?:${MUCH_RE}\\s+)?(${COMPARE_UP}|${COMPARE_DOWN})$`);
    if ((m = s.match(up))) {
      const dir = new RegExp(`^(?:${UP})$`).test(m[1]) ? 1 : -1;
      // "more reverb" and "less delay" are describe.js's, which knows what each effect needs
      if (!m[3] && /^(?:more|less|add|add more)$/.test(m[1])) return false;
      return this.step(m[2], dir, m[3], MUCH[m[4]] || 1, keys) ? true : false;
    }
    if ((m = s.match(compare))) {
      const dir = new RegExp(`^(?:${COMPARE_UP})$`).test(m[3]) ? 1 : -1;
      return this.step(m[1], dir, null, MUCH[m[2]] || 1, keys, true) ? true : false;
    }
    if ((m = s.match(after)) && !/^(?:turn|bring|push|move)$/.test(m[1])) {
      const dir = /^(?:up|higher)$/.test(m[2]) ? 1 : -1;
      return this.step(m[1], dir, m[3], MUCH[m[4]] || 1, keys, true) ? true : false;
    }
    // set
    if ((m = s.match(/^(?:set|make|change|put|adjust|turn|bring|move|give|switch|have)\s+(.+?)\s+(?:to|at|=|into|up to|down to|as)\s+(.+)$/)) ||
        (m = s.match(/^(?:use|choose|pick|select)\s+(.+?)\s+(?:for|as|on)\s+(?:the\s+)?(.+)$/)) && (m = [m[0], m[2], m[1]]) ||
        (m = s.match(/^(.+?)\s+(?:to|at|=|is|should be|equals|of)\s+(.+)$/))) {
      if (this.set(m[1], m[2], keys)) return true;
    }
    // "chord attack 200 ms", "harp waveform triangle", "set reverb 40 percent"
    const bare = s.replace(/^(?:set|make|change|put|adjust)\s+/, "");
    if (bare !== s || /\d/.test(s)) {
      const toks = bare.split(" ");
      for (let k = toks.length - 1; k >= 1; k--) {
        if (this.set(toks.slice(0, k).join(" "), toks.slice(k).join(" "), keys, true)) return true;
      }
    }
    return false;
  }

  // "the reverb, the delay and the chorus": each a setting or a control, or null
  items(phrase) {
    const parts = phrase.split(/\s*(?:,|\band\b|\bplus\b|\bas well as\b)\s*/).filter(Boolean);
    const out = [];
    for (const part of parts) {
      const c = findControl(part);
      if (c && part.replace(c.text, "").trim().replace(ARTICLES, "") === "") { out.push({ control: c }); continue; }
      const r = resolve(part);
      if (!r) return null;
      out.push(r);
    }
    return out;
  }

  // a setting named, or a question when it could be several. Asks once per phrase.
  setting(phrase, keys, clauseFor) {
    const r = resolve(phrase);
    if (!r) return null;
    if (r.choices) {
      this.out.questions.push({ phrase: phrase.trim(), clause: clauseFor, keys,
        choices: r.choices.map(a => ({ addr: a, name: nameOf(a) })) });
      return { asked: true };
    }
    return r;
  }

  set(phrase, valueText, keys, bare) {
    const r = resolve(phrase);
    if (findControl(phrase) && !(r && r.addrs && r.addrs.length === 1)) return false;
    if (!r) return false;
    if (r.choices) {
      if (bare) return false;
      return this.setting(phrase, keys, a => `set @${a} to ${valueText}`) && true;
    }
    const values = this.ctx.values(keys[0]);
    const parsed = r.addrs.map(a => [a, parseValue(valueText, a, values)]);
    if (parsed.some(([, v]) => !v)) return false;
    const bad = parsed.find(([, v]) => v.error);
    if (bad) { this.note(bad[1].error); return true; }
    const changes = parsed.map(([a, v]) => ({ address: a, value: v.value, reason: `set to ${valueText}` }));
    this.change(keys, changes, `set to ${valueText}`);
    const v = this.ctx.values(keys[0]);
    this.say(keys, r.addrs.map(a => `${nameOf(a)} → ${shown(a, v[a] != null ? human(a, v) : 0, v)}`).join(", "));
    return true;
  }

  onOff(phrase, on, keys) {
    const items = this.items(phrase);
    if (!items) return false;
    // "turn on the delay": describe.js knows what an effect needs to be heard
    if (on && items.some(it => it.addrs && it.addrs.some(a => !binary(a)))) return false;
    for (const it of items) {
      if (it.control) {
        if (on) { this.note(`say what ${CONTROL_NAME[it.control.kind]} should control: "${CONTROL_NAME[it.control.kind]} to the reverb"`); continue; }
        this.clearControl(it.control, keys);
        continue;
      }
      if (it.choices) {
        this.out.questions.push({ phrase, clause: a => `turn ${on ? "on" : "off"} @${a}`, keys,
          choices: it.choices.map(a => ({ addr: a, name: nameOf(a) })) });
        continue;
      }
      const changes = it.addrs.map(a => {
        const p = PARAMS[a];
        const v = on ? (String(a) in D.on_value ? D.on_value[String(a)] : p.max_value) : Math.max(p.min_value, 0);
        return { address: a, value: v, reason: on ? "turned on" : "turned off" };
      });
      this.change(keys, changes, on ? "turned on" : "turned off");
      this.say(keys, it.addrs.map(nameOf).join(" and ") + (on ? " on" : " off"));
    }
    return true;
  }

  reset(phrase, keys) {
    if (/^(?:everything|all|all settings|every setting|the whole (?:preset|bank|sound)|the (?:preset|sound|bank)|it all)$/.test(phrase.replace(ARTICLES, ""))) {
      const changes = Object.keys(PARAMS).map(Number).filter(settable)
        .map(a => ({ address: a, value: TARGET_ADDRESSES.has(a) ? 0 : PARAMS[a].default_value, reason: "default" }));
      this.change(keys, changes, "back to its default");
      this.say(keys, "every setting back to its default");
      return true;
    }
    const group = groupAddrs(phrase);
    const items = group ? [{ addrs: group }] : this.items(phrase);
    if (!items) return false;
    for (const it of items) {
      if (it.control) { this.clearControl(it.control, keys); continue; }
      if (it.choices) {
        this.out.questions.push({ phrase, clause: a => `reset @${a}`, keys, choices: it.choices.map(a => ({ addr: a, name: nameOf(a) })) });
        continue;
      }
      this.change(keys, it.addrs.map(a => ({ address: a, value: PARAMS[a].default_value, reason: "default" })), "back to its default");
      this.say(keys, (group ? phrase.replace(ARTICLES, "") : it.addrs.map(nameOf).join(" and ")) + " back to default");
    }
    return true;
  }

  scale(phrase, factor, keys, word) {
    const r = this.setting(phrase, keys, a => `${word === "halved" ? "halve" : word === "doubled" ? "double" : "triple"} @${a}`);
    if (!r) return false;
    if (r.asked) return true;
    for (const key of keys) {
      const v = this.ctx.values(key);
      this.change([key], r.addrs.map(a => {
        const p = unitsOf(a, v);
        const next = Math.max(p.min_value, Math.min(p.max_value, human(a, v) * factor));
        return { address: a, value: p.data_type === "float" ? Math.round(next * 100) / 100 : Math.round(next), reason: word };
      }), word);
    }
    this.say(keys, r.addrs.map(nameOf).join(" and ") + " " + word);
    return true;
  }

  // up or down: by an amount ("by 20", "by 10 percent", "by 2 semitones"), or a step that suits it
  step(phrase, dir, by, much, keys, strict) {
    phrase = phrase.replace(/\s+(?:up|down)$/, "");
    const items = this.items(phrase);
    if (!items || items.some(it => it.control)) return false;
    if (strict && items.some(it => it.choices)) return false;
    for (const it of items) {
      if (it.choices) {
        this.out.questions.push({ phrase, clause: a => `${dir > 0 ? "raise" : "lower"} @${a}${by ? " by " + by : ""}`, keys,
          choices: it.choices.map(a => ({ addr: a, name: nameOf(a) })) });
        continue;
      }
      for (const key of keys) {
        const v = this.ctx.values(key);
        const changes = [];
        for (const a of it.addrs) {
          const p = unitsOf(a, v), cur = human(a, v);
          let next;
          if (by) {
            const pct = by.match(/^(\d*\.?\d+)\s*percent$/);
            if (pct) next = cur + dir * (p.max_value - p.min_value) * parseFloat(pct[1]) / 100;
            else {
              const amount = parseValue(by, a, v);
              if (!amount || amount.error) return false;
              next = cur + dir * amount.value;
            }
          } else if (isSelector(p)) next = cur + dir * Math.max(1, Math.round(much));
          else if (isTime(p)) next = cur ? cur * Math.pow(1.5, dir * much) : (dir > 0 ? p.max_value * 0.05 * much : 0);
          else next = cur + dir * (p.max_value - p.min_value) * 0.1 * much;
          next = Math.max(p.min_value, Math.min(p.max_value, next));
          changes.push({ address: a, value: p.data_type === "float" ? Math.round(next * 100) / 100 : Math.round(next),
                         reason: dir > 0 ? "raised" : "lowered" });
        }
        this.change([key], changes, dir > 0 ? "raised" : "lowered");
      }
      const v = this.ctx.values(keys[0]);
      this.say(keys, it.addrs.map(a => `${nameOf(a)} ${dir > 0 ? "up" : "down"} to ${shown(a, human(a, v), v)}`).join(", ") +
                     (keys.length > 1 ? " in the first; each bank from its own" : ""));
    }
    return true;
  }

  // ---- the knobs, hover and the double tap ----

  controlAddrs(c) {
    if (c.kind === "hover") return [[249, 250]];
    if (c.kind === "tap") return c.slot == null ? TAPS : [TAPS[c.slot]];
    return [KNOBS[c.kind]];
  }

  clearControl(c, keys) {
    const pairs = this.controlAddrs(c);
    this.change(keys, pairs.map(([ca]) => ({ address: ca, value: 0, reason: "does nothing" })), "does nothing");
    const name = c.kind === "tap" && c.slot != null ? `double tap ${c.slot + 1}` : CONTROL_NAME[c.kind];
    this.say(keys, `${name} does nothing`);
  }

  // "assign the mod pot to key signature", "hover controls the filter", "put the reverb on the
  // harp knob", "double tap 2 switches chromatic mode on", "the chord knob does nothing"
  control(s, keys) {
    const c = findControl(s);
    if (!c) return false;
    const before = s.slice(0, c.index).trim();
    const after = s.slice(c.index + c.length).trim();
    let m;
    // clearing
    if ((/^(?:turn off|switch off|disable|unassign|clear|free|reset|remove|disconnect|unmap|deactivate|kill)$/.test(before) && !after) ||
        (!before && /^(?:off|does nothing|do nothing|to nothing|to none|unassigned|disabled|nothing|none|cleared|free)$/.test(after)) ||
        (/^(?:turn|switch)$/.test(before) && after === "off")) {
      this.clearControl(c, keys);
      return true;
    }
    let target = null, valueText = null;
    const verb = "(?:to|onto|on|=|for|at|controls?|moves?|sweeps?|changes?|does|do|is|adjusts?|sets?|switch(?:es)?|toggles?|flips?|opens?|plays?|handles?|runs?|bends?|affects?|modulates?|drives?|works|should\\s+(?:control|move|change|do|be|set|switch|toggle|sweep|adjust))";
    if (/^(?:(?:assign|map|route|link|set|make|have|let|use|give|point|connect|turn|change|put|switch)\s*)?$/.test(before) &&
        (m = after.match(new RegExp(`^(?:so\\s+(?:it|that\\s+it)\\s+)?(?:to\\s+(?:control|move|change|sweep|do|adjust|set)|${verb})\\s+(?:to\\s+|the\\s+|my\\s+)*(.+)$`)))) {
      target = m[1];
    } else if ((m = before.match(/^(?:assign|map|route|link|put|set|give|connect|attach|bind|move)\s+(.+?)\s+(?:to|on|onto|with|for|under)(?:\s+the)?$/)) && !after) {
      target = m[1];
    } else if ((m = before.match(/^(?:use|let)$/)) && (m = after.match(/^(?:for|to\s+(?:control|move|change|sweep))\s+(.+)$/))) {
      target = m[1];
    } else return false;
    // "… to 0", "… toward 5000", "… to max": the value hover goes to, or the double tap sets
    if (c.kind === "hover" || c.kind === "tap") {
      const v = target.match(/^(.+?)\s+(?:to|toward|towards|at|up to|down to)\s+(.+)$/) || target.match(/^(.+?)\s+(on|off)$/);
      if (v && resolve(v[1])) { target = v[1]; valueText = v[2]; }
    }
    target = target.replace(/^(?:turn|switch|toggle|flip)\s+/, "").replace(/\s+(?:on and off|up and down)$/, "");
    if (/^(?:nothing|none|no(?:thing)?\s+at\s+all|off)$/.test(target)) { this.clearControl(c, keys); return true; }
    const r = resolve(target);
    if (!r) return false;
    // describe.js's reading first, when it lands on one of these settings: it knows a sensible
    // sweep, and which section a word like "filter" means here
    if (!valueText && c.kind !== "tap") {
      const probe = describe.interpret(s, this.ctx.values(keys[0]), { first: false, presetNames: [] });
      const ca = this.controlAddrs(c)[0][0];
      const options = r.choices || r.addrs;
      if (probe.changes.some(ch => ch.address === ca && options.includes(Math.round(ch.value)))) {
        this.describeText(s, keys);
        return true;
      }
    }
    if (r.choices) {
      const verbWord = c.kind === "tap" ? `double tap${c.slot != null ? " " + (c.slot + 1) : ""}` : CONTROL_NAME[c.kind];
      this.out.questions.push({ phrase: target, clause: a => `${verbWord} to @${a}${valueText ? " to " + valueText : ""}`, keys,
        choices: r.choices.map(a => ({ addr: a, name: nameOf(a) })) });
      return true;
    }
    if (r.addrs.length > 1) {
      // a control moves one setting: the chords' and the harp's are two
      this.out.questions.push({ phrase: target, keys, clause: a => `${c.kind === "tap" ? "double tap" : CONTROL_NAME[c.kind]} to @${a}${valueText ? " to " + valueText : ""}`,
        choices: r.addrs.map(a => ({ addr: a, name: nameOf(a) })) });
      return true;
    }
    const t = r.addrs[0];
    const p = PARAMS[t];
    const knob = c.kind in KNOBS || c.kind === "hover";
    if (knob && p.controls !== "all") {
      this.note(`${CONTROL_NAME[c.kind]} can't move ${nameOf(t)}${p.controls === "tap" ? "; the double tap can" : ""}`);
      return true;
    }
    if (!knob && p.controls === "none") {
      this.note(`the double tap can't change ${nameOf(t)}`);
      return true;
    }
    for (const key of keys) {
      const v = this.ctx.values(key);
      const pairs = c.kind === "tap" ? [TAPS[c.slot != null ? c.slot : this.freeTap(v)]] : this.controlAddrs(c);
      const [ca, ra] = pairs[0];
      const changes = [{ address: ca, value: t, reason: `${CONTROL_NAME[c.kind]} → ${nameOf(t)}` }];
      if (c.kind in KNOBS) {
        if (!v[ra]) changes.push({ address: ra, value: 100, reason: "the knob's range" });
      } else {
        // what hover reaches with a hand close, or the double tap sets: said, or the far end
        let target = null;
        if (valueText) {
          const parsed = parseValue(valueText, t, v);
          if (parsed && !parsed.error) target = parsed.value;
        }
        if (target == null) {
          const cur = v[t] != null ? (p.data_type === "float" ? v[t] / 100 : v[t]) : p.min_value;
          target = isSelector(p) && p.max_value - p.min_value === 1 ? (cur ? p.min_value : p.max_value)
                 : cur > (p.min_value + p.max_value) / 2 ? p.min_value : p.max_value;
        }
        changes.push({ address: ra, value: target, reason: c.kind === "hover" ? "hover value" : "double tap value" });
      }
      this.change([key], changes, `${CONTROL_NAME[c.kind]} → ${nameOf(t)}`);
    }
    const v = this.ctx.values(keys[0]);
    if (c.kind in KNOBS) this.say(keys, `${CONTROL_NAME[c.kind]} → ${nameOf(t)}`);
    else if (c.kind === "hover") this.say(keys, `hover → ${nameOf(t)}, toward ${shown(250, human(250, v), v)} with a hand close`);
    else {
      const slot = TAPS.findIndex(([ca]) => v[ca] === t);
      this.say(keys, `double tap${slot > 0 ? " " + (slot + 1) : ""} → ${nameOf(t)} to ${shown(TAPS[Math.max(slot, 0)][1], human(TAPS[Math.max(slot, 0)][1], v), v)}, and back`);
    }
    return true;
  }

  // the first double tap slot that is free, or the first
  freeTap(values) {
    const i = TAPS.findIndex(([ca]) => !values[ca]);
    return i < 0 ? 0 : i;
  }

  // ---- copying: "make bank 4 like bank 2", "copy the reverb from bank 1 to banks 3 and 5" ----

  copy(s, keys, places) {
    let from = places.from, to = places.to;
    if (/^(?:swap|exchange|trade|switch)(?:\s+(?:round|around|over|places))?$/.test(s) && to && to.length === 2 && !to.includes("live")) {
      const [x, y] = to.map(k => this.ctx.values(k));
      const addrs = Object.keys(PARAMS).map(Number).filter(a => settable(a) || (a >= RHYTHM_STEPS[0] && a <= RHYTHM_STEPS[1]));
      const xs = x.slice();
      for (const a of addrs) {
        if (x[a] !== y[a]) { x[a] = y[a]; this.ctx.why(to[0], a, `from ${scopeName([to[1]])}`); }
        if (y[a] !== xs[a]) { y[a] = xs[a]; this.ctx.why(to[1], a, `from ${scopeName([to[0]])}`); }
      }
      this.say(to, "swapped");
      this.note("swapping here moves the sounds; to move banks with their names, drag them in reorder and bulk edit");
      return true;
    }
    const m = s.match(/^(?:copy|duplicate|clone|transfer|take|bring over|bring|use|apply|paste)\s*(.*?)\s*(?:over|across|onto|into|to|on)?$/) ||
              s.match(/^(?:make|set|turn)\s*(.*?)\s*(?:like|the same as|same as|match|a copy of|identical to|copy)$/) ||
              s.match(/^(?:make|set)\s*(.*?)\s*(?:match|equal|copy)$/);
    if (!m) return false;
    const marks = places.marks;
    if (!from) {
      // "make bank 4 like bank 2": the bank after like is the one copied
      if (marks.length < 2) return false;
      const [a, b] = marks;
      if (/^(?:make|set|turn)/.test(s)) { to = a.keys; from = b.keys; }
      else { from = a.keys; to = b.keys; }
    }
    if (!to || !from || from.length !== 1) return false;
    to = to.filter(k => k !== from[0]);
    if (!to.length) return false;
    const what = m[1].replace(/\s+(?:settings?|values?)$/, "").replace(ARTICLES, "").trim();
    const src = this.ctx.values(from[0]);
    let addrs;
    if (!what || /^(?:everything|all|it|the sound|sound|the preset|preset|the whole thing|whole bank|the bank|bank|all of it)$/.test(what)) {
      addrs = Object.keys(PARAMS).map(Number).filter(a => settable(a) || (a >= RHYTHM_STEPS[0] && a <= RHYTHM_STEPS[1]));
    } else {
      const group = groupAddrs(what);
      const items = group ? [{ addrs: group }] : this.items(what);
      if (!items || items.some(it => it.choices)) return false;
      addrs = items.flatMap(it => it.control ? this.controlAddrs(it.control).flat() : it.addrs);
    }
    for (const key of to) {
      const v = this.ctx.values(key);
      for (const a of addrs) {
        if (v[a] === src[a]) continue;
        v[a] = src[a];
        this.ctx.why(key, a, `copied from ${scopeName(from)}`);
      }
    }
    this.say(to, `${what && !/^(?:everything|all|it)$/.test(what) ? what : "every setting"} copied from ${scopeName(from)}`);
    return true;
  }
}

function binary(a) {
  const p = PARAMS[a];
  return p.data_type !== "float" && p.max_value - p.min_value === 1;
}

// The places a text names, so the page can read those banks before planning
function placesNamed(text, currentBank) {
  const { scopes } = markScopes(normalise(text), currentBank);
  const keys = new Set(["live"]);
  for (const s of scopes) for (const k of s.keys) keys.add(k);
  return [...keys];
}

// Read a text into changes to the working values: ctx = {values(key) -> stored array, changed
// in place; why(key, addr, reason); currentBank; presetNames}. Returns what was understood,
// what wasn't, notes, and questions: {phrase, keys, clause(addr) -> words, choices: [{addr, name}]}.
function plan(text, ctx) {
  return new Planner(ctx).run(text);
}

const api = { setup, plan, placesNamed, scopeName, nameOf, resolve: (p, s) => resolve(normalise(p), s),
              parseValue: (t, a, v) => parseValue(normalise(t), a, v) };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.commands = api;

})(typeof window !== "undefined" ? window : globalThis);
