//-->>DESCRIBE: A PRESET OR A PROFILE FROM A DESCRIPTION IN WORDS
// "warm pad chords, plucky harp spread across the stereo field, the mod knob opens the
// filter, double tap starts the looper" becomes settings, by rules: no model, nothing sent
// anywhere. A port of the minichord repository's firmware/preset_maker/interpret.py, which
// stays the source: its vocabulary, and the firmware's own facts about every setting, come
// from describe_data.json, which `preset_maker.py --export-js describe_data.json` writes.
// Keep the two in step: firmware/preset_maker/parity_test.py, in that repository, checks this
// file against the Python, description by description.
//
// Two boxes use it. On the main page, a description applies to the live settings over USB,
// starting from the preset that is loaded, so "darker" is darker than what is sounding; save
// to a bank to keep it. On the bulk edit sheet, a description stages a profile: the same
// exact values in every bank, nothing relative to a bank's own sound.

(function (root) {
"use strict";

let D = null;              // describe_data.json
let PARAMS = null;         // address -> the firmware's facts about that setting
let SHARED = [];           // shared presets, one of which a description can start from

// ---- Python's arithmetic and formatting, so the two give the same numbers ----

function pyRound(x) {                      // round half to even, as Python's round() does
  const r = Math.round(x);
  if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2);
  return r;
}
// round(x, 2) as Python does it: on the float's exact value, so 0.025 (a hair over) goes up and 0.175
// (a hair under) goes down; only a true tie, an odd number of eighths, goes to even
function round2(x) {
  if (Number.isInteger(x * 8) && !Number.isInteger(x * 4)) return pyRound(x * 100) / 100;
  return parseFloat(x.toFixed(2));
}
function fmtG(v) {                         // Python's {:g}
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(Number(v).toPrecision(6)));
}
function setOf(a) { return new Set(a); }
function intersects(set, list) { return list.some(w => set.has(w)); }

// ---- settings: stored values (what the minichord keeps) and the units words use ----

function isFloat(p) { return p.data_type === "float"; }
function toStored(p, v) { return pyRound(Number(v) * (isFloat(p) ? 100 : 1)); }
function toHuman(p, stored) { return isFloat(p) ? round2(stored / 100) : Math.trunc(stored); }
function storedBounds(p) { return [toStored(p, p.min_value), toStored(p, p.max_value)]; }
function storedDefault(p) { return toStored(p, p.default_value); }

const KNOB_TARGETS = new Set([10, 12, 14, 16, 249]);
const TAP_TARGETS = new Set([200, 209, 211]);
const LOCKED = new Set([0, 1, 2, 3, 4, 5, 6, 7, 241, 242, 243, 244, 256]);
const RESERVED = new Set([382, 383, 510, 511]);
const PARAMETER_SIZE = 512, PAGE_SIZE = 256, VERSION_ADDRESS = 7;

function editable(a) {
  const p = PARAMS[a];
  return p && !LOCKED.has(a) && !RESERVED.has(a) && p.group !== "hidden";
}

function label(a) {
  const p = PARAMS[a];
  return `${p.section} / ${p.group} / ${p.name.trim()}`;
}

function defaultValues() {
  const values = new Array(PARAMETER_SIZE).fill(0);
  for (const a of Object.keys(PARAMS)) values[a] = storedDefault(PARAMS[a]);
  values[2] = values[3] = 50;
  values[4] = values[5] = values[6] = 512;
  values[VERSION_ADDRESS] = D.firmware_version;
  return values;
}

// A share code to 512 stored values, as preset_maker.decode: page 1's defaults for a page-0
// code, and a code older than a setting gets that setting's default where a 0 can't be meant.
function decode(code) {
  let s = code.replace(/\s+/g, "");
  s += "=".repeat((4 - s.length % 4) % 4);
  const fields = atob(s).split(";");
  if (fields.length !== PAGE_SIZE && fields.length !== PARAMETER_SIZE) throw new Error("malformed preset code");
  const values = fields.map(v => (v.trim() ? pyRound(parseFloat(v)) : 0));
  if (values.length === PAGE_SIZE) {
    for (let i = 0; i < PAGE_SIZE; i++) values.push(0);
    for (const a of Object.keys(PARAMS)) if (+a >= PAGE_SIZE) values[a] = storedDefault(PARAMS[a]);
  }
  const version = values[VERSION_ADDRESS];
  if (version > 0 && version < 18 && values[237] === 11) values[237] = 12;
  for (const k of Object.keys(PARAMS)) {
    const a = +k, p = PARAMS[a];
    if (a === VERSION_ADDRESS || (p.introduction_version || 0) <= version) continue;
    if (version === 0) {
      if (values[a] !== 0 || storedDefault(p) === 0) continue;
      if (storedBounds(p)[0] <= 0 && (p.introduction_version || 0) < 20) continue;
    }
    values[a] = storedDefault(p);
  }
  return values;
}

// The changes in the units of the words, checked and turned into stored values, as
// preset_maker.apply_changes. Returns the new values, [address, old, new] for each change
// made, and notes on anything adjusted or refused.
function applyChanges(values, changes, reportAll) {
  values = values.slice();
  const made = [], notes = [];
  const rank = c => (KNOB_TARGETS.has(+c.address) || TAP_TARGETS.has(+c.address) ? 0 : 1);
  const ordered = changes.map((c, i) => [c, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(x => x[0]);
  for (const c of ordered) {
    const a = +c.address;
    if (!editable(a)) {
      notes.push(`address ${a} isn't a setting a preset can change; left as it was`);
      continue;
    }
    const p = PARAMS[a];
    let next;
    if (KNOB_TARGETS.has(a) || TAP_TARGETS.has(a)) {
      const target = pyRound(c.value);
      if (target !== 0) {
        const t = PARAMS[target];
        let ok = (t != null && !LOCKED.has(target) && t.group !== "hidden") || target === 256;
        if (KNOB_TARGETS.has(a)) ok = ok && target !== 256 && t.controls === "all";
        else ok = ok && (target === 256 || t.controls === "all" || t.controls === "tap");
        if (!ok) {
          notes.push(`${label(a)}: ${target} can't be moved by that control; left as it was`);
          continue;
        }
      }
      next = target;
    } else {
      let source = p;
      if (p.follows_target != null) {
        source = PARAMS[values[p.follows_target]] || p;
        if (values[p.follows_target] === 256) source = PARAMS[256];
      }
      next = toStored(source, c.value);
      const [lo, hi] = storedBounds(source);
      if (next < lo || next > hi) {
        const clamped = Math.max(lo, Math.min(hi, next));
        notes.push(`${label(a)}: ${c.value} is outside ${source.min_value}..${source.max_value}; ` +
                   `set to ${toHuman(source, clamped)}`);
        next = clamped;
      }
    }
    if (next !== values[a] || reportAll) {
      made.push([a, values[a], next]);
      values[a] = next;
    }
  }
  return { values, made, notes };
}

// ---- the rules ----

function normalise(text) {
  let t = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/’/g, "'").replace(/&/g, " and ").replace(/\+/g, " plus ");
  t = t.replace(/\b((?:[a-z]\.){2,})/g, m => m.replace(/\./g, ""));   // r.e.m. is rem
  t = t.replace(/\b(mr|mrs|ms|dr|st|jr|vs)\./g, "$1");                    // mr. blue sky
  t = t.replace(/(\d)\s*-\s*bit/g, "$1 bit");
  t = t.replace(/\b([a-g])\s*#/g, "$1 sharp");
  t = t.replace(/(?<=[a-z])-(?=[a-z])/g, " ");
  t = t.replace(/\b(isn|don|doesn|won)'t\b/g, "$1t");
  return t.split("'s ").join(" ").split("'").join("");
}
function tokens(text) { return text.match(/[a-z0-9#=.]+/g) || []; }

// difflib.get_close_matches(word, possibilities, n=1, cutoff): the closest, ties to the
// later in sort order, as heapq.nlargest picks
function matchingTotal(a, b) {
  const b2j = new Map();
  for (let j = 0; j < b.length; j++) {
    if (!b2j.has(b[j])) b2j.set(b[j], []);
    b2j.get(b[j]).push(j);
  }
  function longest(alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  }
  let total = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      total += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return total;
}
function closeMatch(word, possibilities, cutoff) {
  let best = null, bestScore = -1;
  for (const x of possibilities) {
    const score = 2 * matchingTotal(x, word) / (x.length + word.length);
    if (score < cutoff) continue;
    if (score > bestScore || (score === bestScore && x > best)) { best = x; bestScore = score; }
  }
  return best;
}

class Interpreter {
  constructor(presetNames, profile) {
    this.profile = !!profile;
    this.selectors = setOf(D.selectors);
    this.strong = setOf(D.strong); this.weak = setOf(D.weak); this.negate = setOf(D.negate);
    this.more = setOf(D.more); this.actionVerbs = setOf(D.action_verbs); this.stopwords = setOf(D.stopwords);
    this.modifiers = new Set([...this.strong, ...this.weak, ...this.negate, ...this.more]);
    this.phrases = new Map();
    for (const e of D.vocabulary) for (const w of e.words) this.phrases.set(tokens(normalise(w)).join(" "), e);
    this.byLabel = new Map(D.vocabulary.map(e => [e.label, e]));
    this.targets = new Map();
    for (const [role, words] of Object.entries(D.targets))
      for (const w of words.split(",")) this.targets.set(tokens(w.trim()).join(" "), role);
    this.sectionPhrases = new Map();
    for (const [s, ws] of Object.entries(D.section_words)) for (const w of ws) this.sectionPhrases.set(w, s);
    this.multi = new Map(Object.entries(D.multi_targets).map(([k, v]) => [tokens(k).join(" "), v]));
    this.onOff = new Map(Object.entries(D.on_off).filter(([, v]) => v != null).map(([k, v]) => [tokens(k).join(" "), v]));
    this.names = new Map();
    const notIn = setOf(D.not_in_presets);
    for (const k of Object.keys(PARAMS)) {
      const a = +k, p = PARAMS[a];
      if (notIn.has(a) || p.group === "hidden" || (a >= 220 && a <= 235) || p.follows_target != null ||
          [10, 12, 14, 16, 200, 209, 211, 249].includes(a)) continue;
      const name = tokens(normalise(p.name)).join(" ");
      const group = tokens(normalise(p.group)).join(" ");
      const variants = [name, `${group} ${name}`];
      if (p.section !== "global") variants.push(`${p.section} ${name}`, `${p.section}s ${name}`, `${p.section} ${group} ${name}`);
      const wm = /^waveform (\d)$/.exec(name);
      if (wm && p.section === "chord") variants.push(`oscillator ${wm[1]}`, `osc ${wm[1]}`, `chord oscillator ${wm[1]}`);
      for (const v of variants) {
        const key = v.split(" ").filter(Boolean).join(" ");
        if (!this.names.has(key)) this.names.set(key, new Set());
        this.names.get(key).add(a);
      }
    }
    this.presetNames = new Map(presetNames.map(n => [tokens(normalise(n)).join(" "), n]));
    const known = new Set();
    for (const m of [this.phrases, this.targets, this.sectionPhrases])
      for (const k of m.keys()) for (const w of k.split(" ")) known.add(w);
    for (const c of Object.keys(D.colors)) known.add(c);
    for (const w of ["hover", "hovering", "double", "tap", "knob", "knobs", "modifier", "mod", "modulation",
                     "proximity", "twice", "bpm", "hertz", "transpose", "transposed", "minor", "major",
                     "sharp", "flat", "key", "semitones", "octaves"]) known.add(w);
    for (const w of [...this.modifiers, ...this.actionVerbs]) known.add(w);
    for (const m of [this.multi, this.onOff, this.names])
      for (const k of m.keys()) for (const w of k.split(" ")) known.add(w);
    for (const w of ["led", "leds", "attenuate", "attenuation", "distance", "reach", "type", "value", "slot",
                     "control", "edo", "semitone", "potentiometer", "potentiometers", "pots", "pot", "alternate"]) known.add(w);
    known.delete("");
    this.known = known;
    let longest = 0;
    for (const m of [this.phrases, this.targets, this.sectionPhrases, this.multi, this.onOff, this.names])
      for (const k of m.keys()) longest = Math.max(longest, k.split(" ").length);
    this.longest = longest;
    this.controls = D.controls.map(([p, c]) => [new RegExp(p, "g"), c]);
  }

  // ---- state ----

  addr(role, section) {
    const where = D.roles[role];
    if ("global" in where) return where.global;
    return where[section];
  }
  put(a, v, why) {
    const p = PARAMS[a];
    v = Math.max(p.min_value, Math.min(p.max_value, v));
    v = isFloat(p) ? round2(v) : pyRound(v);
    this.state[a] = v;
    this.why[a] = why;
    this.touched.add(a);
  }
  putRaw(a, v, why) {
    this.state[a] = v;
    this.why[a] = why;
    this.touched.add(a);
  }
  exactKind(a) {
    const p = PARAMS[a];
    return !isFloat(p) && (p.max_value - p.min_value) <= 30;
  }
  move(m, section, k, why) {
    const [kind, role, v] = m;
    const a = this.addr(role, section);
    if (a == null || !(a in this.state)) return;
    const cur = this.state[a];
    if (this.profile && ["scale", "min", "max", "ifzero", "add"].includes(kind)) {
      if (!why.startsWith("for the")) this.skipped.add(why);
      return;
    }
    let next;
    if (kind === "exact" || (kind === "set" && (this.exactKind(a) || this.profile))) next = v;
    else if (kind === "set") next = k <= 1 ? cur + (v - cur) * k : v + (v - cur) * (k - 1) * 0.5;
    else if (kind === "scale") next = cur ? cur * Math.pow(v, k) : (v > 1 ? PARAMS[a].max_value * 0.05 : 0);
    else if (kind === "min") next = Math.max(cur, v);
    else if (kind === "max") next = Math.min(cur, v);
    else if (kind === "ifzero") next = cur === 0 ? v : cur;
    else if (kind === "add") next = cur + v;
    else return;
    this.put(a, next, why);
  }
  movesFor(moves, section) {
    if (moves && !Array.isArray(moves)) return moves[section] || [];
    return moves || [];
  }
  sections(section) {
    return ["both", "global", null, undefined].includes(section) ? ["chord", "harp"] : [section];
  }
  apply(entry, section, k, why, moves) {
    moves = moves === undefined ? entry.moves : moves;
    const doneGlobal = new Set();
    for (const s of this.sections(section)) {
      for (const m of this.movesFor(moves, s)) {
        if ("global" in D.roles[m[1]]) {
          if (doneGlobal.has(m[1])) continue;
          doneGlobal.add(m[1]);
        }
        this.move(m, s, k, why);
      }
    }
  }

  // ---- one descriptor ----

  describe(entry, section, strength, negate, more, less, amount) {
    const r = this.result;
    const key = JSON.stringify([entry.label, section, negate, less]);
    if (this.applied.has(key)) return;
    this.applied.add(key);
    if (entry.moves && !Array.isArray(entry.moves) &&
        !this.sections(section).some(s => (entry.moves[s] || []).length)) {
      if (entry.home in entry.moves) {
        r.notes.push(`${entry.label} is for the ${entry.home === "chord" ? "chords" : entry.home}; put it there`);
        section = entry.home;
      }
    }
    const where = { chord: "chords", harp: "harp", both: "both", global: "" }[section] || "";
    const prefix = where && entry.home !== "global" ? `${where}: ` : "";
    if (entry.kind === "quality") {
      if (negate || less) {
        const opp = this.byLabel.get(entry.opposite);
        if (!opp) {
          r.notes.push(`"less ${entry.label}" has no opposite here; left alone`);
          return;
        }
        this.apply(opp, section, 0.5, `less ${entry.label}`);
        r.understood.push(`${prefix}a little ${opp.label} (less ${entry.label})`);
        return;
      }
      const k = { 1: 1.0, 2: 1.6, 0: 0.5 }[strength];
      this.apply(entry, section, k, entry.label);
      r.understood.push(`${prefix}${{ 1: "", 2: "very ", 0: "slightly " }[strength]}${entry.label}`);
    } else if (entry.kind === "effect") {
      if (negate && !less) {
        let off = entry.off;
        if (off == null) {
          off = {};
          for (const s of ["chord", "harp"])
            off[s] = this.movesFor(entry.moves, s).filter(m => m[0] === "set").map(m => ["exact", m[1], 0]);
        }
        this.apply(entry, section, 1, `no ${entry.label}`, off);
        r.understood.push(`${prefix}no ${entry.label}`);
        return;
      }
      if (less) {
        const halves = {};
        for (const s of ["chord", "harp"])
          halves[s] = this.movesFor(entry.moves, s).filter(m => m[0] === "set").map(m => ["scale", m[1], 0.5]);
        this.apply(entry, section, 1, `less ${entry.label}`, halves);
        r.understood.push(`${prefix}less ${entry.label}`);
        return;
      }
      if (amount != null) {   // "reverb at 40%": exactly that much
        const moves = {};
        for (const s of ["chord", "harp"]) {
          moves[s] = [];
          for (const m of this.movesFor(entry.moves, s)) {
            if (m[0] !== "set") { moves[s].push(m); continue; }
            const a = this.addr(m[1], s);
            if (a == null || !(a in this.state)) continue;
            const p = PARAMS[a];
            let v = amount;
            if (isFloat(p) && v > p.max_value && v / 100 <= p.max_value) v /= 100;
            moves[s].push(["exact", m[1], v]);
          }
        }
        this.apply(entry, section, 1, entry.label, moves);
        r.understood.push(`${prefix}${entry.label} at ${fmtG(amount)}`);
        if (entry.note) r.notes.push(entry.note);
        if (entry.hue != null && this.hue == null) this.hue = entry.hue;
        return;
      }
      const k = { 1: 1.0, 2: 1.5, 0: 0.5 }[strength];
      const moves = {};
      for (const s of ["chord", "harp"]) {
        moves[s] = this.movesFor(entry.moves, s).map(m => {
          if (m[0] !== "set") return m;
          const a = this.addr(m[1], s);
          const cur = a != null && a in this.state ? this.state[a] : 0;
          const target = m[2] * k;
          return ["exact", m[1], more && cur >= target * 0.5 ? Math.max(target, cur * 1.5) : target];
        });
      }
      this.apply(entry, section, 1, entry.label, moves);
      const word = more ? "more " : { 1: "", 2: "lots of ", 0: "a touch of " }[strength];
      r.understood.push(`${prefix}${word}${entry.label}`);
      if (entry.note) r.notes.push(entry.note);
    } else if (entry.kind === "song") {
      this.song(entry, section, negate, prefix);
      return;
    } else {
      if (negate) {
        if (entry.off != null) {
          this.apply(entry, section, 1, `no ${entry.label}`, entry.off);
          r.understood.push(`${prefix}no ${entry.label}`);
        } else {
          r.notes.push(`"not ${entry.label}": nothing to undo there; left alone`);
        }
        return;
      }
      this.apply(entry, section, 1, entry.label);
      r.understood.push(`${prefix}${entry.label}`);
      if (entry.note) r.notes.push(entry.note);
      if (entry.base) {
        if (this.profile) r.notes.push(`a profile can't start from a preset, so ${entry.label} was left out`);
        else r.base = entry.base;
      }
    }
    if (entry.hue != null && this.hue == null) this.hue = entry.hue;
  }

  // A song is its recipe: descriptions, in these same words, of its chords and harp, each read with
  // its section held. Named for one section ("an Africa harp"), only that part is played.
  song(entry, section, negate, prefix) {
    const r = this.result;
    if (negate) {
      r.notes.push(`"not ${entry.label}": nothing to undo there; left alone`);
      return;
    }
    if (entry.hue != null && this.hue == null) this.hue = entry.hue;
    const marks = [r.understood.length, r.notes.length, r.unknown.slice()];
    const outer = [this.applied, this.forced, this.pending, this.voidNext, this.lastValue];
    this.applied = new Set(); this.pending = []; this.voidNext = false;
    const used = [];
    for (const [part, forced] of [["both", null], ["chords", "chord"], ["harp", "harp"]]) {
      const text = entry[part];
      if (!text || (forced && (section === "chord" || section === "harp") && forced !== section)) continue;
      this.forced = forced;
      used.push(`${part !== "both" ? part + ": " : ""}${text}`);
      for (const clause of this.clauses(normalise(text))) this.clause(clause);
    }
    for (const w of r.unknown) if (!marks[2].includes(w)) r.problems.push([entry.label, w]);
    r.understood.length = marks[0];
    r.notes.length = marks[1];
    r.unknown = marks[2];
    [this.applied, this.forced, this.pending, this.voidNext, this.lastValue] = outer;
    r.understood.push(`${prefix}${entry.label} (${used.join("; ")})`);
    if (entry.note) r.notes.push(entry.note);
    if (entry.base) {
      if (this.profile) r.notes.push(`a profile can't start from a preset, so ${entry.label} was left out`);
      else r.base = entry.base;
    }
  }

  // ---- one control ----

  assign(control, role, section, words) {
    const r = this.result;
    let index = null;
    if (control.startsWith("tap:")) { index = parseInt(control.slice(4), 10); control = "tap"; }
    const names = D.control_names[control];
    const where = D.roles[role];
    if ("global" in where) section = "global";
    else if (section == null || !(section in where)) {
      if (control === "harp_knob" && "harp" in where) section = "harp";
      else if ("chord" in where) section = "chord";
      else section = Object.keys(where)[0];
    }
    const a = this.addr(role, section);
    const p = PARAMS[a];
    const lbl = this.settingName(a);
    for (const m of D.prepare[role] || []) this.move(m, section, 1, `for the ${names}`);
    if (control in D.knob_addresses) {
      const [ca, ra] = D.knob_addresses[control];
      if (role === "looper" || p.controls !== "all") {
        r.notes.push(`a knob can't move ${lbl}; try the double tap`);
        return;
      }
      this.put(ca, a, `${names} → ${lbl}`);
      if (this.selectors.has(a) || !(role in D.sweep)) {
        this.put(ra, 100, names);
        const choices = p.max_value - p.min_value === 1 ? "on and off" : "through all its choices";
        r.understood.push(`${names} → ${lbl}, ${choices}`);
      } else if (this.profile) {
        this.put(ra, 100, names);
        r.understood.push(`${names} → ${lbl}, from 0 to twice each bank's own setting`);
      } else {
        const sweep = D.sweep[role];
        const [lo, hi] = Array.isArray(sweep) ? sweep : sweep[section];
        this.put(a, (lo + hi) / 2, `centre of the ${names} sweep`);
        this.put(ra, hi + lo ? pyRound((hi - lo) / (hi + lo) * 100) : 100, names);
        r.understood.push(`${names} → ${lbl}, about ${fmtG(lo)} to ${fmtG(hi)}`);
      }
      return;
    }
    const value = this.tapValue(role, a, words);
    if (control === "hover") {
      if (role === "looper" || p.controls !== "all") {
        r.notes.push(`hover can't move ${lbl}; try the double tap`);
        return;
      }
      this.put(249, a, `hover → ${lbl}`);
      this.putRaw(250, value, "hover value");
      this.lastValue = [250, a];
      r.understood.push(`hover → ${lbl}, toward ${fmtG(value)} with a hand 2 cm over the plate`);
      return;
    }
    if (index == null) index = this.nextTap;
    if (index >= D.tap_pairs.length) {
      r.notes.push(`the double tap has only three slots; ${lbl} was left out`);
      return;
    }
    if (this.tapsUsed === 0 && index === 0 && !this.profile && !words.some(w => w === "also" || w === "too")) {
      for (const [c] of D.tap_pairs.slice(1)) if (this.state[c]) this.put(c, 0, "double tap reset");
    }
    const [ca, va] = D.tap_pairs[index];
    this.nextTap = index + 1;
    this.tapsUsed++;
    this.put(ca, a, `double tap → ${lbl}`);
    this.putRaw(va, value, "double tap value");
    this.lastValue = [va, a];
    const slot = index === 0 ? "" : ` (slot ${index + 1})`;
    if (role === "looper") r.understood.push(`double tap${slot} → the looper: record, play, stop, then a new recording`);
    else r.understood.push(`double tap${slot} → ${lbl} to ${fmtG(value)}, and back on the next double tap`);
    if (index > 0 && !this.tapNote) {
      this.tapNote = true;
      r.notes.push("one double tap flips all three of its slots together");
    }
  }

  // A control set to do nothing
  clear(control) {
    const r = this.result;
    if (control.startsWith("tap")) {
      const pairs = control.includes(":") ? [D.tap_pairs[parseInt(control.slice(4), 10)]] : D.tap_pairs;
      for (const [c] of pairs) this.put(c, 0, "double tap cleared");
      r.understood.push(`double tap${control.includes(":") ? " slot " + (parseInt(control.slice(4), 10) + 1) : ""} does nothing`);
    } else if (control === "hover") {
      this.put(249, 0, "hover cleared");
      r.understood.push("hover does nothing");
    } else {
      this.put(D.knob_addresses[control][0], 0, `${D.control_names[control]} cleared`);
      r.understood.push(`${D.control_names[control]} does nothing`);
    }
  }

  settingName(a) {
    const p = PARAMS[a];
    let name = p.name.trim();
    const plain = ["Effects", "General", "Notes", "Oscillator", "Envelope", "Settings", "Potentiometer", "Device",
                   "Buttons", "Voicing", "Key and tuning", "MIDI", "Double tap", "hidden", "Rythm"];
    if (!plain.includes(p.group) && !name.toLowerCase().includes(p.group.toLowerCase().replace(/s+$/, "")))
      name = `${p.group.toLowerCase()} ${name}`;
    if (p.section === "global" || name.toLowerCase().includes(p.section)) return name;
    return `${p.section} ${name}`;
  }

  tapValue(role, a, words) {
    const p = PARAMS[a];
    const cur = this.state[a];
    const down = intersects(new Set(["dark", "darker", "close", "closes", "muffle", "muffles", "muffled", "down",
      "lower", "less", "off", "mute", "mutes", "silence", "silences", "kill", "kills", "cut", "cuts"]), words);
    if (role === "cutoff") {
      const [lo, hi] = D.sweep.cutoff[a === 49 ? "harp" : "chord"];
      if (down) return lo * 2;
      if (intersects(new Set(["bright", "brighter", "open", "opens", "up"]), words)) return hi;
      return cur > (lo + hi) / 2 ? lo * 2 : hi;
    }
    if (role === "level") return down ? 0 : 1.6;
    if (role === "octave") return down ? Math.max(p.min_value, cur - 1) : Math.min(p.max_value, cur + 1);
    if (role in D.tap) return down && role !== "looper" ? 0 : D.tap[role];
    return p.max_value;
  }

  // ---- a whole description ----

  run(text, values, first) {
    this.result = { changes: [], understood: [], unknown: [], notes: [], base: null, heardAs: [], problems: [] };
    this.state = {};
    for (const k of Object.keys(PARAMS)) this.state[k] = toHuman(PARAMS[k], values[k] || 0);
    const start = Object.assign({}, this.state);
    this.why = {};
    this.hue = null;
    this.color = null;
    this.tapsUsed = 0;
    this.nextTap = 0;
    this.tapNote = false;
    this.applied = new Set();
    this.touched = new Set();
    this.skipped = new Set();
    this.pending = [];
    this.voidNext = false;
    this.lastValue = null;
    this.forced = null;
    for (const clause of this.clauses(normalise(text))) this.clause(clause);
    this.result.notes = [...new Set(this.result.notes)];
    const color = this.color != null ? this.color : (this.profile ? null : this.hue);
    if (color != null && this.result.understood.length && (first || this.color != null)) this.put(20, color, "bank color");
    const addrs = this.profile ? [...this.touched] : Object.keys(this.state).filter(a => this.state[a] !== start[a]);
    for (const a of addrs.map(Number).sort((x, y) => x - y))
      this.result.changes.push({ address: a, value: this.state[a], reason: this.why[a] || "" });
    if (this.profile && this.skipped.size)
      this.result.notes.push("left out, since a profile sets the same value in every bank and these depend on each " +
                             "bank's own sound: " + [...this.skipped].sort().join(", "));
    return this.result;
  }

  clauses(text) {
    const parts = text.split(/(?<!\d)\.|\.(?!\d)|[,;:!?\n]+|\bbut\b|\bwhile\b|\bwhereas\b|\bthen\b|\bexcept\b/);
    const out = [];
    const sections = new Set(Object.values(D.section_words).flat());
    for (const part of parts) {
      const toks = tokens(part || "");
      if (!toks.length) continue;
      const pieces = [];
      let cur = [];
      toks.forEach((t, j) => {
        const nxt = toks.slice(j + 1, j + 3);
        const last = cur.length ? cur[cur.length - 1] : null;
        const joined = (last === "on" && nxt[0] === "off") ||
          (last != null && sections.has(last) &&
           ((nxt.length && sections.has(nxt[0])) || (nxt.length >= 2 && nxt[0] === "the" && sections.has(nxt[1]))));
        if ((t === "and" || t === "plus") && cur.length && !joined) {
          pieces.push(cur);
          cur = [];
        } else cur.push(t);
      });
      pieces.push(cur);
      const merged = [pieces[0]];
      for (const piece of pieces.slice(1)) {
        if (this.anchored(piece) && this.anchored(merged[merged.length - 1])) merged.push(piece);
        else merged[merged.length - 1] = merged[merged.length - 1].concat(["and"], piece);
      }
      for (const m of merged) if (m.length) out.push(m);
    }
    return out;
  }

  anchored(toks) {
    const s = toks.join(" ");
    if (this.controls.some(([re]) => { re.lastIndex = 0; return re.test(s); })) return true;
    return toks.some((_, i) => this.find(toks, i, this.sectionPhrases));
  }

  find(toks, i, table) {
    for (let n = Math.min(this.longest, toks.length - i); n > 0; n--) {
      const key = toks.slice(i, i + n).join(" ");
      if (table.has(key)) return [key, n];
    }
    return null;
  }

  clause(toks) {
    const r = this.result;
    const used = new Array(toks.length).fill(false);
    const s = toks.join(" ");
    const offsets = [];
    let pos = 0;
    for (const t of toks) { offsets.push(pos); pos += t.length + 1; }
    const span = m => offsets.map((o, i) => [o, i]).filter(([o]) => m.index <= o && o < m.index + m[0].length).map(([, i]) => i);
    const take = m => { const idx = span(m); for (const i of idx) used[i] = true; return idx; };

    for (const m of s.matchAll(/\b(\d{2,3}) ?(?:bpm|beats per minute)\b/g)) {
      this.put(187, parseInt(m[1], 10), "tempo");
      r.understood.push(`rhythm tempo ${parseInt(m[1], 10)} bpm`);
      take(m);
    }
    for (const m of s.matchAll(/\b(?:a ?= ?)?(4[34]\d)(?:\.0)? ?(?:hz|hertz)\b|\btuned? to (4[34]\d)\b/g)) {
      const hz = parseInt(m[1] || m[2], 10);
      if (hz >= 432 && hz <= 446) {
        this.put(109, hz * 10, "tuning");
        r.understood.push(`tuned to A = ${hz} Hz`);
        take(m);
      }
    }
    for (const m of s.matchAll(/\b(?:key of|in the key of|in)\s+([a-g])(?:\s+(sharp|flat))?(?:\s+(major|minor))\b|\b(?:key of|in the key of)\s+([a-g])(?:\s+(sharp|flat))?\b/g)) {
      const root = m[1] || m[4], acc = m[2] || m[5];
      const key = this.key(root, acc, m[3] === "minor");
      if (key != null) {
        this.put(35, key, "key");
        r.understood.push(`chords spelled for the key of ${root.toUpperCase()}${acc ? " " + acc : ""}${m[3] === "minor" ? " minor" : ""}`);
        take(m);
      }
    }
    const nw = D.number_words;
    for (const m of s.matchAll(new RegExp(`\\btranspose[ds]? (?:up )?(?:by )?(\\d+|${Object.keys(nw).join("|")})(?: semitones?)?`, "g"))) {
      const n = parseInt(nw[m[1]] || m[1], 10);
      this.put(30, n, "transpose");
      r.understood.push(`transposed up ${n} semitones`);
      take(m);
    }
    this.exactSettings(s, take);
    this.values(s, take);
    // a shared preset to start from
    for (let i = 0; i < toks.length; i++) {
      for (const [key, name] of this.presetNames) {
        const kt = key.split(" ");
        if (toks.slice(i, i + kt.length).join(" ") === key && !used.slice(i, i + kt.length).some(Boolean)) {
          const before = toks.slice(Math.max(0, i - 3), i);
          const cue = ["like", "from", "on", "preset", "base", "based", "using"].some(w => before.includes(w));
          if (kt.length >= 2 || cue) {
            r.base = name;
            for (let j = i; j < i + kt.length; j++) used[j] = true;
          }
        }
      }
    }
    // controls
    let found = [];
    let sawAltHover = false;
    const tapNumbers = { 1: 1, one: 1, first: 1, "1st": 1, 2: 2, two: 2, second: 2, "2nd": 2, 3: 3, three: 3, third: 3, "3rd": 3 };
    for (const [re, control] of this.controls) {
      re.lastIndex = 0;
      for (const m of s.matchAll(re)) {
        const idx = span(m);
        if (!idx.length || idx.some(i => used[i])) continue;
        take(m);
        if (control === "alt_hover") {
          const note = "there's only one hover, so an alternate hover can't be set";
          if (!r.notes.includes(note)) r.notes.push(note);
          sawAltHover = true;
        } else if (control === "two_knobs") {
          found.push([idx[0], "chord_knob"], [idx[0] + 0.5, "harp_knob"]);
        } else if (control === "tap_n") {
          const w = m[0].split(/\s+/).find(x => x in tapNumbers);
          found.push([idx[0], `tap:${(w ? tapNumbers[w] : 1) - 1}`]);
        } else found.push([idx[0], control]);
      }
    }
    found.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
    let controls = found.map(f => f[1]);
    let rest = toks.slice();
    while (rest.length && ["and", "also", "then", "so", "maybe"].includes(rest[0])) rest = rest.slice(1);
    const follows = rest.length > 0 && (this.actionVerbs.has(rest[0]) || rest[0] === "to");
    let carried = false;
    if (sawAltHover || (this.voidNext && !controls.length && (follows || this.roles(toks.slice(), used.slice()).length))) {
      this.voidNext = sawAltHover;     // what the hover that doesn't exist would have done is dropped
      return;
    }
    this.voidNext = false;
    if (!controls.length && follows && this.pending.length) { controls = this.pending; carried = true; }
    if (!controls.length) {
      this.switches(toks, used);
      this.namedNumbers(toks, used);
    }
    // sections
    const anchors = [];
    let i = 0;
    while (i < toks.length) {
      const hit = used[i] || this.covered(toks, i) ? null : this.find(toks, i, this.sectionPhrases);
      if (hit && !this.find(toks, i, hit[1] === 1 ? this.phrases : new Map()) &&
          !(controls.length && (this.find(toks, i, this.targets) || this.find(toks, i, this.multi)))) {
        anchors.push([i, this.sectionPhrases.get(hit[0])]);
        for (let j = i; j < i + hit[1]; j++) used[j] = true;
        i += hit[1];
      } else i++;
    }
    if (controls.length) {
      this.assignments(toks, used, controls, anchors, carried);
      this.values(s, take);
      this.leftovers(toks, used, true);
      return;
    }
    this.pending = [];
    // descriptors
    i = 0;
    while (i < toks.length) {
      if (used[i]) { i++; continue; }
      if (toks[i] in D.colors && !this.find(toks, i, this.phrases)) {
        this.color = D.colors[toks[i]];
        r.understood.push(`bank color ${toks[i]}`);
        used[i] = true;
        i++;
        continue;
      }
      const hit = this.find(toks, i, this.phrases);
      if (!hit) { i++; continue; }
      const [key, n] = hit;
      const entry = this.phrases.get(key);
      const window = [];
      for (let j = Math.max(0, i - 3); j < i; j++) if (!used[j]) window.push(toks[j]);
      const strength = intersects(this.strong, window) ? 2 : (intersects(this.weak, window) ? 0 : 1);
      const negate = intersects(this.negate, window) || (i > 0 && toks[i - 1] === "no");
      const less = window.includes("less") || window.includes("fewer");
      const lastWord = key.split(" ").pop();
      const more = intersects(this.more, window) || (lastWord.endsWith("er") && entry.kind === "effect");
      for (let j = Math.max(0, i - 3); j < i; j++) if (this.modifiers.has(toks[j])) used[j] = true;
      let amount = null;
      if (entry.kind === "effect") {
        const fillers = new Set(D.amount_fillers);
        let k = i + n;
        while (k < toks.length && fillers.has(toks[k]) && k < i + n + 3) k++;
        if (k < toks.length && /^\d*\.?\d+$/.test(toks[k]) &&
            !(k + 1 < toks.length && ["edo", "bpm", "hz", "cm", "hertz"].includes(toks[k + 1]))) {
          amount = parseFloat(toks[k]);
          for (let j = i + n; j <= k; j++) used[j] = true;
          if (k + 1 < toks.length && ["percent", "pc"].includes(toks[k + 1])) used[k + 1] = true;
        }
      }
      const section = this.sectionFor(i, anchors, entry);
      this.describe(entry, section, strength, negate, more, less, amount);
      for (let j = i; j < i + n; j++) used[j] = true;
      i += n;
    }
    this.leftovers(toks, used);
  }

  covered(toks, i) {
    for (let j = Math.max(0, i - 3); j < i; j++) {
      const hit = this.find(toks, j, this.phrases);
      if (hit && j + hit[1] > i) return true;
    }
    return false;
  }

  roles(toks, used) {
    const roles = [];
    let i = 0;
    while (i < toks.length) {
      let hit = null;
      if (!used[i]) {
        hit = this.find(toks, i, this.multi);
        if (hit) for (const role of this.multi.get(hit[0])) roles.push([i, role]);
        else {
          hit = this.find(toks, i, this.targets);
          if (hit) roles.push([i, this.targets.get(hit[0])]);
        }
      }
      if (hit) {
        for (let j = i; j < i + hit[1]; j++) used[j] = true;
        i += hit[1];
      } else i++;
    }
    const seen = new Set(), out = [];
    for (const [j, role] of roles) if (!seen.has(role)) { seen.add(role); out.push([j, role]); }
    return out;
  }

  assignments(toks, used, controls, anchors, carried) {
    const roles = this.roles(toks, used);
    const clearWords = new Set(D.clear_words);
    if (!roles.length && toks.some(t => clearWords.has(t))) {
      for (const control of controls) this.clear(control);
      toks.forEach((t, i) => {
        if (clearWords.has(t) || this.actionVerbs.has(t) || ["also", "too", "on"].includes(t)) used[i] = true;
      });
      this.pending = [];
      this.leftovers(toks, used);
      return;
    }
    if (!roles.length) {
      if (!carried) this.pending = controls;
      this.leftovers(toks, used);
      return;
    }
    let pairs;
    if (controls.length === 1 && controls[0].startsWith("tap")) {
      const c = controls[0];
      const start = c.includes(":") ? parseInt(c.slice(4), 10) : null;
      pairs = roles.map((role, k) => [start != null ? `tap:${start + k}` : "tap", role]);
      this.pending = [];
    } else if (controls.length === 1) {
      pairs = [[controls[0], roles[0]]];
      this.pending = [];
    } else {
      pairs = controls.slice(0, roles.length).map((c, k) => [c, roles[k]]);
      this.pending = controls.slice(roles.length);
    }
    for (const [control, [i, role]] of pairs) {
      let section = null;
      if (anchors.length) {
        let best = anchors[0];
        for (const a of anchors) if (Math.abs(a[0] - i) < Math.abs(best[0] - i)) best = a;
        section = best[1];
      }
      this.assign(control, role, section, toks);
    }
    toks.forEach((t, i) => {
      if (this.actionVerbs.has(t) || this.modifiers.has(t) || ["also", "too", "on", "off"].includes(t)) used[i] = true;
    });
    this.leftovers(toks, used);
  }

  exactSettings(s, take) {
    const r = this.result;
    const fill = "(?:\\s+(?:is|set|to|be|at|of|should|as|make|sure|it|now))*";
    const led = new RegExp("\\b(?:attenuat\\w*|dim\\w*)\\s+(?:all\\s+)?(?:of\\s+)?(?:the\\s+)?(?:my\\s+)?leds?\\s+(?:to|at|by)\\s+" +
      "(\\d*\\.?\\d+)|\\bleds?\\s+(attenuation|brightness)?" + fill + "\\s*(?:to|at|of)?\\s*(\\d*\\.?\\d+)" +
      "|\\bled\\s+(attenuation|brightness)" + fill + "\\s+(\\d*\\.?\\d+)", "g");
    for (const m of s.matchAll(led)) {
      let v = parseFloat(m[1] || m[3] || m[5]);
      if (v > 1) v /= 100;
      if (m[0].includes("brightness")) v = 1 - v;
      this.put(32, v, "LED attenuation");
      r.understood.push(`LED attenuation ${fmtG(this.state[32])} (brightness ${Math.round((1 - this.state[32]) * 100)}%)`);
      take(m);
    }
    const reach = new RegExp("\\bhover(?:ing)?\\s+(?:distance|reach|height|range)\\b" + fill + "\\s+(\\d+)(?:\\s*(?:cm|centimet\\w*))?", "g");
    for (const m of s.matchAll(reach)) {
      this.put(251, parseInt(m[1], 10), "hover reach");
      r.understood.push(`hover reach ${this.state[251]} cm`);
      if (parseInt(m[1], 10) !== this.state[251]) r.notes.push(`hover reach goes from 3 to 10 cm; set to ${this.state[251]}`);
      take(m);
    }
    const crunch = new RegExp("\\b(?:(chords?|harp)\\s+)?(?:crunch|distortion)(?:\\s+type)?" + fill + "\\s+(?:type\\s+)?(\\d)(?![\\d.])", "g");
    for (const m of s.matchAll(crunch)) {
      let n = parseInt(m[2], 10);
      if (n > 2) {
        r.notes.push(`crunch has types 0, 1 and 2; took ${n} as the third, 2`);
        n = 2;
      }
      const where = { chord: [186], chords: [186], harp: [87] }[m[1]] || [186, 87];
      for (const a of where) this.put(a, n, "crunch type");
      r.understood.push(`${where.length === 2 ? "chord and harp" : where[0] === 186 ? "chord" : "harp"} crunch type ${n}`);
      take(m);
    }
  }

  values(s, take) {
    const r = this.result;
    const fill = "(?:\\s+(?:is|set|to|be|at|of|should|as|make|sure|it|now))*";
    const re = new RegExp("(?:(?:^|\\band\\s+)(?:also\\s+|then\\s+)?(?:the\\s+)?|\\b(hover|double ?tap)\\s+)value\\b" + fill + "\\s+(\\d*\\.?\\d+)", "g");
    for (const m of s.matchAll(re)) {
      const where = m[1] && m[1].startsWith("hover") ? [250, this.state[249]] : this.lastValue;
      if (!where || !where[1]) continue;
      const [va, ta] = where;
      const t = PARAMS[ta];
      let n = parseFloat(m[2]);
      if (isFloat(t) && n > t.max_value && n / 100 <= t.max_value) n /= 100;
      n = Math.max(t.min_value, Math.min(t.max_value, n));
      this.putRaw(va, n, "value");
      r.understood.push(`${va === 250 ? "hover" : "double tap"} value ${fmtG(n)} (${this.settingName(ta)})`);
      take(m);
    }
  }

  switches(toks, used) {
    let i = 0;
    while (i < toks.length) {
      const hit = used[i] ? null : this.find(toks, i, this.onOff);
      if (!hit) { i++; continue; }
      const [key, n] = hit;
      const after = toks.slice(i + n, i + n + 4), before = toks.slice(Math.max(0, i - 3), i);
      let on;
      if (after.includes("off") || after.includes("disabled") || before.includes("disable") ||
          (before.includes("off") && before.includes("turn"))) on = false;
      else if (after.includes("on") || after.includes("enabled") || before.includes("enable") || before.includes("on")) on = true;
      else { i++; continue; }
      const a = this.onOff.get(key);
      const onValue = String(a) in D.on_value ? D.on_value[String(a)] : 1;
      this.put(a, on ? onValue : 0, this.settingName(a));
      this.result.understood.push(`${this.settingName(a)} ${on ? "on" : "off"}${a === 36 && on ? " (1, major)" : ""}`);
      for (let j = Math.max(0, i - 3); j < Math.min(toks.length, i + n + 4); j++)
        if ((j >= i && j < i + n) || ["on", "off", "enable", "disable", "enabled", "disabled", "turn", "switch"].includes(toks[j])) used[j] = true;
      i += n;
    }
  }

  namedNumbers(toks, used) {
    const fillers = new Set(["is", "set", "to", "be", "at", "of", "should", "as", "make", "sure", "="]);
    let i = 0;
    while (i < toks.length) {
      const hit = used[i] ? null : this.find(toks, i, this.names);
      if (!hit) { i++; continue; }
      const [key, n] = hit;
      let k = i + n;
      while (k < toks.length && fillers.has(toks[k]) && k < i + n + 3) k++;
      let wave = null;
      if (k < toks.length && toks[k] in D.wave_names &&
          [...this.names.get(key)].every(a => PARAMS[a].name.includes("waveform"))) wave = D.wave_names[toks[k]];
      else if (k >= toks.length || !/^\d*\.?\d+$/.test(toks[k]) ||
          (k + 1 < toks.length && ["edo", "bpm", "hz", "cm", "hertz"].includes(toks[k + 1]))) { i++; continue; }
      let addrs = [...this.names.get(key)].sort((x, y) => x - y);
      if (addrs.length > 1) {
        const plain = addrs.filter(a => ["Envelope", "Oscillator", "Effects", "Notes", "General", "Buttons", "Voicing"].includes(PARAMS[a].group));
        if (plain.length && new Set(plain.map(a => PARAMS[a].section)).size === plain.length) addrs = plain;
      }
      if (addrs.length > 1 && !(addrs.length === 2 &&
          new Set(addrs.map(a => PARAMS[a].section)).size === 2 &&
          addrs.every(a => ["chord", "harp"].includes(PARAMS[a].section)) &&
          PARAMS[addrs[0]].name === PARAMS[addrs[1]].name)) {
        this.result.notes.push(`"${key}" could be: ${addrs.map(a => this.settingName(a)).join(", ")}; say which`);
        i += n;
        continue;
      }
      for (const a of addrs) {
        const p = PARAMS[a];
        let v = wave == null ? parseFloat(toks[k]) : wave;
        if (isFloat(p) && v > p.max_value && v / 100 <= p.max_value) v /= 100;
        this.put(a, v, this.settingName(a));
        this.result.understood.push(`${this.settingName(a)} ${fmtG(this.state[a])}`);
        if (!(p.min_value <= v && v <= p.max_value))
          this.result.notes.push(`${this.settingName(a)} goes from ${p.min_value} to ${p.max_value}; set to ${fmtG(this.state[a])}`);
      }
      for (let j = i; j <= k; j++) used[j] = true;
      i = k + 1;
    }
  }

  sectionFor(i, anchors, entry) {
    if (entry.home === "global") return "global";
    if (this.forced) return this.forced;
    let best = null;
    for (const a of anchors) {
      if (Math.abs(a[0] - i) > 4) continue;
      if (!best) { best = a; continue; }
      const d = Math.abs(a[0] - i), bd = Math.abs(best[0] - i);
      if (d < bd || (d === bd && a[0] > i && !(best[0] > i))) best = a;
    }
    return best ? best[1] : entry.home;
  }

  key(root, accidental, minor) {
    let semis = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[root] + ({ sharp: 1, flat: -1 }[accidental] || 0);
    const names = { c: 0, g: 1, d: 2, a: 3, e: 4, b: 5, f: 6, bb: 7, eb: 8, ab: 9, db: 10, gb: 11, "f#": 12, "c#": 13,
                    "g#": 14, "d#": 15, "a#": 16 };
    const bySemis = ["c", "db", "d", "eb", "e", "f", "gb", "g", "ab", "a", "bb", "b"];
    if (minor) return names[bySemis[(((semis + 3) % 12) + 12) % 12]];
    const name = root + ({ sharp: "#", flat: "b" }[accidental] || "");
    if (name in names) return names[name];
    return names[bySemis[((semis % 12) + 12) % 12]];
  }

  leftovers(toks, used, again) {
    if (again) {
      const taken = new Set(toks.filter((_, i) => used[i]));
      this.result.unknown = this.result.unknown.filter(w => !taken.has(w));
      return;
    }
    toks.forEach((t, i) => {
      if (used[i] || this.stopwords.has(t) || this.modifiers.has(t) || /^\d+$/.test(t) || t.length < 3) return;
      if (!this.result.unknown.includes(t)) this.result.unknown.push(t);
    });
  }

  fixSpelling(text) {
    const out = [];
    const known = [...this.known].filter(k => k.length >= 4);
    for (const t of text.match(/[A-Za-z0-9][A-Za-z0-9']*|[^A-Za-z0-9]+/g) || []) {
      const w = t.toLowerCase();
      if (/^[a-z]+$/.test(w) && w.length >= 5 && !this.known.has(w) && !this.stopwords.has(w)) {
        const close = closeMatch(w, known, 0.84);
        if (close) {
          this.heard.push([w, close]);
          out.push(close);
          continue;
        }
      }
      out.push(t);
    }
    return out.join("");
  }
}

function interpret(text, values, opts) {
  opts = opts || {};
  const it = new Interpreter(opts.presetNames || [], opts.profile);
  it.heard = [];
  const fixed = it.fixSpelling(text);
  const result = it.run(fixed, values, opts.first !== false);
  result.heardAs = it.heard;
  return result;
}

// A description over the given stored values: the new values, what changed, and what was understood
function describePreset(text, values, opts) {
  opts = opts || {};
  const presetNames = opts.presetNames || SHARED.map(p => p.name);
  let result = interpret(text, values, { presetNames, first: opts.first });
  let base = values, baseName = null;
  if (result.base) {
    const shared = SHARED.find(p => p.name === result.base);
    if (shared) {
      base = decode(shared.value);
      base[VERSION_ADDRESS] = D.firmware_version;
      baseName = result.base;
      result = interpret(text, base, { presetNames, first: true });
    }
  }
  const applied = applyChanges(base, result.changes);
  return Object.assign(result, { base: baseName, baseValues: baseName ? base : null, values: applied.values,
                                 made: applied.made, notes: result.notes.concat(applied.notes) });
}

// A description as a bulk edit profile: { edits: [{addr, value}] } in stored values
function describeProfile(text) {
  const base = defaultValues();
  const result = interpret(text, base, { profile: true });
  const applied = applyChanges(base, result.changes, true);
  const edits = applied.made.map(([a, , v]) => ({ addr: a, value: v })).filter(e => e.addr >= 2 && !RESERVED.has(e.addr));
  return Object.assign(result, { edits, notes: result.notes.concat(applied.notes) });
}

function setData(data, shared) {
  D = data;
  PARAMS = {};
  for (const [k, p] of Object.entries(data.params)) PARAMS[+k] = p;
  SHARED = shared || [];
}

let loading = null;
function loadDescribeData() {
  if (!loading) {
    loading = Promise.all([
      fetch("describe_data.json").then(r => r.json()),
      fetch("shared_presets.json").then(r => r.json()).then(j => j.shared_presets || []).catch(() => []),
    ]).then(([data, shared]) => { setData(data, shared); return data; });
  }
  return loading;
}

const api = { interpret, describePreset, describeProfile, decode, applyChanges, defaultValues, setData, loadDescribeData,
              label: a => label(a), toHuman: (a, v) => toHuman(PARAMS[a], v), params: () => PARAMS,
              // for checking the speech model from a console: describe.hear(url of a recording)
              hear: async url => (await loadSpeechModel())(url) };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.describe = api;

//-->>the boxes (only in a page)
if (typeof document === "undefined") return;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// What it understood, what it didn't, and anything worth knowing, under a box
function resultLines(container, result, classes) {
  container.textContent = "";
  if (!result) return;
  const add = (text, extra) => container.appendChild(el("p", classes + (extra ? " " + extra : ""), text));
  if (result.understood.length) add("Understood: " + result.understood.join("; ") + ".");
  else if (!(result.questions || []).length) add("Nothing in that matched a word it knows.");
  if (result.heardAs.length) add("Took " + result.heardAs.map(([h, t]) => `"${h}" as "${t}"`).join(", ") + ".");
  if (result.unknown.length) add("Not understood: " + result.unknown.join(", ") + ".", "describe-unknown");
  for (const n of result.notes) add(n.charAt(0).toUpperCase() + n.slice(1) + ".", "describe-note");
}

// ---- speaking a description ----
// Whisper, run in the page by transformers.js: the library and a small English model (about 40 MB)
// download once and the browser keeps them; the speech itself is turned into text here and goes
// nowhere. The minichord is an audio input too, and often the computer's default one, which would
// record the instrument instead of the player: an input named minichord is never picked unless
// chosen in the list.

const VOICE_LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";
const VOICE_MODEL = "onnx-community/whisper-tiny.en";
const MIC_KEY = "minicontrol_describe_mic";

const voice = {
  asr: null, loading: null, progress: null,   // the speech model, and how much of it has arrived
  stream: null, recorder: null, chunks: [],
  who: null,                                  // "preset" or "profile": the box that is listening
  state: "idle",                              // idle, recording, listening
  status: { preset: "", profile: "" },
  mics: [], mic: null,
};

function voiceStatus(who, text) {
  voice.status[who] = text;
  const line = document.querySelector(`[data-describe="${who}"] .describe-voice-status`);
  if (line) line.textContent = text;
}

function loadSpeechModel() {
  if (!voice.loading) {
    const files = {};
    voice.loading = import(VOICE_LIB).then(({ pipeline }) =>
      pipeline("automatic-speech-recognition", VOICE_MODEL, {
        dtype: "q8",
        device: "wasm",
        progress_callback: info => {
          if (info.status !== "progress" || !info.total) return;
          files[info.file] = [info.loaded, info.total];
          const [loaded, total] = Object.values(files).reduce((t, [l, n]) => [t[0] + l, t[1] + n], [0, 0]);
          voice.progress = Math.round(100 * loaded / total);
          if (voice.state === "listening" && voice.who)
            voiceStatus(voice.who, `Loading the speech model, once (about 40 MB): ${voice.progress}%`);
        },
      })).then(asr => { voice.asr = asr; return asr; })
      .catch(e => { voice.loading = null; throw e; });
  }
  return voice.loading;
}

async function listMics() {
  try {
    voice.mics = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
  } catch (e) { voice.mics = []; }
  let saved = null;
  try { saved = localStorage.getItem(MIC_KEY); } catch (e) {}
  if (saved && voice.mics.some(d => d.deviceId === saved)) voice.mic = saved;
  else {
    const named = voice.mics.find(d => d.label && !/minichord/i.test(d.label) &&
                                       d.deviceId !== "default" && d.deviceId !== "communications");
    voice.mic = named ? named.deviceId : null;
  }
}

async function startSpeaking(who) {
  if (voice.state !== "idle") return;
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    voiceStatus(who, "This browser can't record from a microphone.");
    return;
  }
  voice.who = who;
  try {
    if (!voice.mics.some(d => d.label)) {
      // labels only come once a microphone has been allowed
      const first = await navigator.mediaDevices.getUserMedia({ audio: true });
      first.getTracks().forEach(t => t.stop());
      await listMics();
      rerenderVoice();
    }
    const audio = { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true };
    if (voice.mic) audio.deviceId = { exact: voice.mic };
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio });
  } catch (e) {
    voiceStatus(who, "No microphone: " + (e.name === "NotAllowedError" ? "it wasn't allowed." : e.message));
    voice.who = null;
    return;
  }
  voice.chunks = [];
  try {
    voice.recorder = new MediaRecorder(voice.stream);
    voice.recorder.ondataavailable = e => { if (e.data.size) voice.chunks.push(e.data); };
    voice.recorder.start();
  } catch (e) {
    voice.stream.getTracks().forEach(t => t.stop());
    voiceStatus(who, "Couldn't record from that microphone: " + e.message);
    voice.who = null;
    return;
  }
  voice.state = "recording";
  const mic = voice.mics.find(d => d.deviceId === (voice.stream.getAudioTracks()[0].getSettings().deviceId));
  voiceStatus(who, `Recording${mic && mic.label ? " from " + mic.label : ""}… press stop when you're done.`);
  rerenderVoice();
  loadSpeechModel().catch(() => {});   // on its way while you talk
}

async function stopSpeaking() {
  if (voice.state !== "recording") return;
  const who = voice.who;
  voice.state = "listening";
  rerenderVoice();
  await new Promise(resolve => { voice.recorder.onstop = resolve; voice.recorder.stop(); });
  voice.stream.getTracks().forEach(t => t.stop());
  let text = "";
  try {
    const buffer = await new Blob(voice.chunks).arrayBuffer();
    const ctx = new AudioContext({ sampleRate: 16000 });
    const decoded = await ctx.decodeAudioData(buffer);
    ctx.close();
    let samples = decoded.getChannelData(0);
    if (decoded.numberOfChannels > 1) {
      const other = decoded.getChannelData(1);
      samples = samples.map((v, i) => (v + other[i]) / 2);
    }
    if (samples.length < 4000) {
      voiceStatus(who, "That was too short to hear anything.");
    } else {
      voiceStatus(who, voice.asr ? "Listening back…" : `Loading the speech model, once (about 40 MB)${voice.progress != null ? ": " + voice.progress + "%" : "…"}`);
      const asr = await loadSpeechModel();
      voiceStatus(who, "Listening back…");
      const out = await asr(samples);
      text = (out && out.text || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      voiceStatus(who, text ? `Heard it: check the words in the box, then stage.`
                            : "I didn't catch any words.");
    }
  } catch (e) {
    console.warn("[describe] speech", e);
    voiceStatus(who, "The speech model couldn't run here: " + e.message);
  }
  voice.state = "idle";
  voice.who = null;
  if (text) {
    if (who === "preset") presetText = (presetText.trim() ? presetText.trim() + " " : "") + text;
    else profileText = (profileText.trim() ? profileText.trim() + " " : "") + text;
  }
  rerenderVoice(who);
}

// The speak button, the microphone list once there is one, and the status line, for either box
function voiceControls(who, buttonFor) {
  const speak = buttonFor(voice.state === "recording" && voice.who === who ? "stop" :
                          voice.state === "listening" && voice.who === who ? "listening…" : "speak");
  speak.classList.add("always-on", "describe-speak");
  if (voice.state === "recording" && voice.who === who) speak.classList.add("recording");
  speak.disabled = voice.state === "listening" || (voice.state !== "idle" && voice.who !== who);
  speak.title = "say the description: press, talk, then press stop. The speech is turned into text on this computer";
  speak.addEventListener("click", () => (voice.state === "recording" ? stopSpeaking() : startSpeaking(who)));
  const extra = el("div", "describe-voice");
  const status = el("p", "describe-voice-status", voice.status[who]);
  extra.appendChild(status);
  if (voice.mics.some(d => d.label)) {
    const pick = el("select", "describe-mic always-on");
    pick.setAttribute("aria-label", "microphone");
    for (const d of voice.mics) {
      const o = el("option", "", (d.label || "microphone") + (/minichord/i.test(d.label) ? " (the minichord itself)" : ""));
      o.value = d.deviceId;
      if (d.deviceId === voice.mic) o.selected = true;
      pick.appendChild(o);
    }
    pick.addEventListener("change", () => {
      voice.mic = pick.value;
      try { localStorage.setItem(MIC_KEY, pick.value); } catch (e) {}
    });
    extra.appendChild(pick);
  }
  return { speak, extra };
}

function rerenderVoice() {
  const box = document.getElementById("describe-preset");
  if (box) renderPresetDescribe(box);
  if (typeof renderBankSheet === "function" && document.querySelector('[data-describe="profile"]')) renderBankSheet();
}

// ---- instructions for the live sound or any banks, on the main page ----
// Words become staged changes first, never straight changes: each row says where (the live
// sound, or a bank), which setting, what it was and what it would be, and why. Apply sends
// them, writing a bank only when the words named one; "put everything back" restores what
// apply replaced, live and banks alike, for as long as the page stays open. commands.js reads
// the instructions and hands anything else to the description rules above.

let presetText = "", presetResult = null;
let stagePlaces = {};          // "live" or "b<bank>" -> {before, work, why}: what was there, what would be
let putBack = null;            // {live: {addr: value}, banks: {bank: {addr: value}}}, before any apply
let stageBusy = false;
let commandsReady = null;

function liveValues() {
  const values = new Array(PARAMETER_SIZE).fill(0);
  for (const [a, v] of Object.entries(currentValues)) values[+a] = Math.round(v);
  return values;
}

function sendValues(changes) {
  for (const [a, v] of changes) {
    if (!controller.canWrite(a) || !findParameterBySysex(a)) continue;
    controller.sendParameter(a, v);
    currentValues[a] = v;
  }
  controller.sendParameter(0, 0);   // the minichord reports back, and the page follows
}

function readyCommands() {
  if (!commandsReady) {
    commandsReady = Promise.all([loadDescribeData(), loadParameters(), loadBankParams()])
      .then(([data, parameters]) => { root.commands.setup(data, parameters); })
      .catch(e => { commandsReady = null; throw e; });
  }
  return commandsReady;
}

const pause = ms => new Promise(r => setTimeout(r, ms));
const bankOf = key => +key.slice(1);

// The changes staged in one place: [[addr, before, after]], in address order
function stagedRows(key) {
  const place = stagePlaces[key];
  if (!place) return [];
  const rows = [];
  for (let a = 2; a < place.work.length; a++) {
    if (a === VERSION_ADDRESS || place.work[a] === place.before[a]) continue;
    rows.push([a, place.before[a], place.work[a]]);
  }
  return rows;
}
function stagedKeys() {
  return Object.keys(stagePlaces).filter(k => stagedRows(k).length)
    .sort((x, y) => (x === "live" ? -1 : y === "live" ? 1 : bankOf(x) - bankOf(y)));
}

// Read the banks the words name, unless the bulk edit sheet already holds them as they are
async function readBanks(banks) {
  const need = banks.filter(b => !(bankState.read && !bankState.stale && bankState.original && bankState.original[b]));
  const got = {};
  for (const b of banks) if (!need.includes(b)) got[b] = bankState.original[b].slice();
  if (!need.length) return got;
  if (unsavedEdits && !confirm(`Reading ${need.length === 1 ? "bank " + (need[0] + 1) : need.length + " banks"} loads ` +
                               `each one on the minichord.${unsavedNote()}`)) return null;
  const startingBank = controller.active_bank_number;
  bankState.busy = true;
  try {
    for (let n = 0; n < need.length; n++) {
      showProgress(`Reading bank ${need[n] + 1} (${n + 1} of ${need.length})…`);
      const values = await controller.readBank(need[n], 3000, true);
      got[need[n]] = Array.from(values, v => (v == null ? 0 : v));
    }
  } finally {
    await returnToBank(startingBank);
    bankState.busy = false;
    showProgress(null);
  }
  await pause(300);   // the starting bank's report, so the live values are its own again
  // the live sound is the bank as saved now: what was staged for it moves over onto that
  const live = stagePlaces.live;
  if (live) {
    const before = liveValues(), work = before.slice();
    for (const [a, , v] of stagedRows("live")) work[a] = v;
    stagePlaces.live = { before, work, why: live.why };
  }
  return got;
}

async function stageWords(text, box) {
  if (stageBusy || !deviceReady()) return;
  stageBusy = true;
  try {
    await readyCommands();
    presetText = text;
    const keys = root.commands.placesNamed(text, currentBankNumber);
    const banks = keys.filter(k => k !== "live" && !stagePlaces[k]).map(bankOf);
    if (banks.length) {
      const read = await readBanks(banks);
      if (!read) return;
      for (const [b, values] of Object.entries(read)) stagePlaces["b" + b] = { before: values, work: values.slice(), why: {} };
    }
    const ctx = {
      currentBank: currentBankNumber,
      presetNames: SHARED.map(p => p.name),
      values: key => {
        if (!stagePlaces[key]) {
          if (key !== "live") throw new Error(key + " wasn't read");
          const before = liveValues();
          stagePlaces.live = { before, work: before.slice(), why: {} };
        }
        return stagePlaces[key].work;
      },
      why: (key, a, reason) => { stagePlaces[key].why[a] = reason; },
    };
    presetResult = root.commands.plan(text, ctx);
  } catch (e) {
    console.warn("[describe] stage", e);
    showNotification("Couldn't stage that: " + e.message, "error");
  } finally {
    stageBusy = false;
    renderPresetDescribe(box);
  }
}

function unstage(key, a) {
  const place = stagePlaces[key];
  if (!place) return;
  place.work[a] = place.before[a];
}

function clearStage() {
  stagePlaces = {};
  presetResult = null;
}

// What a setting is called and what a value reads as, the way the page shows them
function rowName(a) {
  const p = typeof bankParams !== "undefined" && bankParams && bankParams[a];
  return p ? paramLabel(p) : root.commands.nameOf(a);
}
function rowValue(a, v, work) {
  const p = typeof bankParams !== "undefined" && bankParams && bankParams[a];
  if (!p) return String(v);
  const edits = p.follows_target != null ? [{ addr: p.follows_target, value: work[p.follows_target] }] : [];
  return valueLabel(p, v, edits);
}

function placeName(key) {
  if (key === "live") return `Live sound (bank ${currentBankNumber + 1}, until it's saved)`;
  const b = bankOf(key);
  const names = typeof bankNamesGet === "function" ? bankNamesGet() : [];
  return `Bank ${b + 1}${names[b] ? " · " + names[b] : ""} (written to the bank)`;
}

async function applyStage(box) {
  if (stageBusy || !deviceReady()) return;
  const keys = stagedKeys();
  if (!keys.length) return;
  const writable = key => stagedRows(key).filter(([a]) => controller.canWrite(a));
  const banks = keys.filter(k => k !== "live").map(bankOf);
  if (banks.length && !confirm(`Write ${root.commands.scopeName(banks.map(b => "b" + b))}? Each is loaded, changed and saved. ` +
                               `"Put everything back" undoes it while this page stays open.${keys.includes("live") ? "" : unsavedNote()}`)) return;
  stageBusy = true;
  putBack = putBack || { live: {}, banks: {} };
  let written = 0, sent = 0;
  try {
    if (banks.length) {
      const startingBank = controller.active_bank_number;
      bankState.busy = true;
      try {
        for (let n = 0; n < banks.length; n++) {
          const b = banks[n];
          showProgress(`Writing bank ${b + 1} (${n + 1} of ${banks.length})…`);
          // the bank as it is now, so only the staged settings change in it
          const fresh = Array.from(await controller.readBank(b, 3000, true), v => (v == null ? 0 : v));
          const was = putBack.banks[b] = putBack.banks[b] || {};
          for (const [a, , v] of writable("b" + b)) {
            if (!(a in was)) was[a] = fresh[a];
            fresh[a] = v;
          }
          await writeBank(b, fresh);
          written++;
        }
      } finally {
        await returnToBank(startingBank);
        bankState.busy = false;
        showProgress(null);
        bankCacheStale();
      }
      await pause(300);
    }
    if (keys.includes("live")) {
      const rows = writable("live");
      for (const [a] of rows) if (!(a in putBack.live)) putBack.live[a] = Math.round(currentValues[a] || 0);
      sendValues(rows.map(([a, , v]) => [a, v]));
      if (rows.length) markEdited(true);
      sent = rows.length;
    }
    const parts = [];
    if (sent) parts.push(`${sent} live ${sent === 1 ? "setting" : "settings"} changed: save to a bank to keep ${sent === 1 ? "it" : "them"}`);
    if (written) parts.push(`${written === 1 ? "bank" : "banks"} ${banks.map(b => b + 1).join(", ")} written`);
    showNotification(parts.join("; ") || "Nothing to change", "success");
    clearStage();
  } catch (e) {
    console.warn("[describe] apply", e);
    showNotification("Stopped partway: " + e.message + ". \"Put everything back\" restores what was changed.", "error");
  } finally {
    stageBusy = false;
    renderPresetDescribe(box);
  }
}

async function restoreAll(box) {
  if (stageBusy || !putBack || !deviceReady()) return;
  const banks = Object.keys(putBack.banks).map(Number).sort((x, y) => x - y);
  const live = Object.entries(putBack.live).map(([a, v]) => [+a, v]);
  const what = [];
  if (live.length) what.push(`${live.length} live ${live.length === 1 ? "setting" : "settings"}`);
  if (banks.length) what.push(root.commands.scopeName(banks.map(b => "b" + b)));
  if (!confirm(`Put back everything applied here: ${what.join(" and ")}, as they were before?`)) return;
  stageBusy = true;
  try {
    if (banks.length) {
      const startingBank = controller.active_bank_number;
      bankState.busy = true;
      try {
        for (let n = 0; n < banks.length; n++) {
          const b = banks[n];
          showProgress(`Putting back bank ${b + 1} (${n + 1} of ${banks.length})…`);
          const fresh = Array.from(await controller.readBank(b, 3000, true), v => (v == null ? 0 : v));
          for (const [a, v] of Object.entries(putBack.banks[b])) fresh[+a] = v;
          await writeBank(b, fresh);
          delete putBack.banks[b];
        }
      } finally {
        await returnToBank(startingBank);
        bankState.busy = false;
        showProgress(null);
        bankCacheStale();
      }
      await pause(300);
    }
    if (live.length) {
      sendValues(live);
      markEdited(true);
    }
    putBack = null;
    showNotification("Put back as it was", "success");
  } catch (e) {
    console.warn("[describe] put back", e);
    showNotification("Stopped partway putting back: " + e.message + "; press it again to finish", "error");
  } finally {
    stageBusy = false;
    renderPresetDescribe(box);
  }
}

function renderPresetDescribe(box) {
  if (!box) return;
  box.textContent = "";
  box.dataset.describe = "preset";
  const connected = controller.isConnected();
  const row = el("div", "describe-row");
  const input = el("textarea", "describe-input");
  input.rows = 3;
  input.placeholder = "turn off hover · assign the mod knob to key signature on banks 2 and 4 · set the chord attack to " +
                      "200 ms · warm pad chords, plucky harp · make bank 5 like bank 2…";
  input.setAttribute("aria-label", "describe a sound or say what to change");
  input.value = presetText;
  input.addEventListener("input", () => { presetText = input.value; });
  const button = (text, title, on) => {
    const b = el("button", on ? "active" : "inactive", text);
    b.setAttribute("version", "0.01");
    b.title = title;
    b.disabled = !on;
    return b;
  };
  const go = button("stage", "stage what the words change, to look over before anything is sent (ctrl+enter)", connected && !stageBusy);
  const { speak, extra } = voiceControls("preset", text => el("button", "active", text));
  const buttons = el("div", "describe-buttons");
  buttons.append(go, speak);
  row.append(input, buttons);
  const lines = el("div", "describe-result");
  box.append(row, extra, lines);
  resultLines(lines, presetResult, "describe-line");
  // a word that could name several settings: the player picks
  if (presetResult) {
    for (const q of presetResult.questions) {
      const ask = el("div", "describe-question");
      ask.appendChild(el("span", "describe-line", `"${q.phrase}" could be: `));
      for (const c of q.choices) {
        const pick = el("button", "describe-choice always-on", c.name);
        pick.type = "button";
        pick.addEventListener("click", () => {
          const where = q.keys.length === 1 && q.keys[0] === "live" ? "" : " on " + root.commands.scopeName(q.keys);
          q.choices = [];
          stageWords(q.clause(c.addr) + where, box);
        });
        ask.appendChild(pick);
      }
      if (q.choices.length) lines.appendChild(ask);
    }
  }
  // the staging area
  const keys = stagedKeys();
  if (keys.length) {
    const area = el("div", "describe-stage");
    area.appendChild(el("p", "describe-stage-title", "Staged: nothing is sent until you apply. × takes a row back."));
    for (const key of keys) {
      const place = stagePlaces[key];
      const group = el("div", "describe-place");
      group.appendChild(el("p", "describe-place-name", placeName(key)));
      const table = el("div", "describe-rows");
      for (const [a, before, after] of stagedRows(key)) {
        const line = el("div", "describe-staged" + (controller.canWrite(a) ? "" : " describe-cant"));
        const name = el("span", "describe-setting", rowName(a));
        const why = controller.canWrite(a) ? (place.why[a] || "") : "this firmware can't take it";
        if (why) name.appendChild(el("span", "describe-why", why));
        line.appendChild(name);
        line.appendChild(el("span", "describe-change", `${rowValue(a, before, place.before)} → ${rowValue(a, after, place.work)}`));
        const x = el("button", "describe-unstage always-on", "×");
        x.type = "button";
        x.title = "take this change back";
        x.setAttribute("aria-label", `take back ${rowName(a)}`);
        x.addEventListener("click", () => { unstage(key, a); renderPresetDescribe(box); });
        line.appendChild(x);
        table.appendChild(line);
      }
      group.appendChild(table);
      area.appendChild(group);
    }
    const acts = el("div", "describe-stage-buttons");
    const apply = button("apply", "send the live changes and write the banks named", connected && !stageBusy);
    apply.addEventListener("click", () => applyStage(box));
    const clear = button("clear", "drop everything staged; nothing has been sent", !stageBusy);
    clear.addEventListener("click", () => { clearStage(); renderPresetDescribe(box); });
    acts.append(apply, clear);
    area.appendChild(acts);
    box.appendChild(area);
  }
  if (putBack && (Object.keys(putBack.live).length || Object.keys(putBack.banks).length)) {
    const back = button("put everything back", "restore every setting and bank that apply changed, as it was before", connected && !stageBusy);
    back.classList.add("describe-putback");
    back.addEventListener("click", () => restoreAll(box));
    box.appendChild(back);
  }
  go.addEventListener("click", () => {
    const text = input.value.trim();
    if (text) stageWords(text, box);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go.click(); }
  });
}

// ---- describing a profile, on the bulk edit sheet (banks.js calls this) ----

let profileText = "", profileResult = null;

root.renderBankDescribe = function (container) {
  container.textContent = "";
  container.appendChild(el("p", "bank-note", "Or describe a profile in words, and stage what it sets:"));
  const row = el("div", "describe-row");
  const input = el("textarea", "describe-input");
  input.rows = 3;
  input.placeholder = "the mod knob controls the filter, hover to chord crunch, double tap 1 switches the alternate chord layout, MPE on…";
  input.setAttribute("aria-label", "describe a profile");
  input.value = profileText;
  input.addEventListener("input", () => { profileText = input.value; });
  container.dataset.describe = "profile";
  const go = mkBankBtn("stage", "stage what the description sets, in every bank; take rows back with ×", "primary");
  const { speak, extra } = voiceControls("profile", text => mkBankBtn(text, "", "secondary"));
  const buttons = el("div", "describe-buttons");
  buttons.append(go, speak);
  row.append(input, buttons);
  const lines = el("div", "describe-result");
  container.append(row, extra, lines);
  resultLines(lines, profileResult, "bank-note bank-small");
  go.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) return;
    await loadDescribeData();
    profileText = text;
    profileResult = describeProfile(text);
    if (profileResult.edits.length) {
      const res = stageProfile({ name: "described", edits: profileResult.edits });
      const parts = [`Staged ${res.staged}`];
      if (res.already) parts.push(`${res.already} already so`);
      if (res.unknown) parts.push(`${res.unknown} this firmware or sheet can't set`);
      bankAnnounce(parts.join(", ") + ".");
    } else {
      bankAnnounce("Nothing to stage from that description.");
    }
    renderBankSheet();
  });
};

document.addEventListener("DOMContentLoaded", () => {
  const box = document.getElementById("describe-preset");
  if (box) renderPresetDescribe(box);
  loadDescribeData().catch(e => console.warn("[describe] couldn't load describe_data.json", e));
});

})(typeof window !== "undefined" ? window : globalThis);
