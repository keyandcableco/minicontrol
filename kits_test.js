// node kits_test.js: your own drum kit's plain parts (kits.js and kit-formats/aiff.js), with no page.
//
// The image, the .mckit and the upload's messages are checked against the minichord repository's test
// vectors (firmware/test/kits, written by firmware/generator/user_kit.py): synthetic.json must build
// to synthetic.image, synthetic.mckit and synthetic.frames to the byte, and every broken image must
// fail with the reason expected.json gives. Set KIT_VECTORS to that folder; without it the usual
// checkouts are looked in (~/minichord-kitslot, ~/minichord). Then the replies, the mapping guess on
// lists of file names, the processing of a hit on made-up sounds, and the AIFF reader on AIFF files
// written here (and, where sox is installed, on sox's own).

const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFileSync} = require("child_process");
const kits = require(path.join(__dirname, "kits.js"));

let failures = 0, passes = 0;
function check(ok, what) {
  if (ok) passes++;
  else { failures++; console.log("FAIL " + what); }
}
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
const bytesOf = file => new Uint8Array(fs.readFileSync(file));

// ---- the vectors ----------------------------------------------------------------------------------
function vectorsDir() {
  const tries = [process.env.KIT_VECTORS, path.join(os.homedir(), "minichord-kitslot/firmware/test/kits"),
    path.join(os.homedir(), "minichord/firmware/test/kits")].filter(Boolean);
  return tries.find(d => fs.existsSync(path.join(d, "synthetic.json")));
}

function testVectors() {
  const dir = vectorsDir();
  if (!dir) { console.log("SKIP the test vectors: set KIT_VECTORS to the firmware's test/kits"); return; }
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "synthetic.json"), "utf8"));
  const voices = doc.voices.map(v => {
    if (!v) return null;
    const pcm = Buffer.from(v.samples, "base64");
    const samples = new Int16Array(pcm.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(2 * i);
    return {samples, rate: v.rate, level: v.level, pan: v.pan, choke: v.choke, flags: v.flags, pitch: v.pitch};
  });
  const image = kits.buildImage({base_kit: doc.base_kit, name: doc.name, voices});
  check(equalBytes(image, bytesOf(path.join(dir, "synthetic.image"))), "synthetic.json builds to synthetic.image");
  check(kits.checkImage(image) === 0, "synthetic.image passes its checks");
  const entries = kits.readHeader(image).entries;
  doc.voices.forEach((v, i) => {
    if (v) check(entries[i].offset === v.offset && entries[i].length === v.length, `voice ${i}'s offset and length as synthetic.json has them`);
    else check(entries[i].length === 0, `voice ${i} empty`);
  });
  const mckit = kits.writeMckit(doc.meta, image);
  check(equalBytes(mckit, bytesOf(path.join(dir, "synthetic.mckit"))), "synthetic.json and its meta make synthetic.mckit");
  const back = kits.readMckit(bytesOf(path.join(dir, "synthetic.mckit")));
  check(equalBytes(back.image, image) && back.meta.author === "minichord test", "synthetic.mckit reads back");
  const lines = fs.readFileSync(path.join(dir, "synthetic.frames"), "utf8").trim().split("\n");
  const frames = kits.frames(image).map(kits.hex);
  check(frames.length === lines.length && frames.every((f, i) => f === lines[i]), "the upload's messages are synthetic.frames");
  check(frames.every(f => f.length / 2 <= 269), "no message longer than 269 bytes");
  check(kits.frames(image).every(m => m.slice(1, -1).every(b => b < 0x80)), "every data byte of every message below 0x80");
  check(kits.checkImage(bytesOf(path.join(dir, "small.image"))) === 0, "small.image is valid");
  const expected = JSON.parse(fs.readFileSync(path.join(dir, "broken/expected.json"), "utf8"));
  let wrong = 0;
  for (const [file, reason] of Object.entries(expected)) {
    const got = kits.checkImage(bytesOf(path.join(dir, "broken", file)));
    if (got !== reason) { wrong++; console.log(`  broken/${file}: ${got}, expected ${reason}`); }
  }
  check(wrong === 0 && Object.keys(expected).length >= 40, `all ${Object.keys(expected).length} broken images fail as expected.json says`);
  // an image from the kit editor's own voices (imageVoices) builds back to itself
  const again = kits.buildImage({base_kit: doc.base_kit, name: doc.name, voices: kits.imageVoices(image)});
  check(equalBytes(again, image), "an image read back into voices builds to the same image");
}

// ---- the small parts ------------------------------------------------------------------------------
function testParts() {
  check(kits.crc32(Buffer.from("123456789")) === 0xCBF43926, "crc32 check value");
  check(kits.pack87(new Array(224).fill(0xFF)).length === 256 && kits.pack87(new Array(224).fill(0xFF)).every(b => b === 0x7F), "224 0xFF pack to 256 0x7F");
  const lengths = [0, 1, 6, 7, 8, 13, 14, 15, 223, 224].map(n => kits.pack87(new Array(n).fill(0x80)).length);
  check(lengths.join() === [0, 2, 7, 8, 10, 15, 16, 18, 255, 256].join(), "pack87 lengths");
  check(kits.groups(0x7F, 2).join() === "127,0" && kits.groups(16383, 2).join() === "127,127", "n2");
  check(kits.groups(0xFFFFFFFF, 5).join() === "127,127,127,127,15", "n5 of a CRC");
  let threw = false;
  try { kits.groups(16384, 2); } catch (e) { threw = true; }
  check(threw, "n2 refuses 16384");
  check(kits.infoMessage().length === 7 && kits.abortMessage().length === 7 && kits.commitMessage().length === 7
    && kits.clearMessage().length === 8 && kits.beginMessage(444, 1).length === 14, "message sizes 7, 7, 7, 8 and 14");
  // replies
  const status = Uint8Array.from([0xF0, 0x7D, 0x6B, 0x42, 6, ...kits.groups(448, 3), 0xF7]);
  const s = kits.parseReply(status);
  check(s && s.kind === "status" && s.op === 2 && s.status === 6 && s.next === 448, "a status reply");
  const name = "my kit";
  const info = Uint8Array.from([0xF0, 0x7D, 0x6B, 0x45, 1, 1, 0, ...kits.groups(262144, 3), ...kits.groups(0x601A0000, 5),
    ...kits.groups(66492, 3), ...kits.groups(0x19A640C5, 5), ...kits.groups(224, 2), 4, ...kits.groups(4091, 2),
    ...Array.from(name.padEnd(20, "\0"), c => c.charCodeAt(0)), 0xF7]);
  const i = kits.parseReply(info);
  check(info.length === 49 && i.kind === "info" && i.state === 1 && i.capacity === 262144 && i.data_base === 0x601A0000
    && i.size === 66492 && i.crc === 0x19A640C5 && i.largest === 224 && i.base_kit === 4 && i.filled === 4091 && i.name === name,
  "an INFO reply");
  check(kits.parseReply(Uint8Array.from([0xF0, 0x7D, 0x6C, 2, 0xF7])) === null, "a lock report is not a kit reply");
  check(kits.parseReply(kits.infoMessage()) === null, "a computer's own INFO is not a reply");
  threw = false;
  try { kits.parseReply(Uint8Array.from([0xF0, 0x7D, 0x6B, 0x42, 0, 0, 0xF7])); } catch (e) { threw = true; }
  check(threw, "a short kit reply is malformed");
  // the .mckit's JSON as Python writes it, non-ASCII and all
  const meta = {name: "Kit é", author: "Zoë \"Ü\" \\ 🥁", made: "2026-10-22", licence: "line\nnext\ttab\u007f", sources: ["a.wav", null],
    nested: {b: 1, a: [true, false, null]}};
  const text = kits.pyJson(meta);
  try {
    const py = execFileSync("python3", ["-c", "import json,sys; print(json.dumps(json.loads(sys.stdin.read()), sort_keys=True, separators=(',', ':')), end='')"],
      {input: JSON.stringify(meta)}).toString();
    check(text === py, "the .mckit's JSON is what Python's json.dumps writes");
  } catch (e) {
    console.log("SKIP the JSON check against Python: no python3");
  }
  const m = kits.readMckit(kits.writeMckit(meta, new Uint8Array(0)));
  check(m.meta.author === meta.author && m.image.length === 0, ".mckit round trip with non-ASCII");
  threw = false;
  try { kits.readMckit(Uint8Array.from([0x4D, 0x43, 0x4B, 0x46, 2, 0, 0, 0, 0, 0, 0, 0])); } catch (e) { threw = true; }
  check(threw, "a .mckit of version 2 is refused");
  // an all-empty kit, and the builder's refusals
  const empty = kits.buildImage({base_kit: 1, name: "", voices: new Array(13).fill(null)});
  check(empty.length === 256 && kits.checkImage(empty) === 0, "an all-empty kit is a 256-byte image");
  const refuses = [
    {base_kit: 0, voices: new Array(13).fill(null)},
    {base_kit: 1, voices: new Array(12).fill(null)},
    {base_kit: 1, name: "é", voices: new Array(13).fill(null)},
    {base_kit: 1, name: "123456789012345678901", voices: new Array(13).fill(null)},
    {base_kit: 1, voices: [{samples: [1]}, ...new Array(12).fill(null)]},
    {base_kit: 1, voices: [{samples: [1, 2], pan: 101}, ...new Array(12).fill(null)]},
    {base_kit: 1, voices: [{samples: [1, 2], flags: 1}, ...new Array(12).fill(null)]},
    {base_kit: 1, voices: [{samples: [1, 2], rate: 3999}, ...new Array(12).fill(null)]},
    {base_kit: 1, voices: [{samples: [40000, 2]}, ...new Array(12).fill(null)]},
  ];
  check(refuses.every(k => { try { kits.buildImage(k); return false; } catch (e) { return true; } }), "the builder refuses kits out of the rules");
  threw = false;
  try { kits.buildImage({base_kit: 1, voices: [{samples: new Int16Array(200)}, ...new Array(12).fill(null)]}, 100); } catch (e) { threw = true; }
  check(threw, "the builder refuses a sound past the capacity");
  check(kits.cleanName("Café  Drums") === "Cafe Drums", "a name cleaned to ASCII");
  check(/^[\x20-\x7E]{0,20}$/.test(kits.cleanName("Café  Drums — 2024 edition!!")), "a cleaned name is printable ASCII, 20 at most");
  check(kits.trimmedLevel(0) === 160 && kits.trimmedLevel(-6) === 80 && kits.trimmedLevel(12) === 255 && kits.trimmedLevel(-12) === 40, "level trims");
  const kinds = {"a/kick.wav": "sound", "x.AIFF": "aiff", "k.mckit": "mckit", "LICENSE.txt": "licence", "README.md": "readme",
    "kit.zip": "later", "set.sf2": "later", "kit.sfz": "later", "drumkit.xml": "later", "__MACOSX/._kick.wav": "skip",
    ".DS_Store": "skip", "notes.pdf": "other", "pack/Licence": "licence"};
  for (const [p, k] of Object.entries(kinds)) check(kits.fileKind(p) === k, `${p} is ${k} (got ${kits.fileKind(p)})`);
}

// ---- the mapping guess ------------------------------------------------------------------------------
const V = Object.fromEntries(kits.VOICE_NAMES.map((n, i) => [n, i]));
function mapped(paths) {
  const m = kits.mapKit(paths);
  const out = {};
  m.assign.forEach((a, v) => { if (a) out[kits.VOICE_NAMES[v]] = [paths[a.file], a.tag]; });
  return {out, m};
}
function testMapper() {
  let r = mapped(["Kick 01.wav", "Snare 01.wav", "HiHat Closed.wav", "HiHat Open.wav", "Crash.wav", "Ride.wav", "Tom Low.wav",
    "Tom Hi.wav", "Clap.wav", "Rimshot.wav", "Cowbell.wav", "Shaker.wav", "Conga Low.wav", "Conga High.wav"]).out;
  check(r.kick[0] === "Kick 01.wav" && r.kick[1] === "from the name kick", "kick by name");
  check(r.hat[0] === "HiHat Closed.wav" && r["open hat"][0] === "HiHat Open.wav", "open wins over hat");
  check(r.cymbal[0] === "Crash.wav", "crash wins over ride");
  check(r["low tom"][0] === "Tom Low.wav" && r["high tom"][0] === "Tom Hi.wav", "toms by side");
  check(r["low conga"][0] === "Conga Low.wav" && r["high conga"][0] === "Conga High.wav", "congas by side");
  check(r.rim[0] === "Rimshot.wav" && r.clap[0] === "Clap.wav" && r.bell[0] === "Cowbell.wav" && r.shaker[0] === "Shaker.wav", "rim, clap, bell, shaker");
  let m = mapped(["Kick 01.wav", "Ride.wav", "Crash.wav"]).m;
  check(m.unused.length === 1 && m.unused[0] === 1, "the ride left in the bin");
  check(m.candidates[V.cymbal].map(c => c.file).join() === "2,1", "the cymbal's candidates, crash first");
  // GM numbers and note names
  r = mapped(["36.wav", "38.wav", "42.wav", "46.wav", "35.wav"]).out;
  check(r.kick[0] === "36.wav" && r.kick[1] === "GM 36" && r.snare[0] === "38.wav" && r.hat[0] === "42.wav" && r["open hat"][0] === "46.wav", "GM numbers, best first");
  r = mapped(["Kick C1.wav", "Snare D1.wav", "Hat F#1.wav", "Crash Bb1.wav"]).out;
  check(r.kick?.[1] === "GM 36" && r.snare?.[1] === "GM 38" && r.hat?.[1] === "GM 42", `note names agreeing with a drum word (C1 = 36) (${JSON.stringify(r)})`);
  check(r.cymbal?.[1] === "from the name crash", "GM 58 (Bb1) is no voice's: the crash by its word");
  // a note name alone is a pitch, never a GM note
  ({out: r, m} = mapped(["C1.wav", "D1.wav", "F#1.wav", "Bb1.wav"]));
  check(Object.keys(r).length === 0 && m.unused.length === 4, `note names with no drum word map to nothing (${JSON.stringify(r)})`);
  r = mapped(["Kick 808 01.wav", "snare 40.wav", "kick_36.wav"]).out;
  check(r.kick[0] === "kick_36.wav" && r.kick[1] === "GM 36", "a GM number before a name");
  check(r.snare[0] === "snare 40.wav" && r.snare[1] === "GM 40", "a lone number in range");
  check(kits.gmOf("Kick 808 01.wav") === null && kits.gmOf("kick 01.wav") === null && kits.gmOf("tom_v2_45.wav") === 45, "lone GM numbers only, layers left out");
  // a number stuck to letters is no GM note: a sample rate, a decade
  check(kits.gmOf("Kick_44k.wav") === null && kits.gmOf("Snare_48k.wav") === null && kits.gmOf("70s Kick.wav") === null
    && kits.gmOf("Hat_44k 42.wav") === 42, "44k, 48k and 70s aren't GM numbers; a number on its own beside them is");
  // a drum word in the file's own name beats a GM number or note name that points at another voice
  for (const [file, voice] of [["Kick_44k.wav", "kick"], ["Snare_48k.wav", "snare"], ["70s Kick.wav", "kick"], ["Kick F#1.wav", "kick"],
    ["Kick (A1).wav", "kick"], ["Snare D2.wav", "snare"], ["Tom Low 50.wav", "low tom"]]) {
    r = mapped([file]).out;
    check(r[voice]?.[0] === file && /^from the name/.test(r[voice][1]) && Object.keys(r).length === 1, `${file} is the ${voice}, by its word`);
  }
  // and a GM note that agrees with the word, or a path with no word, still counts
  r = mapped(["Kick 36.wav", "Tom 45.wav", "Snare 40.wav", "42.wav", "Misc/46.wav"]).out;
  check(r.kick?.[1] === "GM 36" && r["low tom"]?.[1] === "GM 45" && r.snare?.[1] === "GM 40" && r.hat?.[1] === "GM 42"
    && r["open hat"]?.[0] === "Misc/46.wav", "a GM note agreeing with the word, or with no word in the path, counts");
  // a drum word in a folder beats a GM number in the file's name that points at another voice
  r = mapped(["Kicks/46.wav"]).out;
  check(r.kick?.[0] === "Kicks/46.wav" && /^from the name/.test(r.kick[1]) && !r["open hat"], "Kicks/46.wav is a kick, by its folder");
  const folders = ["Hats/36.wav", "Hats/38.wav", "Hats/42.wav", "Kicks/36.wav", "Kicks/38.wav", "Snares/36.wav", "Snares/38.wav"];
  r = mapped(folders).out;
  check(r.kick?.[0].startsWith("Kicks/") && r.snare?.[0].startsWith("Snares/") && r.hat?.[0].startsWith("Hats/")
    && r.kick[0] === "Kicks/36.wav" && r.kick[1] === "GM 36" && r.snare[0] === "Snares/38.wav" && r.snare[1] === "GM 38"
    && r.hat[0] === "Hats/42.wav" && r.hat[1] === "GM 42" && Object.keys(r).length === 3,
    `GM numbers under drum folders: a kick from Kicks/, a snare from Snares/, a hat from Hats/ (${JSON.stringify(r)})`);
  // layers
  m = mapped(["Kick_v1.wav", "Kick_v2.wav", "Kick_v3.wav", "Snare soft.wav", "Snare hard.wav", "hat rr1.wav", "hat rr2.wav"]).m;
  check(m.assign[V.kick].file === 0 && m.alternates[0].join() === "1,2", "layers v1-v3: the first used, the rest alternates");
  check(m.assign[V.snare].file === 3 && m.alternates[3].join() === "4", "soft and hard layers");
  check(m.assign[V.hat].file === 5 && m.alternates[5].join() === "6", "round robins");
  // toms with no side
  r = mapped(["tom 1.wav", "tom 2.wav", "tom 3.wav"]).out;
  check(r["low tom"][0] === "tom 3.wav" && r["high tom"][0] === "tom 1.wav" && r["low tom"][1] === "guessed",
    "numbered toms guessed as drum kits number them: the highest number low, tom 1 high");
  r = mapped(["Big Tom.wav", "Small Tom.wav"].reverse()).out;
  check(r["low tom"][0] === "Big Tom.wav" && r["high tom"][0] === "Small Tom.wav", "toms ordered by a word before file order");
  r = mapped(["tom.wav", "tom low.wav"]).out;
  check(r["low tom"][0] === "tom low.wav" && r["high tom"][0] === "tom.wav", "a side named fills first, the other guessed");
  r = mapped(["bongo 1.wav", "bongo 2.wav"]).out;
  check(r["low conga"][0] === "bongo 1.wav" && r["high conga"][0] === "bongo 2.wav", "two bongos as the congas");
  // folders, camelCase, whole tokens
  r = mapped(["Kicks/01.wav", "Snares/01.wav", "Hats/closed.wav", "Hats/open.wav", "Toms/low.wav", "Toms/hi.wav"]).out;
  check(r.kick?.[0] === "Kicks/01.wav" && r.snare?.[0] === "Snares/01.wav" && r.hat?.[0] === "Hats/closed.wav" && r["open hat"]?.[0] === "Hats/open.wav"
    && r["low tom"]?.[0] === "Toms/low.wav" && r["high tom"]?.[0] === "Toms/hi.wav", "folder names count");
  // a side word in a folder's name doesn't count for a family word in the file's own name
  for (const folder of ["LoFi Kit", "Hi-Fi Kit", "Low End", "Floor Sessions"]) {
    r = mapped([`${folder}/Tom 1.wav`, `${folder}/Tom 2.wav`, `${folder}/Conga 1.wav`, `${folder}/Conga 2.wav`]).out;
    check(r["low tom"]?.[0] === `${folder}/Tom 2.wav` && r["high tom"]?.[0] === `${folder}/Tom 1.wav`
      && r["low conga"]?.[0] === `${folder}/Conga 1.wav` && r["high conga"]?.[0] === `${folder}/Conga 2.wav`
      && r["low tom"][1] === "guessed", `${folder}/: the toms and congas guessed low and high, not all on one side`);
  }
  // a family word in a folder: its side from the file's name or that folder, not a folder above it
  r = mapped(["LoFi Kit/Toms/1.wav", "LoFi Kit/Toms/2.wav", "LoFi Kit/Toms/hi.wav"]).out;
  check(r["high tom"]?.[0] === "LoFi Kit/Toms/hi.wav" && r["low tom"]?.[0] === "LoFi Kit/Toms/2.wav", "LoFi Kit/Toms/: hi.wav high, the highest number low");
  r = mapped(["Big Room/Small Tom.wav", "Big Room/Tom 1.wav"]).out;
  check(r["low tom"]?.[0] === "Big Room/Tom 1.wav" && r["high tom"]?.[0] === "Big Room/Small Tom.wav", "a size word in a folder doesn't count either");
  r = mapped(["BassDrum.wav", "SideStick.wav", "OpenHat.wav", "closedHH.wav", "HandClap.wav"]).out;
  check(r.kick?.[0] === "BassDrum.wav" && r.rim?.[0] === "SideStick.wav" && r["open hat"]?.[0] === "OpenHat.wav" && r.hat?.[0] === "closedHH.wav"
    && r.clap?.[0] === "HandClap.wav", "camelCase");
  r = mapped(["bass drum.wav", "side stick.wav", "Kickback.wav", "hatch.wav"]).out;
  check(r.kick?.[0] === "bass drum.wav" && r.rim?.[0] === "side stick.wav", "two-word names");
  check(Object.keys(r).length === 2, "kickback and hatch are not a kick or a hat");
  r = mapped(["SD_snare_rim.wav", "Conga Open.wav", "Tambourine.wav", "Agogo.wav", "China.wav", "Snare Rimshot 2.wav"]).out;
  check(r.rim?.[0] === "SD_snare_rim.wav" && r["low conga"]?.[0] === "Conga Open.wav" && r.shaker?.[0] === "Tambourine.wav" && r.bell?.[0] === "Agogo.wav"
    && r.cymbal?.[0] === "China.wav", "a snare's rim is the rim, an open conga a conga");
  m = mapped(["Conga Open.wav"]).m;
  check(m.assign[V["low conga"]]?.tag === "guessed", "a conga with no side guessed low");

  // a lone GM note in a path with no drum word comes after the name words: it fills only what they leave
  const perc = ["Kicks/Kick 01.wav", "Snares/Snare 01.wav", "Hats/Hat 01.wav", ...Array.from({length: 31}, (_, i) => `Percussion/Perc ${30 + i}.wav`)];
  r = mapped(perc).out;
  check(r.kick?.[0] === "Kicks/Kick 01.wav" && r.snare?.[0] === "Snares/Snare 01.wav" && r.hat?.[0] === "Hats/Hat 01.wav"
    && /^from the name/.test(r.kick[1]) && /^from the name/.test(r.snare[1]) && /^from the name/.test(r.hat[1]),
    `Kicks/Kick 01, Snares/Snare 01, Hats/Hat 01 beat Percussion/Perc 36, 38, 42 (${r.kick?.[0]}, ${r.snare?.[0]}, ${r.hat?.[0]})`);
  check(r.rim?.[0] === "Percussion/Perc 37.wav" && r.rim[1] === "GM 37" && r.clap?.[0] === "Percussion/Perc 39.wav"
    && r["open hat"]?.[0] === "Percussion/Perc 46.wav" && r.cymbal?.[0] === "Percussion/Perc 49.wav"
    && r["low tom"]?.[0] === "Percussion/Perc 45.wav" && r["high tom"]?.[0] === "Percussion/Perc 50.wav",
    "the Perc numbers fill the voices no name filled, by GM");
  const fx = ["Kicks/Kick 01.wav", "Snares/Snare 01.wav", "Hats/Hat 01.wav", "FX/Riser 44.1kHz.wav", "Bass/Sub E1.wav", "Keys/Piano C2.wav", "Vocals/Vox 38.wav"];
  ({out: r, m} = mapped(fx));
  check(r.kick?.[0] === "Kicks/Kick 01.wav" && r.snare?.[0] === "Snares/Snare 01.wav" && r.hat?.[0] === "Hats/Hat 01.wav"
    && ["FX/Riser 44.1kHz.wav", "Bass/Sub E1.wav", "Vocals/Vox 38.wav"].every(f => m.unused.includes(fx.indexOf(f))),
    `Vox 38, Riser 44.1kHz and Sub E1 never take a named drum's place (${JSON.stringify(r)})`);
  check(Object.keys(r).length === 3 && m.unused.includes(fx.indexOf("Keys/Piano C2.wav")), "Keys/Piano C2 (a note name, and a melodic word) no drum at all");
  check(m.candidates.every(list => !list.some(c => c.file >= 3)), "nor any voice's candidate");
  m = mapped(["Snares/Snare 01.wav", "Misc/Perc 38.wav"]).m;
  check(m.candidates[V.snare][0].file === 0 && m.candidates[V.snare].some(c => c.file === 1 && c.tag === "GM 38"),
    "a wordless GM note is still a candidate, after the named one");
  r = mapped(["Kicks/Kick 01.wav", "Toms/Tom A.wav", "Toms/Tom B.wav", "Percussion/45.wav", "Percussion/50.wav"]).out;
  check(r["low tom"]?.[0].startsWith("Toms/") && r["high tom"]?.[0].startsWith("Toms/"), "guessed toms by name before wordless GM toms");
  r = mapped(["Perc 38.wav", "Kick.wav"]).out;
  check(r.snare?.[0] === "Perc 38.wav" && r.snare[1] === "GM 38", "a wordless GM note still fills an empty voice");

  // hat and open hat agree, as a tom's or conga's family does
  r = mapped(["Hats/46.wav"]).out;
  check(r["open hat"]?.[0] === "Hats/46.wav" && r["open hat"][1] === "GM 46" && !r.hat, "Hats/46.wav is the open hat");
  r = mapped(["Hats/42.wav", "Hats/44.wav", "Hats/46.wav"]).out;
  check(r.hat?.[0] === "Hats/42.wav" && r["open hat"]?.[0] === "Hats/46.wav" && r.hat[1] === "GM 42", "Hats/42, 44, 46: closed 42, open 46");
  r = mapped(["Hat 46.wav", "HH 42.wav", "HiHat 46.wav"]).out;
  check(r["open hat"]?.[0] === "Hat 46.wav" && r.hat?.[0] === "HH 42.wav", "Hat 46 open, HH 42 closed");
  r = mapped(["Hat Closed 46.wav"]).out;
  check(r.hat?.[0] === "Hat Closed 46.wav" && /^from the name closed/.test(r.hat[1]) && !r["open hat"], "a closed hat named closed stays closed whatever its number");
  r = mapped(["HH Open 42.wav"]).out;
  check(r["open hat"]?.[0] === "HH Open 42.wav" && /^from the name open/.test(r["open hat"][1]), "an open hat named open stays open");
  r = mapped(["Kicks/46.wav", "Snares/42.wav"]).out;
  check(r.kick?.[0] === "Kicks/46.wav" && r.snare?.[0] === "Snares/42.wav" && !r.hat && !r["open hat"], "the hat family doesn't stretch to kicks and snares");

  // LoFi and HiFi are one word, never a side
  for (const [text, tokens] of [["LoFi Kit", "lofi kit"], ["Lo-Fi", "lofi"], ["lo fi", "lofi"], ["LOFI_TOM", "lofi tom"], ["HiFi_Conga_01", "hifi conga"],
    ["Hi-Fi Kit", "hifi kit"], ["hifi", "hifi"], ["LoFiTom", "lofi tom"], ["Hi Hat", "hi hat"], ["HiHat", "hi hat"], ["Hi Fidelity", "hi fidelity"]])
    check(kits.nameTokens(text).join(" ") === tokens, `nameTokens("${text}") is "${tokens}" (got "${kits.nameTokens(text).join(" ")}")`);
  r = mapped(["LoFi Toms/01.wav", "LoFi Toms/02.wav", "HiFi Congas/01.wav", "HiFi Congas/02.wav"]).out;
  check(r["low tom"]?.[0] === "LoFi Toms/02.wav" && r["high tom"]?.[0] === "LoFi Toms/01.wav" && r["low tom"][1] === "guessed"
    && r["low conga"]?.[0] === "HiFi Congas/01.wav" && r["high conga"]?.[0] === "HiFi Congas/02.wav", "LoFi Toms/, HiFi Congas/: guessed, not one side");
  r = mapped(["LoFi_Tom_01.wav", "LoFi_Tom_02.wav", "HiFi_Conga_01.wav", "HiFi_Conga_02.wav", "LoFi_Kick.wav"]).out;
  check(r["low tom"]?.[0] === "LoFi_Tom_02.wav" && r["high tom"]?.[0] === "LoFi_Tom_01.wav" && r["low conga"]?.[0] === "HiFi_Conga_01.wav"
    && r["high conga"]?.[0] === "HiFi_Conga_02.wav" && r.kick?.[0] === "LoFi_Kick.wav", "LoFi_ and HiFi_ in the file's own name: no side");
  r = mapped(["Lo-Fi/Toms/Tom A.wav", "Lo-Fi/Toms/Tom B.wav", "lo fi toms/1.wav", "LOFI TOMS/2.wav"]).out;
  check(r["low tom"]?.[1] === "guessed" && r["high tom"]?.[1] === "guessed", "Lo-Fi, lo fi and LOFI aren't sides either");

  // numbered toms: the highest number the low (floor) tom, tom 1 the high (rack) one; a word still wins
  r = mapped(["Toms/1.wav", "Toms/2.wav", "Toms/3.wav"]).out;
  check(r["low tom"]?.[0] === "Toms/3.wav" && r["high tom"]?.[0] === "Toms/1.wav", "Toms/1, 2, 3: 3 low, 1 high");
  r = mapped(["Tom 1.wav", "Tom 2.wav", "Tom 3.wav", "Floor Tom.wav"]).out;
  check(r["low tom"]?.[0] === "Floor Tom.wav" && r["high tom"]?.[0] === "Tom 1.wav", "a floor tom named, and tom 1 the high one");
  r = mapped(["Toms/Tom 1 (Rack).wav", "Toms/Tom 2 (Rack).wav", "Toms/Tom 3 (Floor).wav"]).out;
  check(r["low tom"]?.[0] === "Toms/Tom 3 (Floor).wav" && r["high tom"]?.[0] === "Toms/Tom 1 (Rack).wav", "Tom 1 (Rack) high, Tom 3 (Floor) low");
  r = mapped(["Big Tom 1.wav", "Small Tom 2.wav"]).out;
  check(r["low tom"]?.[0] === "Big Tom 1.wav" && r["high tom"]?.[0] === "Small Tom 2.wav", "big and small win over the numbers");
  r = mapped(["Tom 1 Low.wav", "Tom 2.wav", "Tom 3.wav"]).out;
  check(r["low tom"]?.[0] === "Tom 1 Low.wav" && r["high tom"]?.[0] === "Tom 2.wav", "a low named wins over its number; the high one the lowest number left");
  r = mapped(["RackTom1.wav", "RackTom2.wav", "Tom 4.wav", "Tom 5.wav"]).out;
  check(r["high tom"]?.[0] === "RackTom1.wav" && r["low tom"]?.[0] === "Tom 5.wav", "rack toms high, the highest other number low");
  r = mapped(["Conga 1.wav", "Conga 2.wav"]).out;
  check(r["low conga"]?.[0] === "Conga 1.wav" && r["high conga"]?.[0] === "Conga 2.wav", "congas keep file order: the first low");

  // the 808 and 909's abbreviations
  const tr = ["BD0010.WAV", "SD0010.WAV", "LT00.WAV", "MT00.WAV", "HT00.WAV", "LC00.WAV", "MC00.WAV", "HC00.WAV", "RS.WAV", "CL.WAV", "CP.WAV", "MA.WAV",
    "CB.WAV", "CY0010.WAV", "OH00.WAV", "CH.WAV"];
  ({out: r, m} = mapped(tr));
  const want = {kick: "BD0010.WAV", snare: "SD0010.WAV", "low tom": "LT00.WAV", "high tom": "HT00.WAV", "low conga": "LC00.WAV", "high conga": "HC00.WAV",
    rim: "RS.WAV", clap: "CP.WAV", shaker: "MA.WAV", bell: "CB.WAV", cymbal: "CY0010.WAV", "open hat": "OH00.WAV", hat: "CH.WAV"};
  check(Object.entries(want).every(([v, f]) => r[v]?.[0] === f), `the 808's file names (${JSON.stringify(r)})`);
  check(m.unused.map(i => tr[i]).sort().join() === "CL.WAV,MC00.WAV,MT00.WAV", "MT and MC unused beside an HT and an HC, CL no voice's");
  check(m.candidates[V["high tom"]].map(c => tr[c.file]).join() === "HT00.WAV,MT00.WAV", "MT the high tom's next candidate after HT");
  r = mapped(["LT.wav", "MT.wav"]).out;
  check(r["low tom"]?.[0] === "LT.wav" && r["high tom"]?.[0] === "MT.wav", "MT the high tom with no HT");
  r = mapped(["MT.wav", "HT.wav"]).out;
  check(r["high tom"]?.[0] === "HT.wav" && !r["low tom"], "HT beats MT for the high tom whichever comes first");
  r = mapped(["LC.wav", "MC.wav"]).out;
  check(r["low conga"]?.[0] === "LC.wav" && r["high conga"]?.[0] === "MC.wav", "MC the high conga with no HC");
  r = mapped(["Tom Mid.wav", "Tom Hi.wav", "Tom Lo.wav"]).out;
  check(r["high tom"]?.[0] === "Tom Hi.wav" && r["low tom"]?.[0] === "Tom Lo.wav", "Tom Hi beats Tom Mid though Mid comes first");
  // joined names, any case
  for (const [file, voice] of [["KICKDRUM.wav", "kick"], ["BassDrum.wav", "kick"], ["bassdrum.wav", "kick"], ["SNAREDRUM.wav", "snare"], ["HIHAT.wav", "hat"],
    ["HIHATOPEN.wav", "open hat"], ["OPENHAT.wav", "open hat"], ["openhihat.wav", "open hat"], ["HIHATCLOSED.wav", "hat"], ["closedhat.wav", "hat"],
    ["CLOSEDHIHAT.wav", "hat"], ["LOWTOM.wav", "low tom"], ["HIGHTOM.wav", "high tom"], ["MIDTOM.wav", "high tom"], ["FLOORTOM.wav", "low tom"],
    ["RACKTOM.wav", "high tom"], ["CRASHCYMBAL.wav", "cymbal"], ["ridecymbal.wav", "cymbal"], ["COWBELL.wav", "bell"], ["Cowbell.wav", "bell"]]) {
    r = mapped([file]).out;
    check(r[voice]?.[0] === file && /^from the name/.test(r[voice][1]) && Object.keys(r).length === 1, `${file} is the ${voice} (${JSON.stringify(r)})`);
  }
  // plural folders
  for (const [folder, voice] of [["Crashes", "cymbal"], ["Splashes", "cymbal"], ["Toms", "low tom"], ["Hats", "hat"], ["Kicks", "kick"], ["Snares", "snare"],
    ["Claps", "clap"], ["Congas", "low conga"], ["Bells", "bell"], ["Shakers", "shaker"], ["CRASHES", "cymbal"]]) {
    r = mapped([`${folder}/01.wav`]).out;
    check(r[voice]?.[0] === `${folder}/01.wav`, `${folder}/01.wav is the ${voice} (${JSON.stringify(r)})`);
  }
  r = mapped(["Crashes/01.wav", "Rides/01.wav"]).out;
  check(r.cymbal?.[0] === "Crashes/01.wav", "a crash folder beats a ride folder");

  // a number with a decimal point or a unit is never a GM note
  for (const file of ["Riser 44.1kHz.wav", "Hat 44.1kHz.wav", "Kick 48.0k.wav", "Snare 96k.wav", "Tom 24bit.wav", "Tom 24 bit.wav", "Kick 120bpm.wav",
    "Snare 40 BPM.wav", "Snare 40bpm.wav", "Perc_44_1k.wav", "Hat 44 kHz.wav", "Clap 48000Hz.wav", "Shaker 3.5.wav", "Snare 38,5.wav"])
    check(kits.gmOf(file) === null, `${file}: no GM note (got ${kits.gmOf(file)})`);
  check(kits.gmOf("Snare 38 44.1kHz.wav") === 38 && kits.gmOf("Hat 42 24bit.wav") === 42 && kits.gmOf("Sub E1.wav") === 40 && kits.gmOf("Vox 38.wav") === 38,
    "a GM note beside a sample rate or bit depth still counts");
  r = mapped(["Loops/Snare 90 BPM.wav", "Kick 120 BPM.wav", "Snare 40 BPM.wav"]).out;
  check(r.snare?.[0] === "Loops/Snare 90 BPM.wav" && /^from the name/.test(r.snare[1]), "40 BPM is a tempo, not GM 40");
  r = mapped(["Hat Closed 44.1kHz.wav", "Hat Open 48kHz 24bit.wav"]).out;
  check(/^from the name closed/.test(r.hat?.[1]) && /^from the name open/.test(r["open hat"]?.[1]), "44.1kHz isn't GM 44");

  // ---- numbers that are indexes: a run of three or more in a folder, the names the same but for it
  const run = (folder, word, from, to, pad = 2) => Array.from({length: to - from + 1},
    (_, i) => `${folder}/${word}${word ? " " : ""}${String(from + i).padStart(pad, "0")}.wav`);
  const named = tag => /^from the name/.test(tag || "");
  let pack = [...run("Kicks", "Kick", 1, 60), ...run("Snares", "Snare", 1, 60), ...run("Hihats", "Hihat", 1, 60), ...run("Open Hihats", "Open Hihat", 1, 10)];
  ({out: r, m} = mapped(pack));
  check(r.hat?.[0] === "Hihats/Hihat 01.wav" && named(r.hat[1]) && r["open hat"]?.[0] === "Open Hihats/Open Hihat 01.wav" && named(r["open hat"][1]),
    `Hihats/Hihat 01-60 beside Open Hihats/Open Hihat 01-10: the closed hat from Hihats, the open from Open Hihats (${r.hat}; ${r["open hat"]})`);
  check(r.kick?.[0] === "Kicks/Kick 01.wav" && r.snare?.[0] === "Snares/Snare 01.wav" && named(r.kick[1]) && named(r.snare[1]),
    "and Kick 01 and Snare 01, not Kick 36 and Snare 38");
  check(m.candidates[V["open hat"]].every(c => pack[c.file].startsWith("Open Hihats/")) && m.looks.every(l => l.gm == null),
    "no Hihat 46 among the open hat's candidates, and no file of the pack read as a GM note");
  pack = [...run("Hats", "", 1, 50), ...run("Open Hats", "", 1, 10)];
  r = mapped(pack).out;
  check(r.hat?.[0] === "Hats/01.wav" && r["open hat"]?.[0] === "Open Hats/01.wav" && named(r.hat[1]) && named(r["open hat"][1]),
    `Hats/01-50 + Open Hats/01-10: Hats/01 closed, Open Hats/01 open, not Hats/46 (${r.hat}; ${r["open hat"]})`);
  pack = [...run("Hats", "Hat", 1, 50, 1), ...run("Open Hats", "Open Hat", 1, 10, 1)];
  r = mapped(pack).out;
  check(r.hat?.[0] === "Hats/Hat 1.wav" && r["open hat"]?.[0] === "Open Hats/Open Hat 1.wav", "Hats/Hat 1-50 unpadded, the same");
  pack = [...Array.from({length: 50}, (_, i) => `Hihats/Cymatics - Hihat ${i + 1}.wav`), "Open Hihats/Cymatics - Open Hihat 1.wav"];
  ({out: r, m} = mapped(pack));
  check(r["open hat"]?.[0] === "Open Hihats/Cymatics - Open Hihat 1.wav" && r.hat?.[0] === "Hihats/Cymatics - Hihat 1.wav"
    && m.looks[45].gm == null, `'Cymatics - Hihat 46' in its run is no GM 46 (${r["open hat"]})`);
  // and with no open hat file at all, Hihat 46 in its run is still no open hat
  r = mapped(Array.from({length: 50}, (_, i) => `Hihats/Cymatics - Hihat ${i + 1}.wav`)).out;
  check(!r["open hat"] && r.hat?.[0] === "Hihats/Cymatics - Hihat 1.wav", "a run of Hihat 1-50 alone: no open hat taken from it");
  pack = run("Kicks", "Kick", 1, 40);
  ({out: r, m} = mapped(pack));
  check(r.kick?.[0] === "Kicks/Kick 01.wav" && r.kick[1] === "from the name kick" && m.candidates[V.kick][0].file === 0 && m.looks[35].gm == null,
    `Kicks/Kick 01-40: Kick 01, the first in file order, not Kick 36 (${r.kick})`);
  r = mapped(["Kicks/Kick 01.wav", "Kicks/Kick 02.wav", "Kicks/Kick 05.wav", "Kicks/Kick 06.wav", "Kicks/Kick 36.wav", "Kicks/Kick 37.wav"]).out;
  check(r.kick?.[0] === "Kicks/Kick 01.wav" && named(r.kick[1]), "gaps in a run: still indexes");
  pack = ["Kick.wav", "Snare.wav", "Hat.wav", ...run("Percussion", "Perc", 1, 60)];
  ({out: r, m} = mapped(pack));
  check(Object.keys(r).sort().join() === "hat,kick,snare" && m.unused.length === 60,
    `Percussion/Perc 01-60 beside named drums: the Perc numbers are indexes, no GM notes (${Object.keys(r)})`);
  // not a run: two files, steps of two or more, or a run that starts at 10 or above (a GM kit numbered note by note)
  r = mapped(["Hat 46.wav", "Hat 47.wav"]).out;
  check(r["open hat"]?.[0] === "Hat 46.wav" && r["open hat"][1] === "GM 46", "two numbered files are no run");
  pack = Array.from({length: 47}, (_, i) => `GM Kit/${35 + i}.wav`);
  r = mapped(pack).out;
  check(r.kick?.[0] === "GM Kit/36.wav" && r.snare?.[0] === "GM Kit/38.wav" && r.hat?.[0] === "GM Kit/42.wav" && r["open hat"]?.[0] === "GM Kit/46.wav"
    && r.kick[1] === "GM 36", `GM Kit/35-81, a run from 35: GM notes, not indexes (${r.kick})`);
  check(kits.mapKit(["Kits/A 01.wav", "Kits/A 02.wav", "Kits/A 03.wav", "Kits/B 46.wav"]).looks[3].gm === 46, "a run is one name: B 46 beside A 01-03 keeps its GM note");

  // a plain hat word agrees with GM 46 only when no file in the set names an open hat
  r = mapped(["Hats/46.wav", "Hats/Open.wav"]).out;
  check(r.hat?.[0] === "Hats/46.wav" && named(r.hat[1]) && r["open hat"]?.[0] === "Hats/Open.wav",
    `Hats/46 beside Hats/Open: 46 the closed hat by its folder (${JSON.stringify(r)})`);
  r = mapped(["Hat 46.wav", "Open Hat.wav", "OH.wav"]).out;
  check(r.hat?.[0] === "Hat 46.wav" && r["open hat"]?.[0] === "Open Hat.wav", "Hat 46 beside Open Hat: closed");
  r = mapped(["Hat 46.wav", "Kick.wav"]).out;
  check(r["open hat"]?.[0] === "Hat 46.wav" && r["open hat"][1] === "GM 46", "with no open hat named, Hat 46 is still the open hat");

  // the wordless GM step skips melodic and effect words, and note names alone
  const melodic = ["Drums/Kick.wav", "Drums/Hat Closed.wav", "Vocals/Vox 38.wav", "Vocals/Vox 49.wav", "FX/Riser 44.1kHz.wav", "Keys/Piano C2.wav",
    "Keys/Piano A1.wav", "Bass/Sub E1.wav"];
  ({out: r, m} = mapped(melodic));
  check(Object.keys(r).sort().join() === "hat,kick" && m.unused.length === 6,
    `Vocals/Vox 38 and 49, Keys/Piano A1 and C2, Bass/Sub E1 and FX/Riser fill no voice (${JSON.stringify(r)})`);
  check(m.candidates.every(list => list.every(c => c.file < 2)), "and are no voice's candidates");
  for (const word of ["vox", "vocal", "vocals", "voice", "keys", "key", "piano", "bass", "sub", "synth", "pad", "lead", "chord", "chords", "arp",
    "pluck", "string", "strings", "brass", "fx", "sfx", "riser", "impact", "sweep", "loop", "loops", "melody", "guitar"]) {
    const Word = word[0].toUpperCase() + word.slice(1);
    const files = [`${Word} 38.wav`, `${Word}/42.wav`, `Misc/${word.toUpperCase()}_46.wav`, `${Word}${word.length > 2 && !word.endsWith("s") ? "s" : ""}/Perc 49.wav`];
    const got = kits.mapKit(files);
    check(got.assign.every(a => !a) && got.looks.every(l => l.gm == null), `'${word}' in a path: no wordless GM note (${files.join(", ")})`);
  }
  r = mapped(["Misc/Perc 38.wav", "Misc/C2.wav", "Perc A1.wav", "F#1.wav"]).out;
  check(Object.keys(r).join() === "snare" && r.snare[0] === "Misc/Perc 38.wav", `note names alone are never GM, a number alone is (${JSON.stringify(r)})`);
  r = mapped(["Tom A1.wav"]).out;
  check(r["low tom"]?.[1] === "GM 45", "a note name agreeing with its drum word counts (Tom A1, GM 45)");
  check(kits.gmOf("Piano C2.wav") === 48, "gmOf still reads a note name; only the mapping leaves it out alone");

  // the two-letter abbreviations count only beside numbers, drum, sound or machine words, a machine's prefix, or nothing
  for (const [file, voice] of [["OH.wav", "open hat"], ["OH 01.wav", "open hat"], ["808 OH.wav", "open hat"], ["BD_02.wav", "kick"],
    ["TR-808 BD.wav", "kick"], ["CH 44.1kHz.wav", "hat"], ["Snare SD.wav", "snare"], ["HH Open 42.wav", "open hat"], ["Tight CH 02 v2.wav", "hat"],
    ["OH/01.wav", "open hat"], ["Drums/SD 3.wav", "snare"], ["LT Low.wav", "low tom"], ["Kit HT.wav", "high tom"], ["CY C1.wav", "cymbal"]]) {
    r = mapped([file]).out;
    check(r[voice]?.[0] === file && Object.keys(r).length === 1, `${file} is the ${voice} (${JSON.stringify(r)})`);
  }
  for (const file of ["Vox Oh.wav", "MC Shout.wav", "Oh Yeah.wav", "Vox Oh/01.wav", "SD Card.wav", "Ma Voice.wav"]) {
    check(kits.nameLook(file) === null && kits.mapKit([file]).assign.every(a => !a), `${file}: its abbreviation beside another word counts for nothing`);
  }
  // beside a sound word (long, short, dry, wet, punchy, snappy, sub, tight, fat, hard, soft, room, close, far) or a machine's
  // name (DMX, Linn, LinnDrum, KB, 606, 707, 808, 909, CR78, LM1) they count too
  for (const [file, voice] of [["BD Long.wav", "kick"], ["BD Short.wav", "kick"], ["SD Snappy.wav", "snare"], ["RS Dry.wav", "rim"], ["CP Wet.wav", "clap"],
    ["BD Punchy.wav", "kick"], ["BD Sub.wav", "kick"], ["CH Tight.wav", "hat"], ["BD Fat 02.wav", "kick"], ["SD Hard.wav", "snare"], ["SD Soft.wav", "snare"],
    ["OH Room.wav", "open hat"], ["OH Close.wav", "open hat"], ["OH Far.wav", "open hat"], ["CY Long.wav", "cymbal"], ["Long Dry BD.wav", "kick"],
    ["DMX BD.wav", "kick"], ["Linn SD.wav", "snare"], ["LinnDrum CP.wav", "clap"], ["linndrum_cb.wav", "bell"], ["KB BD.wav", "kick"], ["kb_sd_01.wav", "snare"],
    ["606 CH.wav", "hat"], ["707 OH.wav", "open hat"], ["808 BD Long.wav", "kick"], ["909 SD Snappy.wav", "snare"], ["CR78 CP.wav", "clap"],
    ["CR-78 BD.wav", "kick"], ["cr78_rs.wav", "rim"], ["LM1 SD.wav", "snare"], ["LM-1 CB.wav", "bell"], ["DMX/BD Room 01.wav", "kick"]]) {
    r = mapped([file]).out;
    check(r[voice]?.[0] === file && r[voice][1] === `from the name ${file.match(/(?<![a-z])(bd|sd|rs|cp|ch|oh|cy|cb)(?![a-z])/i)[1].toLowerCase()}`
      && Object.keys(r).length === 1, `${file} is the ${voice}, by its abbreviation (${JSON.stringify(r)})`);
  }
  // and after a machine's prefix: two to five capitals and digits before the abbreviation, not a melodic or effect word
  for (const [file, voice] of [["KB_BD_01.wav", "kick"], ["KB_SD_01.wav", "snare"], ["KB_CH_01.wav", "hat"], ["KB_OH_01.wav", "open hat"],
    ["XR10_SD_02.wav", "snare"], ["MPC60 OH.wav", "open hat"], ["TR8 CH 3.wav", "hat"], ["RX5-BD.wav", "kick"], ["SP12 HT Long.wav", "high tom"],
    ["R8 MA.wav", "shaker"]]) {
    r = mapped([file]).out;
    check(r[voice]?.[0] === file && Object.keys(r).length === 1, `${file} is the ${voice}, after a machine's prefix (${JSON.stringify(r)})`);
  }
  // "Ch 1 Room": room is a sound word now, so it is a closed hat (with "Vox Oh" and "MC Shout" still nothing)
  r = mapped(["Ch 1 Room.wav"]).out;
  check(r.hat?.[0] === "Ch 1 Room.wav" && r.hat[1] === "from the name ch" && Object.keys(r).length === 1, `Ch 1 Room is a closed hat (${JSON.stringify(r)})`);
  for (const file of ["VOX OH.wav", "FX CH.wav", "BASS BD.wav", "LOOP SD.wav", "MC SHOUT.wav", "OH YEAH.wav", "SD CARD.wav", "BD XR10.wav", "xr10 sd.wav",
    "Xr10 SD.wav", "OH Room Mic.wav", "Vox Oh Room.wav", "MC Shout Dry.wav", "PERCUSSION OH.wav", "VOX/OH YEAH 01.wav"]) {
    check(kits.nameLook(file) === null && kits.mapKit([file]).assign.every(a => !a),
      `${file}: no machine's prefix, or a word that is none of the kinds (${JSON.stringify(kits.nameLook(file))})`);
  }
  for (const [file, voice] of [["Kick RS.wav", "kick"], ["RS Kick.wav", "kick"], ["Snare CH.wav", "snare"], ["MA_Kick.wav", "kick"], ["SD Card Snare.wav", "snare"],
    ["Clap BD.wav", "clap"], ["Ride OH.wav", "cymbal"]]) {
    r = mapped([file]).out;
    check(r[voice]?.[0] === file && Object.keys(r).length === 1, `${file}: the full word wins, the ${voice} (${JSON.stringify(r)})`);
  }

  // more joined names, any case
  for (const [word, voice] of [["OPENHH", "open hat"], ["CLOSEDHH", "hat"], ["HHOPEN", "open hat"], ["HHCLOSED", "hat"], ["HIHATPEDAL", "hat"],
    ["PEDALHAT", "hat"], ["PEDALHH", "hat"], ["LOTOM", "low tom"], ["HITOM", "high tom"], ["TOMLOW", "low tom"], ["TOMHI", "high tom"],
    ["TOMHIGH", "high tom"], ["LOWCONGA", "low conga"], ["HIGHCONGA", "high conga"], ["HICONGA", "high conga"], ["LOCONGA", "low conga"],
    ["CONGALOW", "low conga"], ["CONGAHI", "high conga"], ["CONGAHIGH", "high conga"], ["BONGOHI", "high conga"], ["BONGOLO", "low conga"],
    ["SPLASHCYMBAL", "cymbal"], ["CHINACYMBAL", "cymbal"], ["SNARERIM", "rim"], ["RIMSNARE", "rim"], ["RIDEBELL", "bell"]]) {
    for (const file of [`${word}.WAV`, `${word.toLowerCase()}.wav`, `${word}_01.wav`]) {
      r = mapped([file]).out;
      check(r[voice]?.[0] === file && named(r[voice][1]) && Object.keys(r).length === 1, `${file} is the ${voice} (${JSON.stringify(r)})`);
    }
  }
  check(mapped(["Ride Bell.wav"]).out.bell?.[0] === "Ride Bell.wav", "RIDEBELL maps as Ride Bell does");
  r = mapped(["LOTOM.wav", "HITOM.wav", "LOCONGA.wav", "HICONGA.wav"]).out;
  check(r["low tom"]?.[0] === "LOTOM.wav" && r["high tom"]?.[0] === "HITOM.wav" && r["low conga"]?.[0] === "LOCONGA.wav" && r["high conga"]?.[0] === "HICONGA.wav",
    "LOTOM, HITOM, LOCONGA, HICONGA together, each on its side");
  for (const [text, tokens] of [["Low-Fi Toms", "lofi toms"], ["Lo-Fi", "lofi"], ["Lofi", "lofi"], ["LOW-FI", "lofi"], ["low fi kit", "lofi kit"],
    ["LowFi_Tom", "lofi tom"], ["Low Tom", "low tom"], ["Tom Low", "tom low"]])
    check(kits.nameTokens(text).join(" ") === tokens, `nameTokens("${text}") is "${tokens}" (got "${kits.nameTokens(text).join(" ")}")`);
  r = mapped(["Low-Fi Toms/01.wav", "Low-Fi Toms/02.wav"]).out;
  check(r["low tom"]?.[1] === "guessed" && r["high tom"]?.[1] === "guessed", "Low-Fi Toms/: guessed, Low-Fi no side");
  r = mapped(["Lofi Tom 1.wav", "Lofi Tom 2.wav", "Low-Fi Conga 1.wav", "Low-Fi Conga 2.wav"]).out;
  check(r["low tom"]?.[0] === "Lofi Tom 2.wav" && r["high tom"]?.[0] === "Lofi Tom 1.wav" && r["low conga"]?.[0] === "Low-Fi Conga 1.wav"
    && r["high conga"]?.[0] === "Low-Fi Conga 2.wav", "Lofi and Low-Fi in the file's own name: no side");

  // ---- one-shots before loops and effects
  const EDM = ["EDM Pack/FX/Crash FX 2.wav", "EDM Pack/FX/Impact 1.wav", "EDM Pack/FX/Kick Riser.wav", "EDM Pack/FX/Reverse Crash 1.wav",
    "EDM Pack/FX/Snare Build 2.wav", "EDM Pack/FX/Snare Roll 1 - 128 BPM.wav", "EDM Pack/FX/White Noise Sweep 1.wav",
    "EDM Pack/Loops/Clap Loop 1 - 128 BPM.wav", "EDM Pack/Loops/Hat Loop 1 - 128 BPM.wav", "EDM Pack/Loops/Kick Loop 1 - 128 BPM.wav",
    "EDM Pack/Loops/Top Loop 1 - 128 BPM.wav",
    ...run("EDM Pack/One Shots/Claps", "Clap", 1, 8, 1), ...run("EDM Pack/One Shots/Cymbals", "Crash", 1, 3, 1),
    ...run("EDM Pack/One Shots/Hats", "Closed Hat", 1, 8, 1), ...run("EDM Pack/One Shots/Hats", "Open Hat", 1, 4, 1),
    ...run("EDM Pack/One Shots/Kicks", "Kick", 1, 8, 1), ...run("EDM Pack/One Shots/Snares", "Snare", 1, 8, 1)];
  ({out: r, m} = mapped(EDM));
  const shot = (voice, file) => r[voice]?.[0] === `EDM Pack/One Shots/${file}.wav` && named(r[voice][1]);
  check(shot("kick", "Kicks/Kick 1") && shot("snare", "Snares/Snare 1") && shot("clap", "Claps/Clap 1") && shot("hat", "Hats/Closed Hat 1")
    && shot("open hat", "Hats/Open Hat 1") && shot("cymbal", "Cymbals/Crash 1") && Object.keys(r).length === 6,
    `the EDM pack: every voice from One Shots, not FX/Kick Riser, FX/Snare Build 2, Loops/Clap Loop 1 or FX/Crash FX 2 (${JSON.stringify(r)})`);
  const loopsLast = v => {
    const list = m.candidates[v].map(c => EDM[c.file]);
    const first = list.findIndex(f => !f.includes("/One Shots/"));
    return list.length > 0 && first > 0 && list.slice(first).every(f => !f.includes("/One Shots/"));
  };
  check([V.kick, V.snare, V.clap, V.hat, V.cymbal].every(loopsLast), "each voice's candidates: the One Shots files, then the loops and effects");
  check(m.candidates[V.kick].slice(-2).map(c => EDM[c.file]).join() === "EDM Pack/FX/Kick Riser.wav,EDM Pack/Loops/Kick Loop 1 - 128 BPM.wav",
    "FX/Kick Riser and Loops/Kick Loop 1 the kick's last candidates");
  check(EDM.every((f, i) => m.looks[i].loop === !f.includes("/One Shots/") && m.looks[i].oneShot === f.includes("/One Shots/")),
    "the FX and Loops files are loops or effects, the One Shots files one-shots");
  // a Cymatics-like pack: Drum Loops/Hihat Loops beside Drum One Shots/Hihats
  const C = "Cymatics - Lofi Toolkit";
  const cym = [...Array.from({length: 10}, (_, i) => `${C}/Drum Loops/Cymatics - Lofi Drum Loop ${i + 1} - 90 BPM.wav`),
    ...Array.from({length: 5}, (_, i) => `${C}/Drum Loops/Hihat Loops/Cymatics - Lofi Hihat Loop ${i + 1} - 90 BPM.wav`),
    ...Array.from({length: 5}, (_, i) => `${C}/Drum Loops/Kick Loops/Cymatics - Lofi Kick Loop ${i + 1} - 90 BPM.wav`),
    ...Array.from({length: 10}, (_, i) => `${C}/Drum One Shots/Claps/Cymatics - Lofi Clap ${i + 1}.wav`),
    ...Array.from({length: 10}, (_, i) => `${C}/Drum One Shots/Hihats/Cymatics - Lofi Hihat ${i + 1}.wav`),
    ...Array.from({length: 10}, (_, i) => `${C}/Drum One Shots/Kicks/Cymatics - Lofi Kick ${i + 1}.wav`),
    ...Array.from({length: 4}, (_, i) => `${C}/Drum One Shots/Open Hihats/Cymatics - Lofi Open Hihat ${i + 1}.wav`),
    ...Array.from({length: 10}, (_, i) => `${C}/Drum One Shots/Snares/Cymatics - Lofi Snare ${i + 1}.wav`),
    ...Array.from({length: 6}, (_, i) => `${C}/Melody Loops/Cymatics - Lofi Melody Loop ${i + 1} - 90 BPM - Am.wav`)];
  ({out: r, m} = mapped(cym));
  check(r.hat?.[0] === `${C}/Drum One Shots/Hihats/Cymatics - Lofi Hihat 1.wav` && r["open hat"]?.[0] === `${C}/Drum One Shots/Open Hihats/Cymatics - Lofi Open Hihat 1.wav`
    && r.kick?.[0] === `${C}/Drum One Shots/Kicks/Cymatics - Lofi Kick 1.wav` && r.snare?.[0] === `${C}/Drum One Shots/Snares/Cymatics - Lofi Snare 1.wav`
    && r.clap?.[0] === `${C}/Drum One Shots/Claps/Cymatics - Lofi Clap 1.wav` && Object.keys(r).length === 5,
    `the Cymatics-like pack: Drum One Shots/Hihats/Hihat 1, not Drum Loops/Hihat Loops/Hihat Loop 1 - 90 BPM (${r.hat})`);
  check(m.candidates[V.hat].slice(-5).every(c => cym[c.file].includes("/Hihat Loops/")) && m.candidates[V.hat].length === 15,
    "the hihat loops the closed hat's last five candidates");
  // a loop or effect takes a voice only when no one-shot names it, wherever its word is
  r = mapped(["Loops/Clap Loop 1 - 128 BPM.wav", "Kicks/Kick 1.wav", "FX/Crash FX 2.wav"]).out;
  check(r.clap?.[0] === "Loops/Clap Loop 1 - 128 BPM.wav" && r.cymbal?.[0] === "FX/Crash FX 2.wav" && r.kick?.[0] === "Kicks/Kick 1.wav",
    "with no one-shot clap or crash, the clap loop and the crash FX still fill them");
  for (const word of ["loop", "loops", "fx", "sfx", "riser", "build", "buildup", "sweep", "impact", "fill", "fills", "roll", "break", "breaks",
    "groove", "grooves"]) {
    const Word = word[0].toUpperCase() + word.slice(1);
    for (const files of [[`${Word}/Kick A.wav`, "Kicks/Kick B.wav"], [`Kick ${Word} A.wav`, "Kick B.wav"], [`Drums/${word.toUpperCase()}_Kick.wav`, "Drums/Kick.wav"]]) {
      r = mapped(files).out;
      check(r.kick?.[0] === files[1], `'${word}': ${files[0]} after ${files[1]} (${r.kick})`);
    }
  }
  for (const tempo of ["128 BPM", "90bpm", "120_BPM", "BPM 140", "174BPM", "85 bpm"]) {
    r = mapped([`Kick ${tempo}.wav`, "Kick.wav"]).out;
    check(r.kick?.[0] === "Kick.wav", `a tempo (${tempo}) makes a loop: Kick ${tempo} after Kick (${r.kick})`);
    r = mapped([`Drums ${tempo}/Kick.wav`, "One/Kick.wav"]).out;
    check(r.kick?.[0] === "One/Kick.wav", `a tempo in a folder (${tempo}) too (${r.kick})`);
  }
  for (const file of ["Kick 44.1kHz.wav", "Kick 120.wav", "Kick Bpm.wav", "Kick 1280bpmx.wav", "Kick Rolling.wav", "Kick Breakdown.wav", "Kick Filler.wav"]) {
    r = mapped([file, "Kick.wav"]).out;
    check(r.kick?.[0] === file, `${file} is no loop or effect: before Kick.wav in file order (${r.kick})`);
  }
  // in every step: a loop's GM note that agrees with its word ranks after a one-shot's name, and after a one-shot's wordless GM note
  r = mapped(["Loops/Hat Loop 42 - 128 BPM.wav", "Hats/Hat.wav"]).out;
  check(r.hat?.[0] === "Hats/Hat.wav" && named(r.hat[1]), `Loops/Hat Loop 42 (GM 42, agreeing) after Hats/Hat (by its name) (${JSON.stringify(r)})`);
  r = mapped(["FX/Kick Riser.wav", "Percussion/Perc 36.wav"]).out;
  check(r.kick?.[0] === "Percussion/Perc 36.wav" && r.kick[1] === "GM 36", `FX/Kick Riser after a one-shot's wordless GM 36 (${JSON.stringify(r)})`);
  r = mapped(["Fills/Tom Fill 1.wav", "Fills/Tom Fill 2.wav", "Toms/Tom.wav"]).out;
  check(r["low tom"]?.[0] === "Toms/Tom.wav" && r["high tom"]?.[0] === "Fills/Tom Fill 1.wav",
    `the toms guessed from the one-shots first, a fill for the one left (${JSON.stringify(r)})`);
  // a One Shots folder ranks first, before a name or GM note elsewhere
  for (const folder of ["One Shots", "One-Shots", "Oneshots", "Drum One Shots", "OneShots", "One_Shots", "ONE SHOTS", "One Shot", "Drum One-Shots"]) {
    r = mapped(["Kicks/Kick A.wav", "Kick 36.wav", `${folder}/Kicks/Kick B.wav`]).out;
    check(r.kick?.[0] === `${folder}/Kicks/Kick B.wav`, `${folder}/Kicks/Kick B before Kicks/Kick A and Kick 36 (${r.kick})`);
  }
  for (const folder of ["Vocal One Shots", "Shots", "One", "Big Shots"]) {
    r = mapped(["Kicks/Kick A.wav", `${folder}/Kick B.wav`]).out;
    check(r.kick?.[0] === "Kicks/Kick A.wav", `${folder}/ is no One Shots folder (${r.kick})`);
  }
  // the words count below the pack's own folder and below a One Shots folder, and in the file's own name everywhere
  r = mapped(["Lofi Grooves/Drum Loops/Kick Loop 1.wav", "Lofi Grooves/Kicks/Kick 1.wav"]).out;
  check(r.kick?.[0] === "Lofi Grooves/Kicks/Kick 1.wav", `a pack named Lofi Grooves still has one-shots (${r.kick})`);
  r = mapped(["Breaks Vol 2/One Shots/Kick.wav", "Other Pack/Kick.wav"]).out;
  check(r.kick?.[0] === "Breaks Vol 2/One Shots/Kick.wav", `a loop word above a One Shots folder counts for nothing (${r.kick})`);
  r = mapped(["Pack/One Shots/FX/Kick Riser.wav", "Pack/One Shots/Kicks/Kick 1.wav"]).out;
  check(r.kick?.[0] === "Pack/One Shots/Kicks/Kick 1.wav", `One Shots/FX/Kick Riser is still an effect (${r.kick})`);
  check(kits.mapKit(["FX/Kick Riser.wav"]).looks[0].loop && kits.mapKit(["Pack/FX/Kick Riser.wav", "Pack/Kick.wav"]).looks[0].loop
    && !kits.mapKit(["Pack/FX/Kick.wav", "Pack/FX/Snare.wav"]).looks[0].loop, "FX/ every file is in names the pack; one only some are in counts");

  // ---- index runs start at 0 to 9; a run from 10 or above is a GM kit numbered note by note
  pack = Array.from({length: 61}, (_, i) => `Export/${24 + i}.wav`);
  ({out: r, m} = mapped(pack));
  check(r.kick?.[0] === "Export/36.wav" && r.kick[1] === "GM 36" && r.snare?.[0] === "Export/38.wav" && r.hat?.[0] === "Export/42.wav"
    && r["open hat"]?.[0] === "Export/46.wav" && r.cymbal?.[0] === "Export/49.wav" && r.shaker?.[0] === "Export/70.wav" && Object.keys(r).length === 13,
    `Export/24-84, a GM kit exported from C0 = 24: GM notes (${r.kick})`);
  r = mapped(Array.from({length: 51}, (_, i) => `Drums/Drum ${10 + i}.wav`)).out;
  check(r.kick?.[0] === "Drums/Drum 36.wav" && r.kick[1] === "GM 36" && r["open hat"]?.[0] === "Drums/Drum 46.wav", `Drums/Drum 10-60: GM notes (${r.kick})`);
  r = mapped(run("Hats", "Hat", 10, 50)).out;
  check(r.hat?.[0] === "Hats/Hat 42.wav" && r.hat[1] === "GM 42" && r["open hat"]?.[0] === "Hats/Hat 46.wav", `Hats/Hat 10-50: Hat 42 closed, Hat 46 open, by GM (${r.hat})`);
  for (const from of [0, 1, 5, 9]) {
    const files = run("Hats", "Hat", from, 50);
    ({out: r, m} = mapped(files));
    check(r.hat?.[0] === files[0] && named(r.hat[1]) && !r["open hat"] && m.looks.every(l => l.gm == null), `Hats/Hat ${from}-50: indexes, no GM notes (${r.hat})`);
  }
  r = mapped(["Kicks/Kick 10.wav", "Kicks/Kick 11.wav", "Kicks/Kick 12.wav", "Kicks/Kick 35.wav", "Kicks/Kick 36.wav"]).out;
  check(r.kick?.[0] === "Kicks/Kick 36.wav" && r.kick[1] === "GM 36", `Kicks/Kick 10, 11, 12, 35, 36: from 10, Kick 36 by GM (${r.kick})`);

  // the lookup's result has no inName any more, and the page no sendImage
  check(!("inName" in kits.nameLook("Kick.wav")) && !("inName" in kits.nameLook("Toms/low.wav")), "nameLook gives no inName");
  check(!/\bsendImage\b/.test(fs.readFileSync(path.join(__dirname, "kits.js"), "utf8")), "no sendImage left in kits.js");
}

// ---- processing a hit --------------------------------------------------------------------------------
// processHit as it was before the fade in: the same hit, levelled the same, with no fade at the start
// (the levelling is measured on the hit as kept, so the gain can differ by the fade's share of 80 ms)
function processedNoFade(mono, voice) {
  const R = 22050, n = mono.length;
  const {dc, start} = kits.hitStart(mono);
  const x = Float32Array.from(mono, v => v - dc);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  let end = n - 1;
  while (end > start && Math.abs(x[end]) <= peak * 10 ** (-45 / 20)) end--;
  const length = Math.max(2, Math.min(end - start + 1, Math.round(kits.VOICE_CAP[voice] * R), n - start));
  const hit = x.slice(start, start + length);
  const fade = Math.min(Math.round(0.060 * R), Math.floor(length / 3));
  for (let j = 0; j < fade; j++) { const g = Math.cos(0.5 * Math.PI * (j + 1) / fade); hit[length - fade + j] *= g * g; }
  const head = Math.max(1, Math.min(length, Math.round(0.080 * R)));
  let sum = 0, top = 0;
  for (let i = 0; i < head; i++) sum += hit[i] * hit[i];
  for (const v of hit) top = Math.max(top, Math.abs(v));
  const rms = Math.sqrt(sum / head);
  let gain = rms > 0 ? 0.07 / rms : 0.98 / top;
  if (gain * top > 0.98) gain = 0.98 / top;
  return Int16Array.from(hit, v => Math.max(-32768, Math.min(32767, Math.round(v * gain * 32767))));
}
// what the DC tail rule looks at in a file, worked out here again as hitStart's comment says: where the
// strike is (the first sample 2% of the peak-to-peak from the first), how long the file runs past it, and
// how loud its last 50 ms are, their mean out, against the peak (in dB)
function tailFacts(x) {
  const R = 22050, n = x.length, tail = Math.round(0.050 * R);
  let low = Infinity, high = -Infinity;
  for (const v of x) { low = Math.min(low, v); high = Math.max(high, v); }
  let moved = 0;
  while (moved < n && Math.abs(x[moved] - x[0]) <= 0.02 * (high - low)) moved++;
  let mean = 0;
  for (let i = n - tail; i < n; i++) mean += x[i];
  mean /= tail;
  let peak = 0, spread = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v - mean));
  for (let i = n - tail; i < n; i++) spread = Math.max(spread, Math.abs(x[i] - mean));
  return {moved, pastMs: (n - moved) / R * 1000, tailDb: 20 * Math.log10(spread / peak)};
}
function testProcessing() {
  const R = 22050;
  // silence with a DC offset, then a decaying 200 Hz sine, then silence
  const n = R * 2, at = 4410;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = 0.01;
    if (i >= at) x[i] += 0.8 * Math.exp(-(i - at) / (0.05 * R)) * Math.sin(2 * Math.PI * 200 * (i - at) / R + 0.3);
  }
  const hit = kits.processHit(x, V.kick);
  // the onset: the first sample above 2% of the peak, less 1 ms (22 samples)
  let onset = at;
  while (Math.abs(x[onset] - 0.01) <= 0.02 * 0.8 * 0.999) onset++;
  check(hit.length <= Math.round(0.40 * R), "capped at the kick's 0.40 s");
  const head = Math.round(0.080 * R);
  let sum = 0, peak = 0;
  for (let i = 0; i < hit.length; i++) peak = Math.max(peak, Math.abs(hit[i]) / 32767);
  for (let i = 0; i < head; i++) sum += (hit[i] / 32767) ** 2;
  const rms = Math.sqrt(sum / head);
  check(Math.abs(rms - 0.07) < 0.001 || Math.abs(peak - 0.98) < 0.001, `levelled: RMS ${rms.toFixed(4)} or peak ${peak.toFixed(3)}`);
  check(peak <= 0.9801, "never past a 0.98 peak");
  // the start: 22 samples of (near) silence, the DC gone
  check(Math.abs(hit[0]) < 40 && Math.abs(hit[10]) < 40, "the start is the silence before the onset, the DC offset gone");
  let firstLoud = 0;
  while (Math.abs(hit[firstLoud]) / 32767 <= 0.02 * peak) firstLoud++;
  check(Math.abs(firstLoud - 22) <= 1, `the onset 1 ms in (${firstLoud} samples)`);
  check(hit[hit.length - 1] === 0, "the fade ends at zero");
  // a big DC offset, 0.1 under a 0.6 hit at sample 500: over 2% of the peak, so measured apart from the
  // onset, and the lead-in, the end and the levelling all on the sound without it
  const dcx = new Float32Array(R);
  for (let i = 0; i < R; i++) dcx[i] = 0.1 + (i >= 500 ? 0.6 * Math.exp(-(i - 500) / (0.03 * R)) * Math.sin(2 * Math.PI * 200 * (i - 500) / R) : 0);
  const dch = kits.processHit(dcx, V.kick);
  let dcPeak = 0, dcLoud = 0;
  for (let i = 0; i < dch.length; i++) dcPeak = Math.max(dcPeak, Math.abs(dch[i]));
  while (Math.abs(dch[dcLoud]) <= 0.02 * dcPeak) dcLoud++;
  check(Math.abs(dch[0]) < 40 && Math.abs(dcLoud - 22) <= 1, `DC 0.1: the start ${dch[0]}, near 0, and the onset 1 ms in (${dcLoud} samples)`);
  check(dch.length < Math.round(0.40 * R) && dch.length > Math.round(0.10 * R), `DC 0.1: ended at -45 dB (${dch.length} samples), not at the cap`);
  check(Math.abs(kits.hitStart(dcx).dc - 0.1) < 1e-6, `DC 0.1: measured on the 500 samples before the onset (${kits.hitStart(dcx).dc})`);
  // a clean hit with no DC: nothing taken out (the mean of the whole sound isn't 0, and isn't an offset),
  // so the hit is the sound scaled, sample for sample, until the fade
  const clean = new Float32Array(R);
  for (let i = 300; i < R; i++) clean[i] = 0.7 * Math.exp(-(i - 300) / (0.04 * R)) * Math.sin(2 * Math.PI * 150 * (i - 300) / R);
  const cs = kits.hitStart(clean), ch = kits.processHit(clean, V.kick);
  let top = 0;
  for (let i = 1; i < ch.length; i++) if (Math.abs(ch[i]) > Math.abs(ch[top])) top = i;
  const g = ch[top] / clean[cs.start + top];
  let off = 0;
  for (let i = 0; i < ch.length - Math.round(0.060 * R); i++) off = Math.max(off, Math.abs(ch[i] - g * clean[cs.start + i]));
  check(cs.dc === 0 && cs.start === cs.onset - 22 && cs.onset > 300 && cs.onset < 320 && off <= 1,
    `a clean hit with no DC unchanged: dc ${cs.dc}, onset ${cs.onset}, start ${cs.start}, off by ${off.toFixed(2)}`);
  // a file that starts on the hit, with an asymmetric shape: under 1 ms before its onset, so no DC is taken out
  const asym = new Float32Array(R);
  for (let i = 0; i < R; i++) asym[i] = -0.5 * Math.exp(-i / (0.02 * R)) * (1 + 0.3 * Math.sin(2 * Math.PI * 80 * i / R));
  // (its tail, long died away, is the DC it has: none)
  check(Math.abs(kits.hitStart(asym).dc) < 1e-12 && kits.hitStart(asym).start === 0, `a file that starts on its hit: no DC taken out (${kits.hitStart(asym).dc}), nothing cut`);
  // a short hit: kept to its last point above -45 dB, faded over a third of it at most
  const short = new Float32Array(R);
  for (let i = 100; i < 400; i++) short[i] = Math.sin(i) * 0.5;
  const s = kits.processHit(short, V.snare);
  check(Math.abs(s.length - (400 - 100 + 22)) <= 2, `a short hit is kept to its end (${s.length})`);
  // loud and peaky: the peak rule wins
  const click = new Float32Array(R);
  for (let i = 500; i < 2000; i++) click[i] = (i === 500 ? 1 : 0.05 * Math.exp(-(i - 500) / 300) * Math.sin(i)) + 0.0005 * Math.sin(3 * i);
  const c = kits.processHit(click, V.hat);
  check(Math.max(...Array.from(c, v => Math.abs(v))) === Math.round(0.98 * 32767), "a click is held to a 0.98 peak");
  check(c.length <= Math.round(0.15 * R), "capped at the hat's 0.15 s");
  let threw = false;
  try { kits.processHit(new Float32Array(1000), 0); } catch (e) { threw = true; }
  check(threw, "a silent file is refused");
  const mono = kits.mixToMono([Float32Array.from([1, 0.5]), Float32Array.from([0, -0.5])]);
  check(mono[0] === 0.5 && mono[1] === 0, "channels mixed to mono by hand");
  // the processed hits of a whole kit build to an image that passes its checks
  const kit = {base_kit: 4, name: "test", voices: kits.VOICE_NAMES.map((_, v) => v === 2 ? null : {samples: kits.processHit(x, v), level: 160, choke: kits.DEFAULT_CHOKE[v], flags: kits.DEFAULT_BENDS[v] ? 2 : 0})};
  check(kits.checkImage(kits.buildImage(kit)) === 0, "a kit of processed hits builds to a valid image");

  // a file that starts on its strike, under 1 ms before it: the DC from its last 50 ms when the file runs
  // on 100 ms past the strike and that tail is quiet, else none
  const ringing = (n, dc, decay, phase = 0) => {
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = dc + 0.6 * Math.exp(-i / (decay * R)) * Math.sin(2 * Math.PI * 180 * i / R + phase);
    return y;
  };
  const tailed = ringing(R, 0.05, 0.03);
  const ts = kits.hitStart(tailed);
  check(ts.start === 0 && Math.abs(ts.dc - 0.05) < 1e-4, `starting on its strike with a quiet tail: the DC from the tail (${ts.dc.toFixed(5)})`);
  const tailedHit = kits.processHit(tailed, V.kick), plainHit = kits.processHit(ringing(R, 0, 0.03), V.kick);
  let tailOff = 0;
  for (let i = 0; i < plainHit.length; i++) tailOff = Math.max(tailOff, Math.abs(tailedHit[i] - plainHit[i]));
  check(tailedHit.length === plainHit.length && tailOff <= 2, `and the hit the same as without the offset (off by ${tailOff}, lengths ${tailedHit.length}/${plainHit.length})`);
  const shortTail = ringing(Math.round(0.090 * R), 0.05, 0.005);
  check(kits.hitStart(shortTail).dc === 0, "under 100 ms past the strike: no DC from the tail");
  const justLong = ringing(Math.round(0.101 * R), 0.05, 0.005);
  check(Math.abs(kits.hitStart(justLong).dc - 0.05) < 1e-4, "101 ms past the strike, died away: the DC from the tail");
  // a tail still ringing: a file that does run on 100 ms past its strike, so it is the -45 dB test that
  // leaves the DC alone, not the length
  const stillRinging = ringing(R, 0.05, 1.0);
  const sr = tailFacts(stillRinging);
  check(sr.moved < 22 && sr.pastMs >= 100 && sr.tailDb > -45,
    `the ringing file starts on its strike (${sr.moved} samples), runs ${sr.pastMs.toFixed(0)} ms past it, its tail at ${sr.tailDb.toFixed(1)} dB`);
  check(kits.hitStart(stillRinging).dc === 0, "a tail still ringing (above -45 dB of the peak): no DC");
  // the same file with its tail died away does take the DC from it: only the ringing tells the two apart
  const sameButDead = ringing(R, 0.05, 0.03);
  check(tailFacts(sameButDead).pastMs >= 100 && tailFacts(sameButDead).tailDb < -45 && Math.abs(kits.hitStart(sameButDead).dc - 0.05) < 1e-4,
    "and the same 0.05 offset under a tail that died away is found");
  // with 1 ms or more before the strike the tail isn't looked at: the pre-strike mean stays the rule
  const both = new Float32Array(R);
  for (let i = 0; i < R; i++) both[i] = (i < R - 1102 ? 0.02 : 0.08) + (i >= 100 ? 0.6 * Math.exp(-(i - 100) / (0.01 * R)) * Math.sin(2 * Math.PI * 200 * (i - 100) / R) : 0);
  check(Math.abs(kits.hitStart(both).dc - 0.02) < 1e-4, `1 ms or more before the strike: the DC from there, not the tail (${kits.hitStart(both).dc.toFixed(4)})`);

  // a file cut mid-waveform: its first sample loud, so faded in over 32 samples with a raised cosine
  const midWave = ringing(R, 0, 0.03, Math.PI / 2);   // starts on the crest
  const mw = kits.processHit(midWave, V.kick), mwPlain = processedNoFade(midWave, V.kick);
  check(mw[0] === 0 && Math.abs(mwPlain[0]) > 0.01 * 32767, `a file starting mid-waveform: the first sample ${mw[0]} (it was ${mwPlain[0]})`);
  // the two levelled alike but for the fade's share of the first 80 ms: their ratio at the peak past the fade
  let mwTop = 32;
  for (let i = 33; i < mwPlain.length; i++) if (Math.abs(mwPlain[i]) > Math.abs(mwPlain[mwTop])) mwTop = i;
  const k = mw[mwTop] / mwPlain[mwTop];
  let rising = true, shape = 0;
  for (let j = 1; j < 32; j++) {
    const g = 0.5 - 0.5 * Math.cos(Math.PI * j / 32);
    shape = Math.max(shape, Math.abs(mw[j] - g * mwPlain[j] * k));
    if (Math.abs(mw[j]) < Math.abs(mw[j - 1]) && j < 8) rising = false;
  }
  let pastFade = 0;
  for (let i = 32; i < mw.length - Math.round(0.060 * R); i++) pastFade = Math.max(pastFade, Math.abs(mw[i] - k * mwPlain[i]));
  check(rising && shape <= 2 && pastFade <= 2, `the fade in a raised cosine over 32 samples (off by ${shape.toFixed(1)}), the hit untouched past it (${pastFade.toFixed(1)})`);
  // no fade in on a hit with a lead-in, or whose first sample is quiet
  const quietStart = ringing(R, 0, 0.03, 0);         // starts on a zero crossing
  check(kits.processHit(quietStart, V.kick).slice(0, 32).every((v, i) => v === processedNoFade(quietStart, V.kick)[i]), "a file starting at a zero crossing isn't faded in");
  check(dch[0] === processedNoFade(dcx, V.kick)[0], "a hit with a lead-in and a quiet first sample isn't faded in");
  // a lead-in with hum in it under the onset's 2%: the hit starts 1 ms before the onset, on a sample that
  // levelled is above 1% of full scale, so it is faded in too, wherever it starts
  const hum = new Float32Array(R);
  for (let i = 0; i < R; i++) hum[i] = 0.012 * Math.sin(2 * Math.PI * 50 * i / R)
    + (i >= 1896 ? 0.9 * Math.exp(-(i - 1896) / (0.0015 * R)) * Math.sin(2 * Math.PI * 1000 * (i - 1896) / R) : 0);
  const hs = kits.hitStart(hum), hh = kits.processHit(hum, V.kick), hp = processedNoFade(hum, V.kick);
  check(hs.start > 1800 && hs.onset > 1890 && Math.abs(hp[0]) > 0.01 * 32767,
    `the humming lead-in: the hit starts at ${hs.start}, not 0, its first sample ${hp[0]} levelled, above 1% of full scale`);
  let humTop = 32;
  for (let i = 33; i < hp.length; i++) if (Math.abs(hp[i]) > Math.abs(hp[humTop])) humTop = i;
  const hk = hh[humTop] / hp[humTop];
  let humShape = 0, humPast = 0;
  for (let j = 0; j < 32; j++) humShape = Math.max(humShape, Math.abs(hh[j] - (0.5 - 0.5 * Math.cos(Math.PI * j / 32)) * hp[j] * hk));
  for (let i = 32; i < hh.length - Math.round(0.060 * R); i++) humPast = Math.max(humPast, Math.abs(hh[i] - hk * hp[i]));
  check(hh[0] === 0 && humShape <= 2 && humPast <= 2,
    `so faded in from 0 over 32 samples (first ${hh[0]}, off the raised cosine by ${humShape.toFixed(1)}, past it by ${humPast.toFixed(1)})`);
}

// ---- the CC0 tabla strokes ---------------------------------------------------------------------------
// Real hits whose mean isn't 0 (the bayan's ghe and ke are low and one-sided): decoded to 22,050 Hz mono
// by ffmpeg, as the page's decoder gives them, and each must keep no lead-in past the 1 ms, with its
// strike in the first 2 ms. Skipped with no ffmpeg or no ~/minichord-lab/samples/tabla.
function testTabla() {
  const dir = process.env.TABLA_DIR || path.join(os.homedir(), "minichord-lab/samples/tabla");
  let ffmpeg = true;
  try { execFileSync("ffmpeg", ["-version"], {stdio: "ignore"}); } catch (e) { ffmpeg = false; }
  if (!ffmpeg || !fs.existsSync(dir)) { console.log(`SKIP the tabla strokes: ${ffmpeg ? `no ${dir}` : "no ffmpeg"}`); return; }
  const decode = file => {
    const b = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "22050", "-f", "f32le", "-"], {maxBuffer: 256 << 20});
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  };
  // where a hit's strike is, so that no offset left in it can hide it: the first sample that moves
  // more than 2% of the most it ever moves away from its first
  const strikeOf = hit => {
    let most = 0, at = 0;
    for (const v of hit) most = Math.max(most, Math.abs(v - hit[0]));
    while (Math.abs(hit[at] - hit[0]) <= 0.02 * most) at++;
    return at;
  };
  const file = name => fs.readdirSync(dir).find(f => f.replace(/\.[^.]+$/, "") === name);
  for (const name of ["tabla_ghe7", "tabla_ke3"]) {
    const f = file(name);
    if (!f) { check(false, `${name} in ${dir}`); continue; }
    const x = decode(path.join(dir, f));
    let mean = 0;
    for (const v of x) mean += v;
    mean /= x.length;
    const s = kits.hitStart(x), hit = kits.processHit(x, V["low conga"]);
    const strike = strikeOf(hit);
    // the DC measured before the onset, never the whole sound's mean (the hit's own shape)
    check(Math.abs(s.dc - mean) > 0.01, `${name}: the DC (${s.dc.toFixed(4)}) isn't the whole sound's mean (${mean.toFixed(4)})`);
    check(s.start === Math.max(0, s.onset - 22) && strike <= 44,
      `${name}: no lead-in kept (starts at ${s.start}, onset ${s.onset}) and the strike ${strike} samples in, within 2 ms`);
    if (s.start > 0) check(Math.abs(hit[0]) < 40, `${name}: the first sample kept (${hit[0]}) near 0`);
    else {
      // starting on its stroke: no DC taken out, so the hit is the file scaled, sample for sample, till the fade
      // (past the 32-sample fade in, when its first sample is loud enough to have one)
      let top = 0, off = 0;
      for (let i = 1; i < hit.length; i++) if (Math.abs(hit[i]) > Math.abs(hit[top])) top = i;
      const g = hit[top] / (x[top] - s.dc);
      const faded = Math.abs(g * (x[0] - s.dc)) > 0.01 * 32767;
      for (let i = faded ? 32 : 0; i < hit.length - Math.min(Math.round(0.060 * 22050), Math.floor(hit.length / 3)); i++) off = Math.max(off, Math.abs(hit[i] - g * (x[i] - s.dc)));
      check(Math.abs(s.dc) < 0.01 && off <= 1 && (!faded || hit[0] === 0),
        `${name}: starting on its stroke, little or no DC (${s.dc.toFixed(5)}), the hit the file scaled${faded ? " past its fade in" : ""} (off by ${off.toFixed(2)})`);
    }
  }
  // every stroke: nothing kept before its onset but the 1 ms, and no click at the start of a hit that
  // has a lead-in
  let worst = "";
  for (const f of fs.readdirSync(dir).filter(f => /\.(flac|wav)$/i.test(f))) {
    const x = decode(path.join(dir, f));
    const s = kits.hitStart(x), hit = kits.processHit(x, V["low conga"]);
    if (strikeOf(hit) > 44 || (s.start > 0 && Math.abs(hit[0]) > 100)) worst += ` ${f} (strike ${strikeOf(hit)}, first ${hit[0]})`;
  }
  check(!worst, `every tabla stroke starts within 2 ms of its strike, quietly:${worst || " all"}`);
  // the strokes cut mid-waveform (ke2, ke3, tas2) faded in: no stroke's first sample above 1% of full scale
  let loud = "";
  for (const f of fs.readdirSync(dir).filter(f => /\.(flac|wav)$/i.test(f))) {
    const hit = kits.processHit(decode(path.join(dir, f)), V["low conga"]);
    if (Math.abs(hit[0]) > 0.01 * 32767) loud += ` ${f} (${hit[0]})`;
  }
  check(!loud, `no tabla stroke starts above 1% of full scale:${loud || " none"}`);
  for (const name of ["tabla_ke2", "tabla_ke3", "tabla_tas2"]) {
    const f = file(name);
    if (!f) { check(false, `${name} in ${dir}`); continue; }
    const hit = kits.processHit(decode(path.join(dir, f)), V["low conga"]);
    check(hit[0] === 0 && Math.abs(hit[1]) < Math.abs(hit[16]) + 1, `${name}: faded in from 0 (first ${hit[0]}, ${hit[1]}, ${hit[16]})`);
  }
  // strokes that start on their strike and have died away by the end: a DC added to them found from the
  // tail, so the hit is the same with it as without
  for (const name of ["tabla_tas2", "tabla_na", "tabla_tun2"]) {
    const f = file(name);
    if (!f) { check(false, `${name} in ${dir}`); continue; }
    const x = decode(path.join(dir, f));
    const y = Float32Array.from(x, v => v + 0.1);
    const sx = kits.hitStart(x), sy = kits.hitStart(y);
    const a = kits.processHit(x, V["high conga"]), b = kits.processHit(y, V["high conga"]);
    let off = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) off = Math.max(off, Math.abs(a[i] - b[i]));
    check(sx.start === 0 && Math.abs(sy.dc - sx.dc - 0.1) < 1e-3 && a.length === b.length && off <= 2,
      `${name} + 0.1 DC: found from the tail (${sy.dc.toFixed(4)} against ${sx.dc.toFixed(4)}), the hit the same (off by ${off})`);
  }
  // ke3 runs on under 100 ms past its strike: the length rule, not its tail, leaves its DC alone
  const ke3 = file("tabla_ke3");
  if (ke3) {
    const x = decode(path.join(dir, ke3)), t = tailFacts(x);
    check(t.moved < 22 && t.pastMs < 100 && kits.hitStart(x).dc === 0, `tabla_ke3: ${t.pastMs.toFixed(0)} ms past its strike, too short to measure a DC on`);
  }
  // te_ne starts on its strike and runs on 100 ms past it with its tail still ringing above -45 dB: the
  // ringing branch is what leaves its DC alone, so even 0.1 added to it is not taken out (no tail to trust)
  const teNe = file("tabla_te_ne");
  if (!teNe) check(false, `tabla_te_ne in ${dir}`);
  else {
    const x = decode(path.join(dir, teNe)), t = tailFacts(x);
    check(t.moved < 22 && t.pastMs >= 100 && t.tailDb > -45,
      `tabla_te_ne: its strike ${t.moved} samples in, ${t.pastMs.toFixed(0)} ms past it, its tail at ${t.tailDb.toFixed(1)} dB of the peak`);
    const y = Float32Array.from(x, v => v + 0.1), ty = tailFacts(y);
    check(kits.hitStart(x).dc === 0 && kits.hitStart(y).dc === 0 && ty.pastMs >= 100 && ty.tailDb > -45,
      `tabla_te_ne, plain and with 0.1 added: no DC from a ringing tail (${kits.hitStart(x).dc}, ${kits.hitStart(y).dc})`);
  }
}

// ---- AIFF ---------------------------------------------------------------------------------------------
// an 80-bit extended float, big-endian
function extended(value) {
  const out = Buffer.alloc(10);
  if (value === 0) return out;
  let exponent = Math.floor(Math.log2(value));
  let mantissa = value / 2 ** exponent;       // 1 <= m < 2
  out.writeUInt16BE(exponent + 16383, 0);
  const hi = Math.floor(mantissa * 2 ** 31), lo = Math.round((mantissa * 2 ** 31 - hi) * 2 ** 32);
  out.writeUInt32BE(hi >>> 0, 2);
  out.writeUInt32BE(lo >>> 0, 6);
  return out;
}
function chunk(id, body) {
  const head = Buffer.alloc(8);
  head.write(id, 0, "latin1");
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body, Buffer.alloc(body.length & 1)]);
}
// an AIFF (or AIFC of the compression given) of these integer samples, frame by frame
function writeAiff({rate, bits, channels, samples, compression, extra}) {
  const width = (bits + 7) >> 3;
  const frames = samples.length / channels;
  const comm = Buffer.alloc(compression ? 18 + 4 + 2 : 18);
  comm.writeInt16BE(channels, 0);
  comm.writeUInt32BE(frames, 2);
  comm.writeInt16BE(bits, 6);
  extended(rate).copy(comm, 8);
  if (compression) { comm.write(compression, 18, "latin1"); comm.writeUInt16BE(0, 22); }
  const data = Buffer.alloc(8 + samples.length * width);
  samples.forEach((s, i) => {
    const v = (s << (8 * width - bits)) >>> 0;   // left-justified
    for (let k = 0; k < width; k++) {
      const byte = (v >>> (8 * (width - 1 - k))) & 0xFF;
      data[8 + i * width + (compression === "sowt" ? width - 1 - k : k)] = byte;
    }
  });
  const parts = [chunk("COMM", comm), ...(extra || []), chunk("SSND", data)];
  if (compression) parts.unshift(chunk("FVER", Buffer.from([0xA2, 0x80, 0x51, 0x40])));
  const body = Buffer.concat([Buffer.from(compression ? "AIFC" : "AIFF", "latin1"), ...parts]);
  return chunk("FORM", body);
}

async function testAiff() {
  const {parseAiff, extended80} = await import(path.join(__dirname, "kit-formats/aiff.js"));
  for (const rate of [8000, 11025, 22050, 44100, 48000, 96000, 22050.5]) {
    const b = extended(rate);
    check(extended80(new DataView(b.buffer, b.byteOffset, 10), 0) === rate, `80-bit rate ${rate}`);
  }
  for (const bits of [8, 12, 16, 20, 24, 32]) {
    for (const compression of [null, "NONE", "sowt"]) {
      for (const channels of [1, 2]) {
        const top = 2 ** (bits - 1);
        const values = [0, 1, -1, top - 1, -top, Math.floor(top / 3), -Math.floor(top / 5), 7];
        const samples = [];
        for (let f = 0; f < values.length; f++) for (let c = 0; c < channels; c++) samples.push(values[c ? values.length - 1 - f : f]);
        const file = writeAiff({rate: 44100, bits, channels, samples, compression,
          extra: [chunk("NAME", Buffer.from("odd"))]});   // an odd-length chunk before SSND, padded
        const a = parseAiff(new Uint8Array(file));
        const ok = a.sampleRate === 44100 && a.channels.length === channels && a.frames === values.length &&
          samples.every((s, i) => a.channels[i % channels][Math.floor(i / channels)] === Math.fround(s / top));
        check(ok, `AIFF ${compression || "plain"} ${bits}-bit ${channels === 1 ? "mono" : "stereo"}`);
      }
    }
  }
  for (const compression of ["ima4", "MAC3"]) {
    let message = "";
    try { parseAiff(new Uint8Array(writeAiff({rate: 22050, bits: 16, channels: 1, samples: [1, 2], compression}))); } catch (e) { message = e.message; }
    check(/convert it to WAV/.test(message), `AIFC ${compression} refused with "convert it to WAV"`);
  }
  // an AIFC of these raw sample bytes, COMM's bits as given
  const aifc = (compression, bits, frames, data) => {
    const comm = Buffer.alloc(24);
    comm.writeInt16BE(1, 0); comm.writeUInt32BE(frames, 2); comm.writeInt16BE(bits, 6); extended(22050).copy(comm, 8); comm.write(compression, 18, "latin1");
    return new Uint8Array(chunk("FORM", Buffer.concat([Buffer.from("AIFC"), chunk("COMM", comm), chunk("SSND", Buffer.concat([Buffer.alloc(8), data]))])));
  };
  const floats = [0, 0.5, -0.25, 1, -1];
  const f32 = Buffer.alloc(4 * floats.length), f64 = Buffer.alloc(8 * floats.length);
  floats.forEach((v, i) => { f32.writeFloatBE(v, 4 * i); f64.writeDoubleBE(v, 8 * i); });
  let a = parseAiff(aifc("fl32", 32, floats.length, f32));
  check(a.frames === 5 && floats.every((v, i) => a.channels[0][i] === v), "AIFC fl32");
  a = parseAiff(aifc("fl64", 64, floats.length, f64));
  check(a.frames === 5 && floats.every((v, i) => a.channels[0][i] === v), "AIFC fl64");
  // G.711's known points: mu-law FF and 7F silence, 80 and 00 the loudest; A-law D5 and 55 the
  // quietest (plus and minus 8), AA and 2A the loudest
  a = parseAiff(aifc("ulaw", 16, 4, Buffer.from([0xFF, 0x7F, 0x80, 0x00])));
  check([0, 0, 32124, -32124].every((v, i) => a.channels[0][i] === v / 32768) && a.bits === 8, "AIFC ulaw, though COMM says 16 bits");
  a = parseAiff(aifc("alaw", 16, 4, Buffer.from([0xD5, 0x55, 0xAA, 0x2A])));
  check([8, -8, 32256, -32256].every((v, i) => a.channels[0][i] === v / 32768), "AIFC alaw");
  // malformed edges
  const plain = new Uint8Array(writeAiff({rate: 44100, bits: 16, channels: 1, samples: [1, 2, 3, 4, 5, 6]}));
  const zero = plain.slice();
  new DataView(zero.buffer).setUint32(4, 0);
  a = parseAiff(zero);
  check(a.frames === 6 && a.channels[0][5] === 6 / 32768, "a FORM length of 0 (streamed): read to the end of the file");
  // streamed, as ffmpeg -f aiff to a pipe writes it: FORM 0, SSND 0 and COMM's frames 0
  const streamed = plain.slice(), sv = new DataView(streamed.buffer);
  sv.setUint32(4, 0);
  sv.setUint32(12 + 8 + 2, 0);                        // COMM's frames
  sv.setUint32(12 + 8 + 18 + 4, 0);                   // SSND's length
  a = parseAiff(streamed);
  check(a.frames === 6 && [1, 2, 3, 4, 5, 6].every((v, i) => a.channels[0][i] === v / 32768), "a streamed AIFF: FORM, SSND and frames 0, the frames from SSND's bytes");
  check(parseAiff(streamed, 4).frames === 4, "a streamed AIFF: maxFrames still holds");
  const tooSmall = plain.slice();
  new DataView(tooSmall.buffer).setUint32(4, 4 + 8 + 18);     // AIFF and COMM, not SSND
  a = parseAiff(tooSmall);
  check(a.frames === 6, "a FORM length shorter than its chunks: read to the end of the file");
  const longer = new Uint8Array([...plain, ...Buffer.from("ID3 \0\0\0\4abcd")]);
  check(parseAiff(longer).frames === 6, "bytes after the FORM (a tag) don't upset it");
  let cutSaid = "";
  const cut = new Uint8Array(chunk("FORM", Buffer.concat([Buffer.from("AIFF"), chunk("SSND", Buffer.alloc(16)), Buffer.from("COMM"), Buffer.from([0, 0, 0, 18, 0, 1, 0, 0])])));
  try { parseAiff(cut); } catch (e) { cutSaid = e.message; }
  check(/COMM chunk is cut short/.test(cutSaid), `a COMM cut short by the end of the file: "${cutSaid}"`);
  // a frame limit, as a number or from the rate
  const long = new Uint8Array(writeAiff({rate: 8000, bits: 16, channels: 2, samples: Array.from({length: 2 * 8000 * 3}, (_, i) => i % 100)}));
  check(parseAiff(long, 1000).frames === 1000 && parseAiff(long, rate => 2 * rate).frames === 16000 && parseAiff(long).frames === 24000,
    "maxFrames: a number, or a function of the sample rate");
  let message = "";
  try { parseAiff(new Uint8Array(Buffer.from("RIFF....WAVEfmt "))); } catch (e) { message = e.message; }
  check(/isn't an AIFF/.test(message), "a WAV isn't an AIFF");
  // ffmpeg's own streamed AIFF (-f aiff to a pipe: FORM, SSND and frames left 0), read against the raw
  // samples of the WAV it came from, where ffmpeg is installed
  let ffmpeg = true;
  try { execFileSync("ffmpeg", ["-version"], {stdio: "ignore"}); } catch (e) { ffmpeg = false; }
  if (!ffmpeg) console.log("SKIP a streamed AIFF from ffmpeg: no ffmpeg");
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kits-stream-"));
    const wavFile = path.join(dir, "x.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.25:sample_rate=44100", "-ac", "2", "-y", wavFile]);
    for (const codec of ["pcm_s16be", "pcm_s24be"]) {
      const piped = execFileSync("ffmpeg", ["-v", "error", "-i", wavFile, "-c:a", codec, "-f", "aiff", "-"], {maxBuffer: 64 << 20});
      const pv = new DataView(piped.buffer, piped.byteOffset, piped.length);
      const raw = execFileSync("ffmpeg", ["-v", "error", "-i", wavFile, "-f", "f32le", "-c:a", "pcm_f32le", "-"], {maxBuffer: 64 << 20});
      const f = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
      const zeros = pv.getUint32(4) === 0 && pv.getUint32(12 + 8 + 2) === 0;
      a = parseAiff(new Uint8Array(piped));
      let worst = 0;
      for (let i = 0; i < f.length; i++) worst = Math.max(worst, Math.abs(f[i] - a.channels[i % 2][Math.floor(i / 2)]));
      check(zeros && a.sampleRate === 44100 && a.frames * 2 === f.length && a.frames === Math.round(0.25 * 44100) && worst < 1e-4,
        `ffmpeg's streamed ${codec} AIFF (FORM and frames ${zeros ? "0" : "not 0"}): ${a.frames} frames, off by ${worst}`);
    }
    fs.rmSync(dir, {recursive: true, force: true});
  }
  // sox's own AIFF and AIFC files, read against its raw floats, where sox is installed
  let sox = true;
  try { execFileSync("sox", ["--version"], {stdio: "ignore"}); } catch (e) { sox = false; }
  if (!sox) { console.log("SKIP AIFF files from sox: no sox"); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kits-aiff-"));
  for (const [ext, bits, extra] of [["aiff", 16, []], ["aiff", 24, []], ["aiff", 8, []], ["aifc", 16, []], ["aiff", 32, []],
    ["aifc", 32, ["-e", "floating-point"]], ["aifc", 64, ["-e", "floating-point"]]]) {
    const file = path.join(dir, `t${bits}.${ext}`), raw = path.join(dir, `t${bits}.f32`);
    execFileSync("sox", ["-n", "-r", "48000", "-b", String(bits), "-c", "2", ...extra, file, "synth", "0.05", "sine", "440", "sine", "660", "gain", "-3"]);
    execFileSync("sox", [file, "-t", "f32", "-e", "floating-point", "-b", "32", "-L", raw]);
    const a = parseAiff(new Uint8Array(fs.readFileSync(file)));
    const f = new Float32Array(new Uint8Array(fs.readFileSync(raw)).buffer);
    let worst = 0;
    for (let i = 0; i < f.length; i++) worst = Math.max(worst, Math.abs(f[i] - a.channels[i % 2][Math.floor(i / 2)]));
    check(a.sampleRate === 48000 && a.frames * 2 === f.length && worst < 1e-6, `sox's ${bits}-bit .${ext} read as sox reads it (off by ${worst})`);
  }
  fs.rmSync(dir, {recursive: true, force: true});
}

(async () => {
  testVectors();
  testParts();
  testMapper();
  testProcessing();
  testTabla();
  await testAiff();
  console.log(failures ? `kits_test: ${failures} failed, ${passes} passed` : `kits_test: all ${passes} passed`);
  process.exit(failures ? 1 : 0);
})();
