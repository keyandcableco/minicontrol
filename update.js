//-->>UPDATE: THE FIRMWARE, INSTALLED FROM THIS PAGE
// The firmware sheet (#firmware-sheet, laid out by generate.py): the newest advanced firmware, Ben's
// classic firmware or a .hex file from the computer, written to the minichord in its update mode (the
// Teensy's HalfKay bootloader) over WebHID by flash.js. The player backs up the banks, sends the
// minichord into update mode and installs, in as few clicks as this minichord, computer and browser allow:
//
//   firmware 115 on: one click sends the restart command and opens Chrome's device box, which fills in
//     when the minichord appears in update mode a moment later;
//   older firmware on macOS, Windows and ChromeOS: Web Serial's 134 baud restarts it, in a click of its
//     own, then a second click opens the box. Not on Linux, where the 134 sticks to the serial port and
//     would throw the new firmware straight back into update mode the next time the port is opened;
//   there, when that fails, or by choice: the box opens and the player presses the program button
//     through the hole in the back with a pin;
//   no minichord answering: it may be waiting in update mode already, so finish an update, or leave it.
//
// Chrome opens a device box only inside a click, one box a click, so the backup, which takes seconds, is
// a click of its own before them. Nothing is fetched until the sheet opens: the release from GitHub's
// API, then its firmware.hex from raw.githubusercontent.com at the release's tag, checked against the
// release's size and sha256, and every image is checked by flash.js before the minichord is asked for
// anything. While an update runs, window.firmwareUpdating tells index.js the minichord going away is no
// fault. flash_browser_test.js runs it all in headless Chrome against a fake minichord, a fake update
// mode and a fake serial port.

(function () {
"use strict";
const flash = window.minichordFlash;
const $ = id => document.getElementById(id);
const sheet = $("firmware-sheet");
if (!flash || !sheet) return;

const RELEASE_API = "https://api.github.com/repos/keyandcableco/minichord/releases/latest";
const RELEASE_PAGE = "https://github.com/keyandcableco/minichord/releases/latest";
const RAW = "https://raw.githubusercontent.com/keyandcableco/minichord/";
const CLASSIC_HEX = "https://raw.githubusercontent.com/BenjaminPoilve/minichord/main/firmware/firmware.hex";
const BACKUP_FIRMWARE = 21;       // the first that loads a bank when asked: the backup button's version
const KIT_FIRMWARE = 113;         // the first with a kit slot (kits.js)
const BACK_WAIT = 30000;          // how long the minichord has to answer with its new firmware
const LEAVE_WAIT = 3000;          // and to go, once the serial port has asked it to restart
const KIT_WAIT = 1500;            // and to answer for its kit
const UPDATE_MODE = {vendorId: flash.HALFKAY.vendorId, productId: flash.HALFKAY.productId, usagePage: flash.HALFKAY.usagePage};
// update mode has no name of its own in Chrome's box (it isn't the minichord's program answering): it is
// listed by its USB ids, in Chrome's label for a device without a name (16C0:0478) or, on Linux, as the
// kernel names it (HID 16c0:0478). To check on a real update: whether HalfKay has a product string after all
const LISTED = "by number, 16C0:0478, not by name";
// the Teensy's button held for about 15 s wipes its whole flash (PJRC: "Memory Wipe"), firmware, banks and kit
const QUICK = "A quick press: held down for long, it wipes the minichord.";
const PIN_SAY = `Now press the little button through the hole in the back of the minichord with a pin. ${QUICK} ` +
  `Chrome's box lists it after a moment ${LISTED}: pick it and click Connect.`;

const blank = () => ({image: null, error: "", getting: null});
const fw = {
  release: null,          // the newest release: {tag, version, name, url, size, digest}
  looking: null,          // the lookup going on
  lookupFailed: false,
  sources: {newest: blank(), classic: blank(), file: blank()},
  fileName: "",
  pick: "newest",         // what to install: "newest", "classic", "file", or "" for nothing (it has the newest)
  picked: false,          // whether the player chose it, rather than this page
  pin: false,             // the pin chosen over a restart from here
  restarted: false,       // restarted into update mode over serial, for the install that follows
  way: "",                // the route taken at the click, held while Chrome's box is open
  from: null,             // the firmware the minichord last answered with, outside an update: whether its banks come through
  backup: null,           // the banks read before the update, to put back after (one update's: spent by the next)
  backupFile: "",
  restored: false,
  updated: false,         // an update done in this sheet
  late: false,            // written, and the minichord not back yet
  busy: "",               // "backup", "restart", "choose", "install", "restore" or "leave"
  device: null,           // the minichord in update mode, kept for try again
  failed: null,           // what an install that stopped partway was installing, for try again
  rule: false,            // PJRC's Linux rule shown
  kitBefore: null,        // the kit's INFO before the update
  forgetting: false,      // chained onto the controller's connection callback, to forget the two above on an unplug
  abort: null,
  wakeLock: null,
  done: 0,                // blocks written in the install going on
  watching: 0,
  seen: "",
};

// ---- the minichord, the computer, and what to install ----------------------------------------------
const answering = () => controller.isConnected() && controller.firmware_version != null;
const versionNow = () => Math.round((controller.firmware_version || 0) * 100);
const firmwareName = version => flash.isClassic(version) ? `Ben's classic firmware ${version}` : `firmware ${version}`;
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
const sentence = text => /[.?!…]$/.test(text) ? text : text + ".";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// the computer, from the browser: userAgentData where there is one, else the older platform and user agent
// (ChromeOS calls its platform Linux there, but says CrOS in the user agent)
function computer() {
  const said = navigator.userAgentData?.platform ||
    (/\bCrOS\b/.test(navigator.userAgent) ? "Chrome OS" : navigator.platform || navigator.userAgent || "");
  if (/chrome ?os|cros/i.test(said)) return "chromeos";
  if (/mac/i.test(said)) return "mac";
  if (/win/i.test(said)) return "windows";
  if (/android/i.test(said)) return "android";
  if (/linux|x11/i.test(said)) return "linux";
  return "other";
}

// how the minichord gets into update mode as things stand: "command" (firmware 115 on), "serial", "pin",
// "finish" (no minichord answering: it may be in update mode already), or "asking" (its first dump to come)
function route() {
  if (fw.restarted) return "serial";
  if (!controller.isConnected()) return "finish";
  if (controller.firmware_version == null) return "asking";
  if (fw.pin) return "pin";
  return restartFrom();
}
// the way to restart it without the pin, or "pin" where there is none
function restartFrom() {
  if (versionNow() >= flash.RESTART_FIRMWARE) return "command";
  if (navigator.serial && computer() !== "linux") return "serial";
  return "pin";
}

// banks come through only where the new firmware looks where the old kept them: not from 76 or older
// (112 on finds no store, main.cpp PRESET STORAGE), nor into Ben's classic firmware from the advanced
function resetsBanks(t) {
  if (!t || fw.from == null) return false;
  return t.which === "classic" ? !flash.isClassic(fw.from) : fw.from <= 76;
}

// what would be installed: its name in a sentence, its button, and its image once got and checked
function target() {
  const which = fw.pick;
  if (which === "newest") {
    const v = fw.release?.version;
    return {which, version: v, name: v ? `firmware ${v}` : "the newest firmware",
      button: v ? `install firmware ${v}` : "install the newest firmware", ...fw.sources.newest};
  }
  if (which === "classic") return {which, name: "Ben's classic firmware", button: "install Ben's classic firmware", ...fw.sources.classic};
  if (which === "file") return {which, name: fw.fileName ? `the firmware in ${fw.fileName}` : "the .hex file", button: "install the .hex file", ...fw.sources.file};
  return null;
}

// What to install when the player hasn't chosen: the newest, unless the minichord has it (or newer)
function choose() {
  if (fw.picked) return;
  const newest = fw.release?.version;
  fw.pick = answering() && newest && versionNow() >= newest ? "" : "newest";
}

// ---- the firmware, from GitHub or the computer ------------------------------------------------------
// The newest release: its tag names the firmware.hex to fetch, and its .hex asset gives the size and the
// sha256 that file must have (the same file, byte for byte)
function lookUp() {
  if (fw.release || fw.looking) return;
  fw.lookupFailed = false;
  fw.looking = (async () => {
    try {
      const response = await fetch(RELEASE_API, {cache: "no-cache"});
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const r = await response.json();
      if (!/^[\w.-]+$/.test(r.tag_name || "")) throw new Error("the release has no tag");
      const asset = (r.assets || []).find(a => /\.hex$/i.test(a.name || ""));
      const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest || "");
      fw.release = {
        tag: r.tag_name,
        version: flash.versionFromTag(r.tag_name),
        name: String(r.name || r.tag_name),
        url: /^https:\/\/github\.com\//.test(r.html_url || "") ? r.html_url : RELEASE_PAGE,
        size: Number.isInteger(asset?.size) ? asset.size : null,
        digest: digest ? digest[1].toLowerCase() : null,
      };
    } catch (e) {
      console.warn("[update] the newest release:", e);
      fw.lookupFailed = true;
    } finally {
      fw.looking = null;
      choose();
      want();
      paint();
    }
  })();
  paint();
}

// a hex read and checked: flash.js says in plain words what is wrong with one that isn't a minichord's
function checkedImage(text) {
  const image = flash.parseHex(text);
  image.checked = flash.checkImage(image);
  return image;
}

// The firmware to install, fetched once and checked before anything is asked of the minichord
function getImage(which) {
  const source = fw.sources[which];
  if (which === "file" || source.image || source.getting || source.error) return;
  const release = fw.release;
  if (which === "newest" && !release) return;
  const name = which === "classic" ? "Ben's classic firmware" : `firmware ${release.version ?? release.tag}`;
  const url = which === "classic" ? CLASSIC_HEX : `${RAW}${release.tag}/firmware/firmware.hex`;
  source.getting = (async () => {
    try {
      let bytes;
      try {
        const response = await fetch(url, {cache: "no-cache"});
        if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (e) {
        console.warn(`[update] getting ${name}:`, e);
        throw new Error(`Couldn't get ${name} from GitHub: check the connection, then try again.`);
      }
      if (which === "newest" && ((release.size != null && bytes.length !== release.size) ||
          (release.digest && await flash.sha256(bytes) !== release.digest))) {
        console.warn(`[update] ${url}: ${bytes.length} bytes, the release says ${release.size} and sha256 ${release.digest}`);
        throw new Error(`The file GitHub sent for ${name} doesn't match the release, so it won't be installed: try again in a few minutes.`);
      }
      try {
        source.image = checkedImage(new TextDecoder().decode(bytes));
      } catch (e) {
        console.warn(`[update] ${name}:`, e.detail || e);
        // flash.js's word for a damaged file is for one picked from the computer: this one is fetched again
        throw new Error(e.code === "hex" ? `${capital(name)} came from GitHub damaged or cut short, so it won't be installed: click try again.`
          : `${capital(name)} from GitHub can't be installed. ${sentence(e.message)}`);
      }
    } catch (e) {
      source.error = e.message;
    } finally {
      source.getting = null;
      paint();
    }
  })();
  paint();
}

// the firmware chosen, got as soon as it is chosen
function want() {
  if (fw.pick === "newest" || fw.pick === "classic") getImage(fw.pick);
}

// a .hex from the computer, checked the moment it is chosen. Only the newest pick's read counts: a slow
// one (a file still coming from a cloud drive) finishing after a later pick is dropped, image or error.
let fileRead = 0;
function readFile(file) {
  const source = fw.sources.file, read = ++fileRead;
  fw.fileName = file.name;
  fw.pick = "file";
  fw.picked = true;
  source.image = null;
  source.error = "";
  source.getting = (async () => {
    try {
      const image = checkedImage(await file.text());
      if (read === fileRead) source.image = image;
    } catch (e) {
      if (read !== fileRead) return;      // another file chosen since: this one's error isn't its
      console.warn(`[update] ${file.name}:`, e.detail || e);
      source.error = e instanceof flash.FlashError ? sentence(e.message) : `That file couldn't be read: ${e.message}.`;
    } finally {
      if (read === fileRead) { source.getting = null; paint(); }
    }
  })();
  paint();
}

// ---- what the sheet says ----------------------------------------------------------------------------
function say(text, type, short) {
  const status = $("fw-status");
  status.textContent = text || "";
  status.classList.toggle("fw-bad", type === "error");
  status.classList.toggle("fw-good", type === "success");
  if (type && text && typeof showNotification === "function") showNotification(short || text, type);
}

// The bar and its text; a screen reader hears only the milestones (fw-progress-said, the live region):
// the start, each 25% (of the firmware written, or `done` for the banks put back), and the restart at the
// end. The end itself is fw-status's to say.
let saidMilestone = -1;
function progress(fraction, text, done = "of the firmware written") {
  const bar = $("fw-progress"), label = $("fw-progress-text"), box = $("fw-progress-box"), said = $("fw-progress-said");
  box.hidden = fraction == null;
  if (fraction != null) bar.value = fraction;
  if (label.textContent !== (text || "")) label.textContent = text || "";
  if (fraction == null) { saidMilestone = -1; said.textContent = ""; return; }
  const milestone = Math.floor(4 * fraction + 1e-9);      // 0 the start, 1 to 3 each quarter, 4 all written
  if (milestone <= saidMilestone) return;
  saidMilestone = milestone;
  said.textContent = milestone === 0 ? text : milestone === 4 ? "All written: the minichord is restarting." : `${25 * milestone}% ${done}.`;
}

// the release's name less the "minichord advanced firmware 114: " that the sentence says already
function releaseTitle(release) {
  return release.name.replace(/^minichord\s+(advanced\s+)?firmware\s+\d+\s*[:–-]\s*/i, "") || release.name;
}

function paint() {
  const hid = !!navigator.hid;
  $("fw-unsupported").hidden = hid;
  $("fw-main").hidden = !hid;
  paintHint();
  if (!hid) return;
  paintNow();
  paintOther();
  paintSteps();
  paintAfter();
}

// what this minichord has and what is the newest, kept as they were while it is away being updated
function paintNow() {
  if (fw.busy && fw.busy !== "backup" && fw.busy !== "restore") return;
  const connected = controller.isConnected(), known = answering(), v = versionNow(), r = fw.release;
  $("fw-now").textContent = !connected
    ? (fw.restarted ? "The minichord is in update mode, ready for its new firmware."
      : fw.failed ? "The minichord is waiting in update mode."
      : "No minichord is answering: plug it in with a USB cable, and if Chrome asks to use MIDI devices, allow it.")
    : !known ? "Asking the minichord which firmware it has…" : `This minichord has ${firmwareName(v)}.`;
  const newest = $("fw-newest");
  newest.replaceChildren();
  if (fw.looking) newest.textContent = "Looking up the newest firmware…";
  else if (!r) newest.textContent = fw.lookupFailed ? "Couldn't reach GitHub to find the newest firmware: check the connection, then try again." : "";
  else {
    const link = document.createElement("a");
    link.href = r.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = releaseTitle(r);
    if (known && r.version && v === r.version) {
      newest.append("That's the newest: ", link, ". To install it again, or other firmware, choose it under other firmware.");
    } else if (known && r.version && v > r.version) {
      newest.append(`That's newer than the newest release, firmware ${r.version}: `, link, ". To install that, or other firmware, choose it under other firmware.");
    } else {
      newest.append(r.version ? `Firmware ${r.version} is the newest: ` : "The newest firmware: ", link, ".");
      // a minichord on Ben's firmware is offered the fork's: said as everywhere else on the page (index.js)
      if (known && flash.isClassic(v)) {
        newest.append((" It's the advanced firmware, not Ben's classic firmware. " +
          (typeof TEST_FIRMWARE_CAVEAT === "string" ? TEST_FIRMWARE_CAVEAT : "")).trimEnd());
      }
    }
  }
  $("fw-lookup-row").hidden = !(fw.lookupFailed && !r && !fw.looking);
}

function paintOther() {
  const r = fw.release, running = !!fw.busy;
  $("fw-pick-newest").textContent = !r?.version ? "the newest firmware"
    : answering() && versionNow() === r.version ? `firmware ${r.version} again` : `firmware ${r.version}, the newest`;
  sheet.querySelectorAll('input[name="fw-pick"]').forEach(radio => {
    radio.checked = radio.value === fw.pick;
    radio.disabled = running;
  });
  $("fw-file").disabled = running;
  const source = fw.sources.file;
  $("fw-file-said").textContent = !fw.fileName ? ""
    : source.getting ? `Reading ${fw.fileName}…`
    : source.error ? source.error
    : source.image ? `Ready to install: ${fw.fileName}, ${(source.image.checked.length / 1048576).toFixed(1)} MB.` : "";
  $("fw-file-said").classList.toggle("fw-bad-text", !!source.error);
}

function paintSteps() {
  // the steps give way to the bar while it installs or puts the banks back; for the rest they stay, held.
  // While Chrome's box is open they stay as the click left them, though the minichord drops off MIDI as
  // it goes into update mode (the restart command, or the pin pressed): not the box for no minichord.
  const choosing = fw.busy === "choose", t = target(), way = choosing ? fw.way : route(),
    running = fw.busy === "install" || fw.busy === "restore";
  // the firmware chosen, being got or not to be had
  const get = $("fw-get");
  let getText = "", getFailed = false;
  if (t && t.which !== "file" && !fw.failed && !running) {
    if (t.getting) getText = `Getting ${t.name}…`;
    else if (t.error) { getText = t.error; getFailed = true; }
  }
  get.textContent = getText;
  get.classList.toggle("fw-bad-text", getFailed);
  $("fw-get-row").hidden = !getFailed;

  const steps = !!t && !running && !fw.failed && way !== "finish" && way !== "asking";
  $("fw-steps").hidden = !steps;
  $("fw-finish").hidden = !(t && !running && !fw.failed && way === "finish");
  const ready = !!t?.image && !fw.busy;

  // 1: the banks backed up, while there is a minichord to read them from. An update that puts them back
  // to the factory presets says so, and the backup is no longer optional where one can be made.
  const canBackUp = answering() && versionNow() >= BACKUP_FIRMWARE;
  const resets = resetsBanks(t);
  const wantBackup = canBackUp && (resets || $("fw-backup-check").checked);
  const backedUp = !!fw.backup && !fw.updated;    // one spent on the update done is for putting back only
  const backupDone = backedUp || !wantBackup;
  const away = !answering() && (fw.restarted || choosing);    // in update mode on purpose: the step stays, and the numbers with it
  $("fw-step-backup").hidden = !(answering() || backedUp || away);
  $("fw-step-backup").classList.toggle("fw-done", backedUp);
  if (fw.busy !== "backup") {
    const reset = "This update puts all twelve banks back to the factory presets";
    $("fw-backup-text").textContent = backedUp
      ? `Backed up all twelve banks: ${fw.backupFile} is in your downloads, and this page keeps them to put back after the update.`
      : away ? (resets ? `${reset}, and they weren't backed up.` : "Skipped: the banks weren't backed up.")
      : resets ? (canBackUp ? `${reset}. Back them up first and this page puts them back after: it reads all twelve into a file, in a few seconds.`
        : `${reset}, and this firmware can't send them to this page to keep: note down any you want before you install.`)
      : !canBackUp ? "This firmware can't send its banks to this page, so they can't be backed up from here."
      : "Banks usually come through an update as they were. A backup keeps them safe if they don't: it reads all twelve into a file, in a few seconds.";
  }
  $("fw-backup-box").hidden = !canBackUp || backedUp || resets;
  $("fw-backup-check").disabled = !!fw.busy;
  $("fw-backup-btn").hidden = !wantBackup || backedUp;
  $("fw-backup-btn").disabled = !!fw.busy;

  // what holds the next step back: the backup, then (over serial) the restart
  const waiting = way === "serial" && !fw.restarted;
  const backupFirst = resets ? "Back up the banks first." : "Back up the banks first, or untick the box above to go on without a backup.";

  // 2: into update mode over serial, where that is the way
  $("fw-step-restart").hidden = way !== "serial";
  $("fw-step-restart").classList.toggle("fw-done", fw.restarted);
  $("fw-restart-text").textContent = fw.restarted ? "Done: the minichord is in update mode, with its light off."
    : "The minichord restarts into update mode, ready for the new firmware. If Chrome asks which port to use, pick the one listed " +
      "(minichord, or USB Serial Device on Windows) and click Connect." +
      (backupDone ? "" : " " + backupFirst);
  $("fw-restart-btn").hidden = fw.restarted;
  $("fw-restart-btn").disabled = !!fw.busy || !backupDone || !t?.image;   // not into update mode with nothing to install

  // 3: install
  const install = $("fw-install-btn");
  install.textContent = t?.button || "install";
  install.disabled = !ready || !backupDone || waiting;
  let text = way === "command"
    ? "The minichord goes quiet and its light goes off: that's update mode, where it takes new firmware. Chrome opens a box for it, " +
      `and lists it there after a moment ${LISTED}: pick it and click Connect.`
    : way === "serial"
    ? `Chrome opens a box for the minichord in update mode, listed there ${LISTED}: pick it and click Connect.`
    : `Click install, then press the little button through the hole in the back of the minichord with a pin. ${QUICK} ` +
      `Chrome's box lists it after a moment ${LISTED}: pick it and click Connect.`;
  text += " Leave it plugged in till it's done, in under a minute.";
  if (waiting) text += " Restart it into update mode first.";
  else if (!backupDone) text += " " + backupFirst;
  if (t?.which === "file" && !fw.fileName) text += " Choose the .hex file under other firmware first.";
  if (!backedUp && typeof unsavedEdits !== "undefined" && unsavedEdits && typeof currentBankNumber !== "undefined") {
    text += ` The changes to bank ${currentBankNumber + 1} that aren't saved are lost when it restarts: save them to a bank first to keep them.`;
  }
  $("fw-install-text").textContent = text;
  $("fw-install-text").hidden = choosing;      // the status says what to do in the box then
  // the pin, or back from it, where a restart from here is possible
  const pin = $("fw-pin-btn");
  pin.hidden = !answering() || fw.restarted || restartFrom() === "pin";
  pin.textContent = fw.pin ? "restart it from here instead" : "use the pin instead";
  pin.disabled = !!fw.busy;

  // no minichord answering: finish an update, or leave update mode
  $("fw-finish-btn").disabled = !ready;
  $("fw-leave-btn").disabled = !!fw.busy;
  $("fw-finish-text").textContent = `Finish an update installs ${t?.name || "the firmware"} on it. Leave update mode starts it again with ` +
    "the firmware it had, for a minichord restarted into update mode by mistake. If it doesn't appear in Chrome's box, press the little " +
    "button through the hole in the back of the minichord with a pin.";
}

// what is offered after an install: try again, the banks put back, PJRC's rule
function paintAfter() {
  const again = $("fw-again-btn"), restore = $("fw-restore-btn");
  again.hidden = !fw.failed;
  again.disabled = !!fw.busy;
  restore.hidden = !(fw.updated && fw.backup && !fw.restored && answering());
  restore.disabled = !!fw.busy;
  $("fw-after-row").hidden = again.hidden && restore.hidden;
  $("fw-rule-box").hidden = !fw.rule;
  sheet.querySelectorAll(".fw-linux-only").forEach(e => { e.hidden = computer() !== "linux"; });
}

// the drawer's line: which firmware the minichord has, and the newest once looked up
function paintHint() {
  const hint = $("firmware-hint");
  if (!hint) return;
  const r = fw.release, v = versionNow();
  if (fw.busy === "install") hint.textContent = "The firmware is being installed: don't unplug the minichord.";
  else if (!answering()) hint.textContent = "The minichord's own program: plug it in to see which it has. The newest installs from here, over USB.";
  else {
    hint.textContent = `This minichord has ${firmwareName(v)}.` + (!r?.version ? ""
      : v === r.version ? " That's the newest." : v < r.version ? ` Firmware ${r.version} is the newest.` : "");
  }
}

// ---- backing up, into update mode, installing ---------------------------------------------------------
function updating(on) {
  window.firmwareUpdating = on;
}

async function backUp() {
  if (fw.busy || !deviceReady()) return;
  if (!okToDropEdits("Back up all banks? Reading them loads each bank in turn.")) return;
  fw.busy = "backup";
  bankState.busy = true;
  say("");
  paint();
  try {
    const data = await backupAllBanks((i, n) => {
      const text = `Backing up bank ${i + 1} of ${n}…`;
      showProgress(text);
      $("fw-backup-text").textContent = text;
    });
    fw.backupFile = "minichord-backup-" + data.created.slice(0, 10) + ".json";
    downloadJson(data, fw.backupFile);
    fw.backup = data;
    fw.restored = fw.updated = false;   // for the update to come
    forgetOnUnplug();
    showNotification("Backed up all twelve banks", "success");
  } catch (e) {
    say(`Backup failed: ${e.message}. Try again, or untick the box to go on without a backup.`, "error", "Backup failed: " + e.message);
  } finally {
    showProgress(null);
    bankState.busy = false;
    fw.busy = "";
    paint();
  }
}

// The page can't tell one minichord from another over MIDI: the backup, and the kit heard before, are
// forgotten when the minichord goes away outside an update, so another one plugged in (or this one after
// a replug, its banks maybe changed) isn't taken as backed up, nor written with these banks. Chained
// onto the controller's callback as versionBack and kitHeard chain theirs, once there is something to
// forget: index.js's initialize() has set the callback by then, as the minichord answered.
function forgetOnUnplug() {
  if (fw.forgetting) return;
  fw.forgetting = true;
  const previous = controller.onConnectionChange;
  controller.onConnectionChange = (connected, message) => {
    if (previous) previous(connected, message);
    // away for an update (going into update mode, written and coming back, waiting to try again): kept
    if (!connected && !fw.busy && !fw.failed && !fw.late && !fw.restarted && !window.firmwareUpdating) {
      fw.backup = null;
      fw.backupFile = "";
      fw.kitBefore = null;
    }
  };
}

// gone from MIDI within ms: the minichord restarting
async function gone(ms) {
  const end = performance.now() + ms;
  while (controller.isConnected() && performance.now() < end) await pause(100);
  return !controller.isConnected();
}

// Firmware 114 and older, on macOS, Windows and ChromeOS: the serial port opened at 134 baud restarts the
// minichord into update mode (the Teensy's own way), then closed; it is gone by then, so a failed close
// is no matter. A port allowed before is used without asking again.
async function restartBySerial() {
  if (fw.busy || !deviceReady()) return;
  fw.busy = "restart";
  say("");
  paint();
  try {
    const wanted = flash.MINICHORD_SERIAL;
    const same = port => {
      const info = port.getInfo?.() || {};
      return info.usbVendorId === wanted.usbVendorId && info.usbProductId === wanted.usbProductId;
    };
    let port = (await navigator.serial.getPorts()).find(same);
    if (!port) {
      try {
        port = await navigator.serial.requestPort({filters: [wanted]});
      } catch (e) {
        if (e.name === "NotFoundError") return;   // the box closed with nothing chosen: back to the step
        throw e;
      }
    }
    updating(true);
    await port.open({baudRate: 134});
    try { await port.close(); } catch (e) { /* gone with the restart */ }
    if (await gone(LEAVE_WAIT)) {
      fw.restarted = true;      // the step ticked and the top line say so
    } else {
      updating(false);
      say("The minichord didn't restart: try again, or use the pin instead.", "error", "The minichord didn't restart");
    }
  } catch (e) {
    console.warn("[update] the restart over serial:", e);
    updating(false);
    say("Chrome couldn't restart the minichord into update mode from here: use the pin instead.", "error", "Couldn't restart the minichord");
  } finally {
    fw.busy = "";
    paint();
  }
}

// Chrome's box, for the minichord in update mode. Inside the click, and the only box of that click; it
// resolves to nothing when the player closes it with nothing chosen.
async function chooseDevice() {
  try {
    return (await navigator.hid.requestDevice({filters: [UPDATE_MODE]}))[0] || null;
  } catch (e) {
    console.warn("[update] Chrome's box:", e);
    say("Chrome didn't open its box for the minichord: click the button again.", "error", "Chrome didn't open its box");
    return null;
  }
}

// a minichord in update mode this page may use already, without asking: the one tried last first
async function allowedDevice() {
  try {
    const devices = (await navigator.hid.getDevices())
      .filter(d => d.vendorId === UPDATE_MODE.vendorId && d.productId === UPDATE_MODE.productId);
    return devices.find(d => d === fw.device) || devices[0] || null;
  } catch (e) {
    return null;
  }
}

// back to the step, as nothing was chosen
function chooseCancelled(keepStatus) {
  fw.busy = "";
  if (!fw.restarted && !fw.failed) updating(false);
  if (!keepStatus) say("");
  paint();
}

// The install button: restart the minichord into update mode (firmware 115 on), or ask for the pin, and
// open Chrome's box in the same click. Nothing is awaited before the box but the restart command going.
async function installClick() {
  const t = target(), way = route();
  if (fw.busy || !t?.image) return;
  if (controller.isConnected() && !deviceReady()) return;
  fw.busy = "choose";
  fw.way = way;
  updating(true);
  if (way === "command") controller.sendSysEx(flash.RESTART_COMMAND, true);
  say(way === "pin" ? PIN_SAY
    : way === "command" ? "The minichord is restarting into update mode: it goes quiet and its light goes off. " +
      `Chrome's box lists it after a moment ${LISTED}: pick it and click Connect.`
    : `In Chrome's box, pick the minichord in update mode, listed ${LISTED}, and click Connect.`);
  paint();
  const device = await chooseDevice();
  if (!device) return chooseCancelled($("fw-status").classList.contains("fw-bad"));
  await install(device, t);
}

// No minichord answering, or an install that stopped partway: one in update mode allowed already is
// used as it is, or Chrome's box asks for it
async function finishClick(t) {
  if (fw.busy || !t?.image) return;
  fw.busy = "choose";
  fw.way = "finish";
  updating(true);
  paint();
  let device = await allowedDevice();
  if (!device) {
    say(`In Chrome's box, pick the minichord in update mode, listed ${LISTED}, and click Connect. If it isn't there, press the little button ` +
      "through the hole in the back of the minichord with a pin: it appears after a moment.");
    device = await chooseDevice();
  }
  if (!device) return chooseCancelled($("fw-status").classList.contains("fw-bad"));
  await install(device, t);
}

async function install(device, t) {
  const resets = resetsBanks(t);      // from the firmware it had, before this update
  fw.busy = "install";
  fw.device = device;
  fw.restarted = false;     // in update mode, chosen: the restart is spent
  fw.failed = null;
  if (fw.updated) fw.backup = null;   // spent on the update before: not this one's to put back
  fw.updated = fw.late = fw.rule = false;
  fw.done = 0;
  fw.abort = new AbortController();
  updating(true);
  holdWakeLock();
  say("");
  const text = `Installing ${t.name}: don't unplug the minichord.`;
  progress(0, text);
  paint();
  // the first blocks wait while the flash is cleared, a few seconds at most; for much longer, on Linux,
  // it is likely Chrome without PJRC's rule (00-teensy.rules), writing to a device it could only open to read
  const slow = setTimeout(() => {
    if (fw.busy === "install" && !fw.done) say("Nothing is written yet: give it a moment." + (computer() === "linux"
      ? " On Linux this can mean Chrome needs a permission rule first: if so, this page shows how to add it in under a minute." : ""));
  }, 8000);
  // A write that never settles (Chrome sets it no deadline on Windows or macOS) is never timed out by
  // flash.js, which only counts a block's budget when a write rejects: said here once the block's budget
  // is well past. Nothing is sent again; unplugging rejects the write, and stopped() takes it from there.
  let stuck = null, stuckSaid = false;
  const watchdog = () => {
    clearTimeout(stuck);
    if (stuckSaid) { stuckSaid = false; say(""); }      // it took the block after all
    stuck = setTimeout(() => {
      if (fw.busy !== "install") return;
      stuckSaid = true;
      say("The minichord has stopped taking the firmware. Unplug it, plug it back in, then click try again.", "error",
        "The minichord has stopped taking the firmware");
    }, (fw.done < flash.FIRST_WRITES ? flash.FIRST_BUDGET : flash.BUDGET) + 10000);
  };
  watchdog();
  let ok = false;
  try {
    await flash.program(device, t.image, {signal: fw.abort.signal, onProgress: (done, total) => {
      if (!fw.done) say("");
      fw.done = done;
      progress(done / total, text);
      watchdog();
    }});
    ok = true;
  } catch (e) {
    stopped(e, t, device);
  } finally {
    clearTimeout(slow);
    clearTimeout(stuck);
    releaseWakeLock();
    fw.abort = null;
  }
  if (!ok) {
    progress(null);
    fw.busy = "";
    if (!sheet.matches(":popover-open")) updating(false);   // as the sheet's closing would have, had it come after
    paint();
    return;
  }
  // written: start it, and hear it come back with its new firmware
  const back = versionBack(BACK_WAIT);
  progress(1, `Written: the minichord is restarting with ${t.name}…`);
  const booted = await flash.boot(device);
  fw.device = null;
  const version = await back;
  const kit = version >= KIT_FIRMWARE ? await kitHeard(KIT_WAIT) : null;   // asked with the first dump: heard from now
  progress(null);
  fw.busy = "";
  updating(false);
  if (version == null) {
    fw.late = true;
    say(!booted ? `${capital(t.name)} was written, but the minichord didn't start it: it is still in update mode. Click leave update mode to start it.`
      : `${capital(t.name)} was written, and the minichord is taking a while to answer. Give it a moment. If it doesn't come back, ` +
      "press the little button through the hole in the back of the minichord with a pin, then click finish an update.");
    // heard from a dump of its own, not from answering(): until its first dump the controller holds the old version
    versionBack(20 * BACK_WAIT).then(v => {
      if (v == null || !fw.late || fw.busy) return;
      fw.late = false;
      fw.updated = true;
      say(`The minichord is back, with ${firmwareName(v)}.`, "success");
      choose();
      paint();
    });
  } else if (t.which === "newest" && t.version && version !== t.version) {
    say(`The minichord came back with ${firmwareName(version)}, not ${t.name}: the update didn't take. ` +
      (restartFrom() === "pin" ? "Click install to try again." : "Install it again, or use the pin instead."), "error", "The update didn't take");
  } else {
    fw.updated = true;
    fw.picked = false;      // what to install next is this page's to suggest again
    const done = `Done: the minichord has ${firmwareName(version)}`;
    const banks = resets ? " Its banks are back to the factory presets" + (fw.backup && t.which !== "classic" ? ": click put my banks back to write yours to it." : ".")
      : fw.backup ? " Its banks should be as they were: if any sound different, click put my banks back." : "";
    const kitSaid = kitNote(kit);
    // the notification is the whole of it where there is more to do: the sheet may be closed by the time it's read
    say(done + "." + banks + kitSaid, "success", resets || kitSaid ? "" : done);
  }
  choose();
  paint();
}

// what went wrong, in plain words, and what to do: nothing was written for a wrong board or image; for
// the rest the minichord waits in update mode, as nothing told it to start, for try again
function stopped(e, t, device) {
  const code = e instanceof flash.FlashError ? e.code : "";
  console.warn(`[update] stopped (${code || "unexpected"}):`, e.detail || "", e);
  if (code === "board" || code === "image") {
    fw.device = null;
    try { device.close().catch(() => {}); } catch (closed) { /* closed already */ }
    updating(false);
    const said = sentence(e.message);
    say(/nothing was written/i.test(said) ? said : `${said} Nothing was written to the minichord.`, "error", "Nothing was written to the minichord");
    return;
  }
  fw.failed = t;
  const linux = computer() === "linux";
  if (code === "open") {
    fw.rule = linux;
    say(linux ? "Chrome couldn't open the minichord in update mode. On Linux, Chrome needs a permission rule for it, once: " +
        "run these two commands in a terminal, then click try again. Nothing was written: unplugging the minichord and plugging it back in starts it as it was."
      : "Chrome couldn't open the minichord in update mode. Quit Teensy Loader if it's open, then click try again. If that doesn't help, " +
        "unplug the minichord, plug it back in, press the little button through the hole in the back with a pin, and click try again.",
    "error", "Chrome couldn't open the minichord in update mode");
    return;
  }
  if (code === "write" && fw.done === 0 && linux) {
    // opened, and not one block taken: Chrome on Linux opens it read-only without the rule
    fw.rule = true;
    say("The minichord in update mode didn't take the firmware. On Linux, Chrome needs a permission rule for it, once: " +
      "run these two commands in a terminal, then click try again.", "error", "The update stopped");
    return;
  }
  let text = "The update stopped partway. The minichord is safe and waiting in update mode: click try again.";
  // gone from the bus: not waiting in update mode till it is plugged back in (try again asks for the pin if need be)
  if (code === "gone") text = "The update stopped partway: the minichord went away from the computer. If the cable came out, plug it back in, then click try again.";
  if (code === "cancelled") text = "The update was stopped. The minichord is waiting in update mode: click try again.";
  say(text, "error", "The update stopped partway");
}

async function tryAgain() {
  const t = fw.failed;
  if (fw.busy || !t) return;
  fw.rule = false;
  say("");
  await finishClick(t);
}

// Leave update mode: start the minichord again with the firmware it had, nothing written
async function leaveClick() {
  if (fw.busy) return;
  fw.busy = "leave";
  updating(true);
  say("");
  paint();
  let device = await allowedDevice();
  if (!device) {
    say(`In Chrome's box, pick the minichord in update mode, listed ${LISTED}, and click Connect.`);
    device = await chooseDevice();
  }
  if (!device) return chooseCancelled($("fw-status").classList.contains("fw-bad"));
  try {
    if (!device.opened) await device.open();
  } catch (e) {
    console.warn("[update] opening the update mode:", e);
    fw.busy = "";
    updating(false);
    fw.rule = computer() === "linux";
    say(fw.rule ? "Chrome couldn't open the minichord in update mode. On Linux, Chrome needs a permission rule for it, once: " +
        "run these two commands in a terminal, then click leave update mode again."
      : "Chrome couldn't open the minichord in update mode. Quit Teensy Loader if it's open, then click leave update mode again. " +
        "If that doesn't help, unplug the minichord and plug it back in.",
    "error", "Chrome couldn't open the minichord in update mode");
    paint();
    return;
  }
  const back = versionBack(BACK_WAIT);
  say("Leaving update mode: the minichord is restarting…");
  await flash.boot(device);
  const version = await back;
  fw.busy = "";
  updating(false);
  if (version == null) {
    say("The minichord hasn't answered. If an update stopped partway, it can't start as it was: click finish an update.", "error", "The minichord hasn't answered");
  } else {
    if (fw.late) { fw.late = false; fw.updated = true; }    // an update written whole, started here
    say(`The minichord is back, with ${firmwareName(version)}.`, "success");
  }
  choose();
  paint();
}

// The banks backed up before the update, written back
async function putBack() {
  const data = fw.backup;
  if (fw.busy || !data || !deviceReady()) return;
  const problem = backupProblem(data);
  if (problem) { say(problem, "error"); return; }
  const count = data.banks.length, banks = count === BANK_COUNT ? "all twelve banks" : count + (count === 1 ? " bank" : " banks");
  if (!confirm(`Put back ${banks} as they were before the update? What they hold now is replaced.`)) return;
  if (!deviceReady()) return;
  fw.busy = "restore";
  bankState.busy = true;
  say("");
  paint();
  try {
    await restoreAllBanks(data, (i, n) => {
      const text = `Putting back bank ${i + 1} of ${n}…`;
      showProgress(text);
      progress(i / n, text, "of the banks put back");
    });
    fw.restored = true;
    say(`Put back ${banks}.`, "success", `Put back ${banks}`);
  } catch (e) {
    say(`Putting the banks back failed: ${e.message}. Some banks may already have been written.`, "error", "Putting the banks back failed");
  } finally {
    progress(null);
    showProgress(null);
    bankState.busy = false;
    fw.busy = "";
    paint();
  }
}

// ---- hearing the minichord, chained onto the controller's callbacks as readBank does -------------------
// The first dump after the boot report: the minichord back with its new firmware (its version), or null
function versionBack(ms) {
  return new Promise(resolve => {
    const previous = controller.onDataReceived;
    let settled = false;
    const finish = version => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (controller.onDataReceived === watch) controller.onDataReceived = previous;
      resolve(version);
    };
    const watch = data => {
      if (previous) previous(data);
      finish(Math.round(data.firmwareVersion * 100));
    };
    const timer = setTimeout(() => finish(null), ms);
    controller.onDataReceived = watch;
  });
}

// The kit's INFO reply (kits.js reads it as ever), or null after ms
function kitHeard(ms) {
  return new Promise(resolve => {
    const previous = controller.onKit;
    let settled = false;
    const finish = reply => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (controller.onKit === watch) controller.onKit = previous;
      resolve(reply);
    };
    const watch = msg => {
      if (previous) previous(msg);
      let reply = null;
      try { reply = msg ? window.userKit?.parseReply(msg) : null; } catch (e) { /* not one to read */ }
      if (reply?.kind === "info") finish(reply);
    };
    const timer = setTimeout(() => finish(null), ms);
    controller.onKit = watch;
  });
}

// the kit on the minichord as the sheet opens, to say after the update whether it came through
function askKit() {
  if (fw.busy || !answering() || versionNow() < KIT_FIRMWARE || controller.kitPaused) return;
  forgetOnUnplug();
  kitHeard(KIT_WAIT).then(reply => { if (reply) fw.kitBefore = reply; });
  controller.requestKitInfo();
}

// A kit damaged by the update (a bigger firmware moves where its sound starts), or one there before and
// gone now, is the player's to send again
function kitNote(after) {
  if (!after) return "";
  const before = fw.kitBefore;
  const lost = (after.state === 3 && after.reason !== 1) || (before?.state === 1 && after.state !== 1);
  if (!lost) return "";
  const name = before?.state === 1 && before.name ? ` (${before.name})` : "";
  return ` Your own drum kit${name} didn't come through: send it again from your own kit, under drum kit in the rhythm settings.`;
}

// ---- the screen kept on, and the page kept open, while it installs -------------------------------------
// asked for, not waited for, as kits.js does: the request has nothing to do with the update
function holdWakeLock() {
  try {
    navigator.wakeLock?.request("screen").then(lock => {
      if (fw.busy === "install") fw.wakeLock = lock;
      else lock.release().catch(() => {});
    }, () => { /* no wake lock here: the update goes on */ });
  } catch (e) { /* no wake lock here */ }
}
function releaseWakeLock() {
  const lock = fw.wakeLock;
  fw.wakeLock = null;
  try { lock?.release().catch(() => {}); } catch (e) { /* gone already */ }
}
window.addEventListener("beforeunload", e => {
  if (fw.busy === "install") { e.preventDefault(); e.returnValue = ""; }
});
// stopped between blocks, the minichord left waiting in update mode for the next visit to finish
window.addEventListener("pagehide", () => fw.abort?.abort());

// ---- the sheet ------------------------------------------------------------------------------------------
function openFirmwareSheet() {
  if (!sheet.matches(":popover-open")) sheet.showPopover();
}
window.openFirmwareSheet = openFirmwareSheet;

// the minichord coming and going, its version and its unsaved edits, followed while the sheet is open
function watch() {
  const key = [controller.isConnected(), controller.firmware_version, typeof unsavedEdits !== "undefined" && unsavedEdits, fw.busy].join(":");
  if (key === fw.seen) return;
  fw.seen = key;
  if (!answering() && !fw.restarted) fw.pin = false;
  if (answering() && !fw.busy) {
    fw.from = versionNow();
    fw.restarted = false;   // back on MIDI: not in update mode after all
    if (fw.failed) {        // and running a firmware: nothing waits in update mode to try again
      fw.failed = fw.device = null;
      fw.rule = false;
      updating(false);
      say("");
    }
  }
  choose();
  want();
  paint();
}

sheet.addEventListener("toggle", e => {
  // a light-dismiss popover: a click outside or Escape mid-update would leave it running unseen
  if (e.newState === "closed" && (fw.busy === "choose" || fw.busy === "install")) {
    openFirmwareSheet();
    return;
  }
  if (e.newState === "open") {
    if (!fw.busy && !fw.failed && !fw.late) { say(""); fw.rule = false; }
    fw.seen = "";
    clearInterval(fw.watching);
    fw.watching = setInterval(watch, 500);
    if (navigator.hid) {
      lookUp();
      askKit();
    }
    watch();
  } else {
    clearInterval(fw.watching);
    if (!fw.busy) updating(false);
  }
});

$("firmware-btn")?.addEventListener("click", openFirmwareSheet);
document.addEventListener("click", e => {
  if (e.target.closest?.("[data-firmware-open]")) openFirmwareSheet();
});
$("settings-drawer")?.addEventListener("toggle", e => {
  if (e.newState === "open") paintHint();
});

$("fw-lookup-again").addEventListener("click", () => { fw.lookupFailed = false; lookUp(); });
$("fw-get-again").addEventListener("click", () => {
  const source = fw.sources[fw.pick];
  if (!source) return;
  source.error = "";
  if (fw.pick === "newest" && !fw.release) lookUp();
  else want();
});
sheet.querySelectorAll('input[name="fw-pick"]').forEach(radio => radio.addEventListener("change", () => {
  if (!radio.checked) return;
  fw.pick = radio.value;
  fw.picked = true;
  say("");
  want();
  paint();
}));
$("fw-file").addEventListener("change", e => {
  const file = e.target.files?.[0];
  if (file) readFile(file);
});
$("fw-backup-check").addEventListener("change", paint);
$("fw-backup-btn").addEventListener("click", backUp);
$("fw-restart-btn").addEventListener("click", restartBySerial);
$("fw-install-btn").addEventListener("click", installClick);
$("fw-pin-btn").addEventListener("click", () => {
  fw.pin = !fw.pin;
  say("");
  paint();
});
$("fw-finish-btn").addEventListener("click", () => finishClick(target()));
$("fw-leave-btn").addEventListener("click", leaveClick);
$("fw-again-btn").addEventListener("click", tryAgain);
$("fw-restore-btn").addEventListener("click", putBack);
sheet.addEventListener("click", e => {
  const copy = e.target.closest(".fw-copy");
  if (!copy) return;
  const code = copy.closest(".fw-rule")?.querySelector("code")?.textContent || "";
  navigator.clipboard?.writeText(code).then(() => showNotification("Commands copied", "success"),
    () => showNotification("Couldn't copy: select the commands and copy them by hand", "error"));
});
})();
