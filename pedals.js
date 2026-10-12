// Each effect as a pedal: a card with an on/off switch, two or three dials for what matters most,
// and the rest of its settings under "more". Off sets its level to nothing and on puts the level
// back; the dials drag up and down. The settings' own rows hold the values and are what the
// pedal writes through (setParam, controls.js).

const PEDALS = [
  // the chords
  { title: 'delay', level: 183, dials: [[176, 'time'], [179, 'repeats'], [183, 'mix']], more: [177, 178, 180, 181, 182] },
  { title: 'reverb', level: 184, dials: [[184, 'amount']], room: true },
  { title: 'crunch', level: 185, dials: [[185, 'amount']], choice: [186, ['soft', 'hard', 'harder']] },
  { title: 'ensemble', level: 259, dials: [[259, 'depth']] },
  // the harp
  { title: 'delay', level: 84, dials: [[77, 'time'], [80, 'repeats'], [84, 'mix']], more: [78, 79, 81, 82, 83] },
  { title: 'reverb', level: 85, dials: [[85, 'amount']], room: true },
  { title: 'crunch', level: 86, dials: [[86, 'amount']], choice: [87, ['soft', 'hard', 'harder']] },
  { title: 'spread', level: 257, dials: [[257, 'width']], choice: [258, ['by pitch', 'alternating']] },
  // the room both share, on the effects sheet
  { title: 'reverb room', dials: [[24, 'size'], [25, 'damping']], more: [26, 27, 28] },
];

const pedalMemory = {};    // a level as it was when its pedal was switched off
let dialDrag = null;       // { sysex, startY, start, card } while a dial is held

// a setting's range in its sent units
function sentRange(sysex) {
  const p = findParameterBySysex(sysex);
  const m = getFloatMultiplier(p);
  return { p, min: Math.round(p.min_value * m), max: Math.round(p.max_value * m) };
}

function dialText(sysex) {
  const { p, min, max } = sentRange(sysex);
  const v = num(sysex);
  if (p.data_type === 'float' && p.min_value === 0 && p.max_value === 1) return `${Math.round(v / max * 100)}%`;
  if (/length|time/.test(p.name)) return `${v} ms`;
  if (p.data_type === 'float') return (v / getFloatMultiplier(p)).toFixed(decimalsFor(p));
  return max === 100 && min === 0 ? `${v}%` : String(v);
}

// a dial: an arc of 270 degrees, filled to the value
function dialSvg(sysex, label, off) {
  const { min, max } = sentRange(sysex);
  const t = max > min ? (num(sysex) - min) / (max - min) : 0;
  const arc = (from, to) => {
    const a0 = (135 + 270 * from) * Math.PI / 180, a1 = (135 + 270 * to) * Math.PI / 180;
    const p = a => `${(28 + 22 * Math.cos(a)).toFixed(2)},${(28 + 22 * Math.sin(a)).toFixed(2)}`;
    return `M${p(a0)} A22,22 0 ${(to - from) * 270 > 180 ? 1 : 0} 1 ${p(a1)}`;
  };
  const tip = (135 + 270 * t) * Math.PI / 180;
  return `<div class="dial" data-dial="${sysex}" tabindex="${off ? -1 : 0}" role="slider" aria-label="${esc(label)}" ` +
    `aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${num(sysex)}" aria-valuetext="${esc(dialText(sysex))}">` +
    `<svg viewBox="0 0 56 56" aria-hidden="true"><path class="dial-track" d="${arc(0, 1)}"/>` +
    (t > 0.002 ? `<path class="dial-value" d="${arc(0, t)}"/>` : '') +
    `<line class="dial-tick" x1="28" y1="28" x2="${(28 + 16 * Math.cos(tip)).toFixed(2)}" y2="${(28 + 16 * Math.sin(tip)).toFixed(2)}"/></svg>` +
    `<span class="dial-value-text">${esc(dialText(sysex))}</span><span class="dial-label">${esc(label)}</span></div>`;
}

function pedalOn(pedal) {
  return pedal.level == null || num(pedal.level) > 0;
}

function pedalBody(pedal) {
  const off = locked(pedal.dials[0][0]);
  const on = pedalOn(pedal);
  let html = `<div class="pedal-head"><span class="pedal-title">${esc(pedal.title)}</span>` +
    (pedal.level != null ? `<label class="pedal-switch"><input type="checkbox" class="always-on" data-pedal-switch${on ? ' checked' : ''}${off ? ' disabled' : ''}>` +
      `<span>${on ? 'on' : 'off'}</span></label>` : '') + `</div>`;
  html += `<div class="dials">${pedal.dials.map(([sysex, label]) => dialSvg(sysex, label, off)).join('')}</div>`;
  if (pedal.choice) {
    const [sysex, labels] = pedal.choice;
    html += `<div class="pedal-choice" role="radiogroup">` + labels.map((label, value) =>
      `<button type="button" class="always-on" role="radio" data-choose-value="${value}" aria-checked="${num(sysex) === value}"${off ? ' disabled' : ''}>${esc(label)}</button>`).join('') + `</div>`;
  }
  if (pedal.room) html += `<button type="button" class="pedal-link always-on" data-sheet-link="effects">room size ›</button>`;
  return html;
}

function renderPedal(card) {
  const pedal = PEDALS[parseInt(card.dataset.pedal)];
  card.querySelector('.pedal-face').innerHTML = pedalBody(pedal);
  card.classList.toggle('pedal-off', !pedalOn(pedal));
}

function refreshPedals() {
  document.querySelectorAll('.pedal').forEach(card => {
    if (dialDrag?.card === card || card.querySelector('.pedal-face')?.contains(document.activeElement)) return;
    renderPedal(card);
  });
}

function switchPedal(pedal, on) {
  const { max } = sentRange(pedal.level);
  if (on) setParam(pedal.level, pedalMemory[pedal.level] || Math.round(max * 0.3));
  else {
    if (num(pedal.level) > 0) pedalMemory[pedal.level] = num(pedal.level);
    setParam(pedal.level, 0);
  }
}

function nudgeDial(sysex, to) {
  const { min, max } = sentRange(sysex);
  setParam(sysex, Math.round(Math.max(min, Math.min(max, to))));
}

// Build the pedals: each card takes its settings' rows under "more", and stands where the first of
// them was, with the heading over them when the card says the same
function setupPedals() {
  PEDALS.forEach((pedal, i) => {
    const addresses = [...pedal.dials.map(d => d[0]), ...(pedal.choice ? [pedal.choice[0]] : []), ...(pedal.more ?? [])];
    const rows = addresses.map(a => document.getElementById(`param-${a}`)?.closest('div[style*="display: flex"]')).filter(Boolean);
    if (rows.length < addresses.length) return;
    const first = rows.reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? a : b));
    const card = document.createElement('div');
    card.className = 'pedal picture';
    card.dataset.pedal = i;
    card.dataset.title = pedal.title;
    card.innerHTML = `<div class="pedal-face"></div><details class="exact-values"><summary>more</summary></details>`;
    let heading = first.previousElementSibling;
    // the cards of one submenu side by side, in a row of their own
    let row = heading?.classList.contains('pedal-row') ? heading : null;
    let named = false;   // the heading over the rows said what the card says, and has gone
    if (!row && heading?.tagName === 'H3' && heading.textContent.trim().toLowerCase() === pedal.title) {
      const before = heading.previousElementSibling;
      heading.remove();
      named = true;
      if (before?.classList.contains('pedal-row')) row = before;
    }
    if (!row) {
      row = document.createElement('div');
      row.className = 'pedal-row';
      // under a heading that names more than the pedal (reverb and pan), the pedal comes first
      let above = named ? null : first.previousElementSibling;
      while (above && above.tagName !== 'H3') above = above.previousElementSibling;
      if (above) above.after(row);
      else first.before(row);
    }
    row.append(card);
    rows.forEach(r => card.querySelector('.exact-values').append(r));
    renderPedal(card);
  });

  document.addEventListener('change', e => {
    const sw = e.target.closest('.pedal [data-pedal-switch]');
    if (!sw) return;
    const card = sw.closest('.pedal');
    switchPedal(PEDALS[parseInt(card.dataset.pedal)], sw.checked);
    renderPedal(card);
  });
  document.addEventListener('click', e => {
    const choice = e.target.closest('.pedal [data-choose-value]');
    if (choice) {
      const card = choice.closest('.pedal');
      setParam(PEDALS[parseInt(card.dataset.pedal)].choice[0], parseInt(choice.dataset.chooseValue));
      renderPedal(card);
      return;
    }
    const link = e.target.closest('.pedal [data-sheet-link]');
    if (link && typeof openSheet === 'function') openSheet(link.dataset.sheetLink);
  });
  document.addEventListener('pointerdown', e => {
    const dial = e.target.closest('.pedal .dial');
    if (!dial || dial.getAttribute('tabindex') === '-1') return;
    e.preventDefault();
    const sysex = parseInt(dial.dataset.dial);
    dialDrag = { sysex, startY: e.clientY, start: num(sysex), card: dial.closest('.pedal') };
    dial.classList.add('held');
  });
  document.addEventListener('pointermove', e => {
    if (!dialDrag) return;
    // 160 pixels up sweeps the whole range; with shift, a tenth as fast
    const { min, max } = sentRange(dialDrag.sysex);
    const scale = (max - min) / 160 * (e.shiftKey ? 0.1 : 1);
    nudgeDial(dialDrag.sysex, dialDrag.start + (dialDrag.startY - e.clientY) * scale);
    renderPedal(dialDrag.card);
    dialDrag.card.querySelector(`[data-dial="${dialDrag.sysex}"]`)?.classList.add('held');
  });
  const release = () => {
    if (!dialDrag) return;
    dialDrag.card.querySelector('.held')?.classList.remove('held');
    dialDrag = null;
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  document.addEventListener('keydown', e => {
    const dial = e.target.closest?.('.pedal .dial');
    if (!dial || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const sysex = parseInt(dial.dataset.dial);
    const { min, max } = sentRange(sysex);
    const step = Math.max(1, Math.round((max - min) / (e.shiftKey ? 10 : 100)));
    nudgeDial(sysex, num(sysex) + (e.key === 'ArrowUp' || e.key === 'ArrowRight' ? step : -step));
    const card = dial.closest('.pedal');
    renderPedal(card);
    card.querySelector(`[data-dial="${sysex}"]`)?.focus();
  });
}

(function waitForPedals() {
  if (parameters && typeof setParam === 'function' && document.getElementById('param-183')) setupPedals();
  else setTimeout(waitForPedals, 100);
})();
