// node commands_test.js: instructions in words, and the stored values each should change.
// Every place starts at the firmware's defaults; "b1" is bank 2. A row lists address:value
// for each place it changes, and nothing else may change.

const fs = require("fs");
const path = require("path");
const here = f => path.join(__dirname, f);
const describe = require(here("describe.js"));
const data = JSON.parse(fs.readFileSync(here("describe_data.json")));
describe.setData(data, JSON.parse(fs.readFileSync(here("shared_presets.json"))).shared_presets);
const commands = require(here("commands.js"));
const presets = JSON.parse(fs.readFileSync(here("shared_presets.json"))).shared_presets;
const bankNames = ["", "Drone", "", "", "", "", "", "", "", "", "", "Warm"];
commands.setup(data, JSON.parse(fs.readFileSync(here("parameters.json"))));
// the bank sets, as the page hands them over: every instruction is read with them known
const SETS = JSON.parse(fs.readFileSync(here("banksets.json"))).banksets.map(s => {
  const d = JSON.parse(fs.readFileSync(here(s.file)));
  return { id: s.id, title: s.title, firmware: d.firmware_version, banks: d.banks };
});
commands.setSets(SETS);

const CASES = [
  ["turn off hover", { live: { 249: 0 } }, { before: { live: { 249: 143 } } }],
  ["turn on harp drums", { live: { 343: 1 } }],
  ["turn on the harp drums", { live: { 338: 70, 343: 1 } }, { before: { live: { 338: 0 } } }],
  ["assign mod pot to key signature on banks 2 and 4", { b1: { 14: 35 }, b3: { 14: 35 } }],
  ["set reverb to 40%", { live: { 85: 40, 184: 40 } }],
  ["set the chord attack to 200 ms", { live: { 137: 200 } }],
  ["set the harp attack to 5 and the chord release to 2 seconds", { live: { 43: 5, 141: 2000 } }],
  ["set key signature to e flat", { live: { 35: 8 } }],
  ["key signature to e minor", { live: { 35: 1 } }],
  ["chord waveform 1 sawtooth", { live: { 122: 9 } }],
  ["set scalar harp mode to minor pentatonic", { live: { 36: 3 } }],
  ["switch the chord layout to the alternate one", { live: { 39: 1 } }],
  ["set master tuning to 432", { live: { 109: 4320 } }],
  ["just intonation", { live: { 237: 2 } }],
  ["just turn off the reverb", { live: { 85: 0, 184: 0 } }],
  ["bump the tempo up by 10", { live: { 187: 90 } }],
  ["double the chord release", { live: { 141: 2000 } }],
  ["turn on MPE and set the tempo to 120 bpm", { live: { 110: 1, 187: 120 } }],
  ["set the midi channel for the chords to 2", { live: { 106: 2 } }],
  ["double tap 2 switches chromatic mode", { live: { 209: 98 } }],
  ["double tap starts the looper", { live: { 200: 256, 201: 6 } }],
  ["double tap 2 to the looper", { live: { 209: 256, 210: 6 } }],
  ["double tap records chords", { live: { 200: 287, 201: 5 } }],
  ["set chord memory to 1", {}],
  ["turn off chord memory on every bank", {}],
  ["hover to the reverb size toward max", { live: { 249: 24, 250: 100 } }],
  ["the chord knob does nothing", { live: { 10: 0 } }, { before: { live: { 10: 143 } } }],
  ["mute the harp", { live: { 97: 0 } }],
  ["set the bank color to blue", { live: { 20: 225 } }],
  ["on bank 3 set the harp octave to 3", { b2: { 99: 3 } }],
  ["set the chord attack to 50, on banks 5 and 6 set the harp attack to 7", { live: { 137: 50 }, b4: { 43: 7 }, b5: { 43: 7 } }],
  ["set the chord attack to 50, set the harp attack to 7 on bank 9", { b8: { 43: 7, 137: 50 } }],
  ["set the harp attack to 7 on bank 9, set the chord attack to 50", { b8: { 43: 7 }, live: { 137: 50 } }],
  ["on bank 9 set the harp attack to 7, set the chord attack to 50", { b8: { 43: 7, 137: 50 } }],
  ["turn off the reverb on every bank except 2 to 12", { b0: { 85: 0, 184: 0 } }],
  ["remove the double tap from bank 4", { b3: { 200: 0 } }, { before: { b3: { 200: 30 } } }],
  ["make bank 5 like bank 2", { b4: { 137: 99 } }, { before: { b1: { 137: 99 } } }],
  ["copy the envelope from bank 3 to bank 4", { b3: { 137: 99 } }, { before: { b2: { 137: 99, 143: 1000 } } }],
  ["swap banks 2 and 3", { b1: { 137: 99 }, b2: { 137: 10 } }, { before: { b2: { 137: 99 } } }],
  ["reset the harp envelope", { live: { 43: 8 } }, { before: { live: { 43: 300 } } }],
  ["turn off hover on my Drone bank", { b1: { 249: 0 } }, { before: { b1: { 249: 143 } } }],
  ["copy the Drone bank to bank 5", { b4: { 137: 99 } }, { before: { b1: { 137: 99 } } }],
];

// A minishop preset by name: what each should say it understood, and where
const PRESET_CASES = [
  ["load Twin Green", "the Twin Green preset by Ben"],
  ["Twin Green on bank 4", "bank 4: the Twin Green preset by Ben"],
  ["Default Preset 3 on bank 3", "bank 3: the Default Preset 3 by Ben"],
  ["lonely nights on banks 5 and 6", "banks 5 and 6: the Lonely Nights preset by Mark Strange"],
  ["copy Ice Cream to bank 2", "bank 2: the Ice Cream preset by drawn"],
  ["use the Thunder preset", "the Thunder preset by Henry W"],
  ["make it sound like Celestia but with more reverb", "the Celestia preset by Mark Ricketson; both: more reverb"],
];

let failed = 0;
for (const [text, want, opts] of CASES) {
  const base = {}, work = {};
  const ctx = {
    currentBank: 2, presetNames: [], presets, bankNames,
    values: k => {
      if (!work[k]) {
        base[k] = describe.defaultValues();
        for (const [a, v] of Object.entries(((opts || {}).before || {})[k] || {})) base[k][+a] = v;
        work[k] = base[k].slice();
      }
      return work[k];
    },
    why: () => {},
  };
  // the places a case starts from must exist before the words are read, as the page reads banks first
  for (const k of Object.keys((opts || {}).before || {})) ctx.values(k);
  for (const k of commands.placesNamed(text, 2, bankNames)) ctx.values(k);
  const out = commands.plan(text, ctx);
  const got = {};
  for (const k of Object.keys(work)) {
    work[k].forEach((v, a) => {
      if (v !== base[k][a]) (got[k] = got[k] || {})[a] = v;
    });
  }
  const show = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  if (show(got) !== show(want)) {
    failed++;
    console.log(`FAIL "${text}"\n  want ${show(want)}\n  got  ${show(got)}\n  understood: ${out.understood.join("; ")}` +
                (out.questions.length ? `\n  asked about: ${out.questions.map(q => q.phrase).join(", ")}` : ""));
  }
}
for (const [text, want] of PRESET_CASES) {
  const work = {};
  const ctx = { currentBank: 2, presetNames: [], presets, bankNames, why: () => {},
                values: k => (work[k] = work[k] || describe.defaultValues()) };
  const got = commands.plan(text, ctx).understood.join("; ");
  if (got !== want) {
    failed++;
    console.log(`FAIL "${text}"\n  want ${want}\n  got  ${got}`);
  }
}
// the warnings a change brings: [instruction, words its notes must hold ("" none), values before]
const NOTE_CASES = [
  ["turn on drums only", "a chord press makes no sound"],
  ["turn on drums only", "", { 274: 3, 276: 1 }],
  ["turn on voice leading", "the spacing isn't heard", { 38: 1 }],
  ["turn on mpe and drums to midi", "play the drums as that string"],
  ["set knob layer to 1", "the harp knob plays its alternate only"],
  ["set the touch pressure to 1", "only its MIDI goes out"],
  ["set the touch pressure to 1", "", { 252: 50 }],
];
for (const [text, want, before] of NOTE_CASES) {
  const ctx = { currentBank: 2, presetNames: [], presets, bankNames, why: () => {}, work: {},
                values(k) { if (!this.work[k]) { this.work[k] = describe.defaultValues();
                              for (const [a, v] of Object.entries(before || {})) this.work[k][+a] = v; }
                            return this.work[k]; } };
  const notes = commands.plan(text, ctx).notes.join(" // ");
  const ok = want ? notes.includes(want) : !/makes no sound|isn't heard|plays its alternate only|only its MIDI/.test(notes);
  if (!ok) {
    failed++;
    console.log(`FAIL "${text}" ${JSON.stringify(before || {})}\n  want ${want ? "a note with: " + want : "no conflict note"}\n  notes: ${notes}`);
  }
}
// Bank sets by name (the sets banksets.json lists, as the page hands them over): each row, the banks
// the words should fill and the preset each gets, and that nothing else changes
const setName = (id, bank) => SETS.find(s => s.id === id).banks.find(e => e.bank === bank).name;
const SET_CASES = [
  ["load gen3 presets into all 12 banks", [...Array(12).keys()].map(b => [b, "gen3", b])],
  ["load classical", [...Array(12).keys()].map(b => [b, "classical", b])],
  ["swap in the third generation", [...Array(12).keys()].map(b => [b, "gen3", b])],
  ["make a new bankset from bank 1 of Gen2, bank2-5 of Electric piano, banks 6 to 12 of drum and bass",
   [[0, "gen2", 0], ...[1, 2, 3, 4].map(b => [b, "electric-piano", b]), ...[5, 6, 7, 8, 9, 10, 11].map(b => [b, "drum-and-bass", b])]],
  ["load world into banks 7 to 12", [6, 7, 8, 9, 10, 11].map((b, k) => [b, "world", k])],
  ["put bank 4 of classical on bank 2", [[1, "classical", 3]]],
  ["load gen 3 into banks 1 to 6 and bank 7 of world into bank 12", [...[0, 1, 2, 3, 4, 5].map(b => [b, "gen3", b]), [11, "world", 6]]],
  ["Rast on Oud on bank 8", [[7, "gen3", 7]]],
  ["Midnight Raga from World on bank 11", [[10, "world", 9]]],
  ["put Wurli on bank 3", [[2, "electric-piano", 2]]],
  ["turn off hover on bank 2 and load gen2 into bank 5", [[4, "gen2", 0]], ["b1"]],
  // the folk, synth and ambient sets (2026-10-12) and the aliases a player might use for them
  ["load americana into all 12 banks", [...Array(12).keys()].map(b => [b, "folk", b])],
  ["synthesizers into banks 1 to 3", [0, 1, 2].map(b => [b, "synth", b])],
  ["load the ambient set", [...Array(12).keys()].map(b => [b, "ambient", b])],
  ["put Theremin on bank 4", [[3, "synth", 3]]],
  ["put Music Box on bank 9", [[8, "ambient", 8]]],
  ["Blues Harp from folk on bank 7", [[6, "folk", 6]]],
];
for (const [text, want, alsoChanged] of SET_CASES) {
  const work = {};
  const ctx = { currentBank: 2, presetNames: [], presets, bankNames: [], why: () => {},
                values(k) { if (!work[k]) work[k] = describe.defaultValues(); return work[k]; } };
  const read = new Set(commands.placesNamed(text, 2, []));
  const r = commands.plan(text, ctx);
  const problems = [];
  for (const [b, id, src] of want) {
    const name = setName(id, src);
    if (!read.has("b" + b)) problems.push(`bank ${b + 1} isn't read first`);
    if (!r.understood.some(u => u.startsWith(`bank ${b + 1}:`) && u.includes(name))) problems.push(`bank ${b + 1} should be ${name}`);
  }
  const defaults = describe.defaultValues();
  const changed = Object.keys(work).filter(k => work[k].some((v, a) => v !== defaults[a]));
  const expected = new Set([...want.map(([b]) => "b" + b), ...(alsoChanged || [])]);
  for (const k of changed) if (!expected.has(k)) problems.push(`${k} changed`);
  if (problems.length) {
    failed++;
    console.log(`FAIL "${text}"\n  ${problems.join("\n  ")}\n  understood: ${r.understood.join(" | ")}`);
  }
}
// words that name a set but aren't one: a description still
for (const text of ["use the world percussion kit", "make it atmospheric", "electric piano chords"]) {
  const work = {};
  const ctx = { currentBank: 2, presetNames: [], presets, bankNames: [], why: () => {},
                values(k) { if (!work[k]) work[k] = describe.defaultValues(); return work[k]; } };
  commands.plan(text, ctx);
  if (Object.keys(work).some(k => k !== "live")) { failed++; console.log(`FAIL "${text}" filled a bank`); }
}
const total = CASES.length + PRESET_CASES.length + NOTE_CASES.length + SET_CASES.length + 3;
console.log(`${total - failed} of ${total} instructions as expected`);
process.exit(failed ? 1 : 0);
