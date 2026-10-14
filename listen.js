//-->>LISTEN: THE MINICHORD'S OWN SOUND THROUGH THIS PHONE OR COMPUTER
// The minichord sends its own sound to whatever it's plugged into, over USB, as a recording device:
// a phone or a computer lists it among its microphones. Nothing on the minichord can make a phone
// play a microphone, so the page does: it opens the minichord's USB sound and plays it as it comes
// through this phone's or computer's own speaker, the phone as the minichord's speaker. Untouched:
// no echo cancelling, no noise suppression, no levelling, which are for voices.
//
// For a phone, usb audio (244) wants 2: at 0 or 1 the minichord is offered as a speaker, and a
// phone sends all its sound there, this too. And the minichord runs only with something in its
// headphone jack: USB charges its battery, it doesn't run it.
//
// The browser names its inputs only once a microphone has been allowed, so it may ask first. The
// minichord restarting (244 to or from 2) or unplugged ends the sound; left on, it comes back by
// itself when the minichord's input does. The lab's arcade does the same (minichord-lab
// practice/touch.js, tdMonitor).
//
// An Android phone's Chrome doesn't name the minichord's input. It names only what it can switch a
// call to, each with a speaker: "USB audio" is the minichord at 0 or 1, as a speaker, and at 2 the
// minichord isn't there at all. So on Android the page opens the default input, which Android takes
// from a USB input before the phone's own microphone when nothing is cancelled (Chrome's AAudio
// input, its generic preset; an older Chrome took the camcorder's, the phone's own microphone).
// The phone's own microphone through its own speaker howls, so two things keep it from playing:
//   - before anything plays, a short quiet beep through the speaker, which the phone's own
//     microphone hears and the minichord's USB sound doesn't (hearsSpeaker);
//   - the sound plays only while the page is connected to the minichord over MIDI, and is dropped
//     the moment it goes (lost, from index.js): when an input goes, Chrome opens the default again,
//     which is then the phone's own microphone, and the track never ends. It starts again when the
//     minichord's settings arrive (found).

(function (root) {
"use strict";

const USB_AUDIO = 244;
const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };

const listen = {
  wanted: false,               // on, as the player left it: so it comes back after a restart
  starting: false,
  stream: null, source: null,
  ctx: null,                   // made on the press and kept, so a restart's comeback may play
  label: "",                   // the input playing, as the browser names it
  status: "",                  // what happened, when nothing is playing
  meter: null, timer: 0,       // the sound as it arrives, measured four times a second
  peaks: [], since: 0, soundAt: 0, noteAt: 0,
  check: null,                 // the beep check's measures, on Android
  details: [], detailsOpen: false,
};

const phone = /Android|iPhone|iPad/i.test(navigator.userAgent || "");
const android = /Android/i.test(navigator.userAgent || "");
const here = phone ? "this phone" : "this computer";

const sleep = ms => new Promise(r => setTimeout(r, ms));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// usb audio as the connected minichord has it; unknown with none connected (or no Web MIDI)
function usbAudio() {
  if (typeof minichord_device === "undefined" || !minichord_device || typeof currentValues === "undefined") return undefined;
  return currentValues[USB_AUDIO];
}

// The minichord's input, by name (not on Android: see above)
async function minichordInput() {
  const ins = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
  return { dev: ins.find(d => /minichord/i.test(d.label)) || null, named: ins.some(d => d.label) };
}

function drop() {
  if (listen.timer) { clearInterval(listen.timer); listen.timer = 0; }
  listen.meter = null;
  if (listen.source) { try { listen.source.disconnect(); } catch (e) { } listen.source = null; }
  if (listen.stream) { listen.stream.getTracks().forEach(t => t.stop()); listen.stream = null; }
}

function stop(status = "") {
  listen.wanted = false;
  drop();
  if (listen.ctx) { listen.ctx.close().catch(() => {}); listen.ctx = null; }
  listen.status = status;
  render();
}

const WAITING = "Waiting for the minichord's sound: is it plugged in, and on? It runs only with something in its " +
                "headphone jack (USB alone charges it). It starts by itself when the minichord is there.";
const SET_TWO = "On a phone this needs usb audio at 2, just above: at 0 or 1 the minichord is offered as a speaker, and " +
                "the phone sends all its sound there, this too. At 2 the minichord restarts, and this starts by itself.";
const GONE = "The minichord's sound stopped: unplugged, or restarting. It comes back by itself when the minichord does.";
const OWN_MIC = "Nothing played: this phone gave the page its own microphone, not the minichord's sound (it heard the " +
                "check's beep), and that through its speaker would howl. A newer Chrome takes a USB input first: is Chrome up to date?";

// On Android, whether the default input may be taken for the minichord's: connected over MIDI, at
// usb audio 2. Says why not
function androidReady() {
  const mode = usbAudio();
  if (mode === undefined) listen.status = WAITING;
  else if (mode !== 2) listen.status = SET_TWO;
  return mode === 2;
}

// Whether the input opened hears this phone's own speaker: a short quiet beep (2.9 kHz, between the
// notes) goes out, and the input's band there is watched before, during and after it. The phone's
// own microphone hears it come and go, standing clear of what's around it; the minichord's USB sound
// doesn't, and a note of its own there that starts with the beep doesn't stop with it.
async function hearsSpeaker(ctx, stream) {
  const TONE = 2900, LEVEL = 0.05;
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 4096;
  an.smoothingTimeConstant = 0;
  src.connect(an);
  const db = new Float32Array(an.frequencyBinCount);
  const k = Math.round(TONE * an.fftSize / ctx.sampleRate);
  const at = i => Math.max(db[i], -160);     // digital silence is -Infinity
  // how far the beep's band stands above its neighbours, on average over ms
  async function standing(ms) {
    let sum = 0, n = 0;
    for (const end = performance.now() + ms; performance.now() < end; await sleep(20)) {
      an.getFloatFrequencyData(db);
      let around = 0;
      for (let d = 8; d <= 16; d++) around += at(k - d) + at(k + d);
      sum += Math.max(at(k - 1), at(k), at(k + 1)) - around / 18;
      n++;
    }
    return n ? sum / n : 0;
  }
  try {
    const before = await standing(250);
    const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + 0.02;
    osc.frequency.value = TONE;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(LEVEL, t + 0.02);
    gain.gain.setValueAtTime(LEVEL, t + 0.48);
    gain.gain.linearRampToValueAtTime(0, t + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.52);
    await sleep(200);                        // out through the speaker and back
    const during = await standing(260);
    await sleep(250);                        // gone, and its echo
    const after = await standing(250);
    listen.check = { before, during, after };
    return during - Math.max(before, after) >= 6;
  } finally {
    try { src.disconnect(); } catch (e) { }
  }
}

// quiet: tried by itself (a device came or went), not pressed for
async function start(quiet) {
  if (listen.stream || listen.starting || !listen.wanted) return;
  if (android && !androidReady()) { render(); return; }
  listen.starting = true;
  listen.details = [];
  listen.check = null;
  listen.status = android ? "A short beep: checking that it's the minichord's sound, not this phone's own microphone…" : "";
  render();
  let stream = null;
  try {
    let dev = null;
    if (!android) {
      let named;
      ({ dev, named } = await minichordInput());
      if (!dev && !named && !quiet) {
        // a browser names its inputs only once a microphone has been allowed
        const asked = await navigator.mediaDevices.getUserMedia({ audio: RAW });
        asked.getTracks().forEach(t => t.stop());
        ({ dev } = await minichordInput());
      }
      if (!dev) { if (listen.wanted) listen.status = WAITING; return; }
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: dev ? { ...RAW, deviceId: { exact: dev.deviceId } } : RAW });
    if (listen.ctx) await Promise.race([listen.ctx.resume(), sleep(1000)]).catch(() => {});
    if (!listen.wanted || !listen.ctx) { stream.getTracks().forEach(t => t.stop()); return; }   // stopped meanwhile
    if (android) {
      // the check needs the sound running; without it, nothing plays
      if (listen.ctx.state !== "running") {
        stream.getTracks().forEach(t => t.stop());
        stop("Couldn't start the sound here: press again.");
        return;
      }
      if (await hearsSpeaker(listen.ctx, stream)) {
        stream.getTracks().forEach(t => t.stop());
        stop(OWN_MIC);
        return;
      }
      // stopped, or the minichord gone, while it checked
      if (!listen.wanted || !listen.ctx || !androidReady()) { stream.getTracks().forEach(t => t.stop()); return; }
    }
    const source = listen.ctx.createMediaStreamSource(stream);
    source.connect(listen.ctx.destination);
    const meter = listen.ctx.createAnalyser();
    meter.fftSize = 2048;
    source.connect(meter);
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (listen.stream !== stream) return;
      drop();
      listen.status = GONE;
      render();
    });
    listen.stream = stream;
    listen.source = source;
    listen.label = dev ? dev.label : "";
    listen.status = "";
    listen.meter = meter;
    listen.peaks = [];
    listen.since = performance.now();
    listen.soundAt = 0;
    listen.timer = setInterval(measure, 250);
    describeInput(stream);
  } catch (e) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    console.warn("[listen]", e);
    if (e && e.name === "NotAllowedError") {
      listen.wanted = false;
      if (listen.ctx) { listen.ctx.close().catch(() => {}); listen.ctx = null; }
      listen.status = "The microphone wasn't allowed: it's how a page hears the minichord over USB.";
    } else {
      listen.status = quiet ? WAITING : "Couldn't play it: " + (e && e.message || e);
    }
  } finally {
    listen.starting = false;
    render();
  }
}

function press() {
  if (listen.wanted) { stop(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !root.AudioContext) {
    listen.status = "This browser can't open a sound input, so it can't play the minichord's.";
    render();
    return;
  }
  listen.wanted = true;
  // made and started within the press, which a browser asks for before it plays anything
  listen.ctx = new AudioContext({ latencyHint: "interactive" });
  listen.ctx.resume().catch(() => {});
  start(false);
}

// The page lost the minichord over MIDI (index.js, updateConnectionStatus). On Android that's how
// the page knows its sound has gone, before the phone's own microphone takes its place
function lost() {
  if (!android || !listen.stream) return;
  drop();
  listen.status = GONE;
  render();
}

// The minichord's settings arrived (index.js, handleDataReceived): connected, or back after a restart
function found() {
  if (listen.wanted && !listen.stream && !listen.starting) start(true);
  else render();
}

// The sound as it arrives, its loudest over the last second: a minichord sends exact silence while
// it's quiet, so anything at all is something. If its notes come over MIDI and nothing comes in over
// USB, this browser isn't handing the page the minichord's sound
function measure() {
  if (!listen.meter) return;
  const buf = new Float32Array(listen.meter.fftSize);
  listen.meter.getFloatTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak > 0) listen.soundAt = performance.now();
  listen.peaks.push(peak);
  if (listen.peaks.length > 4) listen.peaks.shift();
  const shown = document.querySelector("#listen-usb .listen-level");
  if (shown) shown.textContent = levelText();
}

function levelText() {
  const now = performance.now(), most = Math.max(0, ...listen.peaks);
  if (listen.noteAt > now - 2500 && listen.soundAt < now - 2000 && listen.since < now - 2000)
    return `The minichord is playing (its notes arrive over MIDI), but no sound comes in: ${here} isn't handing the page its sound.`;
  if (!most) return "Arriving from it: silence. Play the minichord.";
  return `Arriving from it: ${Math.round(20 * Math.log10(most))} dB at its loudest.`;
}

// What the page has opened, for when nothing's heard: the input as the browser names it and has it
// set up, the inputs it lists, the sound's own rate and delay, and the beep check's measures
async function describeInput(stream) {
  const track = stream.getAudioTracks()[0], s = track?.getSettings?.() || {}, ctx = listen.ctx;
  const processing = ["echoCancellation", "noiseSuppression", "autoGainControl"].filter(k => s[k]);
  const lines = [
    `input: ${track?.label || "unnamed"}${s.deviceId ? ` (${s.deviceId.slice(0, 12)})` : ""}`,
    `as opened: ${[s.sampleRate && s.sampleRate + " Hz", s.channelCount && s.channelCount + " ch", s.latency != null && Math.round(s.latency * 1000) + " ms"].filter(Boolean).join(", ") || "not said"}; ` +
      `processing: ${processing.length ? processing.join(", ") : "none"}`,
  ];
  if (ctx) lines.push(`played at ${ctx.sampleRate} Hz, ${Math.round((ctx.baseLatency || 0) * 1000)} + ${Math.round((ctx.outputLatency || 0) * 1000)} ms out`);
  if (listen.check) lines.push(`the beep check: ${["before", "during", "after"].map(k => listen.check[k].toFixed(1)).join(" / ")} dB above its surroundings (heard from 6 over)`);
  try {
    const ins = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
    lines.push(`inputs listed: ${ins.map(d => d.label || "unnamed").join(", ") || "none"}`);
  } catch (e) { }
  lines.push(`browser: ${(navigator.userAgent.match(/(Chrome|Firefox)\/[\d.]+|Version\/[\d.]+ (Mobile\/\w+ )?Safari/) || [""])[0]}`);
  if (listen.stream !== stream) return;
  listen.details = lines;
  render();
}

// what's happening, playing: and what usb audio does to it
function playingText() {
  const mode = usbAudio();
  const said = `The minichord's sound is playing through ${here}${listen.label ? ` (${listen.label})` : ""}. Keep this page open.`;
  if (mode === 0) return said + " usb audio is at 0, so a phone sends all its sound, this too, to the minichord, which " +
                         "doesn't play it: for a phone's own speaker set usb audio to 2, just above. The minichord restarts, and this comes back by itself.";
  if (mode === 1) return said + " usb audio is at 1, so a phone sends all its sound, this too, to the minichord, which " +
                         "plays it again a moment late: for a phone's own speaker set usb audio to 2, just above. The minichord restarts, and this comes back by itself.";
  return said;
}

function render() {
  const slot = document.getElementById("listen-usb");
  if (!slot) return;
  const wrap = el("div", "talk-wrap");
  const line = el("div", "talk-controls");
  const b = el("button", "always-on active",
    listen.starting ? "starting…" : listen.wanted ? `stop playing it on ${here}` : `play it through ${here}`);
  b.type = "button";
  b.title = `the minichord's own sound, as it sends it over USB, through ${here}'s speaker. The browser asks for the ` +
            "microphone: it's how a page hears the minichord. For a phone, set usb audio to 2, so the phone keeps its own speaker" +
            (android ? ". A short beep first checks that it's the minichord's sound and not the phone's own microphone" : "");
  b.addEventListener("click", press);
  line.appendChild(b);
  wrap.appendChild(line);
  wrap.appendChild(el("p", "describe-line talk-status", listen.stream ? playingText() : listen.status));
  if (listen.stream) {
    wrap.appendChild(el("p", "describe-line talk-status listen-level", levelText()));
    if (listen.details.length) {
      const more = el("details", "listen-details");
      more.open = listen.detailsOpen;
      more.addEventListener("toggle", () => { listen.detailsOpen = more.open; });
      more.appendChild(el("summary", "describe-line", "what the page hears"));
      listen.details.forEach(x => more.appendChild(el("div", "describe-line", x)));
      wrap.appendChild(more);
    }
  }
  slot.textContent = "";
  slot.appendChild(wrap);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
  document.addEventListener("change", e => {
    if (e.target.id !== `param-${USB_AUDIO}`) return;
    // on Android, away from 2 the minichord restarts as a speaker: dropped now, ahead of it
    if (android && listen.wanted && Number(e.target.value) !== 2) { drop(); listen.status = SET_TWO; }
    render();
  });
  // the minichord back after a restart, or plugged in while waiting
  navigator.mediaDevices?.addEventListener?.("devicechange", () => { if (listen.wanted && !listen.stream) start(true); });
}

// the minichord's notes over MIDI: whether it's playing, for when nothing comes in over USB
if (typeof controller !== "undefined") {
  const previous = controller.onMidi;
  controller.onMidi = d => {
    if ((d[0] & 0xF0) === 0x90 && d[2] > 0) listen.noteAt = performance.now();
    if (previous) previous(d);
  };
}

root.listen = { stop, lost, found };

})(typeof window !== "undefined" ? window : globalThis);
