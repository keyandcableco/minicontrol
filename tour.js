// A tour of the page for newcomers: where the controls, the drawing, the settings drawer,
// bulk edit and the bank sets are. Each step lights one part of the page and says what it
// is for; a step that lives in a drawer or a sheet opens it first and closes it after.
// Nothing is sent to the minichord, so the tour is safe with or without one plugged in.

const TOUR_SEEN_KEY = 'minicontrol_tour_seen';

// a sheet the tour opens is switched to a manual popover first: a click on the tour's
// card would otherwise light-dismiss it, and the tour's own card must sit above it in the
// top layer, which it does by opening after it
const tourOpened = new Set();
function tourRestore(id) {
  const el = document.getElementById(id);
  if (el?.matches(':popover-open')) el.hidePopover();
  el?.setAttribute('popover', '');
  tourOpened.delete(id);
}
function tourShow(id) {
  const el = document.getElementById(id);
  if (!el) return;
  [...tourOpened].forEach(other => { if (other !== id) tourRestore(other); });
  if (el.matches(':popover-open')) el.hidePopover();
  el.setAttribute('popover', 'manual');
  tourOpened.add(id);
  el.showPopover();
}
function tourHideAll() {
  [...tourOpened].forEach(tourRestore);
  if (typeof close_bank_sheet === 'function') close_bank_sheet();
}

// the bank sets sheet for the tour, left as it is when a step already opened it
async function tourBanksets() {
  const sheet = document.getElementById('banksets-sheet');
  if (!sheet || typeof openBanksets !== 'function') return;
  if (tourOpened.has('banksets-sheet') && sheet.matches(':popover-open')) return;
  tourHideAll();
  sheet.setAttribute('popover', 'manual');
  tourOpened.add('banksets-sheet');
  await openBanksets();
}

// target: what to light, one selector or several (lit together); before: what to open first
const TOUR_STEPS = [
  { target: '.title-container', title: 'Welcome to minicontrol',
    text: 'This page edits the minichord: its sound, what its buttons and knobs do, and the twelve banks it keeps. The tour shows where everything is. It sends nothing to the minichord, so take it with or without one plugged in.' },
  { target: '#notification-bubble', title: 'Is the minichord connected?',
    text: 'The bubble says. Connect the minichord by USB, use a recent Chrome, and allow MIDI when the browser asks. Greyed-out buttons need a connected minichord; the drawing, the finder and the bank sets work without one.' },
  { target: '[aria-labelledby="tool-bank"]', title: 'The banks',
    text: 'The minichord keeps twelve banks, one preset each. Choose a bank here: load switches the minichord to it, save keeps the live sound in it. Every change on this page reaches the minichord at once, but is lost at the next bank change unless you save it.' },
  { target: ['[aria-labelledby="tool-name"]', '[aria-labelledby="tool-sound"]'], title: 'The live sound',
    text: 'Name the live sound, up to 24 letters; save keeps the name with the preset. Snapshot remembers the settings so you can try things and revert. Randomise makes a new sound near a shared preset.' },
  { target: '[aria-labelledby="tool-share"]', title: 'Preset codes and the minishop',
    text: 'Copy puts the live sound on the clipboard as a preset code, to keep or to share; paste loads one. The minishop has presets players have shared, to hear on the minichord and save to a bank.' },
  { target: ['[aria-labelledby="tool-looper"]', '[aria-labelledby="tool-chord-memory"]'], title: 'Looper and chord memory',
    text: 'The looper records what you play and plays it back, with overdubs. Chord memory records a chord progression in time with rhythm mode and plays it by itself while both hands play the harp, as an Omnichord does. Both need the advanced firmware named at the foot of the page.' },
  { target: '#minichord-map', title: 'The minichord, drawn',
    text: 'Each button and knob is labelled with what it does in the live preset, and the harp with its strings for the chord you point at. Choose any part of it to change what it does.' },
  { target: '#map-layers', title: 'Three views of the drawing',
    text: 'Turning shows the controls as they are. Holding ♯ shows what they do with ♯ held down. ▲▼ key shows how to change key: hold ▲ and ▼ together and press a chord button.' },
  { target: '#controls-sheet', title: 'A control’s sheet', before: () => {
      if (typeof openControlSheet !== 'function') return;
      const sheet = document.getElementById('controls-sheet');
      if (sheet?.matches(':popover-open')) sheet.hidePopover();
      sheet?.setAttribute('popover', 'manual');
      tourOpened.add('controls-sheet');
      openControlSheet('mod');
    },
    text: 'Choosing a control opens its sheet: what the control does, what it could do instead, and the settings behind it. Change things here and the minichord follows. Close it with ✕ or Escape.' },
  { target: '.map-pedals', title: 'The pedals',
    text: 'What the minichord has no button for, as pedals under the drawing: the key and tuning, the drone, the effects, and sound from a phone or computer over USB. Each opens its own sheet.' },
  { target: '.describe-group', title: 'Describe',
    text: 'Say what you want in words: warm pad chords, make bank 5 louder, key signature to E minor. The page describes the live sound here too. The words are read by rules on this page and never sent anywhere.' },
  { target: '#settings-finder', title: 'Any setting by name',
    text: 'Type reverb, attack or MIDI channel and the page opens the sheet that holds it. Show every setting lays the whole page out at once, every setting in its section.' },
  { target: '.settings-toggle', title: 'The settings drawer',
    text: 'What is reached for now and then: how to connect, device and MIDI, all twelve banks at once, the vocoder voice, the theme, and reset.' },
  { target: '#settings-device', title: 'Device and MIDI', before: () => tourShow('settings-drawer'),
    text: 'How the minichord talks to a computer: MIDI channels and ports, MPE, tuning sent over MIDI, and USB audio.' },
  { target: '#settings-all-banks', title: 'All twelve banks at once', before: () => tourShow('settings-drawer'),
    text: 'Back up all banks reads the twelve into one file; restore writes a backup back. Bank sets, coming up, loads twelve presets in one go. Reset, at the bottom of the drawer, puts banks back to the factory sound.' },
  { target: '#bulk-edit-btn', title: 'Reorder and bulk edit', before: () => tourShow('settings-drawer'),
    text: 'Reads all twelve banks off the minichord, then lets you move them around, set one setting in every bank at once, or apply a profile to several. Changes are staged in a list; nothing is written until you press write.' },
  { target: '#settings-theme', title: 'The theme', before: () => tourShow('settings-drawer'),
    text: 'Nine looks for the page, from plain light and dark to omnichord ’81 and high contrast.' },
  { target: '.bs-sets-panel', title: 'Bank sets', before: tourBanksets,
    text: 'Sets of twelve presets of one kind: classical, synth, ambient, drum and bass and more. Take a whole set, or hear one preset of it on the minichord.' },
  { target: '.bs-mine-panel', title: 'Your own twelve', before: tourBanksets,
    text: 'Mix your own twelve from any of the sets, one bank at a time, then press write to the minichord, at the foot of the sheet, to send them in one go. Save as a set file keeps your twelve to share or restore.' },
  { target: '#tour-btn', title: 'That’s the tour', before: () => tourHideAll(),
    text: 'Take it again from here, or from the settings drawer. The minichord manual, linked above, explains the instrument itself.' },
];

let tourEl = null;
let tourStep = -1;
let tourPrevFocus = null;
let tourFrame = 0;
const tourOn = () => tourEl?.matches(':popover-open');

function buildTour() {
  const el = document.createElement('div');
  el.id = 'tour';
  el.setAttribute('popover', 'manual');
  // the dim is four panels round the lit part rather than one shadow: a box-shadow isn't
  // painted over a sheet open in the top layer, plain panels are
  el.innerHTML = `<div class="tour-dim" aria-hidden="true"></div><div class="tour-dim" aria-hidden="true"></div>
    <div class="tour-dim" aria-hidden="true"></div><div class="tour-dim" aria-hidden="true"></div>
    <div class="tour-light" aria-hidden="true"></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <p class="tool-label tour-count"></p>
      <h2 id="tour-title"></h2>
      <p class="tour-text"></p>
      <div class="tour-nav">
        <button type="button" class="always-on bs-quiet tour-end">end the tour</button>
        <button type="button" class="always-on tour-back">back</button>
        <button type="button" class="always-on tour-next">next</button>
      </div>
    </div>`;
  el.querySelector('.tour-end').addEventListener('click', endTour);
  el.querySelector('.tour-back').addEventListener('click', () => showTourStep(tourStep - 1));
  el.querySelector('.tour-next').addEventListener('click', () => showTourStep(tourStep + 1));
  document.body.appendChild(el);
  document.addEventListener('keydown', e => {
    if (!tourOn()) return;
    if (e.key === 'Escape') { e.preventDefault(); endTour(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); showTourStep(tourStep + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); showTourStep(tourStep - 1); }
  });
  const replace = () => { if (tourOn()) placeTour(); };
  window.addEventListener('resize', replace);
  window.addEventListener('scroll', replace, { passive: true, capture: true });
  return el;
}

function tourSeen() {
  try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch (e) { /* private window: the nudge just comes back */ }
  const nudge = document.getElementById('tour-nudge');
  if (nudge) nudge.hidden = true;
}

function startTour() {
  if (!tourEl) tourEl = buildTour();
  tourSeen();
  tourPrevFocus = document.activeElement;
  document.documentElement.classList.add('tour-on');
  showTourStep(0);
}

function endTour() {
  if (!tourOn()) return;
  tourEl.hidePopover();
  tourHideAll();
  document.documentElement.classList.remove('tour-on');
  tourStep = -1;
  if (tourPrevFocus?.focus) tourPrevFocus.focus();
  tourPrevFocus = null;
}

async function showTourStep(n) {
  if (n < 0) return;
  if (n >= TOUR_STEPS.length) return endTour();
  const step = TOUR_STEPS[n];
  tourStep = n;
  // what the step before opened goes, unless this step is in it too
  if (!step.before) tourHideAll();
  if (step.before) await step.before();
  if (tourStep !== n) return;
  // shown after the step's own sheet, so the card is above it in the top layer
  if (tourEl.matches(':popover-open')) tourEl.hidePopover();
  tourEl.showPopover();
  tourEl.querySelector('.tour-count').textContent = `tour · ${n + 1} of ${TOUR_STEPS.length}`;
  tourEl.querySelector('#tour-title').textContent = step.title;
  tourEl.querySelector('.tour-text').textContent = step.text;
  tourEl.querySelector('.tour-back').disabled = n === 0;
  tourEl.querySelector('.tour-next').textContent = n === TOUR_STEPS.length - 1 ? 'done' : 'next';
  const targets = tourTargets(step);
  targets[0]?.scrollIntoView({ block: 'center', inline: 'nearest' });
  placeTour();
  tourEl.querySelector('.tour-next').focus();
}

function tourTargets(step) {
  const selectors = Array.isArray(step.target) ? step.target : [step.target];
  return selectors.map(s => document.querySelector(s)).filter(el => el && el.getClientRects().length);
}

// the light over the targets, and the card below them, above them, or at the foot of the screen
function placeTour() {
  cancelAnimationFrame(tourFrame);
  tourFrame = requestAnimationFrame(() => {
    const step = TOUR_STEPS[tourStep];
    if (!step) return;
    const light = tourEl.querySelector('.tour-light');
    const dims = tourEl.querySelectorAll('.tour-dim');
    const card = tourEl.querySelector('.tour-card');
    const dim = (i, left, top, width, height) => Object.assign(dims[i].style, { left: left + 'px', top: top + 'px', width: Math.max(width, 0) + 'px', height: Math.max(height, 0) + 'px' });
    const vw = window.innerWidth, vh = window.innerHeight, gap = 12, pad = 6;
    const targets = tourTargets(step);
    let box = null;
    targets.forEach(el => {
      const r = el.getBoundingClientRect();
      box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
                : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    if (!box) {
      light.style.display = 'none';
      dim(0, 0, 0, vw, vh); dim(1, 0, 0, 0, 0); dim(2, 0, 0, 0, 0); dim(3, 0, 0, 0, 0);
      Object.assign(card.style, { left: '16px', right: '16px', top: 'auto', bottom: '16px' });
      return;
    }
    // a target taller than the screen (the drawing on a phone) is lit where it shows
    box = { left: Math.max(box.left - pad, 0), top: Math.max(box.top - pad, 0), right: Math.min(box.right + pad, vw), bottom: Math.min(box.bottom + pad, vh) };
    Object.assign(light.style, { display: 'block', left: box.left + 'px', top: box.top + 'px', width: (box.right - box.left) + 'px', height: (box.bottom - box.top) + 'px' });
    dim(0, 0, 0, vw, box.top);
    dim(1, 0, box.bottom, vw, vh - box.bottom);
    dim(2, 0, box.top, box.left, box.bottom - box.top);
    dim(3, box.right, box.top, vw - box.right, box.bottom - box.top);
    card.style.right = 'auto';
    card.style.bottom = 'auto';
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let top;
    if (box.bottom + gap + ch <= vh) top = box.bottom + gap;
    else if (box.top - gap - ch >= 0) top = box.top - gap - ch;
    else top = Math.max(vh - ch - 16, 0);
    const left = Math.min(Math.max(box.left, 16), Math.max(vw - cw - 16, 16));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  });
}

// the first visit offers the tour, once
function setupTour() {
  document.querySelectorAll('[data-tour-start]').forEach(b => b.addEventListener('click', startTour));
  document.getElementById('tour-nudge-close')?.addEventListener('click', tourSeen);
  let seen = true;
  try { seen = localStorage.getItem(TOUR_SEEN_KEY) === '1'; } catch (e) { /* no storage: no nudge */ }
  const nudge = document.getElementById('tour-nudge');
  if (nudge && !seen) nudge.hidden = false;
}
setupTour();
