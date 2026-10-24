// node flash_test.js: the firmware updater's core (flash.js), with no page and no USB.
//
// The real hexes first: the fork's committed firmware.hex (FLASH_VECTORS_FW, else the feature-webFlash
// worktree's, else ~/minichord's) and Ben's classic one (FLASH_VECTORS_CLASSIC, else a copy downloaded to
// /tmp/claude-1000/webflash-vectors/classic.hex); each is skipped with a note when it isn't there. Both
// must read and pass the checks, and where test/flash holds a reference for that exact file (made by
// test/flash/plan.py, a separate Python reader, keyed by the hex's sha256) the planned blocks and the
// sha256 of every report laid end to end must be the reference's. test/flash/gaps.hex is never skipped:
// a small program made with teensyImage({length: 0x6000}) below, with holes at 0x1400-0x2A10 and
// 0x3800-0x4F00, so one comparison with the Python reference always runs, across the holes (its
// reference: python3 -I test/flash/plan.py test/flash/gaps.hex > test/flash/gaps.json). Then hexes made
// here, broken in every way the reader refuses, the reports to the byte, and program() and boot()
// against a fake HalfKay on a fake clock.

const fs = require("fs");
const os = require("os");
const path = require("path");
const flash = require(path.join(__dirname, "flash.js"));
const {FlashError, FLASH_BASE, BLOCK_SIZE, REPORT_LENGTH, MINICHORD_LIMIT, CODE_END} = flash;

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
const hex8 = n => "0x" + (n >>> 0).toString(16).toUpperCase().padStart(8, "0");

// a FlashError's message is for a player: a sentence, no addresses, no line numbers; its detail says more
const plain = e => typeof e.message === "string" && /^[A-Z].*\.$/.test(e.message) && !/0x|\bline \d|undefined|NaN|null/.test(e.message)
  && typeof e.detail === "string" && e.detail.length > 0;
function throwsCode(fn, code, what, also = () => true) {
  try {
    fn();
  } catch (e) {
    const ok = e instanceof FlashError && e.code === code && plain(e) && also(e);
    check(ok, `${what}: FlashError '${code}' with a plain message (got ${e.name} '${e.code}': ${e.message} [${e.detail}])`);
    return e;
  }
  check(false, `${what}: FlashError '${code}' (nothing thrown)`);
  return null;
}
// a program() that should succeed: its result, or a FAIL and {} where it rejects
async function resolves(promise, what) {
  try {
    return await promise;
  } catch (e) {
    check(false, `${what}: resolves (got ${e.name} '${e.code}': ${e.message} [${e.detail}])`);
    return {};
  }
}
async function rejectsCode(promise, code, what, also = () => true) {
  try {
    await promise;
  } catch (e) {
    const ok = e instanceof FlashError && e.code === code && plain(e) && also(e);
    check(ok, `${what}: FlashError '${code}' with a plain message (got ${e.name} '${e.code}': ${e.message} [${e.detail}])`);
    return e;
  }
  check(false, `${what}: FlashError '${code}' (resolved)`);
  return null;
}

// ---- hexes made here ------------------------------------------------------------------------------
function record(type, address, bytes) {
  const r = [bytes.length, address >> 8 & 0xFF, address & 0xFF, type, ...bytes];
  r.push(-r.reduce((a, b) => a + b, 0) & 0xFF);
  return ":" + r.map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}
// segments [{address, bytes}] as Intel HEX lines, 16 bytes a record, an 04 record whenever the upper
// half of the address changes, a start address and (unless eof is false) the end-of-file record
function hexLines(segments, {eof = true} = {}) {
  const lines = [];
  let upper = -1;
  for (const {address, bytes} of segments) {
    for (let i = 0; i < bytes.length; i += 16) {
      const a = address + i;
      if (Math.floor(a / 0x10000) !== upper) {
        upper = Math.floor(a / 0x10000);
        lines.push(record(4, 0, [upper >> 8, upper & 0xFF]));
      }
      lines.push(record(0, a & 0xFFFF, Array.from(bytes.subarray(i, Math.min(i + 16, bytes.length)))));
    }
  }
  lines.push(record(5, 0, [0x60, 0x00, 0x10, 0x00]));
  if (eof) lines.push(record(1, 0, []));
  return lines;
}
const hexOf = (segments, options) => hexLines(segments, options).join("\n") + "\n";

// A small Teensy 4.0 program laid out as Teensyduino lays one out: the FlexSPI configuration, 0xFF to
// 0x1000, the image vector table and boot data, then made-up code to length bytes
function teensyImage({length = 0x3000, flashSize = 0x00200000, ivt = 0x432000D1, bootLength = length} = {}) {
  const b = new Uint8Array(length).fill(0xFF);
  const v = new DataView(b.buffer);
  const words = (at, list) => list.forEach((w, i) => v.setUint32(at + 4 * i, w >>> 0, true));
  b.fill(0, 0, 0x200);
  words(0, [0x42464346, 0x56010000, 0, 0x00030301]);
  words(0x44, [0x00080401]);
  words(0x50, [flashSize]);
  words(0x1000, [ivt, 0x60001401, 0, 0, 0x60001020, 0x60001000, FLASH_BASE + length - 0x400, 0]);
  words(0x1020, [FLASH_BASE, bootLength, 0]);
  for (let i = 0x1030; i < length - 0x400; i++) b[i] = (i * 7 + 3) & 0xFF;
  b.fill(0, length - 0x400);      // the signature placeholder closes the image
  return b;
}
const whole = (bytes = teensyImage()) => [{address: FLASH_BASE, bytes}];

// ---- the real hexes ------------------------------------------------------------------------------
function references() {
  const dir = path.join(__dirname, "test/flash");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => ({file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))}));
}

// required: a FAIL, not a SKIP, where the hex or its reference is missing
async function testRealHex(name, tries, {required = false} = {}) {
  const file = tries.filter(Boolean).find(f => fs.existsSync(f));
  if (!file) {
    if (required) check(false, `the ${name} hex is at ${tries.filter(Boolean).join(" or ")}`);
    else console.log(`SKIP the ${name} hex: none at ${tries.filter(Boolean).join(" or ")}`);
    return null;
  }
  const raw = new Uint8Array(fs.readFileSync(file));
  let image;
  try {
    image = flash.parseHex(Buffer.from(raw).toString("latin1"));
  } catch (e) {
    check(false, `the ${name} hex (${file}) reads: ${e.message} [${e.detail}]`);
    return null;
  }
  check(equalBytes(flash.parseHex(raw).data, image.data), `the ${name} hex reads the same from its bytes as from its text`);
  let facts = null;
  try {
    facts = flash.checkImage(image);
  } catch (e) {
    check(false, `the ${name} hex passes checkImage: ${e.message} [${e.detail}]`);
    return null;
  }
  const blocks = flash.planBlocks(image);
  check(image.start === FLASH_BASE && image.end > FLASH_BASE + 0x2000 && image.end <= MINICHORD_LIMIT, `the ${name} hex starts at 0x60000000 and ends below the kit header`);
  check(facts.length === image.end - FLASH_BASE && facts.end === image.end, `the ${name} hex's boot data length is its extent`);
  check(facts.ivtVersion === 0x43, `the ${name} hex's image vector table is version 0x43 (Teensyduino 1.56 on)`);
  check([0, 1024, 2048, 3072, 4096].every((o, i) => blocks[i] === o), `the ${name} hex's first blocks are 0, 1024, 2048, 3072, 4096 (1-3 all 0xFF but sent)`);
  check(blocks.every((o, i) => o % BLOCK_SIZE === 0 && (i === 0 || o > blocks[i - 1])), `the ${name} hex's blocks ascend in 1 KB steps`);
  // every block holding a byte of the hex is planned, and nothing else after block 0
  const covered = [];
  for (let o = 0; o < CODE_END - FLASH_BASE; o += BLOCK_SIZE) if (image.present.subarray(o, o + BLOCK_SIZE).some(x => x)) covered.push(o);
  check(blocks.join() === [...new Set([0, ...covered])].join(), `the ${name} hex's blocks are block 0 and the blocks it covers`);
  check(blocks[blocks.length - 1] + BLOCK_SIZE >= image.end - FLASH_BASE && blocks[blocks.length - 1] < image.end - FLASH_BASE, `the ${name} hex's last block holds its last byte`);
  const fileSha = await flash.sha256(raw);
  const ref = references().find(r => r.hexSha256 === fileSha);
  console.log(`${name}: ${file}, sha256 ${fileSha.slice(0, 16)}..., ${hex8(image.start)}-${hex8(image.end)}, ${image.bytes} bytes, ${blocks.length} blocks, boot data length ${hex8(facts.length)}`);
  if (!ref) {
    if (required) check(false, `the ${name} hex has a Python reference: a test/flash/*.json for its sha256`);
    else console.log(`SKIP the ${name} hex against the Python reference: no test/flash/*.json for this file's sha256`);
    return {image, blocks};
  }
  check(image.start === ref.start && image.end === ref.end && image.bytes === ref.bytes && facts.length === ref.bootLength,
    `the ${name} hex's start, end, byte count and boot data length are ${ref.file}'s`);
  const expected = [];
  for (const [from, to] of ref.runs) for (let o = from; o < to; o += BLOCK_SIZE) expected.push(o);
  check(blocks.length === ref.blocks && blocks.join() === expected.join(), `the ${name} hex's ${blocks.length} planned blocks are ${ref.file}'s ${ref.blocks}`);
  const all = new Uint8Array(blocks.length * REPORT_LENGTH);
  blocks.forEach((o, i) => all.set(flash.blockReport(image, o), i * REPORT_LENGTH));
  check(await flash.sha256(all) === ref.reportsSha256, `the ${name} hex's reports, end to end, hash as ${ref.file} says`);
  return {image, blocks, ref};
}

// ---- the reader and the checks on hexes made here ---------------------------------------------------
function testHex() {
  const good = flash.parseHex(hexOf(whole()));
  check(good.start === FLASH_BASE && good.end === FLASH_BASE + 0x3000 && good.bytes === 0x3000, "a made-up program reads: start, end and byte count");
  check(good.data.length === CODE_END - FLASH_BASE && good.present.length === CODE_END - FLASH_BASE, "data and present cover the program space");
  check(good.data[0x3000] === 0xFF && good.present[0x3000] === 0 && good.present[0x2FFF] === 1 && good.data[0x1000] === 0xD1, "data and present hold the hex");
  const facts = flash.checkImage(good);
  check(facts.length === 0x3000 && facts.end === FLASH_BASE + 0x3000 && facts.ivtVersion === 0x43, "a made-up program passes checkImage");
  check(flash.planBlocks(good).join() === Array.from({length: 12}, (_, i) => i * 1024).join(), "a made-up program of 12 KB is 12 blocks");
  // CR LF, lower case, blank lines after the end, a byte-order mark: the same image
  const crlf = flash.parseHex("\uFEFF" + hexLines(whole()).map(l => l.toLowerCase()).join("\r\n") + "\r\n\r\n\n");
  check(equalBytes(crlf.data, good.data) && equalBytes(crlf.present, good.present), "CR LF, lower case and blank lines after the end read the same");
  const cr = flash.parseHex(hexLines(whole()).join("\r"));
  check(equalBytes(cr.data, good.data), "bare CR line ends read the same");
  check(flash.checkImage(flash.parseHex(hexOf(whole(teensyImage({ivt: 0x402000D1}))))).ivtVersion === 0x40, "an image vector table of Teensyduino 1.53 (0x40) passes");

  // a gap in the hex: its blocks aren't sent; a block the hex half covers is, 0xFF where it has nothing
  const image = teensyImage();
  const gappy = flash.parseHex(hexOf([{address: FLASH_BASE, bytes: image.subarray(0, 0x1400)},
    {address: FLASH_BASE + 0x2A10, bytes: image.subarray(0x2A10)}]));
  check(flash.planBlocks(gappy).join() === [0, 1, 2, 3, 4, 10, 11].map(b => b * 1024).join(), "blocks the hex doesn't touch aren't planned");
  const r10 = flash.blockReport(gappy, 10 * 1024);
  check(r10.subarray(64, 64 + 0x210).every(b => b === 0xFF) && equalBytes(r10.subarray(64 + 0x210), image.subarray(0x2A10, 0x2C00)),
    "a block the hex half covers is 0xFF where the hex has nothing");
  // block 0 is always first, even where the hex doesn't hold it (checkImage refuses such a hex anyway)
  const late = flash.parseHex(hexOf([{address: FLASH_BASE + 0x2000, bytes: image.subarray(0x2000)}]));
  check(flash.planBlocks(late).join() === "0,8192,9216,10240,11264", "block 0 is planned first even when the hex starts later");
  throwsCode(() => flash.checkImage(late), "image", "a hex that doesn't start at 0x60000000");

  // broken files
  const lines = hexLines(whole());
  const at = lines.findIndex(l => l.startsWith(":10") && l.slice(7, 9) === "00") + 5;
  const swap = (i, line) => lines.map((l, j) => j === i ? line : l).join("\n");
  const last = lines[at];
  const badSum = last.slice(0, -2) + ((parseInt(last.slice(-2), 16) + 1) & 0xFF).toString(16).toUpperCase().padStart(2, "0");
  throwsCode(() => flash.parseHex(swap(at, badSum)), "hex", "a wrong checksum", e => /checksum/.test(e.detail) && e.detail.includes(`line ${at + 1}`));
  const badData = last.slice(0, 20) + (last[20] === "0" ? "1" : "0") + last.slice(21);
  throwsCode(() => flash.parseHex(swap(at, badData)), "hex", "a changed data byte (so the checksum is wrong)");
  throwsCode(() => flash.parseHex(hexOf(whole(), {eof: false})), "hex", "no end-of-file record", e => /end-of-file/.test(e.detail));
  throwsCode(() => flash.parseHex(lines.slice(0, 200).join("\n")), "hex", "a file cut short");
  throwsCode(() => flash.parseHex(swap(at, last.slice(0, 15) + last.slice(17))), "hex", "a line a byte short", e => /characters/.test(e.detail));
  throwsCode(() => flash.parseHex(swap(at, last.slice(0, 15) + "AB" + last.slice(15))), "hex", "a line a byte long");
  throwsCode(() => flash.parseHex(swap(at, last + "0")), "hex", "a line a character long");
  throwsCode(() => flash.parseHex(swap(at, last + " ")), "hex", "a space after a line");
  throwsCode(() => flash.parseHex(swap(at, last.slice(0, 20) + "G" + last.slice(21))), "hex", "a character that isn't hex", e => /isn't a hex byte/.test(e.detail));
  throwsCode(() => flash.parseHex(swap(at, last.slice(1))), "hex", "a line without its colon");
  throwsCode(() => flash.parseHex([record(2, 0, [0x10, 0x00]), ...lines].join("\n")), "hex", "a record 02", e => /type 0x02/.test(e.detail));
  throwsCode(() => flash.parseHex([record(3, 0, [0, 0, 0x10, 0]), ...lines].join("\n")), "hex", "a record 03", e => /type 0x03/.test(e.detail));
  throwsCode(() => flash.parseHex([record(6, 0, [0]), ...lines].join("\n")), "hex", "a record 06");
  throwsCode(() => flash.parseHex([record(5, 0, [0x60, 0, 0x10]), ...lines].join("\n")), "hex", "a start address record of 3 bytes");
  throwsCode(() => flash.parseHex([record(4, 0, [0x60]), ...lines].join("\n")), "hex", "an extended address record of 1 byte");
  throwsCode(() => flash.parseHex([...lines, record(0, 0, [1, 2])].join("\n")), "hex", "a record after the end-of-file record", e => /after the end-of-file/.test(e.detail));
  throwsCode(() => flash.parseHex([...lines.slice(0, -1), record(1, 0, [0]), ""].join("\n")), "hex", "an end-of-file record with data");
  throwsCode(() => flash.parseHex("hello\n"), "hex", "a text file");
  throwsCode(() => flash.parseHex(""), "hex", "an empty file");

  // well-formed hexes that aren't a minichord program
  throwsCode(() => flash.parseHex(hexOf([{address: 0x00001000, bytes: new Uint8Array(64)}, ...whole()])), "image", "data below 0x60000000 (a Teensy 3 address)",
    e => /0x00001000/.test(e.detail));
  throwsCode(() => flash.parseHex(hexOf([{address: 0x20000000, bytes: new Uint8Array(16)}, ...whole()])), "image", "data in RAM");
  const atLimit = flash.parseHex(hexOf([...whole(), {address: MINICHORD_LIMIT, bytes: Uint8Array.of(0x42)}]));
  check(atLimit.end === MINICHORD_LIMIT + 1, "a byte at the kit header reads (it's inside the Teensy 4.0's program space)");
  throwsCode(() => flash.checkImage(atLimit), "image", "a byte at the kit header, 0x601E0000", e => /too big/.test(e.message));
  const justBelow = flash.parseHex(hexOf([...whole(), {address: MINICHORD_LIMIT - 16, bytes: new Uint8Array(16)}]));
  throwsCode(() => flash.checkImage(justBelow), "image", "a byte just below the kit header, with the boot data length short of it", e => /length/.test(e.message));
  throwsCode(() => flash.checkImage(good, {limit: FLASH_BASE + 0x2000}), "image", "a program past a lower limit");
  throwsCode(() => flash.parseHex(hexOf([...whole(), {address: CODE_END, bytes: Uint8Array.of(0x42)}])), "image", "a byte at 0x601F0000, past the program space");
  throwsCode(() => flash.parseHex(hexOf([...whole(), {address: CODE_END - 8, bytes: new Uint8Array(16)}])), "image", "a record running over 0x601F0000");
  // a damaged line after data out of range: the file is damaged first
  throwsCode(() => flash.parseHex(hexOf([{address: 0x1000, bytes: new Uint8Array(16)}, ...whole()]).replace(/\n:/, "\n:x")), "hex",
    "a damaged file with data out of range is damaged");
  throwsCode(() => flash.parseHex(record(5, 0, [0x60, 0, 0x10, 0]) + "\n" + record(1, 0, [])), "image", "a hex with no data");
  throwsCode(() => flash.checkImage(flash.parseHex(hexOf(whole(teensyImage({flashSize: 0x00800000}))))), "image", "a Teensy 4.1 program",
    e => e.message.includes("Teensy 4.1") && /0x00800000/.test(e.detail));
  throwsCode(() => flash.checkImage(flash.parseHex(hexOf(whole(teensyImage({flashSize: 0x01000000}))))), "image", "a Teensy MicroMod program",
    e => e.message.includes("MicroMod"));
  throwsCode(() => flash.checkImage(flash.parseHex(hexOf(whole(teensyImage({flashSize: 0x00400000}))))), "image", "an unknown flash size");
  throwsCode(() => flash.checkImage(flash.parseHex(hexOf(whole(teensyImage({ivt: 0x412000D2}))))), "image", "a wrong image vector table header");
  throwsCode(() => flash.checkImage(flash.parseHex(hexOf(whole(teensyImage({ivt: 0x462000D1}))))), "image", "an image vector table version past 0x45");
  throwsCode(() => flash.checkImage(flash.parseHex(hexOf(whole(teensyImage({bootLength: 0x2C00}))))), "image", "a boot data length short of the hex",
    e => /length/.test(e.message));
  const noFcfb = teensyImage();
  noFcfb[0] = 0x41;
  throwsCode(() => flash.checkImage(flash.parseHex(hexOf(whole(noFcfb)))), "image", "no FlexSPI configuration");
  const badSelf = teensyImage();
  new DataView(badSelf.buffer).setUint32(0x1014, 0x60002000, true);
  throwsCode(() => flash.checkImage(flash.parseHex(hexOf(whole(badSelf)))), "image", "an image vector table that doesn't point at itself");
}

// ---- the reports ----------------------------------------------------------------------------------
function testReports() {
  const image = flash.parseHex(hexOf(whole()));
  const r0 = flash.blockReport(image, 0);
  const bytes = teensyImage();
  check(r0.length === 1088 && r0[0] === 0 && r0[1] === 0 && r0[2] === 0 && r0.subarray(3, 64).every(b => b === 0)
    && equalBytes(r0.subarray(64), bytes.subarray(0, 1024)), "block 0's report: 0 0 0, 61 zeros, the block");
  const r = flash.blockReport(image, 11 * 1024);
  check(r[0] === 0x00 && r[1] === 0x2C && r[2] === 0x00 && r.subarray(3, 64).every(b => b === 0) && equalBytes(r.subarray(64), bytes.subarray(0x2C00, 0x3000)),
    "block 11's report: 00 2C 00, zeros, the block");
  const far = flash.blockReport(image, 0x15EC00);
  check(far[0] === 0x00 && far[1] === 0xEC && far[2] === 0x15 && far.subarray(3, 64).every(b => b === 0) && far.subarray(64).every(b => b === 0xFF),
    "a block at 0x15EC00 the hex doesn't hold: 00 EC 15, zeros, 1024 of 0xFF");
  const top = flash.blockReport(image, CODE_END - FLASH_BASE - 1024);
  check(top[0] === 0x00 && top[1] === 0xFC && top[2] === 0x1E, "the last block of the program space, 0x1EFC00: 00 FC 1E");
  check([1000, -1024, CODE_END - FLASH_BASE, 1.5].every(o => { try { flash.blockReport(image, o); return false; } catch (e) { return e instanceof RangeError; } }),
    "blockReport refuses offsets that aren't a block of the program space");
  const boot = flash.bootReport();
  check(boot.length === 1088 && boot[0] === 0xFF && boot[1] === 0xFF && boot[2] === 0xFF && boot.subarray(3).every(b => b === 0), "the boot report: FF FF FF, then 1085 zeros");
}

// ---- program() and boot() against a fake HalfKay --------------------------------------------------
function fakeClock() {
  const c = {t: 0, sleeps: []};
  c.now = () => c.t;
  c.sleep = async ms => { c.sleeps.push(ms); c.t += ms; };
  return c;
}
const notAllowed = () => new DOMException("Failed to write the report.", "NotAllowedError");
const offsetOf = report => report[0] | report[1] << 8 | report[2] << 16;

// fail(offset, tryOfThisBlock, device) gives the error a write rejects with, or nothing
function fakeDevice({usage = 0x24, items = null, opened = true, fail = () => null, openError = null, clock = null} = {}) {
  const dev = {
    opened, vendorId: 0x16C0, productId: 0x0478, productName: "",
    collections: [{usagePage: 0xFF9C, usage, inputReports: [], featureReports: [], outputReports: items ? [{reportId: 0, items}] : []}],
    calls: [], written: [], log: [], inFlight: 0, overlap: false, tries: new Map(),
    async open() {
      dev.log.push("open");
      if (openError) throw openError;
      dev.opened = true;
    },
    async close() { dev.log.push("close"); dev.opened = false; },
    async sendReport(id, data) {
      dev.inFlight++;
      if (dev.inFlight > 1) dev.overlap = true;
      const copy = Uint8Array.from(data);
      dev.calls.push({id, data: copy});
      dev.log.push("send");
      await new Promise(resolve => setImmediate(resolve));
      if (clock) clock.t += 1;
      const offset = offsetOf(copy), n = (dev.tries.get(offset) || 0) + 1;
      dev.tries.set(offset, n);
      dev.inFlight--;
      const error = fail(offset, n, dev);
      if (error) throw error;
      dev.written.push(copy);
    },
  };
  return dev;
}
const isBoot = report => report[0] === 0xFF && report[1] === 0xFF && report[2] === 0xFF;

async function testProgram(reals) {
  const image = flash.parseHex(hexOf(whole()));
  const blocks = flash.planBlocks(image);

  // (a) the happy path: every block once, in order, one at a time, no boot report, not closed
  {
    const clock = fakeClock(), dev = fakeDevice({opened: false, clock}), progress = [];
    const result = await resolves(flash.program(dev, image, {sleep: clock.sleep, now: clock.now, onProgress: (done, total) => progress.push([done, total])}), "(a)");
    check(dev.calls.length === blocks.length && dev.calls.every((c, i) => c.id === 0 && equalBytes(c.data, flash.blockReport(image, blocks[i]))),
      `(a) ${blocks.length} reports, report ID 0, each the planned block in order`);
    check(!dev.overlap, "(a) never two writes at once");
    check(!dev.calls.some(c => isBoot(c.data)) && !dev.log.includes("close"), "(a) no boot report, not closed");
    check(dev.log[0] === "open" && dev.log.filter(l => l === "open").length === 1, "(a) a closed device is opened, once");
    check(progress.length === blocks.length && progress.every(([d, t], i) => d === i + 1 && t === blocks.length), "(a) onProgress(done, total) after each block");
    check(result.blocks === blocks.length && result.retries === 0 && clock.sleeps.length === 0, "(a) resolves {blocks, retries}, no sleeps");
  }
  // (a) on the real firmware, and the hex with holes: what goes to the device is the Python reference's reports
  for (const [name, real] of Object.entries(reals)) {
    if (!real || !real.ref) continue;
    const dev = fakeDevice();
    await resolves(flash.program(dev, real.image, {sleep: async () => {}}), `(a) the ${name} hex`);
    const all = new Uint8Array(dev.calls.length * REPORT_LENGTH);
    dev.calls.forEach((c, i) => all.set(c.data, i * REPORT_LENGTH));
    check(dev.calls.length === real.ref.blocks && !dev.overlap && await flash.sha256(all) === real.ref.reportsSha256,
      `(a) the ${name} hex: ${real.ref.blocks} writes, one at a time, hashing as the reference's reports`);
  }
  // (b) NotAllowedError twice on block 3, then it writes: 10 ms between tries
  {
    const clock = fakeClock();
    const dev = fakeDevice({clock, fail: (offset, n) => offset === 3 * 1024 && n <= 2 ? notAllowed() : null});
    const result = await resolves(flash.program(dev, image, {sleep: clock.sleep, now: clock.now}), "(b)");
    check(result.retries === 2 && clock.sleeps.join() === "10,10", "(b) two retries on block 3, 10 ms apart");
    check(dev.calls.length === blocks.length + 2 && dev.written.length === blocks.length && dev.written.every((w, i) => offsetOf(w) === blocks[i]) && !dev.overlap,
      "(b) every block written once, in order, the retries one at a time");
  }
  // (c) block 7 never writes: 'write' once its 5 s are up, nothing after it, no boot
  {
    const clock = fakeClock();
    const dev = fakeDevice({clock, fail: offset => offset === 7 * 1024 ? notAllowed() : null});
    const e = await rejectsCode(flash.program(dev, image, {sleep: clock.sleep, now: clock.now}), "write", "(c) block 7 failing for good");
    check(e && clock.t >= 5000 && clock.t < 5100 && clock.sleeps.every(s => s === 10), `(c) given up after 5 s of 10 ms retries (${clock.t} ms)`);
    check(dev.written.length === 7 && dev.calls.every(c => offsetOf(c.data) <= 7 * 1024) && !dev.calls.some(c => isBoot(c.data)) && !dev.log.includes("close"),
      "(c) nothing after block 7, no boot report, not closed");
    check(e && !/Linux/.test(e.message), "(c) a later block's failure says nothing of Linux");
  }
  // (d) block 0 fails for 44 s (the erase), then writes: the first five have 45 s
  {
    const clock = fakeClock();
    const dev = fakeDevice({clock, fail: offset => offset === 0 && clock.t < 44000 ? notAllowed() : null});
    const result = await resolves(flash.program(dev, image, {sleep: clock.sleep, now: clock.now}), "(d) block 0");
    check(result.blocks === blocks.length && dev.written.length === blocks.length && clock.t >= 44000, "(d) block 0 failing for 44 s, then the rest");
  }
  {
    const clock = fakeClock();
    const dev = fakeDevice({clock, fail: offset => offset === 4 * 1024 && clock.t < 44000 ? notAllowed() : null});
    await resolves(flash.program(dev, image, {sleep: clock.sleep, now: clock.now}), "(d) block 4");
    check(dev.written.length === blocks.length, "(d) block 4 (the fifth write) also has 45 s");
  }
  {
    const clock = fakeClock();
    const dev = fakeDevice({clock, fail: offset => offset === 5 * 1024 && clock.t < 44000 ? notAllowed() : null});
    await rejectsCode(flash.program(dev, image, {sleep: clock.sleep, now: clock.now}), "write", "(d) block 5 (the sixth write) has 5 s");
  }
  {
    const clock = fakeClock();
    const dev = fakeDevice({clock, fail: offset => offset === 0 ? notAllowed() : null});
    const e = await rejectsCode(flash.program(dev, image, {sleep: clock.sleep, now: clock.now}), "write", "(d) block 0 failing for good");
    check(e && clock.t >= 45000 && clock.t < 45100 && /Linux/.test(e.message) && /00-teensy\.rules/.test(e.message), "(d) given up after 45 s, mentioning the Linux rule");
  }
  // (e) InvalidStateError: gone at once, no retry
  {
    const clock = fakeClock();
    const dev = fakeDevice({clock, fail: offset => offset === 4 * 1024 ? new DOMException("The device was closed unexpectedly.", "InvalidStateError") : null});
    await rejectsCode(flash.program(dev, image, {sleep: clock.sleep, now: clock.now}), "gone", "(e) InvalidStateError");
    check(clock.sleeps.length === 0 && dev.calls.length === 5 && !dev.calls.some(c => isBoot(c.data)), "(e) no retry, nothing after, no boot report");
  }
  // (e) navigator.hid's disconnect for this device during a write
  {
    const clock = fakeClock(), hid = new EventTarget();
    const dev = fakeDevice({clock, fail: (offset, n, d) => {
      if (offset !== 6 * 1024) return null;
      const other = new Event("disconnect");
      other.device = {};
      hid.dispatchEvent(other);
      if (n === 1) return notAllowed();       // someone else's device: tried again
      const mine = new Event("disconnect");
      mine.device = d;
      hid.dispatchEvent(mine);
      return notAllowed();
    }});
    await rejectsCode(flash.program(dev, image, {sleep: clock.sleep, now: clock.now, hid}), "gone", "(e) a disconnect event for this device");
    check(clock.sleeps.length === 1 && dev.calls.length === 8, "(e) another device's disconnect is ignored; this one's stops at once");
  }
  {
    const clock = fakeClock();
    const dev = fakeDevice({clock, fail: (offset, n, d) => { if (offset === 2048) { d.opened = false; return notAllowed(); } return null; }});
    await rejectsCode(flash.program(dev, image, {sleep: clock.sleep, now: clock.now}), "gone", "(e) a write failing with the device no longer open");
  }
  {
    const hid = new EventTarget();
    let listening = 0;
    const add = hid.addEventListener.bind(hid), remove = hid.removeEventListener.bind(hid);
    hid.addEventListener = (...a) => { listening++; add(...a); };
    hid.removeEventListener = (...a) => { listening--; remove(...a); };
    await resolves(flash.program(fakeDevice(), image, {sleep: async () => {}, hid}), "(e) the listener's run");
    await flash.program(fakeDevice({fail: () => notAllowed()}), image, {sleep: async () => {}, now: (() => { let t = 0; return () => (t += 50000); })(), hid}).catch(() => {});
    check(listening === 0, "(e) the disconnect listener is removed, success or failure");
  }
  // (f) open() rejects
  {
    const dev = fakeDevice({opened: false, openError: new DOMException("Failed to open the device.", "NotAllowedError")});
    await rejectsCode(flash.program(dev, image, {sleep: async () => {}}), "open", "(f) open() rejecting",
      e => /Linux/.test(e.message) && /00-teensy\.rules/.test(e.message) && /NotAllowedError/.test(e.detail));
    check(dev.calls.length === 0, "(f) nothing sent");
  }
  // (g) a Teensy 4.1 (usage 0x25) or MicroMod (0x26) in update mode
  {
    const dev = fakeDevice({usage: 0x25, opened: false});
    await rejectsCode(flash.program(dev, image), "board", "(g) usage 0x25", e => e.message.includes("Teensy 4.1"));
    check(dev.calls.length === 0 && dev.log.length === 0, "(g) not opened, nothing sent");
    throwsCode(() => flash.checkDevice(fakeDevice({usage: 0x26})), "board", "(g) usage 0x26", e => e.message.includes("MicroMod"));
    throwsCode(() => flash.checkDevice(fakeDevice({usage: 0x99})), "board", "(g) an unknown usage");
    throwsCode(() => flash.checkDevice({collections: [{usagePage: 0xFFAB, usage: 0x0200}]}), "board", "(g) the running minichord's raw HID");
    throwsCode(() => flash.checkDevice({collections: []}), "board", "(g) no collections");
  }
  // (h) the output report's size, where WebHID lists its items
  {
    const dev = fakeDevice({items: [{reportSize: 8, reportCount: 64}]});
    await rejectsCode(flash.program(dev, image), "board", "(h) a 64-byte output report", e => /64 bytes/.test(e.detail));
    check(dev.calls.length === 0, "(h) nothing sent");
    let ok = true;
    for (const items of [[{reportSize: 8, reportCount: 1088}], [{reportSize: 8, reportCount: 1024}, {reportSize: 8, reportCount: 64}], [], null]) {
      try { flash.checkDevice(fakeDevice({items})); } catch (e) { ok = false; }
    }
    try { flash.checkDevice({collections: [{usagePage: 0xFF9C, usage: 0x24}]}); } catch (e) { ok = false; }
    check(ok, "(h) 1088 bytes, in one item or two, or no items listed, is accepted");
  }
  // (i) an aborted signal: between blocks, and between the tries of one
  {
    const controller = new AbortController(), dev = fakeDevice();
    await rejectsCode(flash.program(dev, image, {signal: controller.signal, onProgress: done => { if (done === 3) controller.abort(); }}), "cancelled", "(i) aborted after block 2");
    check(dev.calls.length === 3 && !dev.log.includes("close") && !dev.calls.some(c => isBoot(c.data)), "(i) three blocks, then nothing");
    const clock = fakeClock(), retrying = new AbortController();
    const stuck = fakeDevice({clock, fail: offset => {
      if (offset !== 1024) return null;
      if (clock.t > 300) retrying.abort();
      return notAllowed();
    }});
    await rejectsCode(flash.program(stuck, image, {sleep: clock.sleep, now: clock.now, signal: retrying.signal}), "cancelled", "(i) aborted while block 1 retries");
    check(clock.t < 1000, "(i) the retries stop at the abort");
    const before = new AbortController();
    before.abort();
    const untouched = fakeDevice();
    await rejectsCode(flash.program(untouched, image, {signal: before.signal}), "cancelled", "(i) aborted before it began");
    check(untouched.calls.length === 0, "(i) nothing sent");
  }
  // a hex that isn't a minichord program never reaches the device
  {
    const dev = fakeDevice({opened: false});
    await rejectsCode(flash.program(dev, flash.parseHex(hexOf(whole(teensyImage({flashSize: 0x00800000}))))), "image", "program() checks the image itself");
    check(dev.log.length === 0, "an image refused is never opened or written");
  }
  check(flash.openDevice && (await flash.openDevice(fakeDevice()), true), "openDevice leaves an open device be");
}

async function testBoot() {
  const dev = fakeDevice();
  check(await flash.boot(dev) === true, "boot() resolves true when the boot report went");
  check(dev.log.join() === "send,close" && dev.calls[0].id === 0 && equalBytes(dev.calls[0].data, flash.bootReport()), "boot(): the boot report, then close");
  // refused for good: sent again every 10 ms, one at a time, till its 0.5 s are up, then false and closed
  const rudeClock = fakeClock();
  const rude = fakeDevice({clock: rudeClock, fail: () => new DOMException("Failed to write the report.", "NotAllowedError")});
  rude.close = async () => { rude.log.push("close"); throw new DOMException("gone", "InvalidStateError"); };
  let threw = false;
  try { check(await flash.boot(rude, {sleep: rudeClock.sleep, now: rudeClock.now}) === false, "boot() resolves false when the boot report failed for good"); } catch (e) { threw = true; }
  const sends = rude.log.filter(l => l === "send").length;
  check(!threw && rude.log[rude.log.length - 1] === "close" && rude.log.slice(0, -1).every(l => l === "send"), "boot() swallows the boot report's errors and close()'s");
  check(sends > 10 && rudeClock.t >= flash.BOOT_BUDGET && rudeClock.t < flash.BOOT_BUDGET + 50 && rudeClock.sleeps.every(s => s === 10) && !rude.overlap
    && rude.calls.every(c => isBoot(c.data)), `boot() sends the refused report again every 10 ms, one at a time, for 0.5 s (${sends} tries, ${rudeClock.t} ms)`);
  // refused once (HalfKay still busy with the last block), then it goes
  const onceClock = fakeClock();
  const once = fakeDevice({clock: onceClock, fail: (offset, n) => n === 1 ? new DOMException("Failed to write the report.", "NotAllowedError") : null});
  check(await flash.boot(once, {sleep: onceClock.sleep, now: onceClock.now}) === true && once.log.join() === "send,send,close" && onceClock.sleeps.join() === "10",
    "boot() refused once sends it again 10 ms later: true, two sends, then close");
  // gone: InvalidStateError, or the device closed, stops it at once
  const goneDev = fakeDevice({fail: () => new DOMException("The device was closed.", "InvalidStateError")});
  check(await flash.boot(goneDev, {sleep: async () => {}}) === false && goneDev.log.join() === "send,close", "boot() stops at InvalidStateError: one send");
  const shutMid = fakeDevice({fail: (offset, n, d) => { d.opened = false; return new DOMException("Failed to write the report.", "NotAllowedError"); }});
  check(await flash.boot(shutMid, {sleep: async () => {}}) === false && shutMid.calls.length === 1, "boot() stops when the device has closed: one send");
  const shut = fakeDevice({opened: false});
  await flash.boot(shut);
  check(shut.log.join() === "open,send,close", "boot() opens a closed device first (boot only)");
  const locked = fakeDevice({opened: false, openError: new DOMException("Failed to open the device.", "NotAllowedError")});
  let lockedSends = 0;
  locked.sendReport = async () => { lockedSends++; throw new DOMException("The device must be opened first.", "InvalidStateError"); };
  threw = false;
  try { await flash.boot(locked); } catch (e) { threw = true; }
  check(!threw && lockedSends === 1, "boot() swallows open()'s error too, and doesn't keep sending to a device it couldn't open");
}

async function testParts() {
  check(flash.HALFKAY.vendorId === 0x16C0 && flash.HALFKAY.productId === 0x0478 && flash.HALFKAY.usagePage === 0xFF9C && flash.HALFKAY.usage === 0x24,
    "HALFKAY is 16C0:0478, usage page 0xFF9C, usage 0x24");
  check(flash.REPORT_LENGTH === 1088 && flash.BLOCK_SIZE === 1024 && flash.FLASH_BASE === 0x60000000 && flash.CODE_END === 0x601F0000
    && flash.MINICHORD_LIMIT === 0x601E0000, "the sizes and addresses");
  check(flash.MINICHORD_SERIAL.usbVendorId === 0x16C0 && flash.MINICHORD_SERIAL.usbProductId === 0x048A, "MINICHORD_SERIAL is 16C0:048A");
  check(flash.RESTART_COMMAND.join() === "0,0,11,66" && flash.RESTART_FIRMWARE === 115, "the restart command, from firmware 115");
  check(flash.CODES.join() === "hex,image,board,open,write,gone,cancelled", "the error codes");
  const e = new FlashError("write", "A sentence.", "detail");
  check(e instanceof Error && e.name === "FlashError" && e.code === "write" && e.message === "A sentence." && e.detail === "detail", "FlashError(code, message, detail)");
  check(await flash.sha256("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 of 'abc'");
  check(await flash.sha256(new Uint8Array(0)) === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256 of nothing");
  check(await flash.sha256(new TextEncoder().encode("abc").buffer) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 of an ArrayBuffer");
  check(flash.versionFromTag("firmware-114") === 114 && flash.versionFromTag("firmware-9") === 9, "versionFromTag firmware-114 and firmware-9");
  check([null, undefined, "", "v114", "firmware-", "firmware-11a", "firmware-114-rc1", "fw-114"].every(t => flash.versionFromTag(t) === null), "versionFromTag of other tags is null");
  check(flash.isClassic(9) && flash.isClassic(1) && !flash.isClassic(10) && !flash.isClassic(114) && !flash.isClassic(null) && !flash.isClassic(undefined),
    "isClassic: 9 and below");
}

(async () => {
  const fw = await testRealHex("firmware", [process.env.FLASH_VECTORS_FW,
    path.join(os.homedir(), "minichord/.claude/worktrees/feature-webFlash/firmware/firmware.hex"),
    path.join(os.homedir(), "minichord/firmware/firmware.hex")]);
  await testRealHex("classic", [process.env.FLASH_VECTORS_CLASSIC, "/tmp/claude-1000/webflash-vectors/classic.hex"]);
  const gaps = await testRealHex("gaps", [path.join(__dirname, "test/flash/gaps.hex")], {required: true});
  check(gaps && gaps.ref && gaps.ref.runs.length > 1, "the hex with holes has more than one run of blocks to send");
  testHex();
  testReports();
  await testProgram({firmware: fw, gaps});
  await testBoot();
  await testParts();
  console.log(failures ? `flash_test: ${failures} failed, ${passes} passed` : `flash_test: all ${passes} passed`);
  process.exit(failures ? 1 : 0);
})();
