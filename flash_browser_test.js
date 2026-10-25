// node flash_browser_test.js: the firmware sheet (update.js, writing through flash.js) on the generated
// page, in headless Chrome. Each way into update mode runs to its end against fakes inside the page: a
// minichord answering over the controller as kits_browser_test's does (dumps, bank loads, the kit's INFO,
// the restart command), its update mode as a fake WebHID device that keeps what is written to it, and a
// fake serial port. Web MIDI, WebHID and Web Serial are all replaced before any page script runs, and
// every request off this machine is answered here (GitHub's API and raw files from the firmware.hex
// below) or refused, so nothing can reach a real minichord or the network.
//
//   1. firmware 115: the backup, then one click sends the restart command and opens Chrome's box (the steps
//      held while it is open); every block written in order, the boot report, the minichord back with the
//      new version, the banks put back, and a second update asking for a backup of its own
//   2. firmware 113 on macOS: the serial port opened at 134 baud, then a second click installs (no backup: said skipped)
//   3. firmware 100 on Linux, from the note over the greyed controls: no serial, the pin
//   4. a block that won't write: try again, and no boot report after the failure
//   5. a Teensy 4.1 in update mode: refused, nothing written; leave update mode; then an update that didn't take
//   6. the device won't open on Linux: PJRC's rule; unplugged and back as it was, the failure forgotten
//   7. a download that doesn't match the release's sha256: refused
//   8. no WebHID: Chrome or Edge
//   9. Chrome's box closed with nothing chosen: back to the step, quietly
//  10. a broken .hex from the computer, a good one, and Ben's classic firmware
//  11. no minichord answering: finish an update
//  12. the minichord gone from the bus partway (the sheet kept open through Escape and a click outside), and
//      Ben's classic firmware cut short on the way, its banks' reset said
//  13. two .hex files picked, the first slow to read: the second is the one installed
//  14. Ben's classic firmware 9: its banks reset, said, nothing to back them up with; the fork said as such
//  15. firmware 60: its banks reset, so the backup is a must; a backup forgotten when the minichord goes away
//  16. a write that never settles, on macOS: said, then gone; the update mode that won't open there
//  17. the minichord slow to come back (the 30 s waits made 3 s): heard from its own dump; a refused boot report
//  and the tour walked with a minichord connected, sending nothing.
//
// It needs playwright-core and Chrome, found as kits_browser_test.js finds them, and a minichord
// firmware.hex: FLASH_HEX, else the feature-webFlash worktree's or ~/minichord's. Screenshots go to
// FLASH_SHOTS (default /tmp/claude-1000/webflash-shots). About a minute.
//
//     node flash_browser_test.js

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const flash = require(path.join(__dirname, "flash.js"));
const kits = require(path.join(__dirname, "kits.js"));

function playwright() {
  const tries = [process.env.PLAYWRIGHT_CORE, "playwright-core",
    path.join(os.homedir(), "minichord-lab/tests/node_modules/playwright-core")].filter(Boolean);
  for (const t of tries) {
    try { return require(t); } catch (e) { /* the next */ }
  }
  console.log("SKIP: no playwright-core (set PLAYWRIGHT_CORE to its folder, or npm install it in ~/minichord-lab/tests)");
  process.exit(0);
}
const {chromium} = playwright();
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";

const HEX = [process.env.FLASH_HEX, path.join(os.homedir(), "minichord/.claude/worktrees/feature-webFlash/firmware/firmware.hex"),
  path.join(os.homedir(), "minichord/firmware/firmware.hex")].filter(Boolean).find(f => fs.existsSync(f));
if (!HEX) {
  console.log("SKIP: no firmware.hex (set FLASH_HEX to one)");
  process.exit(0);
}
const SHOTS = process.env.FLASH_SHOTS || "/tmp/claude-1000/webflash-shots";
fs.mkdirSync(SHOTS, {recursive: true});

const ROOT = __dirname;
const TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".webmanifest": "application/manifest+json"};
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {"content-type": TYPES[path.extname(p)] || "application/octet-stream"});
  fs.createReadStream(p).pipe(res);
});

let failures = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failures++; };

// ---- the firmware, and what GitHub would say about it -------------------------------------------------
const hexBytes = fs.readFileSync(HEX);
const SHA = crypto.createHash("sha256").update(hexBytes).digest("hex");
const IMAGE = flash.parseHex(hexBytes.toString("latin1"));
const PLAN = flash.planBlocks(IMAGE);
// every planned block as the reports carry it, one after the other, for a CRC to set the fake's against
const WRITTEN = new Uint8Array(PLAN.length * flash.BLOCK_SIZE);
PLAN.forEach((o, i) => WRITTEN.set(flash.blockReport(IMAGE, o).subarray(flash.HEADER_LENGTH), i * flash.BLOCK_SIZE));
const WRITTEN_CRC = kits.crc32(WRITTEN);
// small hexes made here, as flash_test.js makes them: a Teensy 4.0 program of 12 KB (another firmware than
// the one above, to tell which was written), and the same with a byte at the kit header, 0x601E0000
function hexOf(segments) {
  const record = (type, address, bytes) => {
    const r = [bytes.length, address >> 8 & 0xFF, address & 0xFF, type, ...bytes];
    r.push(-r.reduce((a, b) => a + b, 0) & 0xFF);
    return ":" + r.map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("");
  };
  const lines = [];
  let upper = -1;
  for (const {address, bytes} of segments) {
    for (let i = 0; i < bytes.length; i += 16) {
      const a = address + i;
      if (Math.floor(a / 0x10000) !== upper) { upper = Math.floor(a / 0x10000); lines.push(record(4, 0, [upper >> 8, upper & 0xFF])); }
      lines.push(record(0, a & 0xFFFF, Array.from(bytes.subarray(i, Math.min(i + 16, bytes.length)))));
    }
  }
  return [...lines, record(5, 0, [0x60, 0x00, 0x10, 0x00]), record(1, 0, [])].join("\n") + "\n";
}
function teensyImage(length = 0x3000) {
  const b = new Uint8Array(length).fill(0xFF), v = new DataView(b.buffer);
  const words = (at, list) => list.forEach((w, i) => v.setUint32(at + 4 * i, w >>> 0, true));
  b.fill(0, 0, 0x200);
  words(0, [0x42464346, 0x56010000, 0, 0x00030301]);
  words(0x44, [0x00080401]);
  words(0x50, [0x00200000]);
  words(0x1000, [0x432000D1, 0x60001401, 0, 0, 0x60001020, 0x60001000, flash.FLASH_BASE + length - 0x400, 0]);
  words(0x1020, [flash.FLASH_BASE, length, 0]);
  for (let i = 0x1030; i < length - 0x400; i++) b[i] = (i * 7 + 3) & 0xFF;
  b.fill(0, length - 0x400);
  return b;
}
const SMALL_HEX = hexOf([{address: flash.FLASH_BASE, bytes: teensyImage()}]);
const TOO_BIG_HEX = hexOf([{address: flash.FLASH_BASE, bytes: teensyImage()}, {address: flash.MINICHORD_LIMIT, bytes: Uint8Array.of(0x42)}]);
const SMALL_IMAGE = flash.parseHex(SMALL_HEX);
flash.checkImage(SMALL_IMAGE);
const SMALL_PLAN = flash.planBlocks(SMALL_IMAGE);
const smallWritten = new Uint8Array(SMALL_PLAN.length * flash.BLOCK_SIZE);
SMALL_PLAN.forEach((o, i) => smallWritten.set(flash.blockReport(SMALL_IMAGE, o).subarray(flash.HEADER_LENGTH), i * flash.BLOCK_SIZE));
const SMALL_CRC = kits.crc32(smallWritten);
const CLASSIC_HEX = "https://raw.githubusercontent.com/BenjaminPoilve/minichord/main/firmware/firmware.hex";
const CORS = {"access-control-allow-origin": "*"};
function release(tag, digest = SHA) {
  const v = tag.replace("firmware-", "");
  return {tag_name: tag, name: `minichord advanced firmware ${v}: the test release`, html_url: `https://github.com/keyandcableco/minichord/releases/tag/${tag}`,
    assets: [{name: `minichord-advanced-firmware-${v}.hex`, size: hexBytes.length, digest: "sha256:" + digest}]};
}
let current = release("firmware-114");
let classicCut = false;   // Ben's classic firmware.hex cut short on the way
const hits = [];      // every request to GitHub, in order
const refused = [];   // every other request off this machine

// ---- before any page script: Web MIDI stubbed out, and the fake update mode and serial port -----------
// ?computer= is the platform userAgentData gives, ?hid=0 and ?serial=0 take those APIs away
function fakes() {
  const q = new URLSearchParams(location.search);
  Object.defineProperty(navigator, "requestMIDIAccess", {value: () => Promise.reject(new Error("no MIDI in the test")), configurable: true});
  if (q.get("computer")) Object.defineProperty(navigator, "userAgentData", {value: {platform: q.get("computer"), brands: [], mobile: false}, configurable: true});
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });
  const fh = window.fakeHid = {
    log: [], requests: [], granted: [], present: null, clicks: 0,
    usage: 0x24,          // the board the update mode says it is on
    openFails: false,     // open() rejects
    failOffset: -1,       // a block whose every write is rejected
    chooser: "pick",      // "cancel": the box closed with nothing chosen
    pinPress: false,      // the player presses the pin this long after the box opens (ms), or not at all
    delay: 0,             // ms each write takes
    holdBox: false,       // Chrome's box stays open, the player still choosing, till this is false
    hangOffset: -1,       // a block whose write never settles while the device is on the bus (Windows, macOS)
    bootFails: false,     // the boot report rejected, every time
    flash: null,
  };
  // ?backWait=ms: update.js's 30 s waits for the minichord to come back (BACK_WAIT) take ms instead
  const backWait = Number(q.get("backWait"));
  if (backWait) {
    const later = window.setTimeout;
    window.setTimeout = function (f, ms, ...rest) { return later.call(this, f, ms === 30000 ? backWait : ms, ...rest); };
  }
  // the clicks a person makes: a box opened from one is noted with it, to see one box a click
  window.addEventListener("click", e => { if (e.isTrusted) fh.clicks++; }, true);
  const hid = new EventTarget();
  function device() {
    const d = {
      vendorId: 0x16C0, productId: 0x0478, productName: "", opened: false,
      collections: [{usagePage: 0xFF9C, usage: fh.usage, type: 1, children: [], inputReports: [], featureReports: [],
        outputReports: [{reportId: 0, items: [{reportSize: 8, reportCount: 64}, {reportSize: 8, reportCount: 1024}]}]}],
      async open() {
        fh.log.push({op: "open"});
        if (fh.openFails) throw new DOMException("Failed to open the device.", "NotAllowedError");
        d.opened = true;
      },
      async close() { fh.log.push({op: "close"}); d.opened = false; },
      async sendReport(id, data) {
        if (!d.opened || fh.present !== d) throw new DOMException("The device must be opened first.", "InvalidStateError");
        const b = new Uint8Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
        await (fh.delay ? pause(fh.delay) : tick());
        if (id !== 0 || b.length !== 1088) { fh.log.push({op: "bad", id, length: b.length}); throw new DOMException("Failed to write the report.", "NotAllowedError"); }
        const offset = b[0] | b[1] << 8 | b[2] << 16;
        if (offset === 0xFFFFFF && fh.bootFails) { fh.log.push({op: "bootRefused"}); throw new DOMException("Failed to write the report.", "NotAllowedError"); }
        if (offset === fh.hangOffset) {
          fh.log.push({op: "hang", offset});
          while (fh.present === d) await pause(50);     // pending till the cable comes out, which rejects it
          throw new DOMException("The device was disconnected.", "InvalidStateError");
        }
        if (offset === 0xFFFFFF) {
          fh.log.push({op: "boot", rest: b.subarray(3).some(x => x)});
          setTimeout(() => {      // HalfKay starts the program and leaves the bus
            fh.present = null;
            d.opened = false;
            const e = new Event("disconnect");
            e.device = d;
            hid.dispatchEvent(e);
            window.mini?.back();
          }, 20);
          return;
        }
        if (offset === fh.failOffset) { fh.log.push({op: "fail", offset}); throw new DOMException("Failed to write the report.", "NotAllowedError"); }
        fh.log.push({op: "write", offset, header: b.subarray(3, 64).some(x => x)});
        (fh.flash ||= new Uint8Array(0x1F0000)).set(b.subarray(64), offset);
      },
    };
    return d;
  }
  // the minichord in update mode, on the bus
  fh.appear = () => {
    fh.present = device();
    const e = new Event("connect");
    e.device = fh.present;
    hid.dispatchEvent(e);
    return fh.present;
  };
  // Chrome's box: only from a click; it fills in when the update mode appears, as Chrome's does
  hid.requestDevice = async options => {
    const active = navigator.userActivation.isActive;
    fh.requests.push({filters: options?.filters, active, click: fh.clicks, at: performance.now()});
    if (!active) throw new DOMException("Must be handling a user gesture to show a permission request.", "SecurityError");
    if (fh.chooser === "cancel") { await pause(200); return []; }
    if (fh.pinPress) setTimeout(() => window.mini?.leave(), fh.pinPress);
    const t0 = performance.now();
    while (fh.holdBox || (!fh.present && performance.now() - t0 < 5000)) await pause(50);
    if (!fh.present) return [];
    if (!fh.granted.includes(fh.present)) fh.granted.push(fh.present);
    return [fh.present];
  };
  hid.getDevices = async () => fh.granted.filter(d => d === fh.present);
  if (q.get("hid") === "0") delete Navigator.prototype.hid;
  else Object.defineProperty(navigator, "hid", {value: hid, configurable: true});

  const fs = window.fakeSerial = {granted: [], requests: [], opens: [], closes: 0};
  const serial = new EventTarget();
  serial.requestPort = async options => {
    const active = navigator.userActivation.isActive;
    fs.requests.push({filters: options?.filters, active, click: fh.clicks});
    if (!active) throw new DOMException("Must be handling a user gesture to show a permission request.", "SecurityError");
    const port = {
      getInfo: () => ({usbVendorId: 0x16C0, usbProductId: 0x048A}),
      async open(o) { fs.opens.push(o?.baudRate); if (o?.baudRate === 134) window.mini?.leave(); },
      async close() { fs.closes++; },
    };
    fs.granted.push(port);
    return port;
  };
  serial.getPorts = async () => fs.granted.slice();
  if (q.get("serial") === "0") delete Navigator.prototype.serial;
  else Object.defineProperty(navigator, "serial", {value: serial, configurable: true});
}

// ---- the minichord, inside the page --------------------------------------------------------------------
// It answers dumps, bank loads, page 1 and the kit's INFO, keeps what a save is sent, and goes into
// update mode on the restart command (firmware 115 on), the serial port at 134 baud or the pin: off MIDI
// as the controller's statechange has it, and on as the fake WebHID device. The boot report brings it
// back after a moment with o.after as its version. o.present false: not answering at all to begin with.
function installMinichord(o) {
  const k = window.userKit;
  const m = window.mini = Object.assign({version: 113, after: 114, bank: 0, present: true, kit: {state: 0, reason: 1},
    kitAfter: null, comeBack: true, dumpDelay: 3}, o, {seq: [], saves: [], updated: false});
  const reply = (bytes, ms = 3) => setTimeout(() => { if (m.present) controller.processCurrentData({data: Uint8Array.from(bytes)}); }, ms);
  const word = (out, at, v) => { out[at] = v & 127; out[at + 1] = (v >> 7) & 127; };
  const value = a => Math.max(0, Math.min(16383, Math.round((a < 256 ? defaultValues[a] : controller.page1_defaults[a]) || 0)));
  const dump = () => {
    const out = [0xF0];
    for (let a = 0; a < 256; a++) word(out, 1 + 2 * a, a === 1 ? m.bank : a === 7 ? m.version : value(a));
    out.push(0xF7);
    return out;
  };
  const page1 = () => {
    const out = [0xF0, 0x7D, 0x6D, 1];
    for (let a = 256; a < 512; a++) word(out, 4 + 2 * (a - 256), value(a));
    out.push(0xF7);
    return out;
  };
  const info = kit => {
    const name = Array.from({length: 20}, (_, i) => i < 8 ? "Test kit".charCodeAt(i) : 0);
    reply([0xF0, 0x7D, 0x6B, 0x45, 1, kit.state, kit.reason || 0, ...k.groups(262144, 3), ...k.groups(0x601A0000, 5),
      ...k.groups(kit.state === 1 ? 20000 : 0, 3), ...k.groups(0, 5), ...k.groups(224, 2), 4, ...k.groups(kit.state === 1 ? 1 : 0, 2), ...name, 0xF7]);
  };
  m.dev = {send(msg) {
    const b = Array.from(msg);
    m.seq.push({b, at: performance.now()});
    if (b[1] === 0x7D && b[2] === 0x6B) {
      if (b[3] === 5 && m.version >= 113) info((m.updated && m.kitAfter) || m.kit);
      return;
    }
    if (b.length !== 6 || b[1] || b[2]) return;
    const command = b[3], p = b[4];
    if (command === 0) reply(dump(), m.dumpDelay);
    else if (command === 4) { m.bank = p; reply(dump()); }
    else if (command === 7 && p === 1 && m.version >= 31) reply(page1());
    else if (command === 2) m.saves.push(p);
    else if (command === 11 && p === 66 && m.version >= 115) m.leave();
  }};
  m.leave = () => {
    if (!m.present) return;
    m.present = false;
    m.leftAt = performance.now();
    setTimeout(() => {
      controller.handleStateChange({port: {name: "minichord", state: "disconnected"}, target: {inputs: new Map()}});
      fakeHid.appear();
    }, 30);
  };
  m.back = () => {
    if (!m.comeBack) return;
    setTimeout(() => {
      m.version = m.after;
      m.updated = true;
      m.present = true;
      m.backAt = performance.now();
      controller.device = m.dev;
      controller.onConnectionChange(true, "minichord connected");
      controller.requestCurrentData();      // as handleMIDIAccess asks on connecting
    }, 600);
  };
  // what the page says in the bubble
  window.notes = [];
  const shown = window.showNotification;
  window.showNotification = (message, type) => { notes.push([message, type]); return shown(message, type); };
  if (!m.present) return;
  controller.device = m.dev;
  controller.onConnectionChange(true, "minichord connected");
  controller.requestCurrentData();
}

const RESTART = [0xF0, 0, 0, 0x0B, 0x42, 0xF7];
const text = (page, id) => page.$eval("#" + id, e => e.textContent.trim());
const shown = (page, id) => page.$eval("#" + id, e => !!e.getClientRects().length);
const shot = async (page, name) => {
  const file = path.join(SHOTS, name);
  await page.locator("#firmware-sheet").screenshot({path: file}).catch(e => console.log(`     no screenshot ${name}: ${e.message}`));
  return file;
};
const status = (page, re, ms = 20000) => page.waitForFunction(src => new RegExp(src).test(document.getElementById("fw-status").textContent),
  re.source, {timeout: ms});
// what was written to the fake update mode, from the first write after `from` in its log, its CRC over plan's blocks
async function written(page, from = 0, plan = PLAN) {
  return page.evaluate(([from, plan]) => {
    const log = fakeHid.log.slice(from), writes = log.filter(e => e.op === "write");
    const blocks = new Uint8Array(plan.length * 1024);
    plan.forEach((o, i) => blocks.set(fakeHid.flash ? fakeHid.flash.subarray(o, o + 1024) : new Uint8Array(1024), i * 1024));
    return {ops: log.map(e => e.op), offsets: writes.map(e => e.offset), headers: writes.some(e => e.header), crc: userKit.crc32(blocks),
      boots: log.filter(e => e.op === "boot").length, bootRest: log.some(e => e.op === "boot" && e.rest),
      bootsRefused: log.filter(e => e.op === "bootRefused").length};
  }, [from, plan]);
}
const samePlan = (offsets, plan = PLAN) => offsets.length === plan.length && offsets.every((o, i) => o === plan[i]);
// the contrast of an element's text on its own background (WCAG), 0 where that background isn't opaque
const contrast = (page, id) => page.$eval("#" + id, e => {
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const style = getComputedStyle(e), fg = rgb(style.color), bg = rgb(style.backgroundColor);
  if (bg.length < 3 || (bg.length > 3 && bg[3] < 1)) return 0;
  const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
});
const LISTED = "by number, 16C0:0478, not by name";

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true});
  const context = await browser.newContext({acceptDownloads: true, serviceWorkers: "block", viewport: {width: 1100, height: 900}});
  await context.addInitScript(fakes);
  // nothing off this machine but the GitHub answers below, made here
  await context.route(url => !url.href.startsWith(base), route => { refused.push(route.request().url()); route.abort(); });
  await context.route("https://api.github.com/**", route => {
    hits.push(route.request().url());
    route.fulfill({status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(current)});
  });
  await context.route("https://raw.githubusercontent.com/**", route => {
    const url = route.request().url();
    hits.push(url);
    const ours = url === `https://raw.githubusercontent.com/keyandcableco/minichord/${current.tag_name}/firmware/firmware.hex` || url === CLASSIC_HEX;
    route.fulfill(ours ? {status: 200, contentType: "application/octet-stream", headers: CORS, body: url === CLASSIC_HEX && classicCut ? hexBytes.subarray(0, 5000) : hexBytes}
      : {status: 404, headers: CORS, body: "not here"});
  });
  const errors = [];
  let scene = "";
  async function open(query, minichord, setup) {
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(`${scene}: pageerror: ${e.message}`));
    page.on("console", m => { if (m.type() === "error" && !/MIDI init failed|no MIDI in the test|Failed to load resource/.test(m.text())) errors.push(`${scene}: console: ${m.text()}`); });
    page.on("dialog", d => d.accept());
    page.on("response", r => { if (r.status() >= 400 && !/\/manual\//.test(r.url())) errors.push(`${scene}: ${r.status()} ${r.url()}`); });
    await page.goto(`${base}/index.html?${query}`, {waitUntil: "load"});
    await page.waitForTimeout(500);
    if (setup) await page.evaluate(setup);
    if (minichord) {
      await page.evaluate(installMinichord, minichord);
      if (minichord.present !== false) await page.waitForFunction(v => Math.round((controller.firmware_version || 0) * 100) === v, minichord.version);
      await page.waitForTimeout(300);
    }
    // MIDI's failure at load opened the connection help: shut, to see an update doesn't open it again
    await page.evaluate(() => { document.getElementById("connection-help").open = false; });
    return page;
  }
  async function openSheet(page) {
    await page.click(".settings-toggle");
    await page.click("#firmware-btn");
    await page.waitForFunction(() => document.getElementById("firmware-sheet").matches(":popover-open"));
  }
  // the chosen firmware got and checked: nothing being got, and the install button named
  const ready = page => page.waitForFunction(() => {
    const newest = document.getElementById("fw-newest").textContent, get = document.getElementById("fw-get").textContent;
    return newest && !/Looking/.test(newest) && !/Getting/.test(get);
  }, null, {timeout: 15000});

  // ---- 1. firmware 115: backup, then the restart command and the box in one click --------------------
  scene = "115";
  current = release("firmware-116");
  let page = await open("computer=Linux", {version: 115, after: 116, kit: {state: 1}, kitAfter: {state: 3, reason: 4}});
  check(hits.length === 0, "nothing fetched at page load" + (hits.length ? ": " + hits.join(", ") : ""));
  await page.click(".settings-toggle");
  check(await text(page, "firmware-hint") === "This minichord has firmware 115.", "the drawer says which firmware: " + await text(page, "firmware-hint"));
  await page.locator("#settings-drawer .settings-panel").screenshot({path: path.join(SHOTS, "drawer.png")}).catch(() => {});
  check(hits.length === 0, "the drawer fetches nothing");
  await page.click("#firmware-btn");
  await page.waitForFunction(() => /Firmware 116 is the newest/.test(document.getElementById("fw-newest").textContent));
  await ready(page);
  check(await text(page, "fw-now") === "This minichord has firmware 115.", "the sheet says what it has");
  check(await text(page, "firmware-title") === "update the firmware", "the sheet's head in lower case, as every other sheet's");
  check(await text(page, "fw-newest") === "Firmware 116 is the newest: the test release.", "and the newest, its release named: " + await text(page, "fw-newest"));
  check(await page.$eval("#fw-newest a", a => a.href) === "https://github.com/keyandcableco/minichord/releases/tag/firmware-116", "linked to its release page");
  check(hits.length === 2 && /api\.github\.com/.test(hits[0]) && /keyandcableco\/minichord\/firmware-116\/firmware\/firmware\.hex$/.test(hits[1]),
    "the release, then its firmware.hex at the tag, once the sheet opened: " + hits.join(", "));
  check(!await shown(page, "fw-step-restart") && await shown(page, "fw-step-backup") && await shown(page, "fw-step-install"),
    "firmware 115: no restart step, the backup then install");
  check(await page.$eval("#fw-install-btn", b => b.textContent === "install firmware 116" && b.disabled), "install firmware 116, held till the backup");
  check(await page.$eval("#fw-backup-check", c => c.checked), "the backup ticked by default");
  check(await shown(page, "fw-pin-btn"), "use the pin instead offered");
  console.log("     install: " + await text(page, "fw-install-text"));
  await shot(page, "1-start-desktop.png");
  const downloaded = page.waitForEvent("download");
  await page.click("#fw-backup-btn");
  await page.waitForFunction(() => /^Backing up bank \d+ of 12/.test(document.getElementById("fw-backup-text").textContent));
  check(await shown(page, "fw-steps") && await page.$eval("#fw-install-btn", b => b.disabled) && await page.$eval("#fw-backup-btn", b => b.disabled),
    "while it backs up: the steps stay, each bank said, the buttons held");
  const download = await downloaded;
  await page.waitForFunction(() => /^Backed up all twelve banks/.test(document.getElementById("fw-backup-text").textContent), null, {timeout: 30000});
  check(/^minichord-backup-\d{4}-\d\d-\d\d\.json$/.test(download.suggestedFilename()), "the backup downloaded: " + download.suggestedFilename());
  const backup = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  check(backup.banks.length === 12 && backup.firmware_version === 115, "twelve banks in it, from firmware 115");
  check(await page.$eval("#fw-install-btn", b => !b.disabled) && !await shown(page, "fw-backup-btn"), "backed up: install free to go");
  console.log("     backup: " + await text(page, "fw-backup-text"));
  await shot(page, "1-backed-up-desktop.png");
  await page.evaluate(() => { fakeHid.delay = 2; fakeHid.holdBox = true; window.sentBefore = mini.seq.length; });
  await page.click("#fw-install-btn");
  // the player still choosing in Chrome's box as the minichord drops off MIDI into update mode
  await page.waitForFunction(() => !controller.isConnected(), null, {timeout: 5000});
  await page.waitForTimeout(700);     // a turn of the sheet's watch, at least
  check(await shown(page, "fw-steps") && !await shown(page, "fw-finish") && await shown(page, "fw-step-install"),
    "while Chrome's box is open and the minichord is in update mode: the steps stay, not the box for no minichord");
  check(!await shown(page, "fw-install-text") && (await text(page, "fw-status")).includes(LISTED) && /goes quiet and its light goes off/.test(await text(page, "fw-status")),
    "the install step's text gives way to the status, which says update mode goes dark and how the box lists it: " + await text(page, "fw-status"));
  const infoGround = await page.$eval("#fw-status", e => getComputedStyle(e).backgroundColor);
  await shot(page, "1-choosing-desktop.png");
  await page.evaluate(() => { fakeHid.holdBox = false; });
  await page.waitForFunction(() => document.getElementById("fw-progress").value > 0.3, null, {timeout: 20000});
  console.log("     installing: " + await text(page, "fw-progress-text"));
  check(await text(page, "fw-progress-text") === "Installing firmware 116: don't unplug the minichord.", "the bar says what it installs");
  await page.waitForFunction(() => document.getElementById("connection-text").textContent === "minichord in update mode", null, {timeout: 8000})
    .then(() => check(true, "the header says the minichord is in update mode, not disconnected"),
      async () => check(false, "the header says the minichord is in update mode: " + await text(page, "connection-text")));
  await shot(page, "1-installing-desktop.png");
  await status(page, /^Done: the minichord has firmware 116\./, 30000);
  console.log("     done: " + await text(page, "fw-status"));
  check(/Its banks should be as they were: if any sound different, click put my banks back\./.test(await text(page, "fw-status")),
    "backed up, no reset: says the banks should be as they were, and when to put them back");
  check(await page.$eval("#fw-status", e => getComputedStyle(e).backgroundColor) !== infoGround, "done on a ground of its own, not an instruction's");
  const one = await page.evaluate(() => {
    const restart = mini.seq.find(e => e.b.join() === [0xF0, 0, 0, 0x0B, 0x42, 0xF7].join());
    return {restart: restart && restart.at, requests: fakeHid.requests, clicks: fakeHid.clicks, leftAt: mini.leftAt, backAt: mini.backAt,
      between: mini.seq.filter(e => restart && e.at > restart.at && e.at < mini.backAt).length,
      updating: window.firmwareUpdating, help: document.getElementById("connection-help").open,
      notes: notes.map(n => n[0]), version: Math.round(controller.firmware_version * 100)};
  });
  check(!!one.restart, "the restart command went: F0 00 00 0B 42 F7");
  check(one.requests.length === 1 && one.requests[0].active && one.requests[0].click === one.clicks && one.requests[0].at >= one.restart
    && one.requests[0].at - one.restart < 100, `Chrome's box asked for in the same click, straight after the restart (${Math.round(one.requests[0]?.at - one.restart)} ms)`);
  check(JSON.stringify(one.requests[0].filters) === JSON.stringify([{vendorId: 0x16C0, productId: 0x0478, usagePage: 0xFF9C}]), "the box filtered to HalfKay's ids and usage page");
  let w = await written(page);
  check(samePlan(w.offsets), `every block written in order (${w.offsets.length} of ${PLAN.length})`);
  check(!w.headers && w.crc === WRITTEN_CRC, "each block's header zero and its bytes the hex's");
  check(w.ops[0] === "open" && w.ops.filter(o => o === "boot").length === 1 && w.ops.lastIndexOf("write") < w.ops.indexOf("boot")
    && w.ops[w.ops.length - 1] === "close" && !w.bootRest, "opened, written, the boot report (FF FF FF, the rest 0) last, then closed: " + w.ops.filter((o, i, a) => o !== a[i - 1]).join(" "));
  check(one.between === 0, "nothing sent to the minichord between the restart and its return");
  check(one.version === 116 && !one.updating && !one.help, "back with firmware 116, the update flag down, the connection help left shut");
  check(!one.notes.some(n => /disconnected/i.test(n)), "no disconnected alarm: " + one.notes.join(" | "));
  check(/Your own drum kit \(Test kit\) didn't come through/.test(await text(page, "fw-status")), "the kit damaged by the update: said to send it again");
  check(one.notes.some(n => /^Done: the minichord has firmware 116\..*Your own drum kit \(Test kit\) didn't come through/.test(n)),
    "and the notification says it too, for a sheet closed by then: " + one.notes.join(" | "));
  check(await shown(page, "fw-restore-btn"), "put my banks back offered");
  check(await text(page, "fw-now") === "This minichord has firmware 116." && !await shown(page, "fw-steps"), "the sheet follows: firmware 116, nothing more to install");
  await shot(page, "1-done-desktop.png");
  await page.click("#fw-restore-btn");
  await status(page, /^Put back all twelve banks/, 40000);
  const saves = await page.evaluate(() => mini.saves.slice());
  check([...Array(12).keys()].every(b => saves.includes(b)), "the twelve banks written back and saved: " + saves.join(","));
  check(!await shown(page, "fw-restore-btn"), "and the offer gone");
  // installing again: the backup was this update's, spent; a new one is asked for
  await page.click("#fw-other summary");
  await page.click('input[value="newest"]');
  await ready(page);
  check(await shown(page, "fw-steps") && !await page.$eval("#fw-step-backup", s => s.classList.contains("fw-done")) && await shown(page, "fw-backup-btn")
    && await page.$eval("#fw-install-btn", b => b.textContent === "install firmware 116" && b.disabled),
    "a second update: the first's backup not taken for this one's, install held till a new backup: " + await text(page, "fw-backup-text"));
  // the tour, with the minichord connected: its firmware step, and nothing sent
  await page.keyboard.press("Escape");
  await page.evaluate(() => { window.sentBefore = mini.seq.length; startTour(); });
  let firmwareStep = false;
  for (let i = 0; i < 40; i++) {
    const title = await page.evaluate(() => tourOn() ? document.getElementById("tour-title").textContent : null);
    if (title === null) break;
    if (title === "The firmware") {
      firmwareStep = await page.evaluate(() => document.getElementById("settings-firmware").getClientRects().length > 0);
      await page.screenshot({path: path.join(SHOTS, "tour-firmware.png")});
    }
    await page.evaluate(() => showTourStep(tourStep + 1));
    await page.waitForTimeout(120);
  }
  const tourSent = await page.evaluate(() => mini.seq.slice(window.sentBefore).map(e => e.b.map(x => x.toString(16)).join(" ")));
  check(firmwareStep, "the tour lights the drawer's firmware section");
  check(tourSent.length === 0, "the tour sends nothing to the minichord" + (tourSent.length ? ": " + tourSent.join(" | ") : ""));
  check(await page.evaluate(() => TOUR_STEPS.find(s => s.target === ".settings-toggle").text.includes("the firmware")), "the drawer's step names the firmware");
  await page.close();

  // ---- 2. firmware 113 on macOS: the serial port at 134 baud, then install -------------------------
  scene = "mac";
  current = release("firmware-114");
  page = await open("computer=macOS", {version: 113, after: 114});
  await page.setViewportSize({width: 375, height: 812});
  await openSheet(page);
  await ready(page);
  check(await shown(page, "fw-step-restart") && await page.$eval("#fw-restart-btn", b => b.disabled), "macOS, firmware 113: restart into update mode, held till the backup");
  await page.click("#fw-backup-check");
  check(await page.$eval("#fw-restart-btn", b => !b.disabled) && await page.$eval("#fw-install-btn", b => b.disabled && b.textContent === "install firmware 114"),
    "unticked: restart free, install held till it");
  console.log("     restart: " + await text(page, "fw-restart-text"));
  console.log("     install: " + await text(page, "fw-install-text"));
  check(/USB Serial Device on Windows/.test(await text(page, "fw-restart-text")), "the serial box's entry named as Windows names it too");
  const scroll = await page.$eval("#firmware-sheet", s => s.scrollWidth <= s.clientWidth + 1 && document.documentElement.scrollWidth <= 375);
  check(scroll, "the sheet fits a phone's width");
  await shot(page, "2-serial-phone.png");
  await page.click("#fw-restart-btn");
  await page.waitForFunction(() => document.getElementById("fw-step-restart").classList.contains("fw-done"), null, {timeout: 10000});
  console.log("     restarted: " + await text(page, "fw-now") + " / " + await text(page, "fw-restart-text"));
  check(await text(page, "fw-status") === "", "nothing more to say than the step and the top line");
  const serial = await page.evaluate(() => ({...fakeSerial, granted: fakeSerial.granted.length}));
  check(serial.opens.length === 1 && serial.opens[0] === 134 && serial.requests.length === 1 && serial.requests[0].active
    && JSON.stringify(serial.requests[0].filters) === JSON.stringify([{usbVendorId: 0x16C0, usbProductId: 0x048A}]), "the minichord's serial port asked for and opened at 134 baud");
  check(await page.$eval("#fw-install-btn", b => !b.disabled) && await page.$eval("#fw-step-restart", s => s.classList.contains("fw-done")), "restarted: the step ticked, install free");
  check(await shown(page, "fw-step-backup") && await text(page, "fw-backup-text") === "Skipped: the banks weren't backed up."
    && !await page.$eval("#fw-step-backup", s => s.classList.contains("fw-done")), "the backup step stays, said skipped, so install keeps its number 3");
  await shot(page, "2-restarted-phone.png");
  await page.click("#fw-install-btn");
  await status(page, /^Done: the minichord has firmware 114\./, 30000);
  const two = await page.evaluate(() => ({hid: fakeHid.requests, serial: fakeSerial.requests}));
  check(two.hid.length === 1 && two.hid[0].active && two.hid[0].click !== two.serial[0].click, "the HID box from a click of its own, not the serial box's");
  w = await written(page);
  check(samePlan(w.offsets) && w.crc === WRITTEN_CRC && w.boots === 1, "written whole, then booted");
  await shot(page, "2-done-phone.png");
  await page.close();

  // ---- 3. firmware 100 on Linux: the pin, from the firmware note -----------------------------------------
  scene = "linux";
  page = await open("computer=Linux", {version: 100, after: 114}, () => { fakeHid.pinPress = 1200; fakeHid.holdBox = true; });
  check(await page.evaluate(() => !!document.querySelector("#firmware-note [data-firmware-open]")), "the firmware note offers the update");
  await page.click("#firmware-note [data-firmware-open]");
  await page.waitForFunction(() => document.getElementById("firmware-sheet").matches(":popover-open"));
  await ready(page);
  check(!await shown(page, "fw-step-restart") && !await shown(page, "fw-pin-btn") && /press the little button/.test(await text(page, "fw-install-text")),
    "Linux, firmware 100: no serial step, the pin in the install step");
  await page.click("#fw-backup-check");
  await page.click("#fw-install-btn");
  await status(page, /^Now press the little button through the hole in the back of the minichord with a pin\. A quick press: held down for long, it wipes the minichord\. Chrome's box lists it after a moment by number, 16C0:0478, not by name: pick it and click Connect\.$/, 3000);
  console.log("     pin: " + await text(page, "fw-status"));
  check(!await shown(page, "fw-install-text"), "the pin said once, in the status, not again in the step above it");
  await shot(page, "3-pin-desktop.png");
  await page.waitForFunction(() => !controller.isConnected(), null, {timeout: 5000});      // the pin pressed
  await page.waitForTimeout(700);
  check(await shown(page, "fw-steps") && !await shown(page, "fw-finish"), "the pin pressed, Chrome's box still open: the steps stay, not the box for no minichord");
  await page.evaluate(() => { fakeHid.holdBox = false; });
  await status(page, /^Done: the minichord has firmware 114\./, 30000);
  check(await page.evaluate(() => fakeSerial.requests.length === 0 && fakeSerial.opens.length === 0), "no serial port touched");
  w = await written(page);
  check(samePlan(w.offsets) && w.boots === 1, "written whole, then booted");
  await page.close();

  // ---- 4. a block that won't write: try again -------------------------------------------------------
  scene = "write";
  const middle = PLAN[Math.floor(PLAN.length / 2)];
  page = await open("computer=Linux", {version: 113, after: 114}, `fakeHid.pinPress = 300; fakeHid.failOffset = ${middle};`);
  await page.evaluate(() => setTheme("dark"));      // kept in this browser: the dark theme from here on
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  const t4 = Date.now();
  await page.click("#fw-install-btn");
  await status(page, /^The update stopped partway\. The minichord is safe and waiting in update mode: click try again\.$/, 30000);
  console.log(`     stopped (${Date.now() - t4} ms): ` + await text(page, "fw-status"));
  w = await written(page);
  const failedAt = w.ops.length;
  check(w.boots === 0 && w.ops[w.ops.length - 1] === "fail" && !w.ops.includes("close"), "no boot report after the failure, the device left open in update mode");
  check(await shown(page, "fw-again-btn") && !await shown(page, "fw-steps") && !await shown(page, "fw-finish"), "try again offered, and only that");
  await shot(page, "4-stopped-dark.png");
  await page.evaluate(() => { fakeHid.failOffset = -1; });
  await page.click("#fw-again-btn");
  await status(page, /^Done: the minichord has firmware 114\./, 30000);
  w = await written(page, failedAt);
  check(samePlan(w.offsets) && w.crc === WRITTEN_CRC && w.boots === 1, "try again: the same device, every block from the start, then booted");
  check(await page.evaluate(() => fakeHid.requests.length === 1), "no second box: the device allowed already");
  await shot(page, "4-done-dark.png");
  await page.close();

  // ---- 5. a Teensy 4.1 in update mode: refused; leave update mode -------------------------------------
  scene = "board";
  page = await open("computer=Linux", {version: 113, after: 113}, () => { fakeHid.pinPress = 300; fakeHid.usage = 0x25; });
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  await page.click("#fw-install-btn");
  await status(page, /Teensy 4\.1/, 15000);
  console.log("     board: " + await text(page, "fw-status"));
  w = await written(page);
  check(/nothing was written/i.test(await text(page, "fw-status")) && w.offsets.length === 0 && !w.ops.includes("fail"), "refused, nothing written");
  check(await shown(page, "fw-finish") && await shown(page, "fw-leave-btn"), "the minichord not answering: finish an update or leave update mode");
  await page.click("#fw-leave-btn");
  await status(page, /^The minichord is back, with firmware 113\.$/, 15000);
  w = await written(page);
  check(w.boots === 1 && w.offsets.length === 0, "left update mode: the boot report alone");
  // a Teensy 4.0 this time, but it comes back with the firmware it had: on Linux the pin was the way in already
  await page.evaluate(() => { fakeHid.usage = 0x24; });
  await ready(page);
  await page.click("#fw-install-btn");
  await status(page, /didn't take/, 30000);
  console.log("     didn't take: " + await text(page, "fw-status"));
  check(/the update didn't take\. Click install to try again\.$/.test(await text(page, "fw-status")) && !/pin instead/.test(await text(page, "fw-status")),
    "didn't take, where the pin is the way already: no word of a pin button that isn't there");
  await page.close();

  // ---- 6. the device won't open on Linux: PJRC's rule ------------------------------------------------
  scene = "open";
  page = await open("computer=Linux", {version: 113, after: 114}, () => { fakeHid.pinPress = 300; fakeHid.openFails = true; });
  await page.setViewportSize({width: 375, height: 812});
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  await page.click("#fw-install-btn");
  await status(page, /permission rule/, 15000);
  console.log("     open: " + await text(page, "fw-status"));
  const rule = await page.$eval("#fw-rule-box code", c => c.textContent);
  check(await shown(page, "fw-rule-box") && rule === "sudo wget -O /etc/udev/rules.d/00-teensy.rules https://www.pjrc.com/teensy/00-teensy.rules\n" +
    "sudo udevadm control --reload-rules && sudo udevadm trigger", "the two commands shown");
  check(await shown(page, "fw-again-btn") && (await written(page)).offsets.length === 0, "try again offered, nothing written");
  check(!/PJRC/.test(await text(page, "fw-status")) && !/PJRC/.test(await page.$eval(".fw-help", e => e.textContent)), "the rule named without PJRC, a name the player never meets");
  await page.locator("#fw-rule-box").scrollIntoViewIfNeeded();
  await shot(page, "6-linux-rule-phone.png");
  // no sudo here: unplugged and plugged back in, it starts as it was, on MIDI again
  await page.evaluate(() => { fakeHid.present = null; mini.after = 113; mini.back(); });
  await page.waitForFunction(() => Math.round((controller.firmware_version || 0) * 100) === 113 && controller.isConnected(), null, {timeout: 5000});
  await page.waitForTimeout(800);
  const six = await page.evaluate(() => ({flag: window.firmwareUpdating}));
  check(await shown(page, "fw-steps") && await shown(page, "fw-install-btn") && !await shown(page, "fw-again-btn") && !await shown(page, "fw-rule-box")
    && await text(page, "fw-status") === "" && !six.flag, "back on MIDI as it was: the steps again, the failure and its rule gone, the update flag down");
  await page.close();

  // ---- 7. a download that doesn't match the release -----------------------------------------------------
  scene = "digest";
  current = release("firmware-114", "0".repeat(64));
  page = await open("computer=Linux", {version: 113, after: 114});
  await openSheet(page);
  await page.waitForFunction(() => /doesn't match/.test(document.getElementById("fw-get").textContent), null, {timeout: 15000});
  console.log("     digest: " + await text(page, "fw-get"));
  check(await page.$eval("#fw-install-btn", b => b.disabled) && await shown(page, "fw-get-again"), "refused: install held, try again offered");
  check(/try again in a few minutes\.$/.test(await text(page, "fw-get")), "says when to try again, as the button under it offers");
  const darkContrast = await contrast(page, "fw-get");
  await page.evaluate(() => setTheme("light"));
  const lightContrast = await contrast(page, "fw-get");
  await page.evaluate(() => setTheme("dark"));
  check(darkContrast >= 4.5 && lightContrast >= 4.5, `the error readable on its own ground: ${darkContrast.toFixed(1)}:1 dark, ${lightContrast.toFixed(1)}:1 light`);
  check(await page.evaluate(() => fakeHid.requests.length === 0 && fakeHid.log.length === 0), "nothing asked of the minichord");
  await shot(page, "7-digest-desktop.png");
  await page.close();
  current = release("firmware-114");

  // ---- 8. no WebHID ----------------------------------------------------------------------------------
  scene = "no hid";
  const before8 = hits.length;
  page = await open("hid=0&computer=Linux", {version: 113, after: 114});
  await openSheet(page);
  check(await shown(page, "fw-unsupported") && !await shown(page, "fw-main") && /needs Chrome or Edge on a computer/.test(await text(page, "fw-unsupported")),
    "no WebHID: Chrome or Edge on a computer, and the release page");
  check(hits.length === before8, "and nothing fetched");
  await shot(page, "8-no-webhid-desktop.png");
  await page.close();

  // ---- 9. Chrome's box closed with nothing chosen --------------------------------------------------
  scene = "cancel";
  page = await open("computer=Linux", {version: 113, after: 114}, () => { fakeHid.chooser = "cancel"; });
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  await page.click("#fw-install-btn");
  await page.waitForFunction(() => fakeHid.requests.length === 1 && !document.getElementById("fw-install-btn").disabled, null, {timeout: 5000});
  check(await text(page, "fw-status") === "" && await shown(page, "fw-steps") && !await page.evaluate(() => window.firmwareUpdating)
    && await page.evaluate(() => !notes.some(n => n[1] === "error")), "back to the step, quietly");
  await page.close();

  // ---- 10. a .hex from the computer, and Ben's classic firmware --------------------------------------
  scene = "file";
  page = await open("computer=Linux", {version: 113, after: 114});
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  await page.click("#fw-other summary");
  await page.setInputFiles("#fw-file", {name: "broken.hex", mimeType: "application/octet-stream", buffer: Buffer.from(":10000000ZZ\r\n")});
  await page.waitForFunction(() => document.getElementById("fw-file-said").textContent);
  const broken = await text(page, "fw-file-said");
  console.log("     broken: " + broken);
  check(/damaged|isn't/.test(broken) && !/undefined|Error|line \d/.test(broken), "a broken file: said plainly");
  check(await page.$eval('input[value="file"]', r => r.checked) && await page.$eval("#fw-install-btn", b => b.disabled && b.textContent === "install the .hex file"),
    "the file chosen, and install held");
  await shot(page, "10-broken-file-desktop.png");
  await page.setInputFiles("#fw-file", {name: "too-big.hex", mimeType: "application/octet-stream", buffer: Buffer.from(TOO_BIG_HEX)});
  await page.waitForFunction(() => /too big/.test(document.getElementById("fw-file-said").textContent), null, {timeout: 5000})
    .catch(() => {});
  check(/too big for the minichord/.test(await text(page, "fw-file-said")) && await page.$eval("#fw-install-btn", b => b.disabled)
    && await page.evaluate(() => fakeHid.log.length === 0), "a hex reaching the kit header (0x601E0000): too big, install held, nothing asked of the minichord: " + await text(page, "fw-file-said"));
  await page.setInputFiles("#fw-file", {name: "firmware.hex", mimeType: "application/octet-stream", buffer: hexBytes});
  await page.waitForFunction(() => /^Ready to install/.test(document.getElementById("fw-file-said").textContent));
  console.log("     good: " + await text(page, "fw-file-said"));
  check(await page.$eval("#fw-install-btn", b => !b.disabled), "a good file: ready to install");
  await page.click('input[value="classic"]');
  await page.waitForFunction(() => document.getElementById("fw-install-btn").textContent === "install Ben's classic firmware" && !/Getting/.test(document.getElementById("fw-get").textContent));
  check(hits.includes(CLASSIC_HEX), "Ben's classic firmware fetched from his repository");
  await shot(page, "10-classic-desktop.png");
  await page.close();

  // ---- 11. no minichord answering: finish an update -----------------------------------------------------
  scene = "finish";
  page = await open("computer=Linux", {version: 113, after: 114, present: false}, () => { fakeHid.granted.push(fakeHid.appear()); });
  await openSheet(page);
  await ready(page);
  check(await text(page, "fw-now") === "No minichord is answering: plug it in with a USB cable, and if Chrome asks to use MIDI devices, allow it."
    && await shown(page, "fw-finish") && !await shown(page, "fw-steps"), "no minichord: plug it in and allow MIDI, or finish an update");
  await shot(page, "11-finish-desktop.png");
  await page.click("#fw-finish-btn");
  await status(page, /^Done: the minichord has firmware 114\./, 30000);
  check(await page.evaluate(() => fakeHid.requests.length === 0), "the update mode allowed already: no box");
  w = await written(page);
  check(samePlan(w.offsets) && w.boots === 1, "written whole, then booted");
  await page.close();

  // ---- 12. gone from the bus partway; Ben's classic firmware cut short on the way -------------------------
  scene = "gone";
  page = await open("computer=Windows", {version: 113, after: 114});
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  await page.click("#fw-restart-btn");
  await page.waitForFunction(() => document.getElementById("fw-step-restart").classList.contains("fw-done"), null, {timeout: 10000});
  await page.evaluate(() => { fakeHid.delay = 2; });
  await page.click("#fw-install-btn");
  await page.waitForFunction(() => document.getElementById("fw-progress").value > 0.3, null, {timeout: 20000});
  // Escape and a click beside the sheet, mid-install: it stays open, the bar in sight
  const sheetOpen = () => page.evaluate(() => document.getElementById("firmware-sheet").matches(":popover-open") && !document.getElementById("fw-progress-box").hidden);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const afterEscape = await sheetOpen();
  await page.mouse.click(5, 880);
  await page.waitForTimeout(150);
  check(afterEscape && await sheetOpen(), "Escape or a click outside mid-install leaves the sheet open, the bar in sight");
  await page.evaluate(() => { fakeHid.present = null; });      // the cable out: every write after is InvalidStateError
  await status(page, /^The update stopped partway: the minichord went away/, 15000);
  console.log("     gone: " + await text(page, "fw-status"));
  w = await written(page);
  check(!/safe and waiting/.test(await text(page, "fw-status")) && /plug it back in/.test(await text(page, "fw-status")),
    "gone: not said to be waiting in update mode, plug it back in");
  check(w.boots === 0 && await shown(page, "fw-again-btn"), "gone: no boot report, try again offered");
  await page.close();
  scene = "classic cut";
  classicCut = true;
  page = await open("computer=Linux", {version: 113, after: 114});
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  await page.click("#fw-other summary");
  await page.click('input[value="classic"]');
  await page.waitForFunction(() => /GitHub/.test(document.getElementById("fw-get").textContent), null, {timeout: 15000});
  const cut = await text(page, "fw-get");
  console.log("     classic cut short: " + cut);
  check(/^Ben's classic firmware came from GitHub damaged or cut short/.test(cut) && !/pick the file/.test(cut), "a damaged download: said as one, not as a file picked");
  check(await page.$eval("#fw-install-btn", b => b.disabled) && await shown(page, "fw-get-again"), "install held, try again offered");
  classicCut = false;
  await page.click("#fw-get-again");
  await page.waitForFunction(() => document.getElementById("fw-install-btn").textContent === "install Ben's classic firmware" && !/Getting/.test(document.getElementById("fw-get").textContent)
    && !document.getElementById("fw-get").textContent, null, {timeout: 15000});
  check(/^This update puts all twelve banks back to the factory presets\. Back them up first/.test(await text(page, "fw-backup-text"))
    && !await shown(page, "fw-backup-box") && await page.$eval("#fw-install-btn", b => b.disabled),
    "Ben's classic firmware over the advanced one: the banks' reset said, the backup a must, unticked or not");
  await page.click("#fw-backup-btn");
  await page.waitForFunction(() => /^Backed up all twelve banks/.test(document.getElementById("fw-backup-text").textContent), null, {timeout: 30000});
  check(await page.$eval("#fw-install-btn", b => !b.disabled), "try again: fetched whole, ready to install");
  await page.close();

  // ---- 13. two .hex files, the first slow to read (a cloud drive): the second is the one installed -------
  scene = "two files";
  page = await open("computer=Linux", {version: 113, after: 114}, () => { fakeHid.pinPress = 300; });
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  await page.click("#fw-other summary");
  // picked as the file box would give them, text() as slow as the drive
  const pickTwo = (first, second) => page.evaluate(([a, b]) => {
    const input = document.getElementById("fw-file");
    const pick = file => { Object.defineProperty(input, "files", {value: [file], configurable: true}); input.dispatchEvent(new Event("change")); };
    pick({name: a.name, text: () => new Promise(r => setTimeout(() => r(a.text), 1200))});
    setTimeout(() => pick({name: b.name, text: async () => b.text}), 200);
  }, [first, second]);
  await pickTwo({name: "a-broken-slow.hex", text: ":10000000ZZ\r\n"}, {name: "b-quick.hex", text: SMALL_HEX});
  await page.waitForTimeout(1600);      // the slow one has landed
  check(await text(page, "fw-file-said") === "Ready to install: b-quick.hex, 0.0 MB." && !await page.$eval("#fw-file-said", e => e.classList.contains("fw-bad-text"))
    && await page.$eval("#fw-install-btn", b => !b.disabled), "a slow broken file's error doesn't land on the file picked after it: " + await text(page, "fw-file-said"));
  await pickTwo({name: "a-slow.hex", text: hexBytes.toString("latin1")}, {name: "b-quick.hex", text: SMALL_HEX});
  await page.waitForTimeout(2500);      // the slow one has landed, and been read
  check(await text(page, "fw-file-said") === "Ready to install: b-quick.hex, 0.0 MB.", "the sheet names the file picked last: " + await text(page, "fw-file-said"));
  await page.click("#fw-install-btn");
  await status(page, /^Done: the minichord has firmware 114\./, 30000);
  w = await written(page, 0, SMALL_PLAN);
  check(samePlan(w.offsets, SMALL_PLAN) && w.crc === SMALL_CRC && w.boots === 1,
    `the file picked last is the one written (${w.offsets.length} blocks, ${SMALL_PLAN.length} expected), not the slow one picked before it`);
  await page.close();

  // ---- 14. Ben's classic firmware 9: the banks reset, said; the fork said as the fork ---------------------
  scene = "classic minichord";
  page = await open("computer=Linux", {version: 9, after: 114}, () => { fakeHid.pinPress = 300; });
  await openSheet(page);
  await ready(page);
  const resetText = await text(page, "fw-backup-text");
  console.log("     classic: " + resetText);
  check(/^This update puts all twelve banks back to the factory presets, and this firmware can't send them to this page to keep/.test(resetText)
    && !await shown(page, "fw-backup-box") && !await shown(page, "fw-backup-btn") && await page.$eval("#fw-install-btn", b => !b.disabled),
    "Ben's classic firmware: the reset said, nothing to back up with, install free");
  const newest14 = await text(page, "fw-newest");
  check(/It's the advanced firmware, not Ben's classic firmware\. It is experimental.*isn't made or endorsed by Ben Poilve/.test(newest14),
    "the newest offered said to be the advanced firmware, not Ben's: " + newest14);
  await shot(page, "14-classic-desktop.png");
  await page.click("#fw-install-btn");
  await status(page, /^Done: the minichord has firmware 114\./, 30000);
  console.log("     done: " + await text(page, "fw-status"));
  check(/^Done: the minichord has firmware 114\. Its banks are back to the factory presets\.$/.test(await text(page, "fw-status")),
    "done: the banks said to be back to the factory presets");
  check(await page.evaluate(() => notes.some(n => /factory presets/.test(n[0]))), "and the notification says so too");
  await page.close();

  // ---- 15. firmware 60: the banks reset, so the backup is a must; forgotten when the minichord goes away ----
  scene = "firmware 60";
  page = await open("computer=Linux", {version: 60, after: 114}, () => { fakeHid.pinPress = 300; });
  await openSheet(page);
  await ready(page);
  console.log("     firmware 60: " + await text(page, "fw-backup-text"));
  check(/^This update puts all twelve banks back to the factory presets\. Back them up first/.test(await text(page, "fw-backup-text"))
    && !await shown(page, "fw-backup-box") && await shown(page, "fw-backup-btn") && await page.$eval("#fw-install-btn", b => b.disabled)
    && /Back up the banks first\.$/.test(await text(page, "fw-install-text")),
    "firmware 60: the reset said, no box to untick, install held till the backup");
  await page.click("#fw-backup-btn");
  await page.waitForFunction(() => /^Backed up all twelve banks/.test(document.getElementById("fw-backup-text").textContent), null, {timeout: 30000});
  // the sheet closed, the minichord unplugged and one plugged in: the page can't tell it's the same one
  await page.keyboard.press("Escape");
  await page.evaluate(() => { mini.present = false; controller.handleStateChange({port: {name: "minichord", state: "disconnected"}, target: {inputs: new Map()}}); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { mini.present = true; controller.device = mini.dev; controller.onConnectionChange(true, "minichord connected"); controller.requestCurrentData(); });
  await page.waitForFunction(() => controller.isConnected() && Math.round((controller.firmware_version || 0) * 100) === 60);
  await page.waitForTimeout(300);
  await openSheet(page);
  await page.waitForTimeout(700);
  check(!await page.$eval("#fw-step-backup", s => s.classList.contains("fw-done")) && await shown(page, "fw-backup-btn") && await page.$eval("#fw-install-btn", b => b.disabled),
    "a minichord plugged in after the backup: not taken as backed up, install held: " + await text(page, "fw-backup-text"));
  await page.click("#fw-backup-btn");
  await page.waitForFunction(() => /^Backed up all twelve banks/.test(document.getElementById("fw-backup-text").textContent), null, {timeout: 30000});
  await page.evaluate(() => { mini.saves = []; });
  await page.click("#fw-install-btn");
  await status(page, /^Done: the minichord has firmware 114\./, 30000);
  console.log("     done: " + await text(page, "fw-status"));
  check(/^Done: the minichord has firmware 114\. Its banks are back to the factory presets: click put my banks back to write yours to it\.$/.test(await text(page, "fw-status"))
    && await shown(page, "fw-restore-btn"), "done: the reset said, and put my banks back offered");
  await page.close();

  // ---- 16. a write that never settles (no deadline on macOS or Windows); then the update mode won't open ---
  scene = "stuck";
  current = release("firmware-116");
  page = await open("computer=macOS", {version: 115, after: 116}, `fakeHid.hangOffset = ${PLAN[8]}; minichordFlash.BUDGET = 0;`);   // the sheet's watch on it in 10 s, not 15
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  await page.click("#fw-install-btn");
  await status(page, /^The minichord has stopped taking the firmware\. Unplug it, plug it back in, then click try again\.$/, 20000);
  check(await page.evaluate(() => fakeHid.log.filter(e => e.op === "write").length === 8 && fakeHid.log[fakeHid.log.length - 1].op === "hang"),
    "a write that never settles: said, nothing sent after it");
  await shot(page, "16-stuck-desktop.png");
  await page.evaluate(() => { fakeHid.present = null; });      // the cable out: the pending write rejects
  await status(page, /^The update stopped partway: the minichord went away/, 10000);
  check(await shown(page, "fw-again-btn"), "unplugged: gone, try again offered");
  // back in update mode (the pin), and Chrome can't open it there
  await page.evaluate(() => { fakeHid.hangOffset = -1; fakeHid.openFails = true; fakeHid.appear(); });
  await page.click("#fw-again-btn");
  await status(page, /couldn't open/, 15000);
  console.log("     open on macOS: " + await text(page, "fw-status"));
  check(/Quit Teensy Loader if it's open, then click try again\. If that doesn't help, unplug the minichord, plug it back in, press the little button through the hole in the back with a pin, and click try again\.$/
    .test(await text(page, "fw-status")), "the update mode that won't open on macOS: more to try than Teensy Loader");
  await page.close();
  current = release("firmware-114");

  // ---- 17. slow to come back: heard from its own dump, not the version held from before; a refused boot report ----
  scene = "late";
  page = await open("computer=Linux&backWait=3000", {version: 113, after: 114, comeBack: false}, () => { fakeHid.pinPress = 300; });
  await openSheet(page);
  await ready(page);
  await page.click("#fw-backup-check");
  await page.click("#fw-install-btn");
  await status(page, /^Firmware 114 was written, and the minichord is taking a while to answer/, 30000);
  // back on MIDI, its first dump a while coming: the controller still holds firmware 113 till then
  await page.evaluate(() => { mini.comeBack = true; mini.dumpDelay = 1500; mini.back(); });
  await page.waitForFunction(() => controller.isConnected(), null, {timeout: 5000});
  await page.waitForTimeout(900);
  const before17 = await text(page, "fw-status");
  await status(page, /^The minichord is back, with firmware 114\.$/, 10000).catch(() => {});
  const after17 = await text(page, "fw-status");
  check(!/firmware 113/.test(before17) && after17 === "The minichord is back, with firmware 114.",
    `late: back with the version of its own dump (before the dump: "${before17}"; after: "${after17}")`);
  // installed again, and the boot report refused every time: written, still in update mode, so leave it
  await page.evaluate(() => { mini.dumpDelay = 3; fakeHid.bootFails = true; });
  await page.click("#fw-other summary");
  await page.click('input[value="newest"]');
  await ready(page);
  const from17 = await page.evaluate(() => fakeHid.log.length);
  await page.click("#fw-install-btn");
  await status(page, /didn't start it/, 30000);
  console.log("     boot refused: " + await text(page, "fw-status"));
  w = await written(page, from17);
  check(samePlan(w.offsets) && w.boots === 0 && w.bootsRefused > 10, `the boot report sent again while refused (${w.bootsRefused} tries)`);
  check(/^Firmware 114 was written, but the minichord didn't start it: it is still in update mode\. Click leave update mode to start it\.$/.test(await text(page, "fw-status"))
    && await shown(page, "fw-leave-btn"), "the boot report refused: said to leave update mode, which is offered");
  await page.evaluate(() => { fakeHid.bootFails = false; });
  await page.click("#fw-leave-btn");
  await status(page, /^The minichord is back, with firmware 114\.$/, 15000);
  check((await written(page, from17)).boots === 1, "leave update mode: the boot report goes, and it's back");
  await page.close();

  check(!refused.some(h => /^https:\/\/(api\.github|raw\.githubusercontent)/.test(h)), "GitHub only ever answered from here");
  if (refused.length) console.log("     refused: " + [...new Set(refused)].join(", "));
  check(errors.length === 0, "no console errors" + (errors.length ? ":\n" + errors.join("\n") : ""));
  await browser.close();
  server.close();
  console.log(`     screenshots in ${SHOTS}`);
  console.log(failures ? `${failures} failed` : "all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
