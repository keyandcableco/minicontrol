//-->>KITS: YOUR OWN DRUM KIT (drum kit 13, firmware 113)
// The player's own one-shots in place of the drum machine's thirteen voices: sound files, a folder of
// them or a .mckit read here, each hit trimmed, faded and levelled, packed into one image and sent to
// the minichord over SysEx, which keeps it in flash and plays it as drum kit 13 ("your own").
//
// The minichord repository's firmware/generator/user_kit.md is the contract: the image (a 256-byte
// header, then the sound), the messages that carry it (F0 7D 6B <op> ... F7), the timers on this
// side and the .mckit file. This file follows it byte for byte, and firmware/generator/user_kit.py is
// its Python reference: kits_test.js builds the reference's test vectors (test/kits/ there) from
// synthetic.json and checks that the image, the .mckit and every message of the upload come out the
// same to the byte. When the two disagree, the contract wins.
//
// The top half is plain functions with nothing of the page in them (the image, its checks, the
// messages, the .mckit, the guess at which file is which voice, and the processing of a hit), which
// node runs in kits_test.js. The bottom half is the page: the kit block under drum kit, which
// generate.py lays out (user_kit_html), and the upload, which kits_browser_test.js runs in headless
// Chrome against a fake minichord.

(function (root) {
"use strict";

// ---- the image (user_kit.md section 1) ------------------------------------------------------------
const HEADER_BYTES = 256;
const FILE_CAPACITY = 262144;     // a file has no capacity of its own: the most any minichord has
const NAME_BYTES = 20;
const VOICE_AT = 44;              // the thirteen voice entries, 16 bytes each
const HEADER_CRC_AT = 252;
const VOICES = 13;
const RATE = 22050;               // what minicontrol writes every hit at
const RATE_MIN = 4000;
const FLAG_PRESS_BENDS = 2;       // pressing the pad on plate 13 bends the hit; 0 = a press chokes it

// drum_machine.h's voice order, with the GM note drum MIDI out sends for each
const VOICE_NAMES = ["kick", "snare", "rim", "clap", "hat", "open hat", "cymbal", "low tom", "high tom",
  "low conga", "high conga", "bell", "shaker"];
const GM_NOTE = [36, 38, 37, 39, 42, 46, 49, 45, 50, 64, 63, 56, 70];

// check_image's reasons, the numbers INFO's reason gives too
const REASONS = ["none", "no kit header (the header sector is blank, or holds other bytes)", "its magic, layout, format, voices or base kit is wrong",
  "its header CRC is wrong", "a bigger firmware moved where its sound starts",
  "a size, the name, a reserved byte or a voice entry is out of its rule", "its sound's CRC is wrong",
  "this firmware leaves too little room for a kit"];
const STATES = ["empty", "valid", "receiving", "damaged", "disabled"];
const STATUSES = ["ok", "busy", "too big", "a bad message or length", "an unsupported protocol",
  "no upload begun", "out of order", "a bad piece CRC", "a flash read-back mismatch",
  "the image CRC didn't match at COMMIT", "the image failed its checks at COMMIT", "the kit slot is disabled"];

// The CRC-32 the contract uses everywhere: reflected 0xEDB88320, init and final value inverted
// (zlib's crc32, the firmware's crc32_update(0, p, n))
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// a hit's samples as 16-bit little-endian bytes
function pcmBytes(samples) {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!Number.isInteger(s) || s < -32768 || s > 32767) throw new Error("a sample is not a 16-bit signed number");
    view.setInt16(2 * i, s, true);
  }
  return out;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// the header's 20 name bytes: printable ASCII, then NULs
function nameField(name) {
  name = String(name || "");
  if (name.length > NAME_BYTES || /[^\x20-\x7E]/.test(name)) throw new Error("a kit name is up to 20 printable ASCII characters");
  const out = new Uint8Array(NAME_BYTES);
  for (let i = 0; i < name.length; i++) out[i] = name.charCodeAt(i);
  return out;
}

// What a kit name typed or found becomes: printable ASCII, 20 characters at most
function cleanName(text) {
  return String(text || "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_BYTES).trim();
}

// The image (header + sound, data_base 0) of a kit: base_kit (1 to 12, in setting 337's numbering),
// name, and 13 voices in voice order, each null (the base kit's own voice plays) or {samples (16-bit
// numbers), rate, level, pan, choke, flags, pitch}. The hits go in voice order from the start of the
// sound, each on a 4-byte boundary with zeros in the gap; a voice whose samples are the same as an
// earlier voice's points at that voice's hit, as the reference does, so every builder makes the same
// image from the same kit.
function buildImage(kit, capacity = FILE_CAPACITY) {
  const voices = kit.voices || [];
  if (voices.length !== VOICES) throw new Error("a kit has 13 voices (null for an empty one)");
  const baseKit = kit.base_kit;
  if (!Number.isInteger(baseKit) || baseKit < 1 || baseKit > 12) throw new Error("base_kit is 1 to 12");
  const hits = [];                // {pcm, at}: where each hit went, so a voice with the same samples shares it
  let soundBytes = 0;
  const entries = voices.map((voice, v) => {
    if (!voice) return null;
    const pcm = pcmBytes(voice.samples);
    const length = pcm.length / 2;
    if (length < 2) throw new Error(`voice ${v} (${VOICE_NAMES[v]}): a hit is at least 2 samples`);
    let hit = hits.find(h => sameBytes(h.pcm, pcm));
    if (!hit) {
      hit = {pcm, at: soundBytes};
      hits.push(hit);
      soundBytes += pcm.length + (-pcm.length & 3);     // the next hit starts on a 4-byte boundary
    }
    const e = {offset: hit.at, length, rate: voice.rate ?? RATE, level: voice.level ?? 100, pan: voice.pan ?? 0,
      choke: voice.choke ?? 0, flags: voice.flags ?? 0, pitch: voice.pitch ?? 0};
    const ok = Number.isInteger(e.rate) && e.rate >= RATE_MIN && e.rate <= 65535 && Number.isInteger(e.level) && e.level >= 0
      && e.level <= 255 && Number.isInteger(e.pan) && e.pan >= -100 && e.pan <= 100 && Number.isInteger(e.choke)
      && e.choke >= 0 && e.choke <= 7 && (e.flags === 0 || e.flags === FLAG_PRESS_BENDS) && Number.isInteger(e.pitch)
      && e.pitch >= 0 && e.pitch <= 65535;
    if (!ok) throw new Error(`voice ${v} (${VOICE_NAMES[v]}): rate 4,000 to 65,535, level 0 to 255, pan -100 to 100, ` +
      "choke 0 to 7, flags 0 or 2, pitch 0 to 65,535");
    return e;
  });
  if (soundBytes > capacity) throw new Error(`the sound is ${soundBytes} bytes, more than the ${capacity} there is room for`);
  const image = new Uint8Array(HEADER_BYTES + soundBytes);
  for (const h of hits) image.set(h.pcm, HEADER_BYTES + h.at);
  const view = new DataView(image.buffer);
  image.set([0x4D, 0x43, 0x4B, 0x31, 1, 0, VOICES, baseKit], 0);   // MCK1, layout 1, format 0 (16-bit PCM)
  view.setUint32(8, 0, true);                                      // data_base: 0 in a file and on the wire
  view.setUint32(12, soundBytes, true);
  view.setUint32(16, crc32(image, HEADER_BYTES), true);
  image.set(nameField(kit.name), 20);
  entries.forEach((e, v) => {
    if (!e) return;
    const at = VOICE_AT + 16 * v;
    view.setUint32(at, e.offset, true);
    view.setUint32(at + 4, e.length, true);
    view.setUint16(at + 8, e.rate, true);
    view.setUint8(at + 10, e.level);
    view.setInt8(at + 11, e.pan);
    view.setUint8(at + 12, e.choke);
    view.setUint8(at + 13, e.flags);
    view.setUint16(at + 14, e.pitch, true);
  });
  view.setUint32(HEADER_CRC_AT, crc32(image, 0, HEADER_CRC_AT), true);
  return image;
}

// the header's fields, and the voice entries as a list
function readHeader(image) {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const entries = [];
  for (let v = 0; v < VOICES; v++) {
    const at = VOICE_AT + 16 * v;
    entries.push({offset: view.getUint32(at, true), length: view.getUint32(at + 4, true), rate: view.getUint16(at + 8, true),
      level: view.getUint8(at + 10), pan: view.getInt8(at + 11), choke: view.getUint8(at + 12), flags: view.getUint8(at + 13),
      pitch: view.getUint16(at + 14, true)});
  }
  const nameBytes = image.subarray(20, 40);
  const nul = nameBytes.indexOf(0);
  return {magic: String.fromCharCode(...image.subarray(0, 4)), layout: image[4], format: image[5], voices: image[6],
    base_kit: image[7], data_base: view.getUint32(8, true), data_bytes: view.getUint32(12, true),
    data_crc: view.getUint32(16, true), nameBytes, name: String.fromCharCode(...(nul < 0 ? nameBytes : nameBytes.subarray(0, nul))),
    reserved: view.getUint32(40, true), entries, header_crc: view.getUint32(HEADER_CRC_AT, true)};
}

// a NUL may only be followed by NULs, and what comes before the first is printable (empty is allowed)
function nameOk(field) {
  let end = field.length;
  while (end > 0 && field[end - 1] === 0) end--;
  for (let i = 0; i < end; i++) if (field[i] < 0x20 || field[i] > 0x7E) return false;
  return true;
}

function entryOk(e, dataBytes) {
  if (e.length === 0) return !(e.offset || e.rate || e.level || e.pan || e.choke || e.flags || e.pitch);
  // in doubles, offset + 2 * length can't wrap as 32 bits would
  return e.offset % 4 === 0 && e.length >= 2 && e.offset + 2 * e.length <= dataBytes && e.rate >= RATE_MIN
    && e.pan >= -100 && e.pan <= 100 && e.choke <= 7 && !(e.flags & ~FLAG_PRESS_BENDS);
}

// The reason an image fails, the first of the contract's checks in its order; 0 when it passes them
// all. dataBase is what the header's must be: 0 in a file or on the wire.
function checkImage(image, dataBase = 0, capacity = FILE_CAPACITY) {
  const size = image.length;
  if (size < HEADER_BYTES || size % 4) return 5;
  const h = readHeader(image);
  if (h.magic !== "MCK1" || h.layout !== 1 || h.format !== 0 || h.voices !== VOICES || h.base_kit < 1 || h.base_kit > 12) return 2;
  if (crc32(image, 0, HEADER_CRC_AT) !== h.header_crc) return 3;
  if (h.data_base !== dataBase) return 4;
  const d = h.data_bytes;
  if (d !== size - HEADER_BYTES || d % 4 || d > capacity || h.reserved || !nameOk(h.nameBytes)
    || !h.entries.every(e => entryOk(e, d))) return 5;
  if (crc32(image, HEADER_BYTES) !== h.data_crc) return 6;
  return 0;
}

// An image back into a kit to edit or play: each filled voice's samples as they are stored
function imageVoices(image) {
  const h = readHeader(image);
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  return h.entries.map(e => {
    if (!e.length) return null;
    const samples = new Int16Array(e.length);
    for (let i = 0; i < e.length; i++) samples[i] = view.getInt16(HEADER_BYTES + e.offset + 2 * i, true);
    return Object.assign({samples}, e);
  });
}

// ---- the SysEx messages (section 3) ---------------------------------------------------------------
const PIECE = 224;                  // raw bytes in a DATA piece: 256 packed
const OP = {BEGIN: 1, DATA: 2, COMMIT: 3, ABORT: 4, INFO: 5, CLEAR: 6};
const REPLY = 0x40;

// a number as 7-bit groups, least significant first: n2, n3 and n5
function groups(value, count) {
  if (!Number.isInteger(value) || value < 0 || value >= 2 ** (7 * count)) throw new Error(`${value} does not fit ${count} groups of 7 bits`);
  const out = [];
  for (let i = 0; i < count; i++) { out.push(value % 128); value = Math.floor(value / 128); }
  return out;
}
function ungroup(bytes) {
  let v = 0;
  for (let i = bytes.length - 1; i >= 0; i--) v = v * 128 + bytes[i];
  return v;
}

// 8-to-7 packing: each group of up to 7 raw bytes becomes a byte of their bit 7s (bit j for byte j),
// then the bytes with bit 7 cleared
function pack87(raw) {
  const out = [];
  for (let at = 0; at < raw.length; at += 7) {
    const end = Math.min(at + 7, raw.length);
    let high = 0;
    for (let j = at; j < end; j++) high |= (raw[j] >> 7) << (j - at);
    out.push(high);
    for (let j = at; j < end; j++) out.push(raw[j] & 0x7F);
  }
  return out;
}

function message(op, body) {
  return Uint8Array.from([0xF0, 0x7D, 0x6B, op, ...body, 0xF7]);
}
const beginMessage = (size, crc) => message(OP.BEGIN, [1, ...groups(size, 3), ...groups(crc, 5)]);
function dataMessage(image, offset) {
  const piece = image.subarray(offset, offset + Math.min(PIECE, image.length - offset));
  return message(OP.DATA, [...groups(offset, 3), ...groups(crc32(piece), 5), ...pack87(piece)]);
}
const commitMessage = () => message(OP.COMMIT, [0, 0]);
const abortMessage = () => message(OP.ABORT, [0, 0]);
const infoMessage = () => message(OP.INFO, [1, 0]);
const clearMessage = () => message(OP.CLEAR, [0, 0x43, 0x4C]);    // "CL", so a stray byte can't clear a kit

// every message of an image's upload, in order: BEGIN, its DATA pieces from offset 0, COMMIT
function frames(image) {
  const out = [beginMessage(image.length, crc32(image))];
  for (let at = 0; at < image.length; at += PIECE) out.push(dataMessage(image, at));
  out.push(commitMessage());
  return out;
}

// A reply from the minichord: {kind: "status", op, status, next} or {kind: "info", ...}; null for a
// message that isn't a kit reply at all, and an error for a kit reply that is malformed. The two are
// told apart by their length, as a malformed INFO gets a status reply with op 0x45 too.
function parseReply(msg) {
  if (msg.length < 5 || msg[0] !== 0xF0 || msg[1] !== 0x7D || msg[2] !== 0x6B || !(msg[3] & REPLY)) return null;
  if (msg[msg.length - 1] !== 0xF7) throw new Error("a malformed kit reply");
  for (let i = 1; i < msg.length - 1; i++) if (msg[i] > 0x7F) throw new Error("a malformed kit reply");
  if (msg.length === 9) return {kind: "status", op: msg[3] & 0x3F, status: msg[4], next: ungroup(msg.subarray(5, 8))};
  if (msg.length === 49 && msg[3] === (REPLY | OP.INFO)) {
    const b = msg.subarray(4, 48);
    const name = b.subarray(24, 44);
    const nul = name.indexOf(0);
    return {kind: "info", proto: b[0], state: b[1], reason: b[2], capacity: ungroup(b.subarray(3, 6)),
      data_base: ungroup(b.subarray(6, 11)), size: ungroup(b.subarray(11, 14)), crc: ungroup(b.subarray(14, 19)),
      largest: ungroup(b.subarray(19, 21)), base_kit: b[21], filled: ungroup(b.subarray(22, 24)),
      name: String.fromCharCode(...(nul < 0 ? name : name.subarray(0, nul)))};
  }
  throw new Error(`a kit reply of ${msg.length} bytes (op ${msg[3].toString(16)})`);
}

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

// ---- the .mckit file (section 6) ------------------------------------------------------------------
// The JSON is written as Python's json.dumps(meta, sort_keys=True, separators=(',', ':')) writes it, so
// a .mckit made here is the same to the byte as one made by the reference or minictl: keys sorted at
// every depth, no spaces, and everything outside printable ASCII escaped as \uXXXX (ensure_ascii).
function pyString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5C) out += "\\\\";
    else if (c === 0x0A) out += "\\n";
    else if (c === 0x0D) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0C) out += "\\f";
    else if (c < 0x20 || c > 0x7E) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += s[i];
  }
  return out + '"';
}
function pyJson(v) {
  if (v === null || v === undefined) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    if (!isFinite(v)) return isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
    return String(v).replace(/e([+-])(\d)$/, "e$10$2");   // Python writes 1e-07 where JS writes 1e-7
  }
  if (typeof v === "string") return pyString(v);
  if (Array.isArray(v)) return "[" + v.map(pyJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => pyString(k) + ":" + pyJson(v[k])).join(",") + "}";
}

// "MCKF", version 1, three 0s, the JSON's length (4 bytes, little-endian), the JSON, the image verbatim
function writeMckit(meta, image) {
  const text = pyJson(meta);       // all ASCII, so its UTF-8 is its characters
  const out = new Uint8Array(12 + text.length + image.length);
  out.set([0x4D, 0x43, 0x4B, 0x46, 1, 0, 0, 0], 0);
  new DataView(out.buffer).setUint32(8, text.length, true);
  for (let i = 0; i < text.length; i++) out[12 + i] = text.charCodeAt(i);
  out.set(image, 12 + text.length);
  return out;
}

// {meta, image} from a .mckit's bytes, or an error if it isn't one. The image isn't checked here: a
// reader runs checkImage on it before using or sending it.
function readMckit(bytes) {
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "MCKF") throw new Error("it isn't a .mckit file");
  if (bytes[4] !== 1 || bytes[5] || bytes[6] || bytes[7]) throw new Error(`it is a .mckit of version ${bytes[4]}: this page reads version 1`);
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (12 + n > bytes.length) throw new Error("the .mckit ends inside its description");
  let meta;
  try {
    meta = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(12, 12 + n)));
  } catch (e) {
    throw new Error("the .mckit's description isn't readable JSON");
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("the .mckit's description isn't a JSON object");
  return {meta, image: bytes.slice(12 + n)};
}

// ---- which file is which voice: the mapping guess ---------------------------------------------------
// From the file names alone, in steps, each filling only the voices still empty:
//   1. a GM drum note that agrees with a drum word in the path, tagged "GM 42". The GM note is the lone
//      one in the file's own name, a number 27 to 87 standing on its own (not stuck to letters, so
//      44k, 48k and 70s don't count, and never one with a decimal point or a unit: 44.1kHz, 48.0k, 96k,
//      24bit, 120bpm, 90 BPM) or a note name (C1 = 36, as drum racks and most sample packs name them:
//      C3 = middle C). A drum word anywhere in the path, the file's own name or a folder's, beats a GM
//      note that points at another voice (a "Kick F#1" tuned to F# and a "Kicks/38.wav" are still
//      kicks): the note agrees when it points at the voice the word names, or at one of its family's
//      when the word names a family with no side (a tom, a conga, a hat: "Hats/46.wav" is the open hat,
//      unless a file in the set names an open hat). A note name counts only here, with a word agreeing.
//      Numbers that are indexes are never GM notes: a run of three or more in one folder, the names the
//      same but for the number, mostly consecutive and starting at 0 to 9 (Kick 01 to Kick 40, Hats/01 to
//      50), as indexFiles says;
//   2. the name's words, matched as whole tokens (split on _ - . spaces, digits and camelCase, the
//      folders' names counting where the file's own name has none), tagged "from the name hh";
//   3. a tom or conga with no low or high in its name, two of them left: ordered by GM note, then a
//      word (big, deep... before small, tight...), then for toms the number in the name as drum kits
//      number them (Tom 1 the highest rack tom, the highest number the floor tom), then file order,
//      the first the low one, the last the high one, tagged "guessed";
//   4. a GM number in a path with no drum word anywhere (a "Percussion/Perc 38"), tagged "GM 38": only
//      for the voices the name steps left empty, so it never takes a named drum's place, and never in a
//      path with a melodic or effect word (NOT_DRUMS: "Vocals/Vox 38", "FX/Riser 49") or for a note name
//      ("Keys/Piano C2", "Bass/Sub E1" are pitches, not drums);
//   5. the rest to the "not used" bin.
// The files go through those steps in three groups, all of a group's steps before the next group's: the
// one-shots under a One Shots folder (One Shots, One-Shots, Oneshots, Drum One Shots) first, then the
// rest, and the loops and effects last: a path with a loop or effect word (LOOP_WORDS: loop, fx, riser,
// build, sweep, impact, fill, roll, break, groove...) or a tempo (128 BPM, 90bpm), drum word or not. So an
// "FX/Kick Riser", a "Loops/Clap Loop 1 - 128 BPM" or a "Drum Loops/Hihat Loops/Hihat Loop 1 - 90 BPM"
// takes a voice only when no one-shot names it, and is a voice's candidate after every one-shot. The
// words count in the file's own name and its folders, but not in a folder every file is in (the pack's
// own: a "Lofi Grooves" pack's one-shots are one-shots) nor above a One Shots folder, as standing says.
// A tom's or conga's side (lo, hi, floor, rack, LT, HT...) and size word are looked for where its
// family word was found: in the file's own name only, when the word is there (so a "Low End" folder
// doesn't make every tom in it a low one); in the file's name and the folders up to the one with the
// word, when the word is a folder's ("Toms/low.wav"). A mid tom or conga (mid, MT, MC) is the high one
// when no file names a high one. LoFi and HiFi (Lo-Fi, Low-Fi, Lofi, hi fi, LOFI) are one word, never a side.
// A sound in layers (v1-v4, rr1-rr3, soft and hard) is one sound: the first in file order is used,
// the rest are its alternates. Each voice's GM notes, best first:
const GM_NOTES = [[36, 35], [38, 40], [37], [39], [42, 44], [46], [49, 57, 55, 52, 51, 59], [45, 43, 41], [50, 48, 47],
  [64, 61, 66], [63, 62, 60, 65], [56, 53, 67, 80, 81], [70, 82, 69, 54]];
const GM_VOICE = new Map();
GM_NOTES.forEach((notes, v) => notes.forEach((note, rank) => GM_VOICE.set(note, {voice: v, rank})));
// The words, in the order a name is tried: the first family with a word in it names the voice. So a
// snare's rimshot is the rim, a conga's open tone is a conga, and open wins over hat. Within a family
// a word's place is its rank (crash before ride). The 808 and 909's abbreviations are here too (BD, SD,
// LT, MT, HT, LC, MC, HC, RS, CP, CB, CY, MA, OH, CH, HH), and the joined names a pack writes in capitals
// (OPENHH, HHCLOSED, PEDALHAT, LOTOM, TOMHI, CONGALOW, BONGOHI, SNARERIM, SPLASHCYMBAL, RIDEBELL...). A
// ride bell, written either way, is the bell, as GM's 53 is.
const NAME_WORDS = [
  {voice: 2, words: ["rim", "rimshot", "sidestick", "stick", "rs", "snarerim", "rimsnare"], pairs: [["side", "stick"]]},
  {voice: 3, words: ["clap", "cp", "handclap"]},
  {voice: 0, words: ["kick", "kik", "bd", "bassdrum", "kickdrum"], pairs: [["bass", "drum"]]},
  {voice: 1, words: ["snare", "snr", "sd", "snaredrum"]},
  {family: "tom", words: ["tom", "floortom", "racktom", "lowtom", "hightom", "midtom", "lt", "ht", "mt", "lotom", "hitom", "tomlow", "tomhi",
    "tomhigh"]},
  {family: "conga", words: ["conga", "bongo", "timbale", "timbales", "tumba", "quinto", "lc", "hc", "mc", "lowconga", "highconga", "hiconga",
    "loconga", "congalow", "congahi", "congahigh", "bongohi", "bongolo"]},
  {voice: 11, words: ["cowbell", "bell", "cb", "agogo", "triangle", "ridebell"]},
  {voice: 12, words: ["shaker", "maraca", "maracas", "cabasa", "tambourine", "tamb", "ma"]},
  {voice: 6, words: ["crash", "crashcymbal", "cymbal", "cym", "cy", "splash", "splashcymbal", "china", "chinacymbal", "ride", "ridecymbal"]},
  {voice: 5, words: ["open", "oh", "ohh", "openhat", "openhihat", "hihatopen", "openhh", "hhopen"]},
  {voice: 4, words: ["closed", "chh", "ch", "closedhat", "closedhihat", "hihatclosed", "hh", "hat", "hihat", "pedal", "closedhh", "hhclosed",
    "hihatpedal", "pedalhat", "pedalhh"]},
];
// The two-letter abbreviations count only in a name whose other words are all drum, sound or machine
// words (DRUM_CONTEXT; numbers and one letter, a note's or a take's, are no words), or a machine's prefix
// before the abbreviation: a word of two to five capitals and digits that isn't a melodic or effect word
// (KB_BD_01, XR10 SD, but not VOX OH). "OH", "OH 01", "808 OH", "BD_02", "BD Long", "SD Snappy", "DMX BD",
// "CR78 CP" and "Ch 1 Room" do; "Vox Oh", "MC Shout", "Oh Yeah" and "SD Card" don't. And a full word in
// the same name beats them: "Kick RS" is a kick.
const ABBREVIATIONS = ["bd", "sd", "rs", "cp", "ch", "oh", "cb", "cy", "ma", "lt", "mt", "ht", "lc", "mc", "hc", "hh"];
// a hat word that says nothing of open or closed: a GM note for the closed hat agrees with it, and one
// for the open hat too when no file in the set names an open hat
const ANY_HAT = ["hh", "hat", "hihat"];
const SIDES = {
  tom: {low: ["lo", "low", "floor", "ft", "floortom", "lowtom", "lt", "lotom", "tomlow"],
    high: ["hi", "high", "rack", "racktom", "hightom", "ht", "hitom", "tomhi", "tomhigh"], mid: ["mid", "midtom", "mt"], voices: [7, 8]},
  conga: {low: ["low", "lo", "tumba", "lc", "lowconga", "loconga", "congalow", "bongolo"],
    high: ["high", "hi", "quinto", "hc", "highconga", "hiconga", "congahi", "congahigh", "bongohi"], mid: ["mid", "mc"], voices: [9, 10]},
};
const LOWISH = ["big", "large", "deep", "fat", "bass"];
const HIGHISH = ["small", "little", "tight", "short"];
// the other words a name with an abbreviation may have, besides the drum words above and the sides: the
// kit's, the sound's and the machine's (CR78 and LM1 are cr and lm here, as numbers are no words, and 606,
// 707, 808 and 909 are numbers)
const DRUM_CONTEXT = ["drum", "drums", "kit", "perc", "tr", "big", "large", "deep", "fat", "small", "little", "tight", "short", "long",
  "dry", "wet", "punchy", "snappy", "sub", "hard", "soft", "room", "close", "far", "dmx", "linn", "linndrum", "kb", "cr", "lm"];
// a machine's prefix before an abbreviation: two to five capitals and digits, a capital among them
const MACHINE_PREFIX = /^(?=[0-9]*[A-Z])[A-Z0-9]{2,5}$/;
// A melodic or effect word: a path with one and no drum word has no GM note ("Vocals/Vox 38", "FX/Riser
// 49" and "Bass/Sub 40" are no drums)
const NOT_DRUMS = ["vox", "vocal", "vocals", "voice", "keys", "key", "piano", "bass", "sub", "synth", "pad", "lead", "chord", "chords", "arp",
  "pluck", "string", "strings", "brass", "fx", "sfx", "riser", "impact", "sweep", "loop", "loops", "melody", "guitar"];
// A loop or an effect, not a one-shot, whatever drum it names: it ranks after every one-shot
const LOOP_WORDS = ["loop", "loops", "fx", "sfx", "riser", "build", "buildup", "sweep", "impact", "fill", "fills", "roll", "break", "breaks",
  "groove", "grooves"];
// a tempo: 128 BPM, 90bpm, 120_BPM, BPM 140
const TEMPO = /(?<![0-9])[0-9]{2,3}(?:[.,][0-9]+)?[ _-]?bpm(?![a-z])|(?<![a-z])bpm[ _-]?[0-9]{2,3}(?![0-9])/i;
// a folder of one-shots: One Shots, One-Shots, One_Shot, Oneshots, OneShots, Drum One Shots, One Shot Drums
const ONE_SHOTS = /^(drums?)?oneshots?(drums?)?$/;
const LAYER = /(^|[^a-z0-9])(v[1-4]|rr[1-3]|soft|hard)(?![a-z0-9])/i;
// a number with a unit (44k, 44.1kHz, 44_1k, 24bit, 24 bit, 120bpm, 90 BPM) or a decimal point: never a GM note
const UNIT_NUMBER = /(?<![A-Za-z0-9])[0-9]+(?:[._,][0-9]+)?(?:k|khz|kbps|\s?(?:hz|khz|bits?|bpm))(?![A-Za-z])/gi;
const DECIMAL = /[0-9]+[.,][0-9]+/g;

function splitPath(path) {
  const parts = String(path).split(/[\\/]+/).filter(Boolean);
  const file = parts.pop() || "";
  const dot = file.lastIndexOf(".");
  return {folders: parts, base: dot > 0 ? file.slice(0, dot) : file};
}

// a name's words: split on everything but letters (so on _ - . spaces and digits), and on camelCase,
// with LoFi and HiFi (joined, or with a space or hyphen, any case) kept as one word
function nameTokens(text) {
  return String(text).replace(/(^|[^A-Za-z])([Ll][Oo][Ww]?|[Hh][Ii])[ _-]?([Ff][Ii])(?![a-z])/g,
    (m, lead, side) => `${lead} ${side.slice(0, 2).toLowerCase()}fi `)
    .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z]+/).filter(Boolean).map(t => t.toLowerCase());
}

// a file's own name with its layer words (v2, rr1) and its numbers with units taken out
function plainBase(path) {
  let base = splitPath(path).base;
  while (LAYER.test(base)) base = base.replace(LAYER, "$1 ");
  return base.replace(UNIT_NUMBER, " ").replace(DECIMAL, " ");
}

const NOTE_PC = {c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11};
// a number standing on its own: not part of 44k, 70s or 808s
const LONE_NUMBER = /(?<![A-Za-z0-9])[0-9]+(?![A-Za-z0-9])/g;
// the lone GM note in a file's own name (not its folders), or null: {note (the GM number), named (true
// for a note name, false for a number)}. The name's only number standing on its own, or its only note
// name, with any layer word (v2, rr1) and number with a unit taken out first.
function gmFound(path) {
  let base = plainBase(path);
  const found = [];
  base = base.replace(/(^|[^A-Za-z0-9#])([A-Ga-g])(#|b)?(-?[0-9])(?![A-Za-z0-9])/g, (m, lead, letter, accidental, octave) => {
    found.push({note: (parseInt(octave) + 2) * 12 + NOTE_PC[letter.toLowerCase()] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0),
      named: true});
    return lead + " ";
  });
  for (const m of base.matchAll(LONE_NUMBER)) found.push({note: parseInt(m[0], 10), named: false});
  if (found.length !== 1 || found[0].note < 27 || found[0].note > 87) return null;
  return found[0];
}
function gmOf(path) {
  const found = gmFound(path);
  return found ? found.note : null;
}

// Numbers that are indexes, never GM notes: the files (by index) of every run of three or more in one
// folder whose names are the same but for their last number standing on its own ("Kick 01" to "Kick 40",
// "Hats/01" to "Hats/50", "Cymatics - Hihat 1" to 50), when those numbers are mostly consecutive (at
// least half the steps between them one) and start at 0 to 9, as a pack numbers its takes. A run that
// starts at 10 or above is a GM kit exported note by note (24.wav to 84.wav from C0, 35.wav to 81.wav)
// and keeps its notes; numbers with steps of two or more (Hats/42, 44, 46) are GM notes too.
function indexFiles(paths) {
  const runs = new Map();
  paths.forEach((path, i) => {
    const {folders} = splitPath(path);
    const base = plainBase(path);
    const all = [...base.matchAll(LONE_NUMBER)];
    if (!all.length) return;
    const last = all[all.length - 1];
    const rest = (base.slice(0, last.index) + "#" + base.slice(last.index + last[0].length)).toLowerCase().replace(/[\s_-]+/g, " ").trim();
    const key = [...folders.map(f => f.toLowerCase()), rest].join("/");
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push({i, number: parseInt(last[0], 10)});
  });
  const out = new Set();
  for (const files of runs.values()) {
    const numbers = [...new Set(files.map(f => f.number))].sort((a, b) => a - b);
    if (numbers.length < 3 || numbers[0] > 9) continue;
    let ones = 0;
    for (let k = 1; k < numbers.length; k++) if (numbers[k] - numbers[k - 1] === 1) ones++;
    if (2 * ones >= numbers.length - 1) files.forEach(f => out.add(f.i));
  }
  return out;
}

// the last number in a file's own name (Tom 3, RackTom1, Toms/2.wav), or null: a tom's place in the kit
function numberOf(path) {
  const all = plainBase(path).match(/[0-9]+/g);
  return all ? parseInt(all[all.length - 1], 10) : null;
}

function matchWord(list, token) {
  let i = list.indexOf(token);
  if (i < 0 && token.length > 3 && token.endsWith("s")) i = list.indexOf(token.slice(0, -1));   // toms, claps, hats
  if (i < 0 && token.length > 5 && token.endsWith("es")) i = list.indexOf(token.slice(0, -2));  // crashes, splashes
  return i;
}

const isDrumWord = t => t.length === 1 || DRUM_CONTEXT.includes(t) || NAME_WORDS.some(e => matchWord(e.words, t) >= 0)
  || Object.values(SIDES).some(s => s.low.includes(t) || s.high.includes(t) || s.mid.includes(t));

// Whether a name's two-letter abbreviation counts: its other words all drum, sound or machine words (or
// numbers, or one letter), or, before the abbreviation, a machine's prefix in capitals and digits that
// isn't a melodic or effect word (the KB of KB_BD_01, not the VOX of VOX OH)
function abbreviationCounts(text) {
  const words = String(text).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const at = words.findIndex(w => nameTokens(w).some(t => ABBREVIATIONS.includes(t)));
  const prefixes = new Set(words.slice(0, Math.max(at, 0)).filter(w => MACHINE_PREFIX.test(w)).flatMap(nameTokens)
    .filter(t => matchWord(NOT_DRUMS, t) < 0));
  return nameTokens(text).every(t => isDrumWord(t) || prefixes.has(t));
}

// what a file's name says it is: {voice (or family and side), word, rank, mid (a mid tom or conga, the
// high one when there is no other), anyHat (a hat word that says nothing of open or closed)}, or null.
// The file's own name first, then its folders from the nearest; in each, the full words first and only
// then the two-letter abbreviations, when abbreviationCounts says they count in that name.
function nameLook(path) {
  const {folders, base} = splitPath(path);
  const sources = [nameTokens(base), ...folders.slice().reverse().map(nameTokens)];
  // each name as it is written, its layer words and numbers with units out, for the abbreviations' rule
  const plain = [plainBase(path), ...folders.slice().reverse()];
  const lookIn = (k, abbreviations) => {
    const tokens = sources[k];
    for (const entry of NAME_WORDS) {
      let hit = null;
      for (const t of tokens) {
        if (ABBREVIATIONS.includes(t) !== abbreviations) continue;
        const rank = matchWord(entry.words, t);
        if (rank >= 0 && (!hit || rank < hit.rank)) hit = {word: t, rank};
      }
      for (const [a, b] of abbreviations ? [] : entry.pairs || []) {
        for (let i = 0; i + 1 < tokens.length; i++) {
          if (tokens[i] === a && tokens[i + 1] === b && !hit) hit = {word: `${a} ${b}`, rank: entry.words.length};
        }
      }
      if (!hit) continue;
      if (entry.voice !== undefined) {
        return {voice: entry.voice, word: hit.word, rank: hit.rank, anyHat: entry.voice === 4 && matchWord(ANY_HAT, hit.word) >= 0};
      }
      // the side and size where the family word was: the file's name, and the folders up to its own
      const near = sources.slice(0, k + 1).flat();
      const sides = SIDES[entry.family];
      const named = t => hit.word === t ? t : `${hit.word} ${t}`;
      for (const t of [hit.word, ...near]) {
        if (sides.low.includes(t)) return {voice: sides.voices[0], family: entry.family, word: named(t), rank: hit.rank};
        if (sides.high.includes(t)) return {voice: sides.voices[1], family: entry.family, word: named(t), rank: hit.rank};
        if (sides.mid.includes(t)) return {voice: sides.voices[1], family: entry.family, word: named(t), rank: hit.rank, mid: true};
      }
      const size = near.some(t => LOWISH.includes(t)) ? 0 : near.some(t => HIGHISH.includes(t)) ? 2 : 1;
      return {voice: null, family: entry.family, word: hit.word, rank: hit.rank, size};
    }
    return null;
  };
  for (let k = 0; k < sources.length; k++) {
    const found = lookIn(k, false) || (abbreviationCounts(plain[k]) ? lookIn(k, true) : null);
    if (found) return found;
  }
  return null;
}

// a melodic or effect word anywhere in a path: its file's own name or a folder's
function notDrums(path) {
  const {folders, base} = splitPath(path);
  return [base, ...folders].some(text => nameTokens(text).some(t => matchWord(NOT_DRUMS, t) >= 0));
}

// How a file's GM note ({note, named}, as gmFound gives it) counts: "agrees" when a drum word in its path
// names the voice it points at (or a family it is one of: a tom or conga with no side, a hat that is
// neither open nor closed, the open hat only when no file in the set names one), "alone" when its path
// has no drum word at all, the note is a number and no melodic or effect word is there, and null
// otherwise (the word wins), whether the word is in the file's own name or a folder's. A note name
// (C2, A1, F#1) counts only when a drum word agrees: alone it is a melodic sound's pitch.
function gmCounts(found, name, path, openNamed = false) {
  const g = found && GM_VOICE.get(found.note);
  if (!g) return null;
  if (!name) return found.named || notDrums(path) ? null : "alone";
  if (name.voice != null && name.anyHat) return g.voice === 4 || (g.voice === 5 && !openNamed) ? "agrees" : null;
  if (name.voice != null) return g.voice === name.voice ? "agrees" : null;
  return SIDES[name.family].voices.includes(g.voice) ? "agrees" : null;
}

// Each file's group in the steps: 0 a one-shot under a One Shots folder, 2 a loop or an effect, 1 the
// rest. The loop and effect words and the tempo are looked for in the file's own name and the folders
// below both its One Shots folder and the folders every file in the set is in (the pack's own, which
// name the pack, not the sound: "Lofi Grooves/Kicks/Kick 1" is a one-shot, "Lofi Grooves/Drum Loops/Kick
// Loop 1" a loop). A loop word in a file's own name makes it a loop even under One Shots ("One
// Shots/FX/Kick Riser" is an effect).
function standings(paths) {
  const split = paths.map(splitPath);
  let common = split.length ? Math.min(...split.map(s => s.folders.length)) : 0;
  for (let k = 0; k < common; k++) if (split.some(s => s.folders[k] !== split[0].folders[k])) { common = k; break; }
  return split.map(({folders, base}) => {
    let shots = -1;
    folders.forEach((folder, k) => { if (ONE_SHOTS.test(nameTokens(folder).join(""))) shots = k; });
    const parts = [base, ...folders.slice(Math.max(common, shots + 1))];
    if (parts.some(text => TEMPO.test(text) || nameTokens(text).some(t => matchWord(LOOP_WORDS, t) >= 0))) return 2;
    return shots >= 0 ? 0 : 1;
  });
}

// The guess for a list of paths in file order: {assign (13 of {file, tag, guessed} or null), candidates
// (13 lists of {file, tag}, likeliest first), alternates ({file: [its other layers]}), unused (the
// files no voice has), looks (what each file's name said, and whether it is a loop or effect or under
// a One Shots folder)}
function mapKit(paths) {
  const n = paths.length;
  const alternates = {};
  const isAlternate = new Array(n).fill(false);
  const firstOfLayer = new Map();
  paths.forEach((path, i) => {
    const {folders, base} = splitPath(path);
    if (!LAYER.test(base)) return;
    let rest = base;
    while (LAYER.test(rest)) rest = rest.replace(LAYER, "$1 ");
    const key = [...folders, nameTokens(rest).join(" ") + "|" + (rest.match(/[0-9]+/g) || []).join(" ")].join("/").toLowerCase();
    if (firstOfLayer.has(key)) {
      const main = firstOfLayer.get(key);
      (alternates[main] = alternates[main] || []).push(i);
      isAlternate[i] = true;
    } else firstOfLayer.set(key, i);
  });
  const names = paths.map(nameLook);
  const openNamed = names.some(name => name && name.voice === 5);
  const indexes = indexFiles(paths);
  const groups = standings(paths);
  const looks = paths.map((path, i) => {
    const name = names[i], found = indexes.has(i) ? null : gmFound(path), counts = gmCounts(found, name, path, openNamed);
    return {gm: counts ? found.note : null, gmAlone: counts === "alone", name, loop: groups[i] === 2, oneShot: groups[i] === 0};
  });
  const candidates = Array.from({length: VOICES}, () => []);
  paths.forEach((path, i) => {
    if (isAlternate[i]) return;
    const {gm, gmAlone, name} = looks[i];
    const group = groups[i];
    const g = gm != null && GM_VOICE.get(gm);
    if (g) candidates[g.voice].push({file: i, tag: `GM ${gm}`, group, step: gmAlone ? 4 : 1, key: [group, gmAlone ? 4 : 1, g.rank, 0, 0, i]});
    if (name && name.voice != null) {
      candidates[name.voice].push({file: i, tag: `from the name ${name.word}`, group, step: 2, key: [group, 2, name.rank, name.mid ? 1 : 0, 0, i]});
    }
    if (name && name.voice == null) {
      // toms numbered as drum kits number them: the highest number the low (floor) tom, Tom 1 the high one
      const number = name.family === "tom" ? numberOf(path) : null;
      for (const v of SIDES[name.family].voices) {
        candidates[v].push({file: i, tag: "guessed", group, step: 3, key: [group, 3, gm ?? 1000, name.size, number == null ? 0 : -number, i]});
      }
    }
  });
  const cmp = (a, b) => { for (let k = 0; k < a.key.length; k++) if (a.key[k] !== b.key[k]) return a.key[k] - b.key[k]; return 0; };
  candidates.forEach((list, v) => {
    list.sort(cmp);
    const seen = new Set();
    candidates[v] = list.filter(c => !seen.has(c.file) && seen.add(c.file));
  });
  const assign = new Array(VOICES).fill(null);
  const used = new Set();
  const fill = (group, step) => {
    for (let v = 0; v < VOICES; v++) {
      if (assign[v]) continue;
      const c = candidates[v].find(c => c.group === group && c.step === step && !used.has(c.file));
      if (c) { assign[v] = {file: c.file, tag: c.tag, guessed: false}; used.add(c.file); }
    }
  };
  // the One Shots folders' files through every step, then the rest's, then the loops' and effects'
  for (const group of [0, 1, 2]) {
    fill(group, 1);
    fill(group, 2);
    // step 3: the toms and congas with no side, the first the low one and the last the high one
    for (const family of ["tom", "conga"]) {
      const [low, high] = SIDES[family].voices;
      const left = candidates[low].filter(c => c.group === group && c.step === 3 && !used.has(c.file));
      if (!left.length) continue;
      if (!assign[low]) { assign[low] = {file: left[0].file, tag: "guessed", guessed: true}; used.add(left[0].file); }
      const last = left[left.length - 1];
      if (!assign[high] && !used.has(last.file)) { assign[high] = {file: last.file, tag: "guessed", guessed: true}; used.add(last.file); }
    }
    // step 4: GM notes in paths with no drum word, for the voices still empty
    fill(group, 4);
  }
  const unused = [];
  for (let i = 0; i < n; i++) if (!used.has(i)) unused.push(i);
  return {assign, candidates: candidates.map(list => list.map(c => ({file: c.file, tag: c.tag}))), alternates, unused, looks};
}

// ---- processing a hit -------------------------------------------------------------------------------
// Each voice's longest hit, in seconds: past it a hit is cut (and faded)
const VOICE_CAP = [0.40, 0.35, 0.15, 0.35, 0.15, 0.60, 1.50, 0.50, 0.40, 0.35, 0.30, 0.35, 0.20];
const TARGET_RMS = 0.07;            // over a hit's first 80 ms
const PEAK_LIMIT = 0.98;
const DEFAULT_LEVEL = 160;          // the voice entry's level, 1.60, before the row's trim
// a press on plate 13 bends the skins and chokes the metal
const DEFAULT_BENDS = [true, true, true, true, false, false, false, true, true, true, true, false, false];
const DEFAULT_CHOKE = [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0];   // the hats cut each other off

// every channel mixed to one, by hand (the same weight for each)
function mixToMono(channels) {
  if (channels.length === 1) return Float32Array.from(channels[0]);
  const n = Math.min(...channels.map(c => c.length));
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i];
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

// Where a hit starts, in a sound decoded at 22,050 Hz in mono: {dc, onset, start}. The DC offset first,
// found where the hit itself can't be mistaken for it: the onset as the first sample that moves more
// than 2% of the peak-to-peak away from the first sample (an offset moves every sample alike, so it
// can't hide that), and the DC the mean of what comes before it when that is at least 1 ms long. Not
// the mean of the whole sound: for an asymmetric hit (a low drum, a slap, the tabla's ge and ke) that
// is the hit's own shape, and taking it out would keep a lead-in or start the hit late with a click.
// A file that starts on its hit has nothing before it to measure on, so the DC is then the mean of its
// last 50 ms, when the file runs on at least 100 ms past the strike and that tail, its mean taken out,
// is quiet (below -45 dB of the peak): a hit that has died away by then leaves only the offset there.
// Else 0 (a hit still ringing at the end, as the tabla's short ke strokes are, says nothing of its DC).
// Then, on the sound with the DC taken out, the onset again as the first sample above 2% of the peak,
// and the start 1 ms before it.
// A known limit: a noisy lead-in. Noise in the silence before the hit that reaches 2% of the peak
// (hiss at about 1.5% RMS of the peak does) moves the first test at once, so the onset is found at
// the start of the file and the whole lead-in kept (13 ms on a tabla stroke, 80 ms on an mbira pluck
// in the verifier's runs). Gating on noise would need a noise floor measured first; not done.
function hitStart(mono, rate = RATE) {
  const n = mono.length;
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < n; i++) { low = Math.min(low, mono[i]); high = Math.max(high, mono[i]); }
  const lead = Math.round(0.001 * rate);
  let moved = 0;
  while (moved < n && Math.abs(mono[moved] - mono[0]) <= 0.02 * (high - low)) moved++;
  let dc = 0;
  if (moved >= lead) {
    for (let i = 0; i < moved; i++) dc += mono[i];
    dc /= moved;
  } else {
    const tail = Math.round(0.050 * rate);
    if (n - moved >= Math.round(0.100 * rate) && n >= tail) {
      let mean = 0;
      for (let i = n - tail; i < n; i++) mean += mono[i];
      mean /= tail;
      let peak = 0, spread = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i] - mean));
      for (let i = n - tail; i < n; i++) spread = Math.max(spread, Math.abs(mono[i] - mean));
      if (peak > 0 && spread < peak * 10 ** (-45 / 20)) dc = mean;
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i] - dc));
  let onset = 0;
  while (onset < n && Math.abs(mono[onset] - dc) <= 0.02 * peak) onset++;
  return {dc, onset, start: Math.max(0, onset - lead)};
}

// A hit as the voice plays it, from the sound decoded at 22,050 Hz in mono, in order: the DC offset
// taken out and the start found as hitStart says; the end at the last point above -45 dB, or the
// voice's cap if that comes first; a cos-squared fade over the last 60 ms or third of the hit,
// whichever is shorter; scaled so its first 80 ms have an RMS of 0.07 but its peak never passes 0.98;
// and, when the first sample kept, levelled, would be above 1% of full scale, wherever the hit starts
// (a file cut mid-waveform, as the tabla's ke2, ke3 and tas2 are, or a lead-in with hum or hiss in it
// under the onset's 2%), a raised-cosine fade in over its first 32 samples (about 1.5 ms), so it
// doesn't start with a click; rounded to 16 bits. Its length
// is what the sound has, never what a decoder says (an MP3 decodes with padding at both ends).
const FADE_IN = 32;
function processHit(mono, voice, rate = RATE) {
  const n = mono.length;
  const peakOf = (x, from = 0, to = x.length) => { let p = 0; for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i])); return p; };
  if (!(peakOf(mono) > 0)) throw new Error("it is silent");
  const {dc, start} = hitStart(mono, rate);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = mono[i] - dc;
  const peak = peakOf(x);
  if (!(peak > 0)) throw new Error("it is silent");
  const floor = peak * 10 ** (-45 / 20);
  let end = n - 1;
  while (end > start && Math.abs(x[end]) <= floor) end--;
  const length = Math.max(2, Math.min(end - start + 1, Math.round(VOICE_CAP[voice] * rate), n - start));
  const hit = x.slice(start, start + length);
  const fade = Math.min(Math.round(0.060 * rate), Math.floor(length / 3));
  for (let j = 0; j < fade; j++) {
    const g = Math.cos(0.5 * Math.PI * (j + 1) / fade);
    hit[length - fade + j] *= g * g;
  }
  const head = Math.max(1, Math.min(length, Math.round(0.080 * rate)));
  const gainOf = () => {
    let sum = 0;
    for (let i = 0; i < head; i++) sum += hit[i] * hit[i];
    const rms = Math.sqrt(sum / head);
    const top = peakOf(hit);
    if (!(top > 0)) throw new Error("it is silent");
    let gain = rms > 0 ? TARGET_RMS / rms : PEAK_LIMIT / top;
    if (gain * top > PEAK_LIMIT) gain = PEAK_LIMIT / top;
    return gain;
  };
  let gain = gainOf();
  if (Math.abs(hit[0] * gain) > 0.01) {
    const fadeIn = Math.min(FADE_IN, Math.floor(length / 3));
    for (let j = 0; j < fadeIn; j++) hit[j] *= 0.5 - 0.5 * Math.cos(Math.PI * j / fadeIn);
    gain = gainOf();     // the fade takes a little off the first 80 ms
  }
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(hit[i] * gain * 32767)));
  return out;
}

// the voice entry's level for a trim in dB: 160 (1.60) times it, at most 255
function trimmedLevel(trimDb, base = DEFAULT_LEVEL) {
  return Math.max(0, Math.min(255, Math.round(base * 10 ** (trimDb / 20))));
}

// What a file is, by its name: a sound, an AIFF (read here), a .mckit, a licence or readme, one of
// the formats that are coming later, or nothing to do with a kit (hidden files and __MACOSX are skipped)
function fileKind(path) {
  const parts = String(path).split(/[\\/]+/);
  const file = parts[parts.length - 1] || "";
  if (parts.some(p => p === "__MACOSX" || p.startsWith("."))) return "skip";
  const ext = (file.match(/\.([^.]+)$/) || ["", ""])[1].toLowerCase();
  if (["wav", "wave", "flac", "mp3", "ogg", "oga", "opus", "m4a", "aac", "mp4", "webm"].includes(ext)) return "sound";
  if (["aif", "aiff", "aifc"].includes(ext)) return "aiff";
  if (ext === "mckit") return "mckit";
  if (/^(licen[cs]e|copying)/i.test(file) && ["", "txt", "md"].includes(ext)) return "licence";
  if (/^readme/i.test(file) && ["", "txt", "md"].includes(ext)) return "readme";
  if (["zip", "sf2", "sf3", "sfz", "h2drumkit"].includes(ext) || file.toLowerCase() === "drumkit.xml") return "later";
  return "other";
}

const api = {
  HEADER_BYTES, FILE_CAPACITY, VOICES, RATE, VOICE_NAMES, GM_NOTE, GM_NOTES, REASONS, STATES, STATUSES, PIECE, OP,
  VOICE_CAP, DEFAULT_LEVEL, DEFAULT_BENDS, DEFAULT_CHOKE,
  crc32, pcmBytes, cleanName, buildImage, readHeader, checkImage, imageVoices, groups, ungroup, pack87, message,
  beginMessage, dataMessage, commitMessage, abortMessage, infoMessage, clearMessage, frames, parseReply, hex,
  pyJson, writeMckit, readMckit, nameTokens, gmOf, nameLook, mapKit, mixToMono, hitStart, processHit, trimmedLevel, fileKind,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.userKit = api;

if (typeof document === "undefined") return;

//-->>the page: the kit block under drum kit
const KIT_VERSION = 113;          // the first firmware with a kit slot
const OWN_KIT = 13;               // setting 337's "your own"
const BASE_KIT_DEFAULT = 4;       // studio: the plainest of the kits, under the voices left empty
const HEARD = VOICE_NAMES.map((_, v) => v < 12
  ? `heard on string ${v + 1} with harp drums, in the grooves and on the drum pads`
  : "heard only in the grooves, and on the drum pads' open and rim seam");
const PAIRS = {7: 8, 9: 10};      // a low voice: the high one its swap button trades with
const $ = id => document.getElementById(id);

const state = {
  files: [],          // {name, path, kind ("sound", "aiff" or "hit"), file, mono, error, hit, rate, level, pan, choke, flags}
  voices: [],         // 13 of {file (-1 none), tag, trim, choke, bends, level, pan}
  map: null,          // mapKit's guess, for the candidates
  name: "", author: "", licence: "", licenceFrom: "",
  baseKit: BASE_KIT_DEFAULT,
  hits: new Map(),    // "file:voice" -> its processed hit
  image: null,        // the image of the kit as it stands, or null
  imageSources: null, // the .mckit's sources for that image, by its voices
  imageError: "",
  info: null,         // the minichord's last INFO reply
  noSlot: false,      // it didn't answer INFO
  saved: null,        // the last kit sent, from IndexedDB
};

function baseKitNames() {
  const options = (typeof findParameterBySysex === "function" && findParameterBySysex(337)?.options) || [];
  const names = ["", "808", "909", "CR-78", "studio", "brushes", "boom bap", "world percussion", "tabla and doumbek", "trap",
    "house", "glitch", "cliqhop"];
  for (const o of options) if (o.value >= 1 && o.value <= 12) names[o.value] = o.label;
  return names;
}

function say(text, type) {
  const status = $("kit-status");
  if (status) status.textContent = text || "";
  if (type && typeof showNotification === "function") showNotification(text, type);
}

function defaultVoice(v) {
  return {file: -1, tag: "", trim: 0, choke: DEFAULT_CHOKE[v], bends: DEFAULT_BENDS[v], level: DEFAULT_LEVEL, pan: 0};
}

// ---- reading what the player gives: files, a folder, a drop --------------------------------------
// A folder dropped is walked with webkitGetAsEntry: readEntries hands a directory over in batches, so
// it is called until it hands over nothing
async function filesFromDrop(dataTransfer) {
  const out = [];
  const entries = Array.from(dataTransfer.items || []).map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Array.from(dataTransfer.files || []).map(file => ({file, path: file.name}));
  const fileOf = entry => new Promise((resolve, reject) => entry.file(resolve, reject));
  const walk = async entry => {
    if (entry.name.startsWith(".") || entry.name === "__MACOSX") return;
    if (entry.isFile) {
      out.push({file: await fileOf(entry), path: entry.fullPath.replace(/^\//, "")});
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

async function loadFiles(list) {
  const naturally = (a, b) => a.path.localeCompare(b.path, undefined, {numeric: true, sensitivity: "base"});
  list = list.slice().sort(naturally);
  const kinds = list.map(f => fileKind(f.path));
  const mckit = list.find((f, i) => kinds[i] === "mckit");
  if (mckit) return loadMckit(mckit.file);
  const later = list.filter((f, i) => kinds[i] === "later");
  const sounds = list.filter((f, i) => kinds[i] === "sound" || kinds[i] === "aiff");
  if (!sounds.length) {
    say(later.length ? `${later[0].path.split("/").pop()}: zip files, SoundFonts, SFZ and Hydrogen kits are coming later. ` +
      "For now unpack it and give this its sound files or their folder." : "There are no sound files in that.", "error");
    return;
  }
  const notes = [];
  if (later.length) notes.push(`${later.length} zip, SoundFont, SFZ or Hydrogen file${later.length === 1 ? "" : "s"} left out: those are coming later`);
  const others = kinds.filter(k => k === "other").length;
  if (others) notes.push(`${others} file${others === 1 ? "" : "s"} that aren't sounds left out`);
  // the licence: a licence file before a readme, its text as it is
  const licence = list.find((f, i) => kinds[i] === "licence") || list.find((f, i) => kinds[i] === "readme");
  state.licence = "";
  state.licenceFrom = "";
  if (licence) {
    try {
      state.licence = (await licence.file.text()).trim().slice(0, 4000);
      state.licenceFrom = licence.path;
    } catch (e) { /* unreadable: left unknown */ }
  }
  state.files = sounds.map(f => ({name: f.path.split("/").pop(), path: f.path, kind: fileKind(f.path), file: f.file,
    mono: null, error: ""}));
  const folder = sounds[0].path.includes("/") ? sounds[0].path.split("/")[0] : "";
  state.name = cleanName(folder) || cleanName(sounds[0].path.split("/").pop().replace(/\.[^.]+$/, "")) || "my kit";
  state.author = "";
  state.hits.clear();
  clearFind();
  resetMapping();
  say(`Read ${sounds.length} sound${sounds.length === 1 ? "" : "s"}${notes.length ? "; " + notes.join("; ") : ""}.`);
}

async function loadMckit(file) {
  let kit;
  try {
    kit = readMckit(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    say(`Couldn't read ${file.name}: ${e.message}.`, "error");
    return;
  }
  const reason = checkImage(kit.image);
  if (reason) {
    say(`Couldn't use ${file.name}: ${REASONS[reason]}.`, "error");
    return;
  }
  setFromImage(kit.image, kit.meta, file.name);
  say(`Read ${file.name}: ${state.voices.filter(v => v.file >= 0).length} voices.`);
}

// a kit from an image (a .mckit, or the last kit sent): each hit as stored, at its own rate and level
function setFromImage(image, meta, fileName) {
  meta = meta || {};
  const h = readHeader(image);
  const voices = imageVoices(image);
  const sources = Array.isArray(meta.sources) ? meta.sources : [];
  state.files = [];
  state.voices = Array.from({length: VOICES}, (_, v) => defaultVoice(v));
  voices.forEach((e, v) => {
    if (!e) { state.voices[v].choke = 0; return; }
    let i = state.files.findIndex(f => f.offset === e.offset && f.hit.length === e.length);
    if (i < 0) {
      i = state.files.length;
      state.files.push({name: typeof sources[v] === "string" && sources[v] ? sources[v] : `${VOICE_NAMES[v]} (from the kit)`,
        path: "", kind: "hit", hit: e.samples, rate: e.rate, offset: e.offset, mono: null, error: ""});
    }
    state.voices[v] = {file: i, tag: "from the .mckit", trim: 0, choke: e.choke, bends: !!(e.flags & FLAG_PRESS_BENDS),
      level: e.level, pan: e.pan, rate: e.rate, pitch: e.pitch};
  });
  // voices with no hit keep a default choke for when a file is dropped on them
  state.voices.forEach((s, v) => { if (s.file < 0) s.choke = DEFAULT_CHOKE[v]; });
  state.map = {candidates: Array.from({length: VOICES}, () => []), alternates: {}, unused: [], assign: []};
  state.name = cleanName(h.name || meta.name || (fileName || "").replace(/\.mckit$/i, ""));
  state.author = typeof meta.author === "string" ? meta.author : "";
  state.licence = typeof meta.licence === "string" && meta.licence !== "unknown" ? meta.licence : "";
  state.licenceFrom = state.licence ? "the .mckit" : "";
  state.baseKit = h.base_kit;
  state.hits.clear();
  clearFind();
  render();
}

// the find box emptied: a new set of files, or a kit read from an image, starts with every file listed
function clearFind() {
  const box = $("kit-filter");
  if (box) box.value = "";
}

// the guess again, from the files' names, with every row back to its defaults
function resetMapping() {
  if (state.files.some(f => f.kind === "hit")) {
    say("A kit read from a .mckit keeps the voices it came with.");
    return;
  }
  state.map = mapKit(state.files.map(f => f.path));
  state.voices = Array.from({length: VOICES}, (_, v) => {
    const s = defaultVoice(v);
    const a = state.map.assign[v];
    if (a) { s.file = a.file; s.tag = a.tag; }
    return s;
  });
  render();
}

// ---- decoding and processing ------------------------------------------------------------------------
const MAX_SECONDS = 12;         // what is kept of a decoded file: enough for any cap past a late onset
const MAX_FILE_MB = 50;         // past this a file isn't read at all: a phone's tab can't hold it decoded

function decode(entry) {
  if (!entry.decoding) entry.decoding = decodeNow(entry);
  return entry.decoding;
}
async function decodeNow(entry) {
  try {
    // refused before it is read: a minute-long loop or a whole song dropped by mistake
    const mb = (entry.file.size || 0) / (1024 * 1024);
    if (mb > MAX_FILE_MB) throw new Error(`it is ${Math.round(mb)} MB, more than the ${MAX_FILE_MB} MB this reads: a drum hit is a second or two, so cut it shorter`);
    const bytes = await entry.file.arrayBuffer();
    const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    const isAiff = entry.kind === "aiff" || (String.fromCharCode(...head.subarray(0, 4)) === "FORM"
      && /^AIF[FC]$/.test(String.fromCharCode(...head.subarray(8, 12))));
    let mono;
    if (isAiff) {
      // only the start is read and resampled, a second past what is kept, whatever the file's length
      const {parseAiff} = await import("./kit-formats/aiff.js");
      const a = parseAiff(bytes, rate => Math.ceil((MAX_SECONDS + 1) * rate));
      mono = await resample(a.channels, a.sampleRate);
    } else {
      const context = new OfflineAudioContext(1, 1, RATE);
      let audio;
      try {
        audio = await context.decodeAudioData(bytes);   // resampled to the context's 22,050 Hz
      } catch (e) {
        throw new Error("this browser can't decode it: convert it to WAV");
      }
      mono = mixToMono(Array.from({length: audio.numberOfChannels}, (_, c) => audio.getChannelData(c)));
    }
    entry.mono = mono.length > MAX_SECONDS * RATE ? mono.slice(0, MAX_SECONDS * RATE) : mono;
  } catch (e) {
    entry.error = e.message;
  }
  return entry.mono;
}

// an AIFF's channels at its own rate, to 22,050 Hz through the browser's resampler, then to mono
async function resample(channels, rate) {
  if (rate === RATE) return mixToMono(channels);
  if (rate < 3000) throw new Error(`its sample rate (${rate} Hz) is lower than a browser plays`);
  const n = channels[0].length;
  const context = new OfflineAudioContext(channels.length, Math.max(1, Math.ceil(n * RATE / rate)), RATE);
  const buffer = context.createBuffer(channels.length, Math.max(1, n), rate);
  channels.forEach((c, i) => buffer.copyToChannel(c, i));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  const out = await context.startRendering();
  return mixToMono(Array.from({length: out.numberOfChannels}, (_, c) => out.getChannelData(c)));
}

// the hit voice v plays from file i: processed for that voice's cap, or as a .mckit stored it
async function hitFor(i, v) {
  const f = state.files[i];
  if (!f) return null;
  if (f.kind === "hit") return f.hit;
  const key = `${i}:${v}`;
  if (state.hits.has(key)) return state.hits.get(key);
  const mono = await decode(f);
  if (!mono) return null;
  try {
    const hit = processHit(mono, v);
    state.hits.set(key, hit);
    return hit;
  } catch (e) {
    f.error = e.message;
    return null;
  }
}

// The kit as the image takes it, every voice's hit processed (null for a voice whose file failed),
// and the .mckit's sources to go with it: by the voices that went into the image, not by the rows, so
// null for a voice left empty (its file wouldn't decode, or is silent), and for a voice whose hit is
// the same as an earlier voice's (the image shares it), that voice's name again
async function kitForImage() {
  const voices = [], sources = [];
  for (let v = 0; v < VOICES; v++) {
    const s = state.voices[v];
    const hit = s && s.file >= 0 ? await hitFor(s.file, v) : null;
    if (!hit) { voices.push(null); sources.push(null); continue; }
    const f = state.files[s.file];
    const shared = voices.findIndex(e => e && sameBytes(e.samples, hit));
    sources.push(shared >= 0 ? sources[shared] : f.name);
    voices.push({samples: hit, rate: f.kind === "hit" ? f.rate : RATE, level: trimmedLevel(s.trim, s.level),
      pan: s.pan || 0, choke: s.choke, flags: s.bends ? FLAG_PRESS_BENDS : 0, pitch: 0});
  }
  return {base_kit: state.baseKit, name: cleanName(state.name), voices, sources};
}

let rebuildRun = 0;
async function rebuild() {
  const run = ++rebuildRun;
  let image = null, error = "", sources = null;
  try {
    const kit = await kitForImage();
    if (run !== rebuildRun) return;
    if (!kit.voices.some(Boolean)) error = "no voice has a sound yet";
    else { image = buildImage(kit); sources = kit.sources; }
  } catch (e) {
    error = e.message;
  }
  if (run !== rebuildRun) return;
  state.image = image;
  state.imageSources = sources;
  state.imageError = error;
  paintMeter();
  paintRowErrors();
}

function meta() {
  return {name: cleanName(state.name), author: state.author.trim(), licence: state.licence.trim() || "unknown",
    sources: state.imageSources || Array(VOICES).fill(null),
    made: new Date().toISOString().slice(0, 10)};
}

// ---- audition ---------------------------------------------------------------------------------------
let audio = null, playing = null;
function play(samples, rate, isInt) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    if (playing) try { playing.stop(); } catch (e) { /* already ended */ }
    const buffer = audio.createBuffer(1, samples.length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) data[i] = isInt ? samples[i] / 32768 : samples[i];
    playing = audio.createBufferSource();
    playing.buffer = buffer;
    playing.connect(audio.destination);
    playing.start();
  } catch (e) {
    say(`Couldn't play it: ${e.message}`);
  }
}

async function audition(v, processed) {
  const s = state.voices[v];
  if (!s || s.file < 0) return;
  const f = state.files[s.file];
  if (f.kind === "hit") return play(f.hit, f.rate, true);
  if (processed) {
    const hit = await hitFor(s.file, v);
    if (hit) play(hit, RATE, true);
    else say(`${f.name}: ${f.error || "couldn't read it"}`);
  } else {
    const mono = await decode(f);
    if (mono) play(mono, RATE, false);
    else say(`${f.name}: ${f.error}`);
  }
}

// ---- drawing the block --------------------------------------------------------------------------------
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

function usedFiles() {
  return new Set(state.voices.map(s => s.file).filter(i => i >= 0));
}

// A whole sample library picked by mistake (thousands of files) would make thousands of options in
// every voice's list and as many chips in the bin, redrawn on every change. So each list shows at most
// LIST_MOST of the files that match the find box (shown past LIST_MOST files): the likeliest, those
// whose names say what they are before the rest, each in file order (a list already in order of
// likelihood, as a voice's candidates are, kept in it), and says how many it left out.
const LIST_MOST = 300;
function findText() {
  const box = $("kit-filter-box");
  return box && !box.hidden ? ($("kit-filter").value || "").trim().toLowerCase() : "";
}
function likeliest(list, ranked) {
  const text = findText();
  const looks = state.map?.looks || [];
  const matching = text ? list.filter(i => (state.files[i].path || state.files[i].name).toLowerCase().includes(text)) : list;
  const says = i => looks[i] && (looks[i].gm != null || looks[i].name);
  const order = ranked ? matching : [...matching.filter(says), ...matching.filter(i => !says(i))];
  return order.slice(0, LIST_MOST);
}
const leftOut = left => `${left.toLocaleString("en")} more not shown: find one with "find a file"`;

function render() {
  const card = $("kit-card");
  if (!card) return;
  card.hidden = !state.files.length;
  $("kit-name").value = state.name;
  $("kit-author").value = state.author;
  $("kit-licence").value = state.licence;
  $("kit-base").value = String(state.baseKit);
  paintLicence();
  paintLists();
  rebuild();
}

// the voice rows and the bin, as the find box has them
function paintLists() {
  const box = $("kit-filter-box");
  if (box) box.hidden = state.files.length <= LIST_MOST;
  const names = baseKitNames();
  const rows = $("kit-voices");
  rows.replaceChildren();
  state.voices.forEach((s, v) => rows.appendChild(voiceRow(v, s, names)));
  paintBin();
}

function voiceRow(v, s, names) {
  const row = document.createElement("div");
  row.className = "kit-voice";
  row.dataset.voice = v;
  const candidates = (state.map?.candidates[v] || []).slice();
  const alts = s.file >= 0 ? (state.map?.alternates[s.file] || []) : [];
  const listed = new Set();
  const option = (i, note) => { listed.add(i); return `<option value="${i}"${i === s.file ? " selected" : ""}>${esc(state.files[i].name)}${note ? ` (${esc(note)})` : ""}</option>`; };
  let options = `<option value="-1"${s.file < 0 ? " selected" : ""}>synth: ${esc(names[state.baseKit] || "")} ${VOICE_NAMES[v]}</option>`;
  const more = left => left > 0 ? `<option disabled>${esc(leftOut(left))}</option>` : "";
  if (s.file >= 0 && !candidates.some(c => c.file === s.file)) options += option(s.file, s.tag);
  // the candidates in their order, the likeliest LIST_MOST of them, and the one chosen whatever the find box says
  const pool = candidates.map(c => c.file).filter(i => !listed.has(i));
  const likely = new Set(likeliest(pool, true));
  candidates.forEach(c => { if (!listed.has(c.file) && (likely.has(c.file) || c.file === s.file)) options += option(c.file, c.tag); });
  options += more(pool.filter(i => !listed.has(i)).length);
  alts.forEach(i => { if (!listed.has(i)) options += option(i, "alternate"); });
  const rest = state.files.map((_, i) => i).filter(i => !listed.has(i));
  const shown = likeliest(rest);
  if (rest.length) options += `<optgroup label="other files">${shown.map(i => option(i, "")).join("")}${more(rest.length - shown.length)}</optgroup>`;
  const chokes = ['<option value="0">no choke</option>', ...[1, 2, 3, 4, 5, 6, 7].map(g => `<option value="${g}">choke ${g}</option>`)].join("");
  const filled = s.file >= 0;
  const level = trimmedLevel(s.trim, s.level);
  row.innerHTML = `
    <div class="kit-voice-head">
      <span class="kit-voice-name" title="voice ${v}, GM note ${GM_NOTE[v]} over drum MIDI out">${VOICE_NAMES[v]}</span>
      <select class="always-on kit-pick" aria-label="the sound the ${VOICE_NAMES[v]} plays">${options}</select>
      <span class="kit-tag">${esc(filled ? s.tag : "")}</span>
    </div>
    <div class="kit-voice-controls">
      <button type="button" class="always-on kit-play" data-processed="0" ${filled ? "" : "disabled"} title="play the file as it is"><span aria-hidden="true">▶</span> original</button>
      <button type="button" class="always-on kit-play" data-processed="1" ${filled ? "" : "disabled"} title="play the hit as the minichord gets it: trimmed, faded and levelled, at 22,050 Hz"><span aria-hidden="true">▶</span> hit</button>
      ${PAIRS[v] ? `<button type="button" class="always-on kit-swap" title="trade sounds with the ${VOICE_NAMES[PAIRS[v]]}"><span aria-hidden="true">⇅</span> swap with ${VOICE_NAMES[PAIRS[v]]}</button>` : ""}
      <select class="always-on kit-choke" aria-label="${VOICE_NAMES[v]} choke group" title="a voice struck fades every other sounding voice in its group">${chokes}</select>
      <label class="kit-trim" title="the level, plus or minus 12 dB, on top of the levelling every hit gets; the minichord's level byte tops out at 2.55 (about +4 dB)">
        <input type="range" class="always-on kit-trim-range" min="-12" max="12" step="1" value="${s.trim}" aria-label="${VOICE_NAMES[v]} level trim">
        <span class="kit-trim-value">${s.trim > 0 ? "+" : ""}${s.trim} dB (${(level / 100).toFixed(2)})</span>
      </label>
      <label title="on the drum pads (plate 13), pressing the pad bends this hit; off, a press chokes it"><input type="checkbox" class="always-on kit-bends" ${s.bends ? "checked" : ""}> press bends</label>
    </div>
    <div class="kit-heard">${HEARD[v]}</div>
    <div class="kit-row-error"></div>`;
  row.querySelector(".kit-choke").value = String(s.choke);
  row.querySelector(".kit-pick").addEventListener("change", e => {
    const i = parseInt(e.target.value);
    s.file = i;
    s.tag = i < 0 ? "" : (candidates.find(c => c.file === i)?.tag || (alts.includes(i) ? "alternate" : "chosen"));
    render();
  });
  row.querySelectorAll(".kit-play").forEach(b => b.addEventListener("click", () => audition(v, b.dataset.processed === "1")));
  row.querySelector(".kit-swap")?.addEventListener("click", () => {
    const other = state.voices[PAIRS[v]];
    [s.file, other.file] = [other.file, s.file];
    [s.tag, other.tag] = [other.tag, s.tag];
    [s.trim, other.trim] = [other.trim, s.trim];
    // a .mckit's own level and pan for each voice go with its sound
    [s.level, other.level] = [other.level, s.level];
    [s.pan, other.pan] = [other.pan, s.pan];
    render();
  });
  row.querySelector(".kit-choke").addEventListener("change", e => { s.choke = parseInt(e.target.value); rebuild(); });
  row.querySelector(".kit-trim-range").addEventListener("input", e => {
    s.trim = parseInt(e.target.value);
    const l = trimmedLevel(s.trim, s.level);
    row.querySelector(".kit-trim-value").textContent = `${s.trim > 0 ? "+" : ""}${s.trim} dB (${(l / 100).toFixed(2)})`;
    rebuild();
  });
  row.querySelector(".kit-bends").addEventListener("change", e => { s.bends = e.target.checked; rebuild(); });
  // a drop target: a file dragged in from the not-used bin, or from the computer
  row.addEventListener("dragover", e => { e.preventDefault(); row.classList.add("kit-drop-over"); });
  row.addEventListener("dragleave", () => row.classList.remove("kit-drop-over"));
  row.addEventListener("drop", async e => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("kit-drop-over");
    const from = e.dataTransfer.getData("text/x-kit-file");
    if (from !== "") { s.file = parseInt(from); s.tag = "chosen"; render(); return; }
    const dropped = (await filesFromDrop(e.dataTransfer)).filter(f => ["sound", "aiff"].includes(fileKind(f.path)));
    if (!dropped.length) return;
    if (state.files.some(f => f.kind === "hit") && !state.files.every(f => f.kind === "hit")) return;
    const i = state.files.length;
    dropped.forEach(f => state.files.push({name: f.path.split("/").pop(), path: f.path, kind: fileKind(f.path), file: f.file, mono: null, error: ""}));
    s.file = i;
    s.tag = "chosen";
    render();
  });
  return row;
}

function paintBin() {
  const bin = $("kit-unused");
  if (!bin) return;
  const used = usedFiles();
  const unused = state.files.map((_, i) => i).filter(i => !used.has(i));
  bin.replaceChildren();
  if (!unused.length) { bin.hidden = true; return; }
  bin.hidden = false;
  const head = document.createElement("div");
  head.className = "kit-unused-head";
  head.textContent = `not used (${unused.length}): drag one onto a voice, or choose it in a voice's list`;
  bin.appendChild(head);
  const altOf = {};
  Object.entries(state.map?.alternates || {}).forEach(([main, list]) => list.forEach(i => { altOf[i] = parseInt(main); }));
  const shown = likeliest(unused);
  for (const i of shown) {
    const chip = document.createElement("span");
    chip.className = "kit-chip";
    chip.draggable = true;
    chip.textContent = state.files[i].name + (altOf[i] != null ? ` (a layer of ${state.files[altOf[i]].name})` : "");
    chip.title = state.files[i].path || state.files[i].name;
    chip.addEventListener("dragstart", e => e.dataTransfer.setData("text/x-kit-file", String(i)));
    bin.appendChild(chip);
  }
  if (shown.length < unused.length) {
    const rest = document.createElement("div");
    rest.className = "kit-unused-more";
    rest.textContent = leftOut(unused.length - shown.length);
    bin.appendChild(rest);
  }
}

function paintRowErrors() {
  document.querySelectorAll("#kit-voices .kit-voice").forEach(row => {
    const s = state.voices[parseInt(row.dataset.voice)];
    const f = s && s.file >= 0 ? state.files[s.file] : null;
    row.querySelector(".kit-row-error").textContent = f && f.error ? `${f.name}: ${f.error}; the synth voice plays instead` : "";
  });
}

function capacity() {
  return state.info && state.info.capacity ? state.info.capacity : FILE_CAPACITY;
}

function paintMeter() {
  const meter = $("kit-meter"), text = $("kit-meter-text");
  if (!meter) return;
  const used = state.image ? state.image.length - HEADER_BYTES : 0;
  meter.max = capacity();
  meter.value = Math.min(used, capacity());
  const kb = b => (b / 1024).toFixed(b < 10240 ? 1 : 0);
  const over = used > capacity();
  text.textContent = state.image
    ? `${kb(used)} of ${kb(capacity())} kB${over ? ": too big for this minichord, take a voice out or shorten one" : ""}`
    : state.imageError ? `nothing to send: ${state.imageError}` : "";
  meter.classList.toggle("kit-over", over);
  $("kit-send").disabled = !state.image || over || upload.active || upload.starting;
  $("kit-save").disabled = !state.image;
}

function paintLicence() {
  const note = $("kit-licence-note");
  if (!note) return;
  if (state.licence.trim()) note.textContent = state.licenceFrom ? `licence from ${state.licenceFrom}` : "licence as typed";
  else note.textContent = "Licence unknown: ask the author before sharing";
  note.classList.toggle("kit-warn", !state.licence.trim());
}

// what the minichord holds, from its INFO reply, and drum kit's option 13 to match
function paintInfo() {
  const line = $("kit-info");
  const i = state.info;
  let text;
  if (!controller.isConnected()) text = "No minichord connected: a kit can still be made and saved as a .mckit.";
  else if (state.noSlot) text = "This firmware has no kit slot: your own kit needs firmware 113 or later.";
  else if (!i) text = "";
  else if (i.state === 1) {
    const voices = [...Array(VOICES).keys()].filter(v => i.filled & (1 << v)).length;
    text = `On the minichord: ${i.name || "a kit with no name"}, ${voices} voice${voices === 1 ? "" : "s"} of its own, ` +
      `${Math.round((i.size - HEADER_BYTES) / 1024)} of ${Math.round(i.capacity / 1024)} kB.`;
  } else if (i.state === 0 || (i.state === 3 && i.reason === 1)) {
    // reason 1, no kit header (blank, or other bytes), is no kit at all: nothing in it to be damaged
    text = `No kit is stored on the minichord (room for ${Math.round(i.capacity / 1024)} kB).`;
  } else if (i.state === 2) text = "A kit is being written to the minichord.";
  else if (i.state === 3) text = `The kit on the minichord is damaged (${REASONS[i.reason] || "reason " + i.reason}): send it again.`;
  else text = "This firmware leaves no room for a kit.";
  if (line) line.textContent = text;
  paintSending();
  paintKitOption();
}

// option 13 comes from parameters.json (generate.py); this only says what it holds
function paintKitOption() {
  const option = $("param-337")?.querySelector(`option[value="${OWN_KIT}"]`);
  if (!option) return;
  const i = state.info;
  option.textContent = i && i.state === 1 ? `your own: ${i.name || "no name"}` : i ? "your own: none on this minichord"
    : state.noSlot ? "your own (firmware 113 or later)" : "your own";
}

// ---- the upload (sections 3 to 5) ---------------------------------------------------------------
const upload = {active: false, starting: false, waiter: null, lastAt: 0, needResend: false, aborted: false, wakeLock: null, foreign: false,
  foreignTimer: null, warnedFor: "",
  endedAt: -Infinity,   // when this page's own last upload ended
  stoppedHidden: false, // whether the page was hidden when the watchdog or a freeze stopped it
  stoppedRhythm: false};// whether it stopped the rhythm and the looper for it

// a kit reply (or null when the minichord went away), from minichordcontroller.js
function onKitMessage(msg) {
  if (msg === undefined) {        // a dump from firmware older than the kit slot
    state.info = null;
    state.noSlot = true;
    paintInfo();
    return;
  }
  if (msg === null) {             // the minichord went away
    state.info = null;
    state.noSlot = false;
    endForeign();
    if (upload.waiter) upload.waiter.done(null);
    paintInfo();
    return;
  }
  let r;
  try { r = parseReply(msg); } catch (e) { console.warn("[kits]", e.message); return; }
  if (!r) return;
  upload.lastAt = performance.now();
  if (r.kind === "info") {
    state.info = r;
    state.noSlot = false;
    paintInfo();
    warnIfNoKit();
  }
  if (upload.waiter && upload.waiter.match(r)) { upload.waiter.done(r); return; }
  if (upload.active || r.kind !== "status") return;
  // for a second after this page's own upload ends, a BEGIN or DATA reply is a late answer to its own
  // last piece (the upload given up with one in flight), not another app's upload
  if (!upload.foreign && (r.op === OP.BEGIN || r.op === OP.DATA) && performance.now() - upload.endedAt < 1000) return;
  // A reply nobody here asked for: another app (minictl, a second tab) is sending a kit. Wait till
  // its COMMIT, ABORT or CLEAR is answered, or 6 s pass with nothing.
  if (r.op === OP.BEGIN || r.op === OP.DATA) {
    if (!upload.foreign) {
      upload.foreign = true;
      controller.pauseForKit("another app is sending a kit");
      say("Another app is sending a kit to the minichord: minicontrol waits till it's done.", "info");
    }
    clearTimeout(upload.foreignTimer);
    upload.foreignTimer = setTimeout(() => { endForeign(); say("The other app's kit upload went quiet."); }, 6000);
  } else if (upload.foreign && (r.op === OP.COMMIT || r.op === OP.ABORT || r.op === OP.CLEAR)) {
    endForeign();
    say("The other app's kit upload is over.");
    askInfo();
  }
}

// the other app's upload over: what was held back meanwhile goes now
function endForeign() {
  clearTimeout(upload.foreignTimer);
  const was = upload.foreign;
  upload.foreign = false;
  if (was) controller.resumeAfterKit();
}

// The kit warning for a preset or bank set that asks for your own kit on a minichord that has none:
// said once for each bank it comes up on
function warnIfNoKit() {
  if (typeof currentValues === "undefined") return;
  const key = `${typeof currentBankNumber !== "undefined" ? currentBankNumber : ""}:${state.info?.state}`;
  if (currentValues[337] !== OWN_KIT || !state.info || state.info.state === 1) { upload.warnedFor = ""; return; }
  if (upload.warnedFor === key || upload.active) return;
  upload.warnedFor = key;
  say("This uses your own kit, and none is on this minichord: it plays the studio kit (drum kit 4) until one is sent.", "error");
}

function waitFor(match, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { upload.waiter = null; resolve(null); }, ms);
    upload.waiter = {match, done: r => { clearTimeout(timer); upload.waiter = null; resolve(r); }};
  });
}

function send(bytes) {
  upload.lastAt = performance.now();
  return controller.sendKitMessage(bytes);
}

// INFO's reply, or null after the contract's 1 s
function infoReply() {
  const reply = waitFor(r => r.kind === "info", 1000);
  if (!send(infoMessage())) upload.waiter?.done(null);
  return reply;
}

// INFO asked between uploads: no answer is a firmware with no kit slot
async function askInfo() {
  if (!controller.isConnected() || upload.waiter) return state.info;
  const r = await infoReply();
  if (!r) { state.info = null; state.noSlot = true; paintInfo(); }
  return r;
}

// The bar and its text with every piece; a screen reader hears only the milestones (kit-progress-said,
// the live region): the start, each 25% sent, and the writing at the end. The end itself, sent or not,
// is kit-status's (a role="status" region) to say.
let saidMilestone = -1;
function progress(fraction, text) {
  const bar = $("kit-progress"), label = $("kit-progress-text"), box = $("kit-progress-box"), said = $("kit-progress-said");
  if (!bar) return;
  box.hidden = fraction == null;
  if (fraction != null) bar.value = fraction;
  if (label.textContent !== (text || "")) label.textContent = text || "";
  if (!said) return;
  if (fraction == null) { saidMilestone = -1; said.textContent = ""; return; }
  const milestone = Math.floor(4 * fraction + 1e-9);      // 0 the start, 1 to 3 each quarter, 4 all sent
  if (milestone <= saidMilestone) return;
  saidMilestone = milestone;
  said.textContent = milestone === 0 ? "Sending the kit: don't unplug the minichord."
    : milestone === 4 ? "All sent: writing the kit. Don't unplug the minichord." : `${25 * milestone}% of the kit sent.`;
}

// One send at a time, from the click on: upload.starting is set before the first await (the image
// rebuilt, INFO, the confirm, the save) and cleared in the finally, whichever way the send ends, so a
// second click on Send or Resend meanwhile does nothing, and the Send button is disabled till then
async function oneSend(work) {
  if (upload.active || upload.starting) return;
  upload.starting = true;
  paintSending();
  try {
    await work();
  } finally {
    upload.starting = false;
    paintSending();
  }
}

// the Send button and the Resend offer, as a send starting or running has them
function paintSending() {
  paintMeter();
  const resend = $("kit-resend"), i = state.info;
  if (resend) resend.hidden = !(state.saved && i && (i.state === 0 || i.state === 3) && !upload.active && !upload.starting);
}

// confirmed: the player has just said yes to sending it (again), so it isn't asked twice
async function sendNow(image, kitMeta, confirmed) {
  if (upload.active) return;
  if (typeof deviceReady === "function" && !deviceReady()) return;
  if (upload.foreign) { say("Another app is sending a kit to the minichord: wait till it's done.", "error"); return; }
  const reason = checkImage(image);
  if (reason) { say(`That kit can't be sent: ${REASONS[reason]}.`, "error"); return; }
  say("Asking the minichord about its kit slot…");
  const info = await askInfo();
  if (!info) { say("This firmware has no kit slot: your own kit needs firmware 113 or later.", "error"); return; }
  if (info.state === 4) { say("This firmware leaves no room for a kit.", "error"); return; }
  if (info.state === 2) { say("A kit is being written to the minichord already, from another app: wait till it's done.", "error"); return; }
  if (image.length - HEADER_BYTES > info.capacity) {
    say(`The kit is ${Math.ceil((image.length - HEADER_BYTES) / 1024)} kB and this minichord has room for ${Math.floor(info.capacity / 1024)}: take a voice out or shorten one.`, "error");
    return;
  }
  if (!confirmed && !confirm("Replace the minichord's kit? It goes quiet while the kit is written, usually under 20 seconds. Don't unplug it.")) return;
  await saveLast(image, kitMeta);     // never more than 2 s: a stuck save doesn't hold the upload up
  upload.active = true;
  upload.aborted = false;
  upload.needResend = false;
  upload.stoppedRhythm = false;
  upload.lastAt = performance.now();
  let watchdog = 0, ok = false;
  try {
    // everything from the pause on is in here, so the finally always resumes what it held back
    controller.pauseForKit("a kit is being sent");
    paintMeter();
    holdWakeLock();
    watchdog = setInterval(checkStalled, 500);
    ok = await runUpload(image);
  } catch (e) {
    say(`The kit wasn't sent: ${e.message}.`, "error");
  } finally {
    clearInterval(watchdog);
    upload.active = false;
    upload.endedAt = performance.now();
    controller.resumeAfterKit();      // what was held back meanwhile goes now, before drum kit is set
    releaseWakeLock();
    progress(null);
  }
  if (ok) {
    // drum kit to your own, live, as a Scala file sets the temperament to your own: a bank keeps
    // it only once saved
    if (typeof currentValues !== "undefined") {
      currentValues[337] = OWN_KIT;
      if (typeof tempValues !== "undefined") tempValues[337] = OWN_KIT;
    }
    controller.sendParameter(337, OWN_KIT);
    const param = typeof findParameterBySysex === "function" && findParameterBySysex(337);
    paintKitOption();
    if (param) applyUIValue(param, OWN_KIT);
    if (typeof markEdited === "function") markEdited();
    say("Kit sent: drum kit is your own now. Save to a bank to keep it there.", "success");
  } else {
    // stopped because the page stopped running (frozen in the background, or busy on a visible page):
    // offer to send again on coming back, or now if it already has (the watchdog only runs again once
    // the page does)
    if (upload.needResend && document.hidden) say(`The kit upload stopped ${stoppedWhy()}: send it again when you're back.`);
    else if (upload.needResend) {
      upload.needResend = false;
      if (confirm(`The kit upload stopped ${stoppedWhy()}. Send the kit again?`)) setTimeout(() => resendLast(true), 0);
    }
    (state.saved ? Promise.resolve() : loadLast()).then(() => paintInfo());
  }
  // the rhythm and the looper stopped for it: the page's controls from the minichord again
  if (upload.stoppedRhythm) controller.requestCurrentData();
  askInfo();
}

const stoppedWhy = () => upload.stoppedHidden ? "while the page was in the background" : "because this page stopped answering for a few seconds";

// The screen kept on while the kit goes, where the browser allows it: asked for, not waited for, as
// the request has nothing to do with the upload and mustn't hold it up
function holdWakeLock() {
  try {
    navigator.wakeLock?.request("screen").then(lock => {
      if (upload.active) upload.wakeLock = lock;
      else lock.release().catch(() => {});
    }, () => { /* no wake lock here: the upload goes on */ });
  } catch (e) { /* no wake lock here */ }
}
function releaseWakeLock() {
  const lock = upload.wakeLock;
  upload.wakeLock = null;
  try { lock?.release().catch(() => {}); } catch (e) { /* gone already */ }
}

// Stop-and-wait, with the contract's timers (its section 5). BEGIN waits 3 s for its reply; each DATA
// piece 1 s, then goes again, three tries in all; COMMIT 3 s, then INFO says whether the kit landed all
// the same. Whenever it gives up with an upload that may be open, ABORT goes, so the minichord isn't
// left muted until its own 5 s of silence: after a BEGIN with no reply (it may have opened, and only the
// reply went missing), a piece not taken in three tries or refused, a COMMIT refused (one damaged on
// the way is answered 3 and leaves the upload open), and a COMMIT INFO says never arrived or that
// neither it nor INFO answered. Not after "no upload begun" (5), or a piece's read-back mismatch (8):
// the minichord has ended it then.
async function runUpload(image) {
  const size = image.length, crc = crc32(image);
  let open = false;               // whether the minichord may have this upload open
  const fail = (text, status) => {
    // stopUpload has sent its ABORT already
    if (open && !upload.aborted && status !== 5 && status !== 8) send(abortMessage());
    open = false;
    throw new Error(text);
  };
  const said = s => STATUSES[s] || `status ${s}`;
  progress(0, "Starting the upload: don't unplug the minichord");
  let r = await begin(size, crc);
  if (r && r.status === 1) {
    // busy: the rhythm or the looper runs, or another app began an upload since INFO was asked (while
    // the confirm was open). INFO again says which; that one isn't this page's to stop
    const info = await infoReply();
    if (upload.aborted) fail("it was stopped");
    if (info && info.state === 2) fail("another app began sending a kit to the minichord meanwhile: send it again once that's done");
    // the rhythm or the looper: stop both, say so, and once more
    controller.sendSysEx([0, 0, 8, 0], true);       // control command 8: rhythm mode off
    controller.sendSysEx([0, 2, 3, 0], true);       // 256 = 3: the looper stops
    upload.stoppedRhythm = true;
    say("The rhythm or the looper was running: both are stopped for the upload.", "info");
    await new Promise(resolve => setTimeout(resolve, 300));
    r = await begin(size, crc);
  }
  open = true;
  if (upload.aborted) fail("it was stopped");
  if (!r) fail("the minichord didn't answer the start of the upload");
  if (r.status !== 0) { open = false; fail(`the minichord refused it (${said(r.status)})`); }
  for (let offset = 0; offset < size; offset += PIECE) {
    const end = Math.min(offset + PIECE, size);
    const msg = dataMessage(image, offset);
    let reply = null, last = null;
    for (let tries = 0; tries < 3; tries++) {
      const wait = waitFor(x => x.kind === "status" && x.op === OP.DATA && (x.status !== 0 || x.next === end), 1000);
      send(msg);
      reply = await wait;
      if (upload.aborted) fail("it was stopped");
      // lost, or damaged on the way (a bad length, 3, or a bad piece CRC, 7): the same piece again
      if (!reply || reply.status === 3 || reply.status === 7) { last = reply || last; reply = null; continue; }
      break;
    }
    if (!reply) fail(`the minichord didn't take the piece at byte ${offset} of ${size} in three tries ` +
      `(${last ? said(last.status) : "no answer"}), so the upload was given up; it has no kit now`);
    if (reply.status !== 0) fail(`the minichord stopped the upload at byte ${offset} of ${size} (${said(reply.status)}); ` +
      "it has no kit now", reply.status);
    progress(end / size, `Sending the kit: ${Math.round(100 * end / size)}%. Don't unplug the minichord.`);
  }
  progress(1, "Writing the kit: don't unplug the minichord");
  const wait = waitFor(x => x.kind === "status" && x.op === OP.COMMIT, 3000);
  send(commitMessage());
  const done = await wait;
  if (upload.aborted) fail("it was stopped");
  if (done) {
    if (done.status === 0) return true;
    // refused: over with no kit, except a COMMIT damaged on the way (3), which leaves the upload open,
    // so ABORT after any status but "no upload begun" (5)
    open = done.status !== 5;
    fail(`the minichord couldn't keep it (${said(done.status)}); it has no kit now`);
  }
  // no reply: the kit landed and only the reply went missing (INFO says valid, this size and CRC), or
  // COMMIT itself never arrived and the upload is still open (INFO says receiving), so ABORT
  const info = await infoReply();
  if (upload.aborted) fail("it was stopped");
  if (info && info.state === 1 && info.size === size && info.crc === crc) return true;
  if (info && info.state === 2) fail("the end of the upload never reached the minichord, so it was called off; it has no kit now");
  // INFO answered with the upload over: nothing to call off. Unanswered too: it may still be open, so ABORT
  if (info) open = false;
  fail("the minichord didn't answer the end of the upload" +
    (info ? `, and says its kit slot is ${STATES[info.state] || "state " + info.state}` : ", nor INFO after it"));
}

function begin(size, crc) {
  const wait = waitFor(x => x.kind === "status" && x.op === OP.BEGIN, 3000);
  send(beginMessage(size, crc));
  return wait;
}

// With the page hidden the upload goes on as long as the page runs: replies drive it, not timers. If
// the page stopped running (frozen in the background) for nearly the minichord's 5 s, the minichord
// has given up: stop, and offer to send again on coming back.
function checkStalled() {
  if (!upload.active || upload.aborted) return;
  if (performance.now() - upload.lastAt > 4500) stopUpload(true);
}
function stopUpload(resend) {
  if (!upload.active) return;
  upload.aborted = true;
  upload.needResend = resend;
  upload.stoppedHidden = document.hidden;
  send(abortMessage());
  if (upload.waiter) upload.waiter.done(null);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !upload.needResend) return;
  upload.needResend = false;
  if (state.saved && confirm(`The kit upload stopped ${stoppedWhy()}. Send the kit again?`)) resendLast(true);
});
document.addEventListener("freeze", () => stopUpload(true));
window.addEventListener("pagehide", () => stopUpload(false));

// ---- the last kit sent, kept in this browser (IndexedDB) ---------------------------------------------
// One connection, opened the first time and kept (opened again if the browser closes it, or another
// tab needs it closed). Every save and read gives up after 2 s: storage that is full, being evicted or
// stuck never holds an upload up, and a quota failure, which reaches a transaction as an abort and
// not an error, fails the save rather than leaving it waiting for good.
const DB_WAIT = 2000;
let kitDbOpen = null;
function kitDb() {
  if (!kitDbOpen) {
    kitDbOpen = new Promise((resolve, reject) => {
      const request = indexedDB.open("minicontrol-kits", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kits");
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); kitDbOpen = null; };
        db.onclose = () => { kitDbOpen = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("the kit store is held by another tab"));
    });
    kitDbOpen.catch(() => { kitDbOpen = null; });
  }
  return kitDbOpen;
}
function within(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
async function saveLast(image, kitMeta) {
  const record = {image: image.slice(), meta: kitMeta || {}, sent: new Date().toISOString()};
  state.saved = record;               // this page's own resend has it, whatever the storage does
  try {
    await within((async () => {
      const db = await kitDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("kits", "readwrite");
        tx.objectStore("kits").put(record, "last");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("the save was aborted"));
      });
    })(), DB_WAIT);
  } catch (e) {
    console.warn("[kits] couldn't keep the last kit sent:", e);
  }
}
// the last kit kept, unless this page has sent a newer one meanwhile
async function loadLast() {
  try {
    const got = await within((async () => {
      const db = await kitDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kits");
        const request = tx.objectStore("kits").get("last");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || new Error("the read was aborted"));
      });
    })(), DB_WAIT);
    if (got && !(got.image instanceof Uint8Array)) got.image = new Uint8Array(got.image);
    if (got && (!state.saved || got.sent > state.saved.sent)) state.saved = got;
  } catch (e) {
    console.warn("[kits] couldn't read the last kit sent:", e);
  }
  return state.saved;
}
// confirmed: the player has just said yes to sending it again
function resendLast(confirmed) {
  return oneSend(async () => {
    const saved = state.saved || await loadLast();
    if (!saved || checkImage(saved.image)) { say("There's no last kit kept in this browser to send.", "error"); return; }
    await sendNow(saved.image, saved.meta, confirmed);
  });
}

// ---- setting it up ----------------------------------------------------------------------------------
function saveMckit() {
  if (!state.image) return;
  const blob = new Blob([writeMckit(meta(), state.image)], {type: "application/octet-stream"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (cleanName(state.name).replace(/[^A-Za-z0-9 _-]/g, "").trim() || "kit") + ".mckit";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function setupKits() {
  if (!$("user-kit")) return;
  state.voices = Array.from({length: VOICES}, (_, v) => defaultVoice(v));
  const picked = input => input.addEventListener("change", async () => {
    const list = Array.from(input.files || []).map(file => ({file, path: file.webkitRelativePath || file.name}));
    input.value = "";
    if (list.length) await loadFiles(list);
  });
  picked($("kit-files"));
  picked($("kit-folder"));
  const zone = $("kit-drop");
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("kit-drop-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("kit-drop-over"));
  zone.addEventListener("drop", async e => {
    e.preventDefault();
    zone.classList.remove("kit-drop-over");
    const list = await filesFromDrop(e.dataTransfer);
    if (list.length) await loadFiles(list);
  });
  $("kit-name").addEventListener("input", e => { state.name = e.target.value; });
  $("kit-name").addEventListener("change", e => { state.name = cleanName(e.target.value); e.target.value = state.name; rebuild(); });
  $("kit-author").addEventListener("input", e => { state.author = e.target.value; });
  $("kit-licence").addEventListener("input", e => { state.licence = e.target.value; state.licenceFrom = ""; paintLicence(); });
  $("kit-base").addEventListener("change", e => { state.baseKit = parseInt(e.target.value); render(); });
  $("kit-reset").addEventListener("click", resetMapping);
  let finding = 0;
  $("kit-filter").addEventListener("input", () => {
    clearTimeout(finding);
    finding = setTimeout(() => { paintLists(); paintRowErrors(); }, 150);
  });
  $("kit-save").addEventListener("click", saveMckit);
  $("kit-send").addEventListener("click", () => oneSend(async () => {
    await rebuild();
    if (state.image) await sendNow(state.image, meta());
  }));
  $("kit-resend").addEventListener("click", () => resendLast(false));
  controller.onKit = onKitMessage;
  controller.onPausedSend = () => {
    if (!upload.active && !upload.foreign) return;
    const now = performance.now();
    if (now - (upload.pausedSaid || 0) > 3000) {
      upload.pausedSaid = now;
      say(`That waits: ${controller.kitPaused}. What is changed meanwhile goes to the minichord once it's done.`, "info");
    }
  };
  // INFO asked after each dump (minichordcontroller.js): no answer in 1 s is a firmware with no kit slot
  controller.onKitAsked = () => {
    clearTimeout(upload.askedTimer);
    const asked = performance.now();
    upload.askedTimer = setTimeout(() => {
      if (!upload.active && !(state.info && upload.lastAt >= asked)) { state.info = null; state.noSlot = true; paintInfo(); }
    }, 1000);
  };
  render();
  paintInfo();
  loadLast().then(paintInfo);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupKits);
else setupKits();

})(typeof window !== "undefined" ? window : globalThis);
