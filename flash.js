//-->>FLASH: UPDATE THE MINICHORD'S FIRMWARE FROM THE BROWSER
// The core of the firmware updater: a .hex read strictly, checked to be a Teensy 4.0 program that fits
// the minichord, cut into the 1 KB blocks the Teensy's bootloader (HalfKay) takes, and written to it
// over WebHID one block at a time. update.js is the page around it (the firmware sheet, where the
// firmware comes from, getting the minichord into update mode); this file has nothing of the page in
// it, and node runs it in flash_test.js against fake devices and the real hexes.
//
// How HalfKay works was pieced together from Teensy Loader's command-line source, TyTools (public
// domain) and Chromium's WebHID code; nothing here is copied from the GPL loaders. In short:
//  - HalfKay is 16C0:0478 with usage page 0xFF9C, and usage 0x24 on a Teensy 4.0 (0x25 is a 4.1,
//    0x26 a MicroMod).
//  - Each write is a 1088-byte output report with report ID 0: the block's offset from 0x60000000 in
//    bytes 0-2, zeros to byte 63, then the block's 1024 bytes. Block 0 goes first, then every block
//    the hex covers in order (all-0xFF ones too), and never one it doesn't.
//  - The first writes set off the erase, so the first five may take 45 s each and the rest 5 s (one
//    write on Linux can take 5 s by itself). A failed write is sent again 10 ms later, never while
//    one is still pending: Chrome can't cancel a write, so a second could overlap it.
//  - FF FF FF in bytes 0-2 starts the new program, sent again for up to 0.5 s if refused. It goes only
//    after every block has gone; until then a failed update leaves the minichord in update mode, ready
//    to try again.
//  - The top of the Teensy 4.0's 1984 KB holds the minichord's own kit header (0x601E0000) and
//    presets (0x601E8000), so no byte of a hex may land at 0x601E0000 or above.

(function (root) {
"use strict";

// ---- the board and the minichord -----------------------------------------------------------------
const HALFKAY = {vendorId: 0x16C0, productId: 0x0478, usagePage: 0xFF9C, usage: 0x24};
const REPORT_LENGTH = 1088;       // a 64-byte header, then the block; Chrome adds report ID 0 in front
const HEADER_LENGTH = 64;
const BLOCK_SIZE = 1024;
const FLASH_BASE = 0x60000000;
const CODE_END = 0x601F0000;      // the end of a Teensy 4.0's program space: EEPROM emulation and the restore program above
const MINICHORD_LIMIT = 0x601E0000;   // the user kit header, then the presets at 0x601E8000
const MINICHORD_SERIAL = {usbVendorId: 0x16C0, usbProductId: 0x048A};
const RESTART_COMMAND = [0, 0, 11, 66];   // for controller.sendSysEx: F0 00 00 0B 42 F7 on the wire
const RESTART_FIRMWARE = 115;     // the first firmware that knows it
const CLASSIC_FIRMWARE = 9;       // index.js's OFFICIAL_FIRMWARE: Ben's firmware is 9 or below
const FIRST_WRITES = 5;           // the writes the erase can hold up
const FIRST_BUDGET = 45000;       // ms one of those may take, every try included
const BUDGET = 5000;              // ms for each later block
const RETRY_MS = 10;
const BOOT_BUDGET = 500;          // ms the boot report is sent again for, as teensy_loader_cli gives it

// The usage on page 0xFF9C says which Teensy HalfKay is running on (TyTools' list)
const BOARDS = {0x1A: "Teensy++ 1.0", 0x1B: "Teensy 2.0", 0x1C: "Teensy++ 2.0", 0x1D: "Teensy 3.0", 0x1E: "Teensy 3.1",
  0x1F: "Teensy 3.5", 0x20: "Teensy LC", 0x21: "Teensy 3.2", 0x22: "Teensy 3.6", 0x23: "Teensy 4.0 beta",
  0x24: "Teensy 4.0", 0x25: "Teensy 4.1", 0x26: "Teensy MicroMod"};
// sflashA1Size in the FlexSPI configuration says which Teensy a program was built for
const FLASH_SIZES = {0x00200000: "Teensy 4.0", 0x00800000: "Teensy 4.1", 0x01000000: "Teensy MicroMod"};

// ---- errors ----------------------------------------------------------------------------------------
// code: hex (not a valid Intel HEX file), image (valid, but not a Teensy 4.0 program that fits the
// minichord), board (the device in update mode isn't a Teensy 4.0), open (it wouldn't open), write
// (a block failed after its retries), gone (it disconnected), cancelled (the signal was aborted).
// message is for the player; detail is a short technical line for the console.
const CODES = ["hex", "image", "board", "open", "write", "gone", "cancelled"];
class FlashError extends Error {
  constructor(code, message, detail = "") {
    super(message);
    this.name = "FlashError";
    this.code = code;
    this.detail = detail;
  }
}

const DAMAGED = "This firmware file is damaged or cut short. Download it again, or pick the file again, and try once more.";
const NOT_OURS = "This isn't firmware for the minichord: it isn't a program for the Teensy 4.0 inside it.";
const SAFE = "The minichord is still in update mode, so nothing is lost: update again to finish.";

const hex8 = n => "0x" + (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
const hex2 = n => "0x" + n.toString(16).toUpperCase().padStart(2, "0");

// ---- the hex --------------------------------------------------------------------------------------
const NIBBLE = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < 16; i++) t["0123456789abcdef".charCodeAt(i)] = t["0123456789ABCDEF".charCodeAt(i)] = i;
  return t;
})();
// the byte written as two hex digits at line[i], or -1
function hexByte(line, i) {
  const a = line.charCodeAt(i), b = line.charCodeAt(i + 1);
  const hi = a < 128 ? NIBBLE[a] : -1, lo = b < 128 ? NIBBLE[b] : -1;
  return hi < 0 || lo < 0 ? -1 : hi << 4 | lo;
}

// An Intel HEX file (text, or its bytes) read strictly, as TyTools reads it: every line ':' and hex of
// exactly the length its record needs, every checksum right, an end-of-file record and nothing after it
// but blank lines. Records 00 (data), 01 (end of file) and 04 (the upper 16 address bits) are used; 05
// (the start address) must be 4 bytes and is ignored; 02, 03 and any other type are refused, as no
// Teensy 4 hex has them. Every data byte must lie in the Teensy 4.0's program space,
// [FLASH_BASE, CODE_END). Returns {data, present, start, end, bytes}: data and present cover the program
// space (data 0xFF where the hex has nothing, present 1 where it has a byte), start and end are the
// addresses of the lowest byte and one past the highest, bytes is how many there are.
function parseHex(text) {
  if (typeof text !== "string") text = new TextDecoder().decode(text);
  const space = CODE_END - FLASH_BASE;
  const data = new Uint8Array(space).fill(0xFF), present = new Uint8Array(space);
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const record = new Uint8Array(260);
  const broken = (n, why) => new FlashError("hex", DAMAGED, `line ${n}: ${why}`);
  let upper = 0, ended = false, bytes = 0, start = Infinity, end = -Infinity;
  let outside = null;             // the first data out of the program space, thrown once the whole file has read well
  for (let n = 1; n <= lines.length; n++) {
    const line = lines[n - 1];
    if (line === "") continue;
    if (ended) throw broken(n, "more records after the end-of-file record");
    if (line[0] !== ":") throw broken(n, "doesn't start with ':'");
    const length = hexByte(line, 1);
    if (length < 0) throw broken(n, "no record length");
    if (line.length !== 11 + 2 * length) throw broken(n, `${line.length} characters, where a ${length}-byte record has ${11 + 2 * length}`);
    let sum = 0;
    for (let i = 0; i < length + 5; i++) {
      const v = hexByte(line, 1 + 2 * i);
      if (v < 0) throw broken(n, `"${line.substr(1 + 2 * i, 2)}" isn't a hex byte`);
      record[i] = v;
      sum += v;
    }
    if (sum & 0xFF) throw broken(n, `checksum ${hex2(record[length + 4])}, where the record needs ${hex2((record[length + 4] - sum) & 0xFF)}`);
    const type = record[3];
    if (type === 0) {
      if (!length) continue;
      const first = upper + (record[1] << 8 | record[2]), last = first + length;
      if (first < FLASH_BASE || last > CODE_END) {
        if (!outside) outside = first < FLASH_BASE
          ? new FlashError("image", NOT_OURS, `line ${n}: data at ${hex8(first)}, below the Teensy 4.0's flash at 0x60000000`)
          : new FlashError("image", "This isn't firmware for the minichord: it reaches past the end of the Teensy 4.0's room for programs.",
            `line ${n}: data up to ${hex8(last - 1)}, past the program space's end at 0x601F0000`);
        continue;
      }
      for (let i = 0, o = first - FLASH_BASE; i < length; i++, o++) {
        if (!present[o]) { present[o] = 1; bytes++; }
        data[o] = record[4 + i];
      }
      if (first < start) start = first;
      if (last > end) end = last;
    } else if (type === 1) {
      if (length) throw broken(n, "an end-of-file record with data in it");
      ended = true;
    } else if (type === 4) {
      if (length !== 2) throw broken(n, `an extended linear address record of ${length} bytes, not 2`);
      upper = (record[4] << 8 | record[5]) * 0x10000;
    } else if (type === 5) {
      if (length !== 4) throw broken(n, `a start address record of ${length} bytes, not 4`);
    } else {
      throw broken(n, `record type ${hex2(type)}` + (type === 2 || type === 3 ? ", a segment address no Teensy 4 hex has" : ", which Intel HEX doesn't have"));
    }
  }
  if (!ended) throw broken(lines.length, "no end-of-file record");
  if (outside) throw outside;
  if (!bytes) throw new FlashError("image", "This file has no firmware in it.", "no data records");
  return {data, present, start, end, bytes};
}

function u32(image, address) {
  const d = image.data, o = address - FLASH_BASE;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24) >>> 0;
}

// The checks before anything touches USB: a Teensy 4.0 program (FlexSPI configuration, image vector
// table and boot data where Teensyduino's bootdata.c puts them), starting at 0x60000000 and ending below
// limit. BootData's length is the linker's _flashimagelen, which runs to the end of the 1 KB-aligned
// signature placeholder that closes every Teensy 4 image, so it equals the hex's extent to the byte.
// Returns {length, end, ivtVersion}; throws FlashError 'image' with what's wrong in plain words.
function checkImage(image, {limit = MINICHORD_LIMIT} = {}) {
  if (image.start !== FLASH_BASE) throw new FlashError("image", NOT_OURS, `starts at ${hex8(image.start)}, not 0x60000000`);
  if (u32(image, FLASH_BASE) !== 0x42464346 || u32(image, FLASH_BASE + 4) !== 0x56010000) {
    throw new FlashError("image", NOT_OURS, `no FlexSPI configuration ("FCFB", version 0x56010000) at 0x60000000`);
  }
  const flashSize = u32(image, 0x60000050);
  if (flashSize !== 0x00200000) {
    const board = FLASH_SIZES[flashSize];
    throw new FlashError("image", board ? `This firmware is made for a ${board}, not the Teensy 4.0 inside the minichord.` : NOT_OURS,
      `sflashA1Size ${hex8(flashSize)}, where a Teensy 4.0 has 0x00200000`);
  }
  const ivt = u32(image, 0x60001000), ivtVersion = ivt >>> 24;
  if ((ivt & 0xFFFFFF) !== 0x2000D1 || ivtVersion < 0x40 || ivtVersion > 0x45) {
    throw new FlashError("image", NOT_OURS, `image vector table header ${hex8(ivt)} at 0x60001000`);
  }
  const bootData = u32(image, 0x60001010), self = u32(image, 0x60001014), bootStart = u32(image, 0x60001020);
  if (bootData !== 0x60001020 || self !== 0x60001000 || bootStart !== FLASH_BASE) {
    throw new FlashError("image", NOT_OURS, `boot data pointer ${hex8(bootData)}, IVT self ${hex8(self)}, boot data start ${hex8(bootStart)}`);
  }
  if (image.end > limit) {
    throw new FlashError("image", "This firmware is too big for the minichord: it would write over the room kept for the presets and your own drum kit.",
      `ends at ${hex8(image.end)}, past ${hex8(limit)}`);
  }
  const length = u32(image, 0x60001024);
  if (length !== image.end - FLASH_BASE || length > limit - FLASH_BASE) {
    throw new FlashError("image", "This firmware file looks damaged: the length written inside it doesn't match the file.",
      `boot data length ${hex8(length)}, the hex runs to +${hex8(image.end - FLASH_BASE)}`);
  }
  return {length, end: image.end, ivtVersion};
}

// ---- the writes -----------------------------------------------------------------------------------
// The offsets (from FLASH_BASE) of the blocks to send, in order: block 0 first, then every block holding
// at least one byte of the hex, all-0xFF ones included, so a bootloader that erases as the writes reach
// a part of the flash erases every part the program covers. Never a block the hex doesn't touch.
function planBlocks(image) {
  const offsets = [0];
  const top = Math.min(image.end - FLASH_BASE, CODE_END - FLASH_BASE);
  for (let o = Math.max(BLOCK_SIZE, Math.floor((image.start - FLASH_BASE) / BLOCK_SIZE) * BLOCK_SIZE); o < top; o += BLOCK_SIZE) {
    if (image.present.subarray(o, o + BLOCK_SIZE).includes(1)) offsets.push(o);
  }
  return offsets;
}

// One block's output report: the offset little-endian in bytes 0-2, zeros to byte 63, then the block,
// 0xFF wherever the hex has no byte
function blockReport(image, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset % BLOCK_SIZE || offset >= CODE_END - FLASH_BASE) {
    throw new RangeError(`a block offset is a multiple of 1024 below ${CODE_END - FLASH_BASE}, not ${offset}`);
  }
  const report = new Uint8Array(REPORT_LENGTH);
  report[0] = offset & 0xFF;
  report[1] = offset >> 8 & 0xFF;
  report[2] = offset >> 16 & 0xFF;
  for (let i = 0; i < BLOCK_SIZE; i++) report[HEADER_LENGTH + i] = image.present[offset + i] ? image.data[offset + i] : 0xFF;
  return report;
}

// The report that starts the program: FF FF FF, then zeros
function bootReport() {
  const report = new Uint8Array(REPORT_LENGTH);
  report[0] = report[1] = report[2] = 0xFF;
  return report;
}

// The bits in a collection's output report (report ID 0, or its first), or null where WebHID doesn't say
function outputBits(collection) {
  const reports = collection.outputReports || [];
  const report = reports.find(r => !r.reportId) || reports[0];
  if (!report || !report.items || !report.items.length) return null;
  let bits = 0;
  for (const item of report.items) {
    if (!Number.isInteger(item.reportSize) || !Number.isInteger(item.reportCount)) return null;
    bits += item.reportSize * item.reportCount;
  }
  return bits;
}

// That the HIDDevice in update mode is a Teensy 4.0's HalfKay: a collection on usage page 0xFF9C with
// usage 0x24, whose output report (where WebHID lists its items) is 1088 bytes
function checkDevice(device) {
  const collections = (device && device.collections) || [];
  const halfkay = collections.find(c => c.usagePage === HALFKAY.usagePage && c.usage === HALFKAY.usage);
  if (!halfkay) {
    const other = collections.find(c => c.usagePage === HALFKAY.usagePage);
    const board = other && BOARDS[other.usage];
    throw new FlashError("board", board
      ? `The board in update mode is a ${board}, not the Teensy 4.0 inside a minichord, so nothing was written to it.`
      : "The board in update mode isn't a minichord's Teensy 4.0, so nothing was written to it.",
    other ? `usage page 0xFF9C, usage ${hex2(other.usage)}` : `no collection on usage page 0xFF9C (${collections.map(c => `${c.usagePage}/${c.usage}`).join(", ") || "none"})`);
  }
  const bits = outputBits(halfkay);
  if (bits !== null && bits !== REPORT_LENGTH * 8) {
    throw new FlashError("board", "The board in update mode doesn't take the blocks a Teensy 4.0 takes, so nothing was written to it.",
      `output report of ${bits / 8} bytes, not ${REPORT_LENGTH}`);
  }
}

// Opens the device if it isn't open yet
async function openDevice(device) {
  if (device.opened) return;
  try {
    await device.open();
  } catch (e) {
    throw new FlashError("open", "The browser couldn't open the minichord in update mode. Quit Teensy Loader or anything else that " +
      "might be using it, then try again. On Linux the computer also needs PJRC's permission rule for Teensy boards " +
      "(00-teensy.rules, in /etc/udev/rules.d) before a browser can open one.", `${e && e.name}: ${e && e.message}`);
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const clock = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());

// Writes image to the HIDDevice in update mode: the image's checks, the device's, then every planned
// block in order, one awaited sendReport at a time. A rejected write (NotAllowedError, or anything but
// InvalidStateError) is sent again RETRY_MS later until the block's budget from its first try runs
// out (45 s for the first five blocks, 5 s after), then FlashError 'write'. InvalidStateError, the
// device closing, or navigator.hid's disconnect for this device is 'gone'; an aborted signal, looked at
// before each block and between tries, is 'cancelled'. onProgress(done, total) after each block.
// The boot report is not sent and the device is not closed, whatever happens: after a failure the
// minichord stays in update mode for another try, and after success boot() starts the new firmware.
// sleep, now and hid (navigator.hid's stand-in, for the disconnect event) are there for the tests.
// Resolves to {blocks, retries, ms}.
async function program(device, image, {onProgress, sleep = wait, now = clock, signal, hid = root.navigator && root.navigator.hid,
  limit = MINICHORD_LIMIT} = {}) {
  checkImage(image, {limit});
  checkDevice(device);
  let disconnected = false;
  const onDisconnect = e => { if (e.device === device) disconnected = true; };
  if (hid && hid.addEventListener) hid.addEventListener("disconnect", onDisconnect);
  const offsets = planBlocks(image);
  const gone = (i, why) => new FlashError("gone", "The minichord disconnected in the middle of the update. Plug it back in and update " +
    "again; if it doesn't come back on its own, press the button on its Teensy to put it in update mode.", `block ${i} of ${offsets.length}: ${why}`);
  const cancelled = i => new FlashError("cancelled", "The update was stopped before it finished. " + SAFE, `before block ${i} of ${offsets.length}`);
  try {
    await openDevice(device);
    const began = now();
    let retries = 0;
    for (let i = 0; i < offsets.length; i++) {
      if (signal && signal.aborted) throw cancelled(i);
      if (disconnected) throw gone(i, "disconnect event");
      const report = blockReport(image, offsets[i]);
      const budget = i < FIRST_WRITES ? FIRST_BUDGET : BUDGET;
      const first = now();
      for (;;) {
        let error = null;
        try {
          await device.sendReport(0, report);
        } catch (e) {
          error = e || new Error("rejected");
        }
        if (!error) break;
        if (disconnected || error.name === "InvalidStateError" || !device.opened) {
          throw gone(i, disconnected ? "disconnect event" : `${error.name}: ${error.message}`);
        }
        const spent = now() - first;
        if (spent >= budget) {
          throw new FlashError("write", "Part of the firmware wouldn't write, so the update stopped. " + SAFE +
            (i === 0 ? " On Linux this is also what happens without PJRC's permission rule for Teensy boards (00-teensy.rules)." : ""),
          `block ${i} of ${offsets.length} (offset ${hex8(offsets[i])}) still failing after ${Math.round(spent)} ms: ${error.name}: ${error.message}`);
        }
        retries++;
        await sleep(RETRY_MS);
        if (disconnected) throw gone(i, "disconnect event");
        if (signal && signal.aborted) throw cancelled(i);
      }
      if (onProgress) onProgress(i + 1, offsets.length);
    }
    return {blocks: offsets.length, retries, ms: now() - began};
  } finally {
    if (hid && hid.removeEventListener) hid.removeEventListener("disconnect", onDisconnect);
  }
}

// Starts the program: opens the device if need be, sends the boot report, closes. A rejected boot
// report is sent again RETRY_MS later, one awaited write at a time, for up to BOOT_BUDGET (0.5 s), as
// teensy_loader_cli and TyTools do (HalfKay may refuse a write that comes straight after the last
// block); InvalidStateError or the device closing stops it at once. No error is thrown, as HalfKay
// leaves the bus as it starts the program. Resolves to whether the report went. sleep and now are
// there for the tests.
async function boot(device, {sleep = wait, now = clock} = {}) {
  let sent = false;
  try {
    if (!device.opened) await device.open();
  } catch (e) { /* the boot report fails below the same way */ }
  const first = now();
  for (;;) {
    try {
      await device.sendReport(0, bootReport());
      sent = true;
      break;
    } catch (e) {
      if ((e && e.name) === "InvalidStateError" || !device.opened || now() - first >= BOOT_BUDGET) break;
    }
    await sleep(RETRY_MS);
  }
  try {
    await device.close();
  } catch (e) { /* ignored */ }
  return sent;
}

// ---- the download's checks ------------------------------------------------------------------------
// The lowercase hex SHA-256 of bytes (or of a string's UTF-8), to set against a release asset's digest
async function sha256(bytes) {
  if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
  const digest = await root.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

// The fork's release tags: firmware-114 is firmware 114
function versionFromTag(tag) {
  const m = /^firmware-(\d+)$/.exec(String(tag == null ? "" : tag).trim());
  return m ? Number(m[1]) : null;
}

// Ben's classic firmware numbers its versions up to 9; the advanced firmware starts above
function isClassic(version) {
  return typeof version === "number" && version <= CLASSIC_FIRMWARE;
}

const api = {
  HALFKAY, REPORT_LENGTH, HEADER_LENGTH, BLOCK_SIZE, FLASH_BASE, CODE_END, MINICHORD_LIMIT, MINICHORD_SERIAL,
  RESTART_COMMAND, RESTART_FIRMWARE, FIRST_WRITES, FIRST_BUDGET, BUDGET, RETRY_MS, BOOT_BUDGET, BOARDS, CODES, FlashError,
  parseHex, checkImage, planBlocks, blockReport, bootReport, checkDevice, openDevice, program, boot, sha256,
  versionFromTag, isClassic,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.minichordFlash = api;
})(typeof window !== "undefined" ? window : globalThis);
