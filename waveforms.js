// Each waveform dropdown (the oscillators, the LFOs, tremolo, vibrato, the transient) as a row of
// little pictures of its twelve shapes. The dropdown stays, hidden, and is what a choice writes
// through (setParam, controls.js).

// one cycle and a bit of each, in a 24 by 16 box, by the firmware's numbering
const WAVE_SHAPES = {
  0: 'M2,8 C5,-1 8,-1 12,8 S19,17 22,8',                                   // sine
  1: 'M2,14 L12,2 L12,14 L22,2',                                           // sawtooth
  2: 'M2,14 L2,2 L12,2 L12,14 L22,14 L22,2',                               // square
  3: 'M2,8 L7,2 L17,14 L22,8',                                             // triangle
  4: 'M2,14 L7,14 L7,0.5 Q8,4 9.5,2 L13,2 L13,15.5 Q14,12 15.5,14 L22,14',  // bandlimited pulse
  5: 'M2,14 L2,2 L6,2 L6,14 L12,14 L12,2 L16,2 L16,14 L22,14',             // pulse
  6: 'M2,2 L12,14 L12,2 L22,14',                                           // reverse sawtooth
  7: 'M2,10 H6 V4 H10 V12 H14 V6 H18 V9 H22',                              // sample and hold
  8: 'M2,14 L16,2 L22,14',                                                 // variable triangle
  9: 'M2,14 L12,2 L12,15.5 Q13,11.5 14.5,13.5 L22,2',                       // bandlimited sawtooth
  10: 'M2,2 L12,14 L12,0.5 Q13,4.5 14.5,2.5 L22,14',                        // reverse bandlimited sawtooth
  11: 'M2,14 L2,0.5 Q3.5,4.5 5,2 L12,2 L12,15.5 Q13.5,11.5 15,14 L22,14 L22,0.5',  // bandlimited square
};
// the order they are offered in: like shapes together, the smoother bandlimited ones after
const WAVE_ORDER = [0, 3, 8, 1, 6, 2, 5, 7, 9, 10, 11, 4];

const waveStrips = [];   // { sysex, strip }

function waveButtons(select) {
  return WAVE_ORDER.map(value => {
    const label = select.querySelector(`option[value="${value}"]`)?.textContent ?? '';
    return `<button type="button" class="wave always-on" role="radio" data-value="${value}" title="${esc(label)}" aria-label="${esc(label)}">` +
      `<svg viewBox="0 0 24 16" aria-hidden="true"><path d="${WAVE_SHAPES[value]}"/></svg></button>`;
  }).join('');
}

function refreshWaves() {
  waveStrips.forEach(({ sysex, strip }) => {
    const value = num(sysex);
    const off = locked(sysex);
    strip.querySelectorAll('.wave').forEach(b => {
      b.setAttribute('aria-checked', String(parseInt(b.dataset.value) === value));
      b.disabled = off;
    });
  });
}

function setupWaveforms() {
  const names = WAVE_ORDER.map(v => String(v)).sort().join();
  document.querySelectorAll('#parameters select[id^="param-"]').forEach(select => {
    // a dropdown of the twelve waveforms, whatever it is called
    if ([...select.options].map(o => o.value).sort().join() !== names) return;
    if (!/sine/i.test(select.options[0]?.textContent)) return;
    const sysex = parseInt(select.id.slice(6));
    const strip = document.createElement('div');
    strip.className = 'wave-strip';
    strip.setAttribute('role', 'radiogroup');
    strip.setAttribute('aria-label', select.name);
    strip.innerHTML = waveButtons(select);
    select.after(strip);
    select.classList.add('wave-select');
    waveStrips.push({ sysex, strip });
    strip.addEventListener('click', e => {
      const b = e.target.closest('.wave');
      if (!b || b.disabled) return;
      setParam(sysex, parseInt(b.dataset.value));
      refreshWaves();
    });
  });
  refreshWaves();
}

(function waitForWaveforms() {
  if (parameters && typeof setParam === 'function' && document.getElementById('param-122')) setupWaveforms();
  else setTimeout(waitForWaveforms, 100);
})();
