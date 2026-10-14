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
};

const phone = /Android|iPhone|iPad/i.test(navigator.userAgent || "");
const android = /Android/i.test(navigator.userAgent || "");
const here = phone ? "this phone" : "this computer";

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

// The minichord's input, by name. Android's Chrome may only call it a USB one, so there a USB
// input will do; elsewhere a USB microphone or headset would be played instead, so not.
async function minichordInput() {
  const ins = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
  const dev = ins.find(d => /minichord/i.test(d.label)) || (android && ins.find(d => /usb/i.test(d.label))) || null;
  return { dev, named: ins.some(d => d.label) };
}

function drop() {
  if (listen.source) { try { listen.source.disconnect(); } catch (e) { } listen.source = null; }
  if (listen.stream) { listen.stream.getTracks().forEach(t => t.stop()); listen.stream = null; }
}

function stop() {
  listen.wanted = false;
  drop();
  if (listen.ctx) { listen.ctx.close().catch(() => {}); listen.ctx = null; }
  listen.status = "";
  render();
}

const WAITING = "Waiting for the minichord's sound: is it plugged in, and on? It runs only with something in its " +
                "headphone jack (USB alone charges it). It starts by itself when the minichord is there.";

// quiet: tried by itself (a device came or went), not pressed for
async function start(quiet) {
  if (listen.stream || listen.starting || !listen.wanted) return;
  listen.starting = true;
  render();
  let stream = null;
  try {
    let { dev, named } = await minichordInput();
    if (!dev && !named && !quiet) {
      // a browser names its inputs only once a microphone has been allowed
      const asked = await navigator.mediaDevices.getUserMedia({ audio: RAW });
      asked.getTracks().forEach(t => t.stop());
      ({ dev } = await minichordInput());
    }
    if (!dev) { if (listen.wanted) listen.status = WAITING; return; }
    stream = await navigator.mediaDevices.getUserMedia({ audio: { ...RAW, deviceId: { exact: dev.deviceId } } });
    if (!listen.wanted || !listen.ctx) { stream.getTracks().forEach(t => t.stop()); return; }   // stopped meanwhile
    listen.ctx.resume().catch(() => {});
    const source = listen.ctx.createMediaStreamSource(stream);
    source.connect(listen.ctx.destination);
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (listen.stream !== stream) return;
      drop();
      listen.status = "The minichord's sound stopped: unplugged, or restarting. It comes back by itself when the minichord does.";
      render();
    });
    listen.stream = stream;
    listen.source = source;
    listen.label = dev.label;
    listen.status = "";
  } catch (e) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    console.warn("[listen]", e);
    if (e && e.name === "NotAllowedError") {
      listen.wanted = false;
      if (listen.ctx) { listen.ctx.close().catch(() => {}); listen.ctx = null; }
      listen.status = "The microphone wasn't allowed: it's how a page hears the minichord over USB.";
    } else if (!quiet) {
      listen.status = "Couldn't play it: " + (e && e.message || e);
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
            "microphone: it's how a page hears the minichord. For a phone, set usb audio to 2, so the phone keeps its own speaker";
  b.addEventListener("click", press);
  line.appendChild(b);
  wrap.appendChild(line);
  wrap.appendChild(el("p", "describe-line talk-status", listen.stream ? playingText() : listen.status));
  slot.textContent = "";
  slot.appendChild(wrap);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
  // usb audio changed here: what's said about it
  document.addEventListener("change", e => { if (e.target.id === `param-${USB_AUDIO}`) render(); });
  // the minichord back after a restart, or plugged in while waiting
  navigator.mediaDevices?.addEventListener?.("devicechange", () => { if (listen.wanted && !listen.stream) start(true); });
}

root.listen = { stop };

})(typeof window !== "undefined" ? window : globalThis);
