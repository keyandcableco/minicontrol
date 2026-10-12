// Each filter as its curve, loudness against pitch, with a handle at the cutoff: drag it across for
// the cutoff and up for the resonance's peak. The output filters' curve also follows their mix of
// low, band and high pass. The cutoff and resonance rows fold under "exact values" and are what a
// drag writes through (setParam, controls.js).

const FILTERS = [
  { f: 143, q: 145 },                       // the chords' low pass
  { f: 192, q: 193, mix: [194, 195, 196] }, // their output filter: low, band and high pass
  { f: 49, q: 51 },                         // the harp's low pass
  { f: 88, q: 89, mix: [90, 91, 92] },      // its output filter
];

// 20 Hz to 16 kHz across, on a log scale; +18 dB to -36 dB down
const FIL_W = 400, FIL_H = 120, FIL_PAD = 12, FIL_LO = 20, FIL_HI = 16000, FIL_TOP = 18, FIL_BOTTOM = -36;
const filX = hz => FIL_PAD + FIL_W * Math.log(Math.max(FIL_LO, hz) / FIL_LO) / Math.log(FIL_HI / FIL_LO);
const filHz = x => FIL_LO * Math.pow(FIL_HI / FIL_LO, (x - FIL_PAD) / FIL_W);
const filY = db => FIL_PAD + FIL_H * (FIL_TOP - Math.max(FIL_BOTTOM, Math.min(FIL_TOP, db))) / (FIL_TOP - FIL_BOTTOM);
const filDb = y => FIL_TOP - (y - FIL_PAD) / FIL_H * (FIL_TOP - FIL_BOTTOM);

let filDrag = null;   // { box, svg, filter } while the handle is held

function filValues(filter) {
  const q = findParameterBySysex(filter.q);
  const level = a => num(a) / getFloatMultiplier(findParameterBySysex(a));
  return {
    hz: num(filter.f),
    q: q ? num(filter.q) / getFloatMultiplier(q) : 0.7,
    mix: filter.mix ? filter.mix.map(level) : [1, 0, 0],
  };
}

// A two-pole filter's loudness at hz, in dB: low, band and high pass mixed as the firmware's
// state variable filter mixes them
function filResponse(v, hz) {
  const w = hz / Math.max(1, v.hz);
  const [low, band, high] = v.mix;
  const dRe = 1 - w * w, dIm = w / v.q;
  const nRe = low - high * w * w, nIm = band * w / v.q;
  const gain = Math.sqrt(nRe * nRe + nIm * nIm) / Math.sqrt(dRe * dRe + dIm * dIm);
  return 20 * Math.log10(Math.max(gain, 1e-6));
}

const hzText = hz => hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 ? 1 : 0)} kHz` : `${hz} Hz`;

function filSvg(filter) {
  const v = filValues(filter);
  const off = locked(filter.f);
  let line = '';
  for (let i = 0; i <= 120; i++) {
    const x = FIL_PAD + FIL_W * i / 120;
    line += `${i ? 'L' : 'M'}${x.toFixed(1)},${filY(filResponse(v, filHz(x))).toFixed(1)} `;
  }
  // the handle at the resonance's height, which is the low pass's peak (a band pass keeps its own)
  const hx = filX(v.hz), hy = filY(20 * Math.log10(v.q));
  const floor = filY(FIL_BOTTOM);
  const ticks = [100, 1000, 10000].map(hz =>
    `<line class="pic-key" x1="${filX(hz)}" y1="${FIL_PAD}" x2="${filX(hz)}" y2="${floor}"/>` +
    `<text class="pic-tag" x="${filX(hz)}" y="${floor + 15}">${hz >= 1000 ? hz / 1000 + 'k' : hz}</text>`).join('');
  return `<svg class="pic-svg${off ? ' off' : ''}" viewBox="0 0 ${FIL_W + FIL_PAD * 2} ${FIL_H + FIL_PAD * 2 + 16}" role="group" aria-label="filter">` +
    ticks + `<line class="pic-floor" x1="${FIL_PAD}" y1="${filY(0)}" x2="${FIL_W + FIL_PAD}" y2="${filY(0)}"/>` +
    `<path class="pic-fill" d="${line} L${FIL_W + FIL_PAD},${floor} L${FIL_PAD},${floor} Z"/><path class="pic-line" d="${line}"/>` +
    `<g class="pic-handle" data-handle="f" tabindex="${off ? -1 : 0}" role="slider" aria-label="cutoff and resonance" ` +
    `aria-valuetext="${hzText(v.hz)}, resonance ${v.q.toFixed(2)}"><circle class="pic-hit" cx="${hx}" cy="${hy}" r="16"/>` +
    `<circle class="pic-dot" cx="${hx}" cy="${hy}" r="6"/></g></svg>`;
}

function filCaption(filter) {
  const v = filValues(filter);
  return `cutoff <b>${hzText(v.hz)}</b> · resonance <b>${v.q.toFixed(2)}</b>`;
}

function renderFilter(box) {
  const filter = FILTERS[parseInt(box.dataset.filter)];
  box.querySelector('.fil-draw').innerHTML = filSvg(filter);
  box.querySelector('.pic-values').innerHTML = filCaption(filter);
}

function refreshFilters() {
  document.querySelectorAll('.filter-box').forEach(box => {
    if (filDrag?.box === box || box.contains(document.activeElement)) {
      box.querySelector('.pic-values').innerHTML = filCaption(FILTERS[parseInt(box.dataset.filter)]);
      return;
    }
    renderFilter(box);
  });
}

// the handle at x, y: the cutoff across (within the setting's own range), the resonance up
function filMove(filter, x, y) {
  const f = findParameterBySysex(filter.f);
  setParam(filter.f, Math.round(Math.max(f.min_value, Math.min(f.max_value, filHz(x)))));
  const q = findParameterBySysex(filter.q);
  const peak = Math.pow(10, filDb(y) / 20);
  setParam(filter.q, Math.round(Math.max(q.min_value, Math.min(q.max_value, peak)) * getFloatMultiplier(q)));
}

// the arrow keys: left and right a semitone of cutoff (an octave with shift), up and down resonance
function filKey(filter, key, big) {
  const f = findParameterBySysex(filter.f);
  const q = findParameterBySysex(filter.q);
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const ratio = Math.pow(2, (big ? 12 : 1) / 12);
    const hz = Math.max(1, num(filter.f)) * (key === 'ArrowRight' ? ratio : 1 / ratio);
    setParam(filter.f, Math.round(Math.max(f.min_value, Math.min(f.max_value, hz))));
    return true;
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const m = getFloatMultiplier(q);
    const step = (big ? 0.5 : 0.1) * m * (key === 'ArrowUp' ? 1 : -1);
    setParam(filter.q, Math.round(Math.max(q.min_value * m, Math.min(q.max_value * m, num(filter.q) + step))));
    return true;
  }
  return false;
}

function setupFilters() {
  FILTERS.forEach((filter, i) => {
    const rows = [filter.f, filter.q]
      .map(a => document.getElementById(`param-${a}`)?.closest('div[style*="display: flex"]'))
      .filter(Boolean);
    if (rows.length < 2) return;
    const box = document.createElement('div');
    box.className = 'filter-box picture';
    box.dataset.filter = i;
    box.innerHTML = `<div class="fil-draw"></div><p class="pic-values"></p>` +
      `<details class="exact-values"><summary>exact values</summary></details>`;
    rows[0].before(box);
    rows.forEach(row => box.querySelector('.exact-values').append(row));
    renderFilter(box);
  });

  document.addEventListener('pointerdown', e => {
    const box = e.target.closest('.filter-box');
    if (!box || !e.target.closest('.pic-handle') || box.querySelector('.pic-svg.off')) return;
    e.preventDefault();
    filDrag = { box, svg: box.querySelector('.pic-svg'), filter: FILTERS[parseInt(box.dataset.filter)] };
    box.querySelector('.pic-handle').classList.add('held');
  });
  document.addEventListener('pointermove', e => {
    if (!filDrag) return;
    const { x, y } = envPoint(filDrag.svg, e);
    filMove(filDrag.filter, x, y);
    renderFilter(filDrag.box);
    filDrag.svg = filDrag.box.querySelector('.pic-svg');
    filDrag.box.querySelector('.pic-handle').classList.add('held');
  });
  const release = () => {
    if (!filDrag) return;
    filDrag.box.querySelector('.held')?.classList.remove('held');
    filDrag = null;
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  document.addEventListener('keydown', e => {
    const box = e.target.closest?.('.filter-box');
    if (!box || !e.target.closest('.pic-handle')) return;
    if (!filKey(FILTERS[parseInt(box.dataset.filter)], e.key, e.shiftKey)) return;
    e.preventDefault();
    renderFilter(box);
    box.querySelector('.pic-handle')?.focus();
  });
}

(function waitForFilters() {
  if (parameters && typeof envPoint === 'function' && document.getElementById('param-143')) setupFilters();
  else setTimeout(waitForFilters, 100);
})();
