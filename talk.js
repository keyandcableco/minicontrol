//-->>TALK: A VOICE ON A LOOP, INTO THE MINICHORD, FOR THE VOCODER
// The vocoder shapes the chords (or the harp) with whatever the computer plays into the minichord's
// USB speaker (USB audio 0 or 1). So a song that talks can be played straight away: the page says
// a line, the song's title by default, in eSpeak's robot voice, or the player records their own, and
// sends it round and round into the minichord, and the chords talk while they're played.
//
// eSpeak is a speech synthesizer that works by rules, like the rest of the box: no AI, nothing
// sent anywhere. It is espeak-ng compiled to WebAssembly (GPL v3, as minicontrol is), about 18 MB,
// downloaded once from jsDelivr and kept by the browser. A recorded line is held in memory only
// while it loops: stopping, or recording another, drops it.
//
// The sound goes to the minichord alone, by AudioContext.setSinkId, which Chrome has; the
// computer's own speakers keep whatever else they were playing.

(function (root) {
"use strict";

const ESPEAK_LIB = "https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.js";
const ESPEAK_WASM = "https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.wasm";
const GAP_SECONDS = 0.5;       // quiet between one time round and the next
const USB_AUDIO = 244, VOCODER = 260;

const talk = {
  phrase: "",                  // the words the robot voice says
  state: "idle",               // idle, making, playing, recording
  status: "",
  recorded: null,              // the player's own line, an AudioBuffer, while it is in use
  using: "robot",              // what is looping: "robot" or "recorded"
  ctx: null, source: null,
  recorder: null, stream: null, chunks: [],
  rerender: () => {},
};

let espeak = null;             // {ESpeakNG, compiled}: the library, and its engine compiled once

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function say(status) {
  talk.status = status;
  const line = document.querySelector(".talk-status");
  if (line) line.textContent = status;
}

// ---- the robot voice ----

async function loadEspeak() {
  if (!espeak) {
    espeak = Promise.all([
      import(ESPEAK_LIB),
      WebAssembly.compileStreaming ? WebAssembly.compileStreaming(fetch(ESPEAK_WASM))
                                   : fetch(ESPEAK_WASM).then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b)),
    ]).then(([lib, compiled]) => ({ ESpeakNG: lib.default, compiled }))
      .catch(e => { espeak = null; throw e; });
  }
  return espeak;
}

// The words as a WAV, in eSpeak's voice. Each line gets its own instance, which runs eSpeak once.
async function robotWav(text) {
  const { ESpeakNG, compiled } = await loadEspeak();
  const words = text.replace(/^[\s-]+/, "").slice(0, 300);
  const es = await ESpeakNG({
    arguments: ["-w", "/line.wav", "-v", "en-us", "-s", "150", words],
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(compiled, imports).then(instance => receive(instance, compiled));
      return {};
    },
    print() {}, printErr() {},
  });
  return es.FS.readFile("/line.wav");
}

// ---- where it goes: the minichord's USB speaker ----

async function minichordOutput() {
  const outputs = async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
  let outs = await outputs();
  if (!outs.some(d => d.label)) {
    // a browser names its outputs only once a microphone has been allowed
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    outs = await outputs();
  }
  return outs.find(d => /minichord/i.test(d.label)) || null;
}

// The line, made as loud as it goes, and a short quiet after it, so the loop breathes
function loopBuffer(ctx, line) {
  const gap = Math.round(GAP_SECONDS * line.sampleRate);
  const out = ctx.createBuffer(1, line.length + gap, line.sampleRate);
  const data = out.getChannelData(0);
  let peak = 0;
  for (let c = 0; c < line.numberOfChannels; c++) {
    const ch = line.getChannelData(c);
    for (let i = 0; i < ch.length; i++) data[i] += ch[i] / line.numberOfChannels;
  }
  for (let i = 0; i < line.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0) for (let i = 0; i < line.length; i++) data[i] *= 0.9 / peak;
  return out;
}

function stopLoop() {
  if (talk.source) { try { talk.source.stop(); } catch (e) { } talk.source = null; }
  if (talk.ctx) { talk.ctx.close().catch(() => {}); talk.ctx = null; }
  talk.recorded = null;   // a recorded line is kept only while it loops
  talk.state = "idle";
}

async function startLoop(using) {
  if (talk.state === "making" || talk.state === "recording") return;
  const recorded = using === "recorded" ? talk.recorded : null;
  stopLoop();
  talk.recorded = recorded;
  talk.using = using;
  if (!navigator.mediaDevices || !window.AudioContext || !AudioContext.prototype.setSinkId) {
    say("This browser can't choose where a sound goes, so it can't send the voice to the minichord. Chrome can.");
    talk.rerender();
    return;
  }
  const mode = typeof currentValues !== "undefined" ? currentValues[USB_AUDIO] : undefined;
  if (mode === 2) {
    say("USB audio is set to 2, so the minichord offers the computer no speaker to send the voice to. " +
        "Set usb audio to 0 (the vocoder alone hears it) or 1 (you hear it too), in Global Parameters.");
    talk.rerender();
    return;
  }
  talk.state = "making";
  talk.rerender();
  try {
    const out = await minichordOutput();
    if (!out) throw new Error("the minichord isn't among this computer's sound outputs: is it plugged in, with USB audio at 0 or 1?");
    const ctx = new AudioContext();
    await ctx.setSinkId(out.deviceId);
    let line;
    if (recorded) line = recorded;
    else {
      const text = talk.phrase.trim();
      if (!text) throw new Error("type some words for the robot voice to say");
      say(espeak ? "Saying it…" : "Loading the robot voice, once (about 18 MB)…");
      const wav = await robotWav(text);
      line = await ctx.decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));
    }
    const source = ctx.createBufferSource();
    source.buffer = loopBuffer(ctx, line);
    source.loop = true;
    source.connect(ctx.destination);
    source.start();
    talk.ctx = ctx;
    talk.source = source;
    talk.state = "playing";
    const vocoderOff = typeof currentValues !== "undefined" && !currentValues[VOCODER];
    say((recorded ? "Your line" : `"${talk.phrase.trim()}"`) + " is going round into the minichord: play the chords. " +
        (mode === 1 ? "USB audio 1 plays it through the minichord too. " : "") +
        (vocoderOff ? "The vocoder is off in what's playing now: apply a song that talks, or stage \"vocoder\"." : ""));
  } catch (e) {
    console.warn("[talk]", e);
    stopLoop();
    say("Couldn't loop it: " + (e && e.message || e));
  }
  talk.rerender();
}

// ---- the player's own line ----

async function startRecording() {
  if (talk.state === "recording") return;
  stopLoop();
  const mic = typeof root.describeMic === "function" ? root.describeMic() : null;
  try {
    const audio = { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true };
    if (mic) audio.deviceId = { exact: mic };
    talk.stream = await navigator.mediaDevices.getUserMedia({ audio });
    talk.chunks = [];
    talk.recorder = new MediaRecorder(talk.stream);
    talk.recorder.ondataavailable = e => { if (e.data.size) talk.chunks.push(e.data); };
    talk.recorder.start();
    talk.state = "recording";
    say("Recording your line… press stop when you're done. It's kept only while it loops.");
  } catch (e) {
    say("No microphone: " + (e.name === "NotAllowedError" ? "it wasn't allowed." : e.message));
  }
  talk.rerender();
}

async function stopRecording() {
  if (talk.state !== "recording") return;
  await new Promise(resolve => { talk.recorder.onstop = resolve; talk.recorder.stop(); });
  talk.stream.getTracks().forEach(t => t.stop());
  talk.stream = null;
  talk.state = "idle";
  try {
    const blob = new Blob(talk.chunks);
    talk.chunks = [];
    const ctx = new AudioContext();
    const line = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close();
    if (line.duration < 0.3) throw new Error("that was too short");
    talk.recorded = line;
    await startLoop("recorded");
  } catch (e) {
    talk.chunks = [];
    say("Couldn't use that recording: " + e.message);
    talk.rerender();
  }
}

// ---- the row under the describe box ----

// What a staged or described song that talks says: its title, unless the player has typed words
function phraseFrom(title) {
  if (title && talk.state !== "playing" && (!talk.phrase || talk.fromSong)) {
    talk.phrase = title;
    talk.fromSong = true;
  }
}

// The row: shown while the vocoder is on, staged, or a line is going round
function row(rerender, vocoderOn) {
  talk.rerender = rerender;
  if (!vocoderOn && talk.state === "idle" && !talk.status) return null;
  const box = el("div", "talk-row");
  box.appendChild(el("p", "describe-line", "The vocoder hears what the computer sends the minichord over USB. Loop a line into it, then play:"));
  const line = el("div", "talk-controls");
  const input = el("input", "talk-phrase");
  input.type = "text";
  input.placeholder = "words for the robot voice";
  input.setAttribute("aria-label", "words for the robot voice to say");
  input.value = talk.phrase;
  input.addEventListener("input", () => { talk.phrase = input.value; talk.fromSong = false; });
  const btn = (text, title, cls) => {
    const b = el("button", "always-on " + (cls || "active"), text);
    b.type = "button";
    b.title = title;
    return b;
  };
  const busy = talk.state === "making";
  const play = talk.state === "playing"
    ? btn("stop the loop", "stop sending the voice to the minichord")
    : btn(busy ? "starting…" : "loop the robot voice", "say the words in eSpeak's robot voice, round and round into the minichord");
  play.addEventListener("click", () => (talk.state === "playing" ? (stopLoop(), say("Stopped."), rerender()) : startLoop("robot")));
  const rec = talk.state === "recording"
    ? btn("stop and loop it", "stop recording and send your line round into the minichord", "active recording")
    : btn("record my own", "say a line yourself; it loops into the minichord, and is kept only while it loops");
  rec.addEventListener("click", () => (talk.state === "recording" ? stopRecording() : startRecording()));
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); startLoop("robot"); } });
  line.append(input, play, rec);
  box.appendChild(line);
  const status = el("p", "describe-line talk-status", talk.status);
  box.appendChild(status);
  return box;
}

root.talk = { row, phraseFrom, stop: () => { stopLoop(); talk.rerender(); } };

})(typeof window !== "undefined" ? window : globalThis);
