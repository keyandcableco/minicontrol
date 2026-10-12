// Each envelope as a shape to drag: the chords' and the harp's volume, filter and vibrato, every one
// attack, hold, decay, sustain and release. The graph sits over the envelope's own rows, which fold
// under "exact values"; dragging writes through them (setParam, controls.js), so it sends and
// marks the bank edited as moving a slider does.

const ENVELOPES = [
  { a: 137, h: 138, d: 139, s: 140, r: 141 },   // the chords' volume
  { a: 146, h: 147, d: 148, s: 149, r: 150 },   // their filter
  { a: 164, h: 165, d: 166, s: 167, r: 168 },   // their vibrato
  { a: 43, h: 44, d: 45, s: 46, r: 47 },   // the harp's volume
  { a: 52, h: 53, d: 54, s: 55, r: 56 },   // its filter
  { a: 65, h: 66, d: 67, s: 68, r: 69 },   // its vibrato
  { a: 102, h: 103, d: 104 },               // its transient, a click that dies away: no sustain or release
];

// The drawing: 400 wide, 120 high inside its margins. Times run on a square-root scale, so a
// 20 ms attack is still a slope you can catch and 5 s doesn't push the rest off the edge; each
// stage keeps a little width at 0 ms, so the handles never sit on one another.
const ENV_W = 400, ENV_H = 120, ENV_PAD = 12, ENV_MIN = 10, ENV_SEG = 72, ENV_SUSTAIN = 56, ENV_MAX_MS = 5000;
const envX = ms => ENV_MIN + ENV_SEG * Math.sqrt(Math.max(0, ms) / ENV_MAX_MS);
const envMs = x => Math.round(ENV_MAX_MS * Math.pow(Math.max(0, Math.min(ENV_SEG, x - ENV_MIN)) / ENV_SEG, 2));
const envY = level => ENV_PAD + (1 - level) * ENV_H;

let envDrag = null;   // { env, handle, svg } while a handle is held

function envValues(env) {
  const sustain = env.s && findParameterBySysex(env.s);
  return {
    a: num(env.a), h: num(env.h), d: num(env.d), r: env.r ? num(env.r) : 0,
    s: sustain ? num(env.s) / getFloatMultiplier(sustain) : 0, held: !!env.r,
  };
}

// where each corner of the shape is (one with no release ends where its decay does)
function envPoints(v) {
  const x0 = ENV_PAD;
  const xa = x0 + envX(v.a), xh = xa + envX(v.h), xd = xh + envX(v.d);
  const xs = v.held ? xd + ENV_SUSTAIN : xd, xr = v.held ? xs + envX(v.r) : xs;
  return { x0, xa, xh, xd, xs, xr, top: envY(1), sus: envY(v.s), bottom: envY(0) };
}

const msText = ms => ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} s` : `${ms} ms`;

function envSvg(env) {
  const v = envValues(env);
  const p = envPoints(v);
  const off = locked(env.a);
  const shape = `M${p.x0},${p.bottom} L${p.xa},${p.top} L${p.xh},${p.top} L${p.xd},${p.sus} L${p.xs},${p.sus} L${p.xr},${p.bottom}`;
  const handle = (key, x, y, label, value) =>
    `<g class="pic-handle" data-handle="${key}" tabindex="${off ? -1 : 0}" role="slider" aria-label="${label}" aria-valuetext="${value}">` +
    `<circle class="pic-hit" cx="${x}" cy="${y}" r="16"/><circle class="pic-dot" cx="${x}" cy="${y}" r="6"/></g>`;
  return `<svg class="pic-svg${off ? ' off' : ''}" viewBox="0 0 ${ENV_W + ENV_PAD * 2} ${ENV_H + ENV_PAD * 2 + 16}" role="group" aria-label="envelope">` +
    `<line class="pic-floor" x1="${ENV_PAD}" y1="${p.bottom}" x2="${ENV_W + ENV_PAD}" y2="${p.bottom}"/>` +
    (v.held ? `<line class="pic-key" x1="${p.xs}" y1="${ENV_PAD}" x2="${p.xs}" y2="${p.bottom}"/>` +
      `<text class="pic-tag" x="${(p.x0 + p.xs) / 2}" y="${p.bottom + 15}">held</text>` +
      `<text class="pic-tag" x="${(p.xs + Math.max(p.xr, p.xs + 40)) / 2}" y="${p.bottom + 15}">let go</text>` : '') +
    `<path class="pic-fill" d="${shape} Z"/><path class="pic-line" d="${shape}"/>` +
    handle('a', p.xa, p.top, 'attack', msText(v.a)) +
    handle('h', p.xh, p.top, 'hold', msText(v.h)) +
    (v.held ? handle('d', p.xd, p.sus, 'decay and sustain', `${msText(v.d)}, sustain ${v.s.toFixed(2)}`) +
      handle('r', p.xr, p.bottom, 'release', msText(v.r)) : handle('d', p.xd, p.bottom, 'decay', msText(v.d))) +
    `</svg>`;
}

function envCaption(env) {
  const v = envValues(env);
  return `attack <b>${msText(v.a)}</b> · hold <b>${msText(v.h)}</b> · decay <b>${msText(v.d)}</b>` +
    (v.held ? ` · sustain <b>${Math.round(v.s * 100)}%</b> · release <b>${msText(v.r)}</b>` : '');
}

function renderEnvelope(box) {
  const env = ENVELOPES[parseInt(box.dataset.env)];
  box.querySelector('.env-draw').innerHTML = envSvg(env);
  box.querySelector('.pic-values').innerHTML = envCaption(env);
}

function refreshEnvelopes() {
  document.querySelectorAll('.env-box').forEach(box => {
    if (envDrag?.box === box || box.contains(document.activeElement)) {
      box.querySelector('.pic-values').innerHTML = envCaption(ENVELOPES[parseInt(box.dataset.env)]);
      return;
    }
    renderEnvelope(box);
  });
}

// A handle moved to x, y in the drawing's own units: set what it stands for
function envMove(env, handle, x, y) {
  const p = envPoints(envValues(env));
  if (handle === 'a') setParam(env.a, envMs(x - p.x0));
  if (handle === 'h') setParam(env.h, envMs(x - p.xa));
  if (handle === 'd') {
    setParam(env.d, envMs(x - p.xh));
    if (env.s) {
      const level = Math.max(0, Math.min(1, 1 - (y - ENV_PAD) / ENV_H));
      setParam(env.s, Math.round(level * getFloatMultiplier(findParameterBySysex(env.s))));
    }
  }
  if (handle === 'r') setParam(env.r, envMs(x - p.xs));
}

// the arrow keys move a handle: left and right its time, up and down the sustain
function envKey(env, handle, key, big) {
  const step = big ? 100 : 10;
  const time = { a: env.a, h: env.h, d: env.d, r: env.r }[handle];
  if ((key === 'ArrowLeft' || key === 'ArrowRight') && time) {
    setParam(time, Math.max(0, Math.min(ENV_MAX_MS, num(time) + (key === 'ArrowRight' ? step : -step))));
    return true;
  }
  if ((key === 'ArrowUp' || key === 'ArrowDown') && handle === 'd' && env.s) {
    const sustain = findParameterBySysex(env.s);
    const m = getFloatMultiplier(sustain);
    setParam(env.s, Math.max(0, Math.min(m, num(env.s) + (key === 'ArrowUp' ? 1 : -1) * (big ? m / 10 : m / 100))));
    return true;
  }
  return false;
}

// the point in the drawing's units under a pointer
function envPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// Put a graph over each envelope's rows, and fold the rows under it
function setupEnvelopes() {
  ENVELOPES.forEach((env, i) => {
    const addresses = [env.a, env.h, env.d, env.s, env.r].filter(Boolean);
    const rows = addresses
      .map(a => document.getElementById(`param-${a}`)?.closest('div[style*="display: flex"]'))
      .filter(Boolean);
    if (rows.length < addresses.length) return;
    const box = document.createElement('div');
    box.className = 'env-box picture';
    box.dataset.env = i;
    box.innerHTML = `<div class="env-draw"></div><p class="pic-values"></p>` +
      `<details class="exact-values"><summary>exact values</summary></details>`;
    rows[0].before(box);
    const exact = box.querySelector('.exact-values');
    rows.forEach(row => exact.append(row));
    renderEnvelope(box);
  });

  document.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.pic-handle');
    const box = handle?.closest('.env-box');
    if (!box || box.querySelector('.pic-svg.off')) return;
    e.preventDefault();
    const svg = box.querySelector('.pic-svg');
    envDrag = { box, svg, env: ENVELOPES[parseInt(box.dataset.env)], handle: handle.dataset.handle };
    svg.setPointerCapture(e.pointerId);
    handle.classList.add('held');
  });
  document.addEventListener('pointermove', e => {
    if (!envDrag) return;
    const { x, y } = envPoint(envDrag.svg, e);
    envMove(envDrag.env, envDrag.handle, x, y);
    // redraw the shape around the handle without losing hold of it
    const held = envDrag.handle;
    renderEnvelope(envDrag.box);
    envDrag.svg = envDrag.box.querySelector('.pic-svg');
    envDrag.svg.setPointerCapture(e.pointerId);
    envDrag.svg.querySelector(`[data-handle="${held}"]`)?.classList.add('held');
  });
  const release = () => {
    if (!envDrag) return;
    envDrag.box.querySelector('.held')?.classList.remove('held');
    envDrag = null;
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  document.addEventListener('keydown', e => {
    const handle = e.target.closest?.('.pic-handle');
    const box = handle?.closest('.env-box');
    if (!box) return;
    const env = ENVELOPES[parseInt(box.dataset.env)];
    if (!envKey(env, handle.dataset.handle, e.key, e.shiftKey)) return;
    e.preventDefault();
    const key = handle.dataset.handle;
    renderEnvelope(box);
    box.querySelector(`[data-handle="${key}"]`)?.focus();
  });
}

(function waitForEnvelopes() {
  if (parameters && typeof setParam === 'function' && document.getElementById('param-137')) setupEnvelopes();
  else setTimeout(waitForEnvelopes, 100);
})();
