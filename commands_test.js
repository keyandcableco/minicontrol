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

const CASES = [
  ["turn off hover", { live: { 249: 0 } }, { before: { live: { 249: 143 } } }],
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
const total = CASES.length + PRESET_CASES.length;
console.log(`${total - failed} of ${total} instructions as expected`);
process.exit(failed ? 1 : 0);
