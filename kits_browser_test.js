// node kits_browser_test.js: your own drum kit on the generated page, in headless Chrome. The kit block
// renders, a folder of sounds maps and processes, a .mckit saves and reads back, and uploads run against
// a fake minichord inside the page that follows the contract (the minichord repository's
// firmware/generator/user_kit.md, sections 3 to 5), with the things that go wrong on the way: a busy
// BEGIN, lost and damaged replies, a lost COMMIT, refusals, another app's upload, and the settings
// sent meanwhile, held back and sent after. Web MIDI is stubbed out before any page script runs, so
// nothing can reach a real minichord.
//
// It needs playwright-core and Chrome; neither is a dependency of this page. ~/minichord-lab has
// playwright-core (cd ~/minichord-lab/tests && npm install), and that copy is used unless node finds
// one of its own or PLAYWRIGHT_CORE names another (the package's folder). CHROME names the browser
// (default /usr/bin/google-chrome). The sounds are written here at the start (WAV and AIFF by this
// file, FLAC and Ogg by sox where it is installed) into a fresh folder under the system's temp folder,
// or KIT_TEST_OUT; the screenshots (kit-phone.png, kit-desktop.png) go there too. About a minute: the
// contract's 3 s timers run as they are.
//
//     node kits_browser_test.js
//     PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME=/usr/bin/chromium node kits_browser_test.js

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFileSync} = require("child_process");
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

const ROOT = __dirname;
const OUT = process.env.KIT_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), "minicontrol-kit-"));
fs.mkdirSync(OUT, {recursive: true});
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

// ---- the sounds: a folder as a player might give it ----------------------------------------------
let seed = 1;
const noise = () => (seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF) / 0x40000000 - 1;
// a decaying sine with some noise in it, or noise alone (freq 0)
function hit(seconds, rate, freq, noiseShare, decay) {
  const n = Math.round(seconds * rate), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = 0.8 * Math.exp(-decay * t) * ((freq ? (1 - noiseShare) * Math.sin(2 * Math.PI * freq * t) : 0) + noiseShare * noise());
  }
  return out;
}
const clamp = x => Math.max(-1, Math.min(1, x));
function wav(channels, rate) {               // 16-bit PCM
  const n = channels[0].length, c = channels.length, data = n * c * 2, b = Buffer.alloc(44 + data);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(c, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * c * 2, 28); b.writeUInt16LE(c * 2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(data, 40);
  for (let i = 0; i < n; i++) for (let ch = 0; ch < c; ch++) b.writeInt16LE(Math.round(clamp(channels[ch][i]) * 32767), 44 + 2 * (i * c + ch));
  return b;
}
function aiff24(samples, rate) {             // mono, 24-bit, the rate as an 80-bit extended float
  const n = samples.length, data = 3 * n, b = Buffer.alloc(54 + data), e = Math.floor(Math.log2(rate));
  b.write("FORM", 0); b.writeUInt32BE(46 + data, 4); b.write("AIFFCOMM", 8); b.writeUInt32BE(18, 16); b.writeUInt16BE(1, 20);
  b.writeUInt32BE(n, 22); b.writeUInt16BE(24, 26); b.writeUInt16BE(16383 + e, 28); b.writeBigUInt64BE(BigInt(rate) << BigInt(63 - e), 30);
  b.write("SSND", 38); b.writeUInt32BE(8 + data, 42);
  for (let i = 0; i < n; i++) b.writeIntBE(Math.round(clamp(samples[i]) * 8388607), 54 + 3 * i, 3);
  return b;
}
let haveSox = true;
try { execFileSync("sox", ["--version"], {stdio: "ignore"}); } catch (e) { haveSox = false; }
// FLAC or Ogg through sox, from a WAV; a WAV of the same name without it
function encoded(dir, base, ext, channels, rate) {
  const wavFile = path.join(dir, `${base}.wav`);
  fs.writeFileSync(wavFile, wav(channels, rate));
  if (!haveSox) return `${base}.wav`;
  execFileSync("sox", [wavFile, path.join(dir, `${base}.${ext}`)]);
  fs.unlinkSync(wavFile);
  return `${base}.${ext}`;
}
function makeSounds() {
  const dir = path.join(OUT, "sounds", "MyKit");
  fs.rmSync(path.join(OUT, "sounds"), {recursive: true, force: true});
  fs.mkdirSync(path.join(dir, "Toms"), {recursive: true});
  const kick = hit(0.6, 44100, 55, 0.05, 7);
  fs.writeFileSync(path.join(dir, "Kick 01.wav"), wav([kick, kick.map(x => 0.9 * x)], 44100));
  fs.writeFileSync(path.join(dir, "Snare.aif"), aiff24(hit(0.4, 48000, 190, 0.6, 12), 48000));
  const hat = encoded(dir, "HiHat Closed", "flac", [hit(0.2, 44100, 0, 1, 30)], 44100);
  fs.writeFileSync(path.join(dir, "Open Hat.wav"), wav([hit(0.8, 44100, 0, 1, 5)], 44100));
  fs.writeFileSync(path.join(dir, "Ride.wav"), wav([hit(1.2, 44100, 3200, 0.7, 3)], 44100));
  const clap = hit(0.58, 44100, 0, 1, 14);
  const clapFile = encoded(dir, "Clap", "ogg", [clap, clap.map(x => -x)], 44100);
  fs.writeFileSync(path.join(dir, "Toms", "hi.wav"), wav([hit(0.5, 44100, 200, 0.1, 8)], 44100));
  fs.writeFileSync(path.join(dir, "Toms", "low.wav"), wav([hit(0.5, 44100, 110, 0.1, 8)], 44100));
  fs.writeFileSync(path.join(dir, ".hidden.wav"), wav([hit(0.05, 44100, 0, 1, 10)], 44100));
  // two files of the same bytes on two voices of the same cap: one hit in the image, and the .mckit's
  // sources name the earlier voice's file for both; and a file no browser decodes, its voice empty
  const conga = wav([hit(0.3, 44100, 330, 0.2, 14)], 44100);
  fs.writeFileSync(path.join(dir, "Conga Low.wav"), conga);
  fs.writeFileSync(path.join(dir, "Cowbell.wav"), conga);
  fs.writeFileSync(path.join(dir, "Shaker.wav"), Buffer.from("RIFF\x10\0\0\0WAVEjunkjunkjunk"));
  fs.writeFileSync(path.join(dir, "LICENSE.txt"), "CC0 1.0: do what you like\n");
  return {dir, hat, clap: clapFile};
}

// A small kit, for the uploads that only need to go wrong: one voice, 19 pieces
function smallMckit() {
  const voices = Array(13).fill(null);
  voices[0] = {samples: Int16Array.from({length: 2000}, (_, i) => Math.round(12000 * Math.sin(i / 9) * Math.exp(-i / 600))),
    rate: 22050, level: 160, pan: 0, choke: 0, flags: 2, pitch: 0};
  const image = kits.buildImage({base_kit: 4, name: "Small", voices});
  return {image, file: kits.writeMckit({name: "Small", author: "", licence: "CC0", sources: ["kick.wav", ...Array(12).fill(null)],
    made: "2026-10-22"}, image)};
}

// ---- the fake minichord, inside the page --------------------------------------------------------
// It answers kit messages as section 4 says the minichord does and drops every other message while an
// upload is open. Knobs on window.fake make the next upload go wrong in one way; fake.seq is everything
// that arrived, in order, with whether an upload was open at the time.
function installFake() {
  const k = window.userKit;
  const CAPACITY = 262144, DATA_BASE = 0x601A0000, SILENCE = 5000;
  const fake = window.fake = {
    stored: null, open: false, size: 0, crc: 0, buf: null, next: 0, last: null, quietSince: 0, silenced: 0,
    rhythm: false, looper: false, live: {}, dumps: 0,
    seq: [], replies: [], deliver: true,
    loseBeginReply: false,  // BEGIN opens the upload, and its reply goes missing
    dropReplyAt: -1,        // the piece at this offset is written, and its reply goes missing
    damage: {},             // offset: the statuses (3 or 7) the piece there is answered first, one per try
    refuseAt: {},           // offset: a status the piece there is answered (8 and 5 end the upload)
    loseCommit: false,      // COMMIT never arrives
    loseCommitReply: false, // COMMIT keeps the kit, and both its replies go missing
    commitStatus: 0,        // COMMIT answered this (3: as one damaged on the way), the upload left open
    loseInfo: 0,            // this many INFO replies go missing
    loseCommitInfo: false,  // with loseCommit: the INFO after the lost COMMIT goes unanswered too
    openAfterInfo: false,   // after answering the next INFO, another app's upload opens
    infoDelay: 3,           // ms before an INFO reply arrives
  };
  const now = () => performance.now();
  const reply = (bytes, ms = 3) => {
    fake.replies.push(bytes);
    if (fake.deliver) setTimeout(() => controller.processCurrentData({data: Uint8Array.from(bytes)}), ms);
  };
  // next: the offset of the next piece expected, 0 with no upload
  const status = (op, s) => reply([0xF0, 0x7D, 0x6B, 0x40 | op, s, ...k.groups(fake.open ? fake.next : 0, 3), 0xF7]);
  const end = () => { fake.open = false; fake.buf = null; fake.last = null; };
  // 5 s with no DATA, COMMIT, ABORT or CLEAR ends an upload; INFO, BEGIN and malformed messages don't count
  const quiet = () => { if (fake.open && now() - fake.quietSince > SILENCE) { end(); fake.silenced++; } };
  setInterval(quiet, 100);
  const info = () => {
    const s = fake.open ? null : fake.stored, h = s && k.readHeader(s), state = fake.open ? 2 : s ? 1 : 0;
    reply([0xF0, 0x7D, 0x6B, 0x45, 1, state, state === 0 ? 1 : 0, ...k.groups(CAPACITY, 3), ...k.groups(DATA_BASE, 5),
      ...k.groups(s ? s.length : 0, 3), ...k.groups(s ? k.crc32(s) : 0, 5), ...k.groups(224, 2), s ? h.base_kit : 0,
      ...k.groups(s ? h.entries.reduce((m, e, v) => m | (e.length ? 1 << v : 0), 0) : 0, 2),
      ...Array.from({length: 20}, (_, i) => s ? s[20 + i] : 0), 0xF7], fake.infoDelay);
  };
  const unpack = p => {
    const o = [];
    for (let a = 0; a < p.length; a += 8) for (let j = 1; j < 8 && a + j < p.length; j++) o.push(p[a + j] | ((p[a] >> (j - 1)) & 1) << 7);
    return o;
  };
  const kit = msg => {
    const op = msg[3], n = msg.length;
    if (op === 3 && fake.loseCommit) {
      fake.loseCommit = false;
      if (fake.loseCommitInfo) { fake.loseCommitInfo = false; fake.loseInfo = 1; }
      fake.seq.push({lost: op, at: now()});
      return;
    }
    const entry = {kit: op, len: n, open: fake.open, at: now()};
    if (op === 2 && n > 7) entry.offset = k.ungroup(msg.subarray(4, 7));
    fake.seq.push(entry);
    quiet();
    if (op >= 0x40 || n < 7) return;       // a reply's shape is never answered; under 7 is the settings path's
    if (op === 5) {
      if (n !== 7) return status(5, 3);
      if (fake.loseInfo > 0) { fake.loseInfo--; return; }
      info();
      if (fake.openAfterInfo) {
        fake.openAfterInfo = false;
        Object.assign(fake, {open: true, size: 1024, crc: 0, buf: new Uint8Array(1024), next: 0, last: null, stored: null, quietSince: now()});
      }
      return;
    }
    if (op === 1) {
      if (n !== 14) return status(1, 3);
      if (msg[4] !== 1) return status(1, 4);
      const size = k.ungroup(msg.subarray(5, 8)), crc = k.ungroup(msg.subarray(8, 13));
      if (fake.open || fake.rhythm || fake.looper) return status(1, 1);
      if (size < 256 || size - 256 > CAPACITY || size % 4) return status(1, 2);
      Object.assign(fake, {open: true, size, crc, buf: new Uint8Array(size), next: 0, last: null, stored: null, quietSince: now()});
      if (fake.loseBeginReply) { fake.loseBeginReply = false; return; }
      return status(1, 0);
    }
    if (op === 2) {
      if (!fake.open) return status(2, 5);
      fake.quietSince = now();
      if (n < 13) return status(2, 3);
      const offset = entry.offset, crc = k.ungroup(msg.subarray(7, 12)), packed = msg.subarray(12, n - 1);
      if (fake.last && offset === fake.last.offset && crc === fake.last.crc) return status(2, 0);   // a repeat: not written again
      if (offset !== fake.next || offset >= fake.size) return status(2, 6);
      const len = Math.min(224, fake.size - offset);
      if (packed.length !== len + Math.ceil(len / 7)) return status(2, 3);
      if (fake.damage[offset]?.length) return status(2, fake.damage[offset].shift());
      const raw = Uint8Array.from(unpack(packed));
      if (k.crc32(raw) !== crc) return status(2, 7);
      if (offset in fake.refuseAt) {
        const s = fake.refuseAt[offset];
        delete fake.refuseAt[offset];
        if (s === 8 || s === 5) end();
        return status(2, s);
      }
      fake.buf.set(raw, offset);
      fake.next = offset + len;
      fake.last = {offset, crc};
      if (fake.dropReplyAt === offset) { fake.dropReplyAt = -1; return; }
      return status(2, 0);
    }
    if (op === 3 || op === 4) {
      if (n !== 7 || msg[4] || msg[5]) return status(op, 3);     // the upload stays open
      if (!fake.open) return status(op, 5);
      fake.quietSince = now();
      if (op === 4) { end(); return status(4, 0); }
      if (fake.commitStatus) { const st = fake.commitStatus; fake.commitStatus = 0; return status(3, st); }
      if (fake.next !== fake.size) { end(); return status(3, 3); }
      if (k.crc32(fake.buf) !== fake.crc) { end(); return status(3, 9); }
      // any of check_image's steps, a data_base that isn't 0 among them
      if (k.checkImage(fake.buf, 0, CAPACITY)) { end(); return status(3, 10); }
      fake.stored = fake.buf;
      end();
      if (fake.loseCommitReply) { fake.loseCommitReply = false; return; }
      status(3, 0);
      return info();
    }
    if (op === 6) {
      if (n !== 8 || msg[4] || msg[5] !== 0x43 || msg[6] !== 0x4C) return status(6, 3);
      end();
      fake.stored = null;
      return status(6, 0);
    }
    return status(op, 3);                  // an op it doesn't know
  };
  // a setting or a command (F0 lo hi lo hi F7): dropped while an upload is open
  const other = msg => {
    const b = Array.from(msg);
    fake.seq.push({other: b, open: fake.open, at: now()});
    if (fake.open || b.length !== 6) return;
    const address = b[1] + 128 * b[2], value = b[3] + 128 * b[4];
    if (address === 0 && b[3] === 8 && b[4] === 0) fake.rhythm = false;    // control command 8, 0: rhythm mode off
    if (address === 256 && value === 3) fake.looper = false;
    if (address === 0 && b[3] === 0 && b[4] === 0) fake.dumps++;           // control command 0: a dump asked for
    if (address) fake.live[address] = value;
  };
  controller.firmware_version = 1.13;
  controller.has_page1 = true;             // so settings 256 and up (drum level, drum kit) are sent at all
  controller.device = {send(msg) {
    msg = Uint8Array.from(msg);
    if (msg[0] === 0xF0 && msg[1] === 0x7D && msg[2] === 0x6B) kit(msg);
    else other(msg);
  }};
  // every line the kit block says, as kits.js overwrites one with the next
  window.kitSaid = [];
  new MutationObserver(() => kitSaid.push(document.getElementById("kit-status").textContent))
    .observe(document.getElementById("kit-status"), {childList: true, characterData: true, subtree: true});
  // and what the upload's live region says (a screen reader hears it), and how often the bar's own text changes
  window.kitMilestones = [];
  window.kitBarTexts = 0;
  new MutationObserver(() => { const t = document.getElementById("kit-progress-said").textContent; if (t) kitMilestones.push(t); })
    .observe(document.getElementById("kit-progress-said"), {childList: true, characterData: true, subtree: true});
  new MutationObserver(() => kitBarTexts++)
    .observe(document.getElementById("kit-progress-text"), {childList: true, characterData: true, subtree: true});
}

// One upload through the send button, to its end: what the page said and what the fake saw
async function upload(page, label, setup, arg) {
  await page.evaluate(setup || (() => {}), arg);
  await page.evaluate(() => { fake.seq = []; kitSaid.length = 0; kitMilestones.length = 0; kitBarTexts = 0; });
  const t0 = Date.now();
  await page.click("#kit-send");
  await page.waitForFunction(() => kitSaid.some(t => /^Kit sent|^The kit wasn't sent/.test(t)), null, {timeout: 30000});
  await page.waitForFunction(() => !document.getElementById("kit-send").disabled, null, {timeout: 5000});
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => ({said: kitSaid.find(t => /^Kit sent|^The kit wasn't sent/.test(t)), seq: fake.seq,
    open: fake.open, stored: fake.stored && Array.from(fake.stored), milestones: kitMilestones.slice(), barTexts: kitBarTexts}));
  r.ok = /^Kit sent/.test(r.said);
  r.kit = r.seq.filter(e => "kit" in e);
  r.ops = r.kit.map(e => e.kit);
  console.log(`     ${label}: ${r.said} (${Date.now() - t0} ms)`);
  return r;
}
const isSetting = (e, address, value) => e.other && e.other.length === 6 && e.other[1] + 128 * e.other[2] === address
  && (value === undefined || e.other[3] + 128 * e.other[4] === value);

(async () => {
  const sounds = makeSounds();
  if (!haveSox) console.log("     no sox: the hat and the clap are WAVs, not FLAC and Ogg");
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"]});
  const context = await browser.newContext({acceptDownloads: true});
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "requestMIDIAccess", {value: () => Promise.reject(new Error("no MIDI in the test")), configurable: true});
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/MIDI init failed|no MIDI in the test|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  let dialogs = 0;
  page.on("dialog", d => { dialogs++; d.accept(); });
  // the advanced manual isn't served here (controls.js asks whether it is): any other miss is an error
  page.on("response", r => { if (r.status() >= 400 && !/\/manual\//.test(r.url())) errors.push(r.status() + " " + r.url()); });
  await page.goto(url, {waitUntil: "load"});
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.getElementById("rhythm-sheet").showPopover(); document.getElementById("user-kit").closest("details").open = true; });

  check(await page.locator("#user-kit").count() === 1, "the kit block is on the page");
  check(await page.$eval("#kit-base", s => s.options.length === 12 && s.value === "4" && s.selectedOptions[0].textContent === "studio"), "base kit: 12 kits, studio chosen");
  check(await page.$eval("#param-337", s => s.querySelectorAll('option[value="13"]').length === 1 && s.options.length === 14
    && s.querySelector('option[value="13"]').textContent === "your own"), "drum kit has one option 13, your own, from parameters.json");
  check(await page.$eval("#kit-info", e => /No minichord connected/.test(e.textContent)), "says no minichord is connected");

  // a folder in
  await page.setInputFiles("#kit-folder", sounds.dir);
  await page.waitForSelector("#kit-voices .kit-voice");
  await page.waitForFunction(() => /kB/.test(document.getElementById("kit-meter-text").textContent), null, {timeout: 10000});
  const rows = await page.$$eval("#kit-voices .kit-voice", rs => rs.map(r => [r.querySelector(".kit-voice-name").textContent,
    r.querySelector(".kit-pick").selectedOptions[0].textContent, r.querySelector(".kit-tag").textContent]));
  console.log(rows.map(r => "     " + r.join(" | ")).join("\n"));
  const pick = name => rows.find(r => r[0] === name)[1];
  const starts = (name, file) => pick(name).startsWith(file);
  check(starts("kick", "Kick 01.wav") && starts("snare", "Snare.aif") && starts("hat", sounds.hat) && starts("open hat", "Open Hat.wav")
    && starts("cymbal", "Ride.wav") && starts("low tom", "low.wav") && starts("high tom", "hi.wav") && starts("clap", sounds.clap),
  "the folder mapped by name and folder");
  check(/^synth: studio rim/.test(pick("rim")), "an empty voice reads synth: <base kit's voice>");
  check(await page.$eval("#kit-name", e => e.value) === "MyKit", "the kit named after the folder");
  check(/licence from MyKit\/LICENSE\.txt/.test(await page.$eval("#kit-licence-note", e => e.textContent)), "the licence found in the folder");
  const errorsShown = await page.$$eval(".kit-row-error", es => es.map(e => e.textContent).filter(Boolean));
  check(errorsShown.length === 1 && /^Shaker\.wav: .*the synth voice plays instead/.test(errorsShown[0]),
    "every file decoded (the AIFF by kit-formats/aiff.js) but the broken shaker, which says so: " + errorsShown.join("; "));
  console.log("     meter: " + await page.$eval("#kit-meter-text", e => e.textContent));
  await page.click('.kit-voice[data-voice="0"] .kit-play[data-processed="1"]');
  await page.click('.kit-voice[data-voice="1"] .kit-play[data-processed="0"]');
  // the choke and bends defaults
  check(await page.$eval('.kit-voice[data-voice="4"] .kit-choke', s => s.value) === "1" && await page.$eval('.kit-voice[data-voice="5"] .kit-choke', s => s.value) === "1"
    && !await page.$eval('.kit-voice[data-voice="4"] .kit-bends', b => b.checked) && await page.$eval('.kit-voice[data-voice="0"] .kit-bends', b => b.checked),
  "hats in choke 1, the skins bend");
  // swap the toms and back
  await page.click('.kit-voice[data-voice="7"] .kit-swap');
  check(/^hi\.wav/.test(await page.$eval('.kit-voice[data-voice="7"] .kit-pick', s => s.selectedOptions[0].textContent)), "swap trades the toms");
  await page.click('.kit-voice[data-voice="7"] .kit-swap');
  await page.waitForTimeout(300);

  // a .mckit saved
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#kit-save")]);
  const saved = new Uint8Array(fs.readFileSync(await download.path()));
  const mck = kits.readMckit(saved);
  check(download.suggestedFilename() === "MyKit.mckit", "saved as MyKit.mckit");
  check(kits.checkImage(mck.image) === 0, "the saved .mckit's image passes its checks");
  check(mck.meta.licence.startsWith("CC0") && mck.meta.sources[0] === "Kick 01.wav" && mck.meta.sources[2] === null && mck.meta.name === "MyKit",
    "the .mckit's meta: licence, sources, name");
  const h = kits.readHeader(mck.image);
  check(mck.meta.sources[9] === "Conga Low.wav" && mck.meta.sources[11] === "Conga Low.wav" && h.entries[11].offset === h.entries[9].offset
    && h.entries[11].length === h.entries[9].length, "a hit the same as an earlier voice's: shared in the image, the earlier voice's name in sources");
  check(mck.meta.sources[12] === null && h.entries[12].length === 0 && mck.meta.sources[10] === null,
    "sources by the image's voices: null for the shaker that wouldn't decode, as for a voice with no file");
  check(h.base_kit === 4 && h.entries[0].rate === 22050 && h.entries[0].level === 160 && h.entries[4].choke === 1 && h.entries[0].flags === 2
    && h.entries[4].flags === 0 && h.entries[0].length <= Math.round(0.4 * 22050) && h.entries[2].length === 0, "the image's entries as the rows have them");
  const myKit = path.join(OUT, "MyKit.mckit");
  fs.writeFileSync(myKit, saved);
  const pieces = Math.ceil(mck.image.length / kits.PIECE);

  // ---- the fake minichord ----
  await page.evaluate(installFake);
  await page.evaluate(() => controller.requestKitInfo());
  await page.waitForTimeout(200);
  check(/No kit is stored on the minichord/.test(await page.$eval("#kit-info", e => e.textContent)), "INFO asked: no kit yet");

  // the fake itself, to the contract, its replies kept from the page
  const own = await page.evaluate(async () => {
    const k = window.userKit;
    fake.deliver = false;
    const last = () => Uint8Array.from(fake.replies[fake.replies.length - 1]);
    const out = {};
    // an image with a data_base in its header (and its header CRC to match): refused at COMMIT with 10
    const small = k.buildImage({base_kit: 4, name: "x", voices: [{samples: Int16Array.from({length: 40}, (_, i) => i * 100)}, ...Array(12).fill(null)]});
    const moved = small.slice();
    const view = new DataView(moved.buffer);
    view.setUint32(8, 0x601A0000, true);
    view.setUint32(252, k.crc32(moved, 0, 252), true);
    for (const m of k.frames(moved)) controller.device.send(m);
    out.dataBase = k.parseReply(last());
    out.dataBaseLeft = {open: fake.open, stored: !!fake.stored};
    // a reply's shape (0x40 and up) gets no reply; an op it doesn't know gets status 3
    let n = fake.replies.length;
    controller.device.send([0xF0, 0x7D, 0x6B, 0x42, 0, 0, 0, 0, 0xF7]);
    controller.device.send([0xF0, 0x7D, 0x6B, 0x45, 1, 0, 0xF7]);
    out.replyShapes = fake.replies.length - n;
    controller.device.send([0xF0, 0x7D, 0x6B, 0x07, 0, 0, 0xF7]);
    out.unknown = k.parseReply(last());
    // INFO doesn't hold an upload open: asked every 0.4 s, the upload still ends after 5 s of silence
    controller.device.send(k.beginMessage(small.length, k.crc32(small)));
    out.opened = fake.open;
    const t0 = performance.now();
    while (fake.open && performance.now() - t0 < 7000) {
      controller.device.send(k.infoMessage());
      await new Promise(r => setTimeout(r, 400));
    }
    out.silentAfter = Math.round(performance.now() - t0);
    out.stillOpen = fake.open;
    fake.replies = [];
    fake.deliver = true;
    return out;
  });
  check(own.dataBase && own.dataBase.op === 3 && own.dataBase.status === 10 && !own.dataBaseLeft.open && !own.dataBaseLeft.stored,
    "the fake: COMMIT refuses an image whose data_base isn't 0 with 10, and keeps no kit");
  check(own.replyShapes === 0 && own.unknown && own.unknown.op === 7 && own.unknown.status === 3,
    "the fake: ops 0x40 and up get no reply, an unknown op status 3");
  check(own.opened && !own.stillOpen && own.silentAfter >= 5000 && own.silentAfter < 6000,
    `the fake: INFO asked every 0.4 s doesn't hold an upload open (ended after ${own.silentAfter} ms)`);
  await page.waitForTimeout(100);

  // ---- uploads ----
  // The rhythm and the looper running, so BEGIN is busy; a piece's reply lost; a piece damaged (7) and
  // one bad in length (3), each answered so once; two settings sent while it runs
  const mid = page.waitForTimeout(400).then(() => page.evaluate(() => { controller.sendParameter(338, 50); controller.sendParameter(338, 60); }));
  let r = await upload(page, "busy, one reply lost, two pieces damaged, settings mid-upload", () => {
    fake.rhythm = true; fake.looper = true;
    fake.dropReplyAt = 224 * 5;
    fake.damage = {[224 * 8]: [7], [224 * 9]: [3]};
  });
  await mid;
  check(r.ok && r.stored && Buffer.from(r.stored).equals(Buffer.from(mck.image)), "the fake kept the kit, the image the .mckit saved");
  const begins = r.seq.map((e, i) => e.kit === 1 ? i : -1).filter(i => i >= 0);
  const stops = [r.seq.findIndex(e => isSetting(e, 0, 8)), r.seq.findIndex(e => isSetting(e, 256, 3))];
  check(begins.length === 2 && stops.every(i => i > begins[0] && i < begins[1]) && !r.seq[stops[0]].open,
    "BEGIN busy: the rhythm and the looper stopped, then BEGIN once more");
  const data = r.kit.filter(e => e.kit === 2);
  check(data.length === pieces + 3 && data.filter(e => e.offset === 224 * 5).length === 2 && data.filter(e => e.offset === 224 * 8).length === 2
    && data.filter(e => e.offset === 224 * 9).length === 2, `the lost reply's piece and the two damaged ones sent again (${data.length} DATA for ${pieces} pieces)`);
  const commit = r.seq.findIndex(e => e.kit === 3);
  const held = r.seq.map((e, i) => isSetting(e, 338) ? i : -1).filter(i => i >= 0);
  check(held.length === 2 && held.every(i => i > commit && !r.seq[i].open) && isSetting(r.seq[held[0]], 338, 50) && isSetting(r.seq[held[1]], 338, 60),
    "the settings sent mid-upload were held, then sent in order once it was over");
  check(!r.seq.some(e => e.other && e.open), "nothing but the kit's messages went while the upload was open");
  const ownKit = r.seq.findIndex(e => isSetting(e, 337, 13));
  check(ownKit > held[1], "drum kit set to your own after the held settings");
  check(r.kit.every(e => e.len >= 7), "every kit message at least 7 bytes");
  check(JSON.stringify(r.milestones) === JSON.stringify(["Sending the kit: don't unplug the minichord.", "25% of the kit sent.",
    "50% of the kit sent.", "75% of the kit sent.", "All sent: writing the kit. Don't unplug the minichord."]) && r.barTexts > 20,
  `the live region says the start, each 25% and the writing, not each piece (${r.milestones.length} said, the bar's text ${r.barTexts} times)`);
  const dump = r.seq.findIndex(e => isSetting(e, 0, 0));
  check(dump > commit && dump > ownKit, "the rhythm and the looper stopped: a dump asked for once the upload is over, for the page's controls");
  check(await page.$eval("#param-337", s => s.value) === "13", "drum kit shows your own");
  check(await page.$eval('#param-337 option[value="13"]', o => o.textContent) === "your own: MyKit", "option 13 reads your own: MyKit");
  check(/On the minichord: MyKit/.test(await page.$eval("#kit-info", e => e.textContent)), "the info line names the kit");

  // the small kit for the rest
  const small = smallMckit();
  await page.setInputFiles("#kit-files", {name: "Small.mckit", mimeType: "application/octet-stream", buffer: Buffer.from(small.file)});
  await page.waitForFunction(() => /kB/.test(document.getElementById("kit-meter-text").textContent) && document.getElementById("kit-name").value === "Small");
  await page.waitForTimeout(200);

  // a double click on Send, then Send and Resend forced while the first is starting: one upload, one confirm
  await page.evaluate(() => { fake.seq = []; kitSaid.length = 0; fake.infoDelay = 600; });   // INFO slow, so it is still starting
  dialogs = 0;
  await page.dblclick("#kit-send");
  const forced = await page.evaluate(() => {
    const send = document.getElementById("kit-send"), resend = document.getElementById("kit-resend");
    const disabled = send.disabled;
    send.disabled = false;                 // past the disabled button, to the flag behind it
    send.click();
    const wasHidden = resend.hidden;
    resend.hidden = false;
    resend.click();
    resend.hidden = wasHidden;
    send.disabled = true;
    return {disabled};
  });
  await page.waitForFunction(() => kitSaid.some(t => /^Kit sent|^The kit wasn't sent/.test(t)), null, {timeout: 30000});
  await page.waitForFunction(() => !document.getElementById("kit-send").disabled, null, {timeout: 5000});
  await page.waitForTimeout(800);
  await page.evaluate(() => { fake.infoDelay = 3; });
  const twice = await page.evaluate(() => ({ops: fake.seq.filter(e => "kit" in e).map(e => e.kit), sent: kitSaid.filter(t => /^Kit sent/.test(t)).length}));
  check(forced.disabled && twice.ops.filter(o => o === 1).length === 1 && twice.ops.filter(o => o === 3).length === 1
    && twice.sent === 1 && dialogs === 1,
  `a double click on Send, and Send and Resend clicked while it starts: Send disabled, one confirm (${dialogs}), one BEGIN and one COMMIT (${twice.ops.join(" ")}), ${twice.sent} sent`);

  r = await upload(page, "BEGIN's reply lost", () => { fake.loseBeginReply = true; });
  const b = r.kit.findIndex(e => e.kit === 1);
  check(!r.ok && r.ops[b + 1] === 4 && !r.ops.includes(2) && r.kit[b + 1].at - r.kit[b].at >= 2900 && !r.open,
    "BEGIN unanswered for 3 s: ABORT sent, nothing more, and the upload the fake had opened is over");

  r = await upload(page, "COMMIT's replies lost, the kit kept", () => { fake.loseCommitReply = true; });
  const c = r.kit.findIndex(e => e.kit === 3);
  check(r.ok && r.ops[c + 1] === 5 && !r.ops.includes(4) && r.stored && Buffer.from(r.stored).equals(Buffer.from(small.image)),
    "COMMIT unanswered: INFO says valid with the same size and CRC, so the kit landed");

  r = await upload(page, "COMMIT lost", () => { fake.loseCommit = true; });
  const lost = r.seq.findIndex(e => e.lost === 3);
  const after = r.seq.slice(lost + 1).filter(e => "kit" in e).map(e => e.kit);
  check(!r.ok && lost >= 0 && after[0] === 5 && after[1] === 4 && !r.open && !r.stored && /never reached/.test(r.said),
    "COMMIT lost: INFO says receiving, so ABORT, and no kit");

  r = await upload(page, "COMMIT answered 3", () => { fake.commitStatus = 3; });
  const c3 = r.kit.findIndex(e => e.kit === 3);
  check(!r.ok && r.ops[c3 + 1] === 4 && !r.open && !r.stored, "COMMIT answered 3 (the upload left open): ABORT, and no kit");

  r = await upload(page, "COMMIT lost and INFO unanswered", () => { fake.loseCommit = true; fake.loseCommitInfo = true; });
  const lost2 = r.seq.findIndex(e => e.lost === 3);
  const after2 = r.seq.slice(lost2 + 1).filter(e => "kit" in e).map(e => e.kit);
  check(!r.ok && after2[0] === 5 && after2[1] === 4 && !r.open && /nor INFO after it/.test(r.said),
    "neither COMMIT nor INFO answered: ABORT, as the upload may be open");

  r = await upload(page, "another app begins while the confirm is open", () => { fake.openAfterInfo = true; });
  check(!r.ok && /another app began sending a kit/.test(r.said) && r.ops.filter(o => o === 1).length === 1 && !r.ops.includes(4)
    && !r.seq.some(e => isSetting(e, 0, 8) || isSetting(e, 256, 3)) && r.open,
  "BEGIN busy and INFO says receiving: another app's, so no stops, no ABORT and no second BEGIN");
  await page.evaluate(() => { fake.open = false; fake.buf = null; });
  await page.waitForTimeout(1100);

  r = await upload(page, "a piece damaged three times", () => { fake.damage = {[224 * 2]: [7, 3, 7]}; });
  check(!r.ok && r.kit.filter(e => e.offset === 224 * 2).length === 3 && r.ops[r.ops.length - 2] === 4 && !r.ops.includes(3) && !r.open,
    "a piece answered 7, 3, 7: three tries, then ABORT");

  r = await upload(page, "a piece out of order (6)", () => { fake.refuseAt = {[224 * 3]: 6}; });
  check(!r.ok && r.kit.filter(e => e.offset === 224 * 3).length === 1 && r.ops.includes(4) && !r.open, "a piece answered 6: ABORT, not tried again");

  for (const s of [8, 5]) {
    r = await upload(page, `a piece answered ${s}`, status => { fake.refuseAt = {[224 * 3]: status}; }, s);
    check(!r.ok && !r.ops.includes(4) && !r.open, `a piece answered ${s}: no ABORT, as the minichord has ended the upload itself`);
  }

  // a DATA reply just after this page's own upload ended is a late answer to its last piece, not another app
  await page.evaluate(() => { kitSaid.length = 0; controller.processCurrentData({data: Uint8Array.from([0xF0, 0x7D, 0x6B, 0x42, 0, 0, 2, 0, 0xF7])}); });
  check(await page.evaluate(() => !controller.kitPaused && !kitSaid.some(t => /Another app/.test(t))),
    "a DATA reply within a second of its own upload's end: not taken for another app's");
  await page.waitForTimeout(1100);

  // another app's upload: a reply nobody here asked for pauses minicontrol, and what it sends meanwhile waits
  await page.evaluate(() => { fake.seq = []; controller.processCurrentData({data: Uint8Array.from([0xF0, 0x7D, 0x6B, 0x42, 0, 0, 2, 0, 0xF7])}); });
  check(/Another app is sending a kit/.test(await page.$eval("#kit-status", e => e.textContent)) && await page.evaluate(() => !!controller.kitPaused),
    "another app's DATA reply pauses minicontrol");
  check(await page.evaluate(() => !deviceReady()), "buttons that talk to the minichord wait meanwhile");
  await page.evaluate(() => controller.sendParameter(338, 70));
  check(!(await page.evaluate(() => fake.seq)).some(e => isSetting(e, 338, 70)), "a setting changed meanwhile waits");
  await page.evaluate(() => controller.processCurrentData({data: Uint8Array.from([0xF0, 0x7D, 0x6B, 0x43, 0, 0, 0, 0, 0xF7])}));
  check(await page.evaluate(() => !controller.kitPaused), "its COMMIT reply ends the pause");
  check((await page.evaluate(() => fake.seq)).some(e => isSetting(e, 338, 70)), "and the setting goes then");
  await page.evaluate(() => { fake.seq = []; controller.processCurrentData({data: Uint8Array.from([0xF0, 0x7D, 0x6B, 0x42, 0, 0, 4, 0, 0xF7])}); });
  await page.evaluate(() => controller.sendParameter(338, 71));
  await page.waitForTimeout(5500);
  check(await page.evaluate(() => !!controller.kitPaused), "another app's upload: still paused after 5.5 s");
  await page.waitForTimeout(800);
  check(await page.evaluate(() => !controller.kitPaused) && (await page.evaluate(() => fake.seq)).some(e => isSetting(e, 338, 71)),
    "6 s with nothing of it heard ends the pause, and the setting goes then");

  // the kit gone: send your last kit again is offered
  await page.evaluate(() => { fake.stored = null; controller.requestKitInfo(); });
  await page.waitForTimeout(200);
  check(await page.$eval("#kit-resend", b => !b.hidden), "no kit on the minichord: send your last kit again is offered");
  check(await page.$eval('#param-337 option[value="13"]', o => o.textContent) === "your own: none on this minichord", "option 13 says none is there");
  // a dump with 337 = 13 while there's no kit
  await page.evaluate(() => { currentValues[337] = 13; currentBankNumber = 3; controller.requestKitInfo(); });
  await page.waitForTimeout(200);
  check(/none is on this minichord: it plays the studio kit/.test(await page.$eval("#kit-status", e => e.textContent)),
    "warned: this uses your own kit, none is on this minichord, and it plays the studio kit");
  // the .mckit back in
  await page.setInputFiles("#kit-files", myKit);
  await page.waitForTimeout(300);
  const tags = await page.$$eval("#kit-voices .kit-tag", ts => ts.map(t => t.textContent));
  check(tags[0] === "from the .mckit" && tags[2] === "", "a .mckit read back into the rows");
  await page.waitForTimeout(300);
  const [again] = await Promise.all([page.waitForEvent("download"), page.click("#kit-save")]);
  check(Buffer.from(kits.readMckit(new Uint8Array(fs.readFileSync(await again.path()))).image).equals(Buffer.from(mck.image)), "and saved again, the same image");
  // swap moves a .mckit's level and pan with the sound; sources follow the voices
  const tone = (f, n) => Int16Array.from({length: n}, (_, i) => Math.round(9000 * Math.sin(i / f) * Math.exp(-i / 500)));
  const tv = Array(13).fill(null);
  tv[7] = {samples: tone(9, 1500), rate: 22050, level: 120, pan: -50, choke: 0, flags: 2, pitch: 0};
  tv[8] = {samples: tone(5, 1200), rate: 22050, level: 200, pan: 50, choke: 0, flags: 2, pitch: 0};
  tv[9] = {samples: tone(9, 1500), rate: 22050, level: 160, pan: 0, choke: 0, flags: 2, pitch: 0};
  const toms = kits.buildImage({base_kit: 4, name: "Toms", voices: tv});
  const tomsFile = kits.writeMckit({name: "Toms", author: "", licence: "CC0", made: "2026-10-23",
    sources: [...Array(7).fill(null), "lo.wav", "hi.wav", "lo.wav", null, null, null]}, toms);
  await page.setInputFiles("#kit-files", {name: "Toms.mckit", mimeType: "application/octet-stream", buffer: Buffer.from(tomsFile)});
  await page.waitForFunction(() => document.getElementById("kit-name").value === "Toms");
  await page.click('.kit-voice[data-voice="7"] .kit-swap');
  await page.waitForTimeout(300);
  const [swapped] = await Promise.all([page.waitForEvent("download"), page.click("#kit-save")]);
  const sw = kits.readMckit(new Uint8Array(fs.readFileSync(await swapped.path())));
  const swe = kits.readHeader(sw.image).entries, swv = kits.imageVoices(sw.image);
  check(swe[7].level === 200 && swe[7].pan === 50 && swe[8].level === 120 && swe[8].pan === -50
    && Buffer.from(swv[7].samples.buffer).equals(Buffer.from(tv[8].samples.buffer)) && Buffer.from(swv[8].samples.buffer).equals(Buffer.from(tv[7].samples.buffer)),
  "swap trades the toms' sounds with their level and pan");
  check(sw.meta.sources[7] === "hi.wav" && sw.meta.sources[8] === "lo.wav" && sw.meta.sources[9] === "lo.wav" && swe[9].offset === swe[8].offset,
    "the swapped kit's sources by its voices, the shared hit under the earlier voice's name");

  // a whole sample library: each list and the bin show 300 at most, say how many they left out, and
  // the find box finds the rest
  // names with no drum word and no GM number in them (001b is stuck to a letter)
  const many = Array.from({length: 400}, (_, i) => ({name: `take ${String(i + 1).padStart(3, "0")}b.wav`, mimeType: "audio/wav",
    buffer: wav([hit(0.01, 22050, 300, 0, 50)], 22050)}));
  await page.setInputFiles("#kit-files", many);
  await page.waitForFunction(() => document.querySelectorAll("#kit-unused .kit-chip").length > 0);
  const big = await page.evaluate(() => ({
    options: document.querySelector('.kit-voice[data-voice="0"] .kit-pick').options.length,
    more: document.querySelector('.kit-voice[data-voice="0"] .kit-pick option[disabled]')?.textContent,
    chips: document.querySelectorAll("#kit-unused .kit-chip").length,
    binMore: document.querySelector("#kit-unused .kit-unused-more")?.textContent,
    box: !document.getElementById("kit-filter-box").hidden}));
  check(big.options === 302 && /^100 more not shown/.test(big.more || "") && big.chips === 300 && /^100 more not shown/.test(big.binMore || "") && big.box,
    `400 files: 300 in each list and the bin, 100 said to be left out, the find box shown (${JSON.stringify(big)})`);
  await page.fill("#kit-filter", "take 39");
  await page.waitForTimeout(400);
  check(await page.$$eval("#kit-unused .kit-chip", cs => cs.length === 10 && cs.every(c => /^take 39\db/.test(c.textContent))),
    "the find box narrows the bin to the files that match");
  // a new set of files empties the find box, and a .mckit read too
  await page.setInputFiles("#kit-files", many);
  await page.waitForTimeout(400);
  check(await page.$eval("#kit-filter", i => i.value === "") && await page.$$eval("#kit-unused .kit-chip", cs => cs.length === 300),
    "files read again: the find box emptied, every file listed again");
  await page.fill("#kit-filter", "take 1");
  await page.setInputFiles("#kit-files", {name: "Small.mckit", mimeType: "application/octet-stream", buffer: Buffer.from(small.file)});
  await page.waitForFunction(() => document.getElementById("kit-name").value === "Small");
  check(await page.$eval("#kit-filter", i => i.value === ""), "a .mckit read: the find box emptied");

  // a zip dropped
  await page.setInputFiles("#kit-files", {name: "kit.zip", mimeType: "application/zip", buffer: Buffer.from("PK")});
  check(/coming later/.test(await page.$eval("#kit-status", e => e.textContent)), "a zip: coming later");
  // a phone's width
  await page.setViewportSize({width: 375, height: 800});
  await page.setInputFiles("#kit-folder", sounds.dir);
  await page.waitForTimeout(500);
  // what sticks out, if anything does
  const wide = await page.$eval("#user-kit", e => {
    const right = e.getBoundingClientRect().right;
    return [...e.querySelectorAll("*")].filter(x => x.getBoundingClientRect().right > right + 1)
      .map(x => `${x.tagName.toLowerCase()}.${x.className} ${Math.round(x.getBoundingClientRect().right - right)} px`).slice(0, 5);
  });
  check(await page.$eval("#user-kit", e => e.scrollWidth <= e.clientWidth + 1), "the block fits a phone's width" + (wide.length ? ": " + wide.join(", ") : ""));
  check(await page.$eval("#kit-progress-box", e => getComputedStyle(e).display === "none"), "the progress bar hidden when no upload runs");
  check(await page.evaluate(() => document.getElementById("kit-progress").getAttribute("aria-labelledby") === "kit-progress-text"
    && !document.getElementById("kit-progress-text").hasAttribute("aria-live")
    && document.getElementById("kit-progress-said").getAttribute("aria-live") === "polite"
    && [...document.querySelectorAll(".kit-play")].every(b => b.querySelector('span[aria-hidden="true"]')?.textContent === "▶")
    && document.getElementById("kit-filter-box").hidden), "the progress named and spoken, the play glyphs hidden from screen readers");
  await page.focus("#kit-files");
  check(await page.$eval("#kit-files", i => getComputedStyle(i.closest(".kit-pick-btn")).outlineStyle === "solid"), "a focus ring on the sound files button");
  await page.locator("#user-kit").scrollIntoViewIfNeeded().catch(() => {});
  await page.locator("#user-kit").screenshot({path: path.join(OUT, "kit-phone.png")}).catch(e => console.log("     no screenshot: " + e.message));
  await page.setViewportSize({width: 1100, height: 900});
  await page.waitForTimeout(200);
  await page.locator("#user-kit").screenshot({path: path.join(OUT, "kit-desktop.png")}).catch(e => console.log("     no screenshot: " + e.message));

  check(errors.length === 0, "no console errors" + (errors.length ? ":\n" + errors.join("\n") : ""));
  await browser.close();
  server.close();
  console.log(`     sounds, kit and screenshots in ${OUT}`);
  console.log(failures ? `${failures} failed` : "all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
