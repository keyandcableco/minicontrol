// Global variables for MIDI controller interface
let parameters = null;
let currentValues = {};
let controller = new MiniChordController();
let tempValues = {};
let currentBankNumber = -1;
let targetBank = -1;
const bankNames = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
let defaultValues = {};
let notificationTimeout = null;
let rhythmPattern = new Array(16).fill(0);
let minichord_device = false;
const BASE_ADDRESS_RHYTHM = 220;
let notificationQueue = [];
let isShowingNotification = false;
let snapshotBank = -1; // the bank a snapshot was taken on, -1 when none is held
// Changes made from the page that the bank doesn't hold yet. While the page is connected the
// minichord doesn't save on changing bank, so they are dropped when it does: the page says so.
let unsavedEdits = false;
let handEdits = false;         // edits by hand since the last whole preset came in, which a code or randomise replaces
let unsavedAtSnapshot = false; // what unsavedEdits was when the snapshot was taken, for a revert to put back
let progressText = null;       // a long job's progress, held in the bubble till it is done
// RANDOMISE leaves these alone: device, MIDI, tuning, double tap and hover settings, the looper
// (an action, not a setting) and the vocoder, which silences what it carries with nothing coming in
const RANDOMISE_FIXED = [32, 33, 34, 35, 41, 97, 106, 107, 108, 109, 110, 117, 197, 200, 201, 209, 210, 211, 212, 237, 238,
  241, 242, 243, 244, 249, 250, 251, 256, 260, 261, 262];

function getFloatMultiplier(param) {
  return parseFloat(param.float_multiplier) || (param.data_type === 'float' ? (controller.float_multiplier || 100.0) : 1);
}

function decimalsFor(param) {
  if (param.data_type !== 'float') return 0;
  const step = String(param.step ?? 0.01);
  return step.includes('.') ? step.split('.')[1].length : 0;
}

// A double tap value is a raw number whatever its target, so on its own it is a plain slider.
// Once its control names a target, it takes on that target's range and type, so the value is
// set the way the setting itself is.
function effectiveParam(param) {
  if (param.follows_target == null) return param;
  const target = findParameterBySysex(parseInt(currentValues[param.follows_target]));
  if (!target || target.follows_target != null || target.sysex_adress === param.sysex_adress) return param;
  return {
    ...param,
    min_value: target.min_value,
    max_value: target.max_value,
    data_type: target.data_type === 'float' ? 'float' : 'int',
    float_multiplier: target.float_multiplier,
    step: target.step,
    options: target.options
  };
}

function configureSlider(element, valueDisplay, p) {
  const floatMultiplier = getFloatMultiplier(p);
  element.min = Math.round(p.min_value * floatMultiplier);
  element.max = Math.round(p.max_value * floatMultiplier);
  element.step = p.data_type === 'float' ? Math.round((p.step ?? 0.01) * floatMultiplier) : 1;
  if (valueDisplay) {
    valueDisplay.min = p.min_value;
    valueDisplay.max = p.max_value;
    valueDisplay.step = p.data_type === 'float' ? (p.step ?? 0.01) : 1;
  }
}

// the label of a dropdown setting's value, shown next to a double tap value aimed at it
function updateOptionHint(param, value) {
  if (param.follows_target == null) return;
  const valueDisplay = document.getElementById(`value-${param.sysex_adress}`);
  if (!valueDisplay) return;
  let hint = document.getElementById(`hint-${param.sysex_adress}`);
  if (!hint) {
    hint = document.createElement('span');
    hint.id = `hint-${param.sysex_adress}`;
    hint.className = 'option-hint';
    valueDisplay.insertAdjacentElement('afterend', hint);
  }
  const p = effectiveParam(param);
  const option = (p.options || []).find(o => o.value === Math.round(value));
  hint.textContent = option ? option.label : '';
}

// Each knob's percent range and the control it sets the range of. The firmware sweeps a setting
// from its value less that percent to its value plus it, so the page shows what that comes to
// next to the percent. A setting of a few steps is swept across all of them, whatever the percent.
const KNOB_RANGES = { 11: 10, 13: 12, 15: 14, 17: 16 };
const SELECTOR_MAX_SPAN = 32; // as the firmware's generator decides which settings are steps

// whether a knob holds its sweep within the setting's own range (firmware 40); with no minichord
// yet the page shows what the newest firmware does
function knobsClamp() {
  const firmware = Math.round((controller.firmware_version || 0) * 100);
  return !firmware || firmware >= 40;
}

function knobSpanText(rangeSysex) {
  const target = findParameterBySysex(parseInt(currentValues[KNOB_RANGES[rangeSysex]]));
  if (!target || target.follows_target != null) return { text: '', title: '' };
  const steps = target.data_type === 'int' && target.max_value - target.min_value <= SELECTOR_MAX_SPAN;
  if (steps) {
    const label = v => (target.options || []).find(o => o.value === v)?.label ?? v;
    return {
      text: `→ every step`,
      title: `${target.name} has a few steps, so the knob runs through all of them, ${label(target.min_value)} to ${label(target.max_value)}, and the percent is not used`
    };
  }
  const value = currentValues[target.sysex_adress] ?? 0;
  const percent = (currentValues[rangeSysex] ?? 100) / 100;
  const multiplier = getFloatMultiplier(target);
  const shown = v => target.data_type === 'float' ? (v / multiplier).toFixed(decimalsFor(target)) : v;
  // as the firmware works it out, in whole sent units
  let low = Math.trunc(Math.max(0, value * (1 - percent)));
  let high = Math.trunc(value * (1 + percent));
  const min = Math.round(target.min_value * multiplier);
  const max = Math.round(target.max_value * multiplier);
  const outside = low < min || high > max;
  const sweeps = `the knob sweeps ${target.name} from ${shown(Math.max(low, min))} to ${shown(Math.min(high, max))}, around its value of ${shown(value)}`;
  if (!outside) return { text: `→ ${shown(low)} – ${shown(high)}`, title: sweeps };
  if (knobsClamp()) {
    return {
      text: `→ ${shown(Math.max(low, min))} – ${shown(Math.min(high, max))}`,
      title: `${sweeps}. The percent reaches ${shown(low)} to ${shown(high)}, past its own range, so the knob rests at the end for the rest of its travel`
    };
  }
  return {
    text: `→ ${shown(low)} – ${shown(high)} (beyond ${target.min_value}–${target.max_value})`,
    title: `the knob sweeps ${target.name} from ${shown(low)} to ${shown(high)}, around its value of ${shown(value)}. ` +
      `That goes beyond its own range, ${target.min_value} to ${target.max_value}, and this firmware sends it anyway: firmware 40 holds it within`
  };
}

function refreshKnobSpans() {
  Object.keys(KNOB_RANGES).forEach(rangeSysex => {
    const valueDisplay = document.getElementById(`value-${rangeSysex}`);
    if (!valueDisplay) return;
    let hint = document.getElementById(`hint-${rangeSysex}`);
    if (!hint) {
      hint = document.createElement('span');
      hint.id = `hint-${rangeSysex}`;
      hint.className = 'option-hint';
      valueDisplay.insertAdjacentElement('afterend', hint);
    }
    const { text, title } = knobSpanText(parseInt(rangeSysex));
    hint.textContent = text;
    hint.title = title;
  });
}

function applyOverrideDefaults(target = defaultValues) {
  [2, 3, 4, 5, 6].forEach(sysex => {
    const param = findParameterBySysex(sysex);
    if (param) {
      const floatMultiplier = getFloatMultiplier(param);
      target[sysex] = (sysex === 2 || sysex === 3) ? 0.5 * floatMultiplier : 512;
    }
  });
}

async function loadParameters() {
  if (parameters) return parameters;
  try {
    const response = await fetch('parameters.json');
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    parameters = await response.json();
    // console.log('[DEBUG] Loaded parameters:', Object.keys(parameters));
    return parameters;
  } catch (error) {
    console.error('[loadParameters] Failed:', error);
    showNotification("Failed to load parameters", "error");
    return {};
  }
}

async function initializeDefaultValues() {
  const params = await loadParameters();
  defaultValues = {};
  Object.keys(params).forEach(group => {
    if (group === 'sysex_name_map') return;
    params[group].forEach(param => {
      const sysex = param.sysex_adress;
      const floatMultiplier = getFloatMultiplier(param);
      defaultValues[sysex] = param.data_type === 'float' ? param.default_value * floatMultiplier : param.default_value;
      // page 1 goes to these when a preset of page 0 alone is loaded
      if (sysex >= controller.page_size) controller.page1_defaults[sysex] = Math.round(defaultValues[sysex]);
    });
  });
  applyOverrideDefaults(defaultValues);
  // console.log('[DEBUG] Default values:', defaultValues);
}

function findParameterBySysex(sysex) {
  const params = parameters;
  for (const group of Object.keys(params)) {
    if (group === 'sysex_name_map') continue;
    const param = params[group].find(p => p.sysex_adress === sysex);
    if (param) return param;
  }
  return null;
}

// The names the bank dropdown shows. Before firmware 50 they are the ones this browser keeps for
// the bank sheet. From 50 they are in the banks, which can only be read by loading each, so the
// page notes each name as it sees one (a bank loaded, saved, reset, read or written by the bank
// sheet, restored) and shows the last it saw, kept for the next visit.
const BANK_NAMES_SEEN_KEY = "minicontrol_bank_names_seen";
function bankNamesSeen() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(BANK_NAMES_SEEN_KEY)) || []; } catch (e) { raw = []; }
  return Array.from({ length: 12 }, (_, i) => (typeof raw[i] === "string" ? raw[i] : ""));
}
function noteBankName(bank, name) {
  if (!namesOnDevice() || bank < 0 || bank >= 12) return;
  const names = bankNamesSeen();
  if (names[bank] === (name || "")) return;
  names[bank] = name || "";
  try { localStorage.setItem(BANK_NAMES_SEEN_KEY, JSON.stringify(names)); } catch (e) { }
  paintBankNames();
}
// a bank's name as the page knows it, "" for none
function bankNameShown(bank) {
  const names = namesOnDevice() ? bankNamesSeen() : typeof bankNamesGet === "function" ? bankNamesGet() : [];
  return names[bank] || "";
}
function paintBankNames() {
  const select = document.getElementById("bank_number_selection");
  if (!select) return;
  for (const option of select.options) {
    const bank = parseInt(option.value);
    const name = bankNameShown(bank);
    option.textContent = (bank + 1) + (name ? " · " + name : "");
  }
  labelResetBank();
}

// " · Warm pad" after the bank number: the live sound's own name, or before firmware 50 the
// name this browser keeps for the bank
function liveName() {
  const name = namesOnDevice() ? presetName(currentValues)
    : typeof bankNamesGet === "function" ? bankNamesGet()[currentBankNumber] : "";
  return name ? " · " + name : "";
}

function updateConnectionStatus(connected, message) {
  console.log(`[updateConnectionStatus] Called with connected: ${connected}, message: ${message}`);
  const bubbleElement = document.getElementById("notification-bubble");
  const textElement = document.getElementById("connection-text");
  if (!bubbleElement || !textElement) {
    console.warn("[updateConnectionStatus] Notification elements not found");
    return;
  }
  minichord_device = connected;
  if (!isShowingNotification) {
    bubbleElement.className = connected ? 'connected' : 'disconnected';
    const bankText = currentBankNumber >= 0 ? ` | Bank ${currentBankNumber + 1}${liveName()}${unsavedEdits ? ' (unsaved changes)' : ''}` : '';
    textElement.textContent = !connected ? "minichord disconnected" : progressText || `minichord connected${bankText}`;
    bubbleElement.style.display = 'flex';
  }
  if (message && !isShowingNotification) {
    showNotification(message, connected ? "success" : "error");
  }
  if (!connected) {
    // the buttons have all gone grey: say what they are waiting for
    const help = document.getElementById("connection-help");
    if (help) help.open = true;
    // greyed for want of a minichord now, not of firmware
    showFirmwareNote(0, 0);
    document.querySelectorAll("[data-needs-firmware]").forEach(holder => {
      delete holder.dataset.needsFirmware;
      holder.removeAttribute("title");
    });
    document.querySelectorAll('input:not(.always-on), button:not(.always-on), select:not(.always-on)').forEach(element => {
      element.classList.add("inactive");
      element.classList.remove("active");
    });
  }
}

function showNotification(message, type = 'info') {
  console.log(`[showNotification] Queuing message: ${message}, type: ${type}`);
  notificationQueue.push({ message, type });
  if (isShowingNotification) return;
  displayNextNotification();
}

function displayNextNotification() {
  if (notificationQueue.length === 0) {
    isShowingNotification = false;
    updateConnectionStatus(controller.isConnected(), null); // Ensure reset when queue is empty
    return;
  }
  isShowingNotification = true;
  const { message, type } = notificationQueue.shift();
  const bubbleElement = document.getElementById("notification-bubble");
  const textElement = document.getElementById("connection-text");
  if (!bubbleElement || !textElement) {
    console.warn("[showNotification] Notification elements not found");
    isShowingNotification = false;
    notificationQueue = []; // Clear queue to prevent infinite loop
    updateConnectionStatus(controller.isConnected(), null);
    return;
  }
  if (notificationTimeout) {
    console.log("[showNotification] Clearing existing timeout");
    clearTimeout(notificationTimeout);
  }
  textElement.textContent = message;
  bubbleElement.className = type === 'success' ? 'connected' : 'disconnected';
  bubbleElement.style.display = 'flex';
  notificationTimeout = setTimeout(() => {
    console.log("[showNotification] Timeout executed");
    isShowingNotification = false; // Set to false before updating connection status
    updateConnectionStatus(controller.isConnected(), null);
    displayNextNotification();
  }, type === 'error' ? 5000 : 3000); // what went wrong is given longer to be read
}

// whether a snapshot can replace the one held, and is dropped on any change of bank (firmware 39)
function snapshotReplaces() {
  return Math.round((controller.firmware_version || 0) * 100) >= 39;
}

// A preset's name, kept in the preset itself from firmware 50: two letters to each of the twelve
// settings from 290, the first in the low seven bits, plain ASCII, and the first 0 ends it. The
// minichord only keeps it. Before 50 the bank sheet keeps names in this browser instead.
const NAME_FIRST = 290, NAME_SLOTS = 12, NAME_LENGTH = 2 * NAME_SLOTS;
function namesOnDevice() {
  return Math.round((controller.firmware_version || 0) * 100) >= 50;
}
function isNameAddress(a) {
  return a >= NAME_FIRST && a < NAME_FIRST + NAME_SLOTS;
}
// what a name can be on the minichord: plain letters (accents taken off), at most 24 of them
function plainName(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_LENGTH);
}
// the name in a preset's values (an array, or currentValues), "" for none
function presetName(values) {
  let out = "";
  for (let k = 0; k < NAME_SLOTS; k++) {
    const v = values[NAME_FIRST + k] || 0;
    for (const c of [v & 127, (v >> 7) & 127]) {
      if (c < 32) return out.trim();
      out += String.fromCharCode(c);
    }
  }
  return out.trim();
}
function setPresetName(values, name) {
  const s = plainName(name);
  for (let k = 0; k < NAME_SLOTS; k++) {
    const first = s.charCodeAt(2 * k) || 0, second = s.charCodeAt(2 * k + 1) || 0;
    values[NAME_FIRST + k] = first ? first + 128 * second : 0;
  }
}

function refreshStatus() {
  if (!isShowingNotification) updateConnectionStatus(controller.isConnected(), null);
}

function showProgress(text) {
  progressText = text;
  refreshStatus();
}

// A change made here, which the bank doesn't hold until it is saved. `byHand` is false for a whole
// preset arriving at once (a code, a randomise), which replaces hand edits rather than being one.
function markEdited(byHand = true) {
  const was = unsavedEdits;
  unsavedEdits = true;
  handEdits = byHand;
  if (!was) refreshStatus();
}

// the live settings are now what a bank holds: saved, loaded or reset
function markClean() {
  unsavedEdits = false;
  handEdits = false;
  refreshStatus();
}

// Anything that loads a bank over the live settings asks first while they hold unsaved edits.
function okToDropEdits(action) {
  if (!unsavedEdits) return true;
  return confirm(`${action}\n\nThe changes made to bank ${currentBankNumber + 1} since it was last saved will be lost. ` +
    `Save to a bank first to keep them.`);
}

// Whether a button that talks to the minichord can go ahead: connected, and not in the middle of
// walking the banks, which a stray load or save would throw off
function deviceReady() {
  if (!controller.isConnected()) {
    showNotification("No minichord connected", "error");
    return false;
  }
  if (typeof bankState !== 'undefined' && bankState.busy) {
    showNotification("Wait till the banks are done", "error");
    return false;
  }
  return true;
}

// Black or white, whichever reads better on the bank colour. Choosing by hue alone gave
// white on dark mode's lighter reds and blues, too faint to read.
function readableOn(h, sPct, lPct) {
  const s = sPct / 100, l = lPct / 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const lin = v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lin(channel(0)) + 0.7152 * lin(channel(8)) + 0.0722 * lin(channel(4));
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#ffffff' : '#000000';
}

function updateUIColor() {
  const param = findParameterBySysex(20);
  if (!param) return console.warn('[updateUIColor] SysEx 20 not found');
  const bankColor = currentValues[20] ?? defaultValues[20] ?? param.default_value;
  const hue = bankColor % 360;
  // each theme says how the bank colour is lit (index.css and the theme sheets set these)
  const primaryColor = `hsl(${hue}, ${themeVar('--bank-saturation', '70%')}, ${themeVar('--bank-lightness', '50%')})`;
  const textColor = readableOn(hue, parseFloat(themeVar('--bank-saturation', '70%')), parseFloat(themeVar('--bank-lightness', '50%')));
  document.documentElement.style.setProperty('--primary-color-hue', hue);
  document.documentElement.style.setProperty('--primary-color', primaryColor);
  document.documentElement.style.setProperty('--text-color', textColor);
  // an installed window's title bar takes the bank colour too
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', primaryColor);
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    const value = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    const trackColor = sliderTrackColor();
    slider.style.background = `linear-gradient(to right, var(--primary-color) 0%, var(--primary-color) ${value}%, ${trackColor} ${value}%, ${trackColor} 100%)`;
  });
  document.querySelectorAll('button, #bank_number_selection').forEach(element => {
    if (element.classList.contains('active')) {
      element.style.backgroundColor = primaryColor;
      element.style.color = textColor;
    }
  });
}

// the picker is the list of themes; themes drawn by themes/common.css are marked on it
function themeList() {
  const select = document.getElementById('theme-select');
  return select ? [...select.options].map(o => o.value) : ['light'];
}
function tokenThemes() {
  try { return JSON.parse(document.getElementById('theme-select')?.dataset.tokenThemes || '[]'); } catch (e) { return []; }
}
const THEME_FAVICONS = { arcade: 'themes/arcade-minichord.svg' };

// a theme's own value for a CSS variable, such as its slider track colour
function themeVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function sliderTrackColor() {
  return themeVar('--track-color', '#ccc');
}

// Light or dark is one choice across keyandcable.com, kept in a cookie the shop's site and the
// Minichord Lab read and write too: pick dark on any of them and the others open dark.
// minicontrol's own looks (arcade, omnichord and the rest) stay minicontrol's.
function sharedTheme() {
  const m = document.cookie.match(/(?:^|;\s*)kc-theme=(dark|light)(?:;|$)/);
  return m ? m[1] : null;
}
function shareTheme(theme) {
  const domain = /(^|\.)keyandcable\.com$/.test(location.hostname) ? '; domain=keyandcable.com' : '';
  const secure = location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `kc-theme=${theme}; path=/; max-age=31536000; samesite=lax${domain}${secure}`;
}

function setTheme(theme, save = true) {
  if (!themeList().includes(theme)) theme = 'light';
  const html = document.documentElement;
  html.setAttribute('data-theme', theme);
  if (tokenThemes().includes(theme)) html.setAttribute('data-themed', '');
  else html.removeAttribute('data-themed');
  if (save) {
    try { localStorage.setItem('theme', theme); } catch (e) { /* private window: the choice just isn't remembered */ }
    if (theme === 'light' || theme === 'dark') shareTheme(theme);
  }
  const select = document.getElementById('theme-select');
  if (select) select.value = theme;
  // some themes bring their own favicon
  let icon = document.getElementById('theme-favicon');
  if (THEME_FAVICONS[theme]) {
    if (!icon) {
      icon = document.createElement('link');
      icon.id = 'theme-favicon';
      icon.rel = 'icon';
      icon.type = 'image/svg+xml';
      document.head.appendChild(icon);
    }
    icon.href = THEME_FAVICONS[theme];
  } else if (icon) {
    icon.remove();
  }
  updateUIColor();
}

// a look picked here wins; plain light or dark follows the shared choice; until there is either,
// a system asking for more contrast gets high contrast
function loadTheme() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) { /* no storage */ }
  const shared = sharedTheme();
  if (shared && (saved === null || saved === 'light' || saved === 'dark')) return setTheme(shared, false);
  if (themeList().includes(saved)) return setTheme(saved);
  const contrast = window.matchMedia && matchMedia('(prefers-contrast: more)').matches;
  setTheme(contrast ? 'contrast' : 'light', false);
}

function refreshRhythmGrid() {
  for (let step = 0; step < 16; step++) {
    const sysexAddress = BASE_ADDRESS_RHYTHM + step;
    const patternValue = currentValues[sysexAddress] ?? 0;
    rhythmPattern[step] = patternValue;
    for (let voice = 0; voice < 7; voice++) {
      const checkbox = document.getElementById(`rhythm-checkbox-${step}-${voice}`);
      if (checkbox) checkbox.checked = !!(patternValue & (1 << voice));
    }
  }
}

function applyUIValue(param, value) {
  const sysex = param.sysex_adress;
  const element = document.getElementById(`param-${sysex}`);
  const valueDisplay = document.getElementById(`value-${sysex}`);
  if (!element) return;
  const p = effectiveParam(param);
  const floatMultiplier = getFloatMultiplier(p);
  const displayValue = p.data_type === 'float' ? (value / floatMultiplier).toFixed(decimalsFor(p)) : value;
  const uiType = param.ui_type || '';

  if (uiType.includes('slider')) {
    if (param.follows_target != null) configureSlider(element, valueDisplay, p);
    element.value = value;
    if (valueDisplay) valueDisplay.value = displayValue;
    updateOptionHint(param, value);
  } else if (uiType === 'select') {
    element.value = value;
    // a target the list doesn't offer is one this control can't take, which leaves it unassigned
    if (element.selectedIndex < 0 && param.none_option != null) element.value = 0;
  } else if (uiType === 'switch') {
    element.checked = value === 1;
  } else if (uiType === 'degrees') {
    for (let bit = 0; bit < 12; bit++) {
      const box = document.getElementById(`param-${sysex}-bit-${bit}`);
      if (box) box.checked = !!(value & (1 << bit));
    }
  }
}

// the double tap value that follows this control, if any
function followerOf(sysex) {
  for (const group of Object.keys(parameters)) {
    const follower = parameters[group].find(p => p.follows_target === sysex);
    if (follower) return follower;
  }
  return null;
}

function refreshFollower(sysex) {
  const follower = followerOf(sysex);
  if (follower) applyUIValue(follower, currentValues[follower.sysex_adress] ?? 0);
}

async function setupParameterControls() {
  const params = await loadParameters();
  Object.keys(params).forEach(group => {
    if (group === 'sysex_name_map') return;
    params[group].forEach(param => {
      const sysex = param.sysex_adress;
      const floatMultiplier = getFloatMultiplier(param);
      const defaultValue = defaultValues[sysex] ?? (param.data_type === 'float' ? param.default_value * floatMultiplier : param.default_value);
      currentValues[sysex] = currentValues[sysex] ?? defaultValue;
      applyUIValue(param, currentValues[sysex]);

      const element = document.getElementById(`param-${sysex}`);
      const valueDisplay = document.getElementById(`value-${sysex}`);
      if (!element) return;
      const uiType = param.ui_type || '';

      if (uiType.includes('slider')) {
        configureSlider(element, valueDisplay, effectiveParam(param));
        element.addEventListener('input', () => {
          const p = effectiveParam(param);
          const uiValue = parseFloat(element.value) / getFloatMultiplier(p);
          const deviceValue = Math.round(parseFloat(element.value));
          tempValues[sysex] = deviceValue;
          currentValues[sysex] = deviceValue;
          if (valueDisplay) valueDisplay.value = p.data_type === 'float' ? uiValue.toFixed(decimalsFor(p)) : deviceValue;
          updateOptionHint(param, deviceValue);
          controller.sendParameter(sysex, deviceValue);
          markEdited();
          const valuePercent = ((element.value - element.min) / (element.max - element.min)) * 100;
          element.style.background = `linear-gradient(to right, var(--primary-color) 0%, var(--primary-color) ${valuePercent}%, ${sliderTrackColor()} 0%, ${sliderTrackColor()} 100%)`;
          if (sysex === 20) updateUIColor();
          refreshKnobSpans();
        });
        if (valueDisplay) {
          valueDisplay.addEventListener('input', () => {
            const p = effectiveParam(param);
            let inputValue = p.data_type === 'float' ? parseFloat(valueDisplay.value) : parseInt(valueDisplay.value);
            if (isNaN(inputValue)) {
              console.warn(`[text-input] Invalid value for ${sysex}: ${valueDisplay.value}`);
              return;
            }
            inputValue = Math.max(p.min_value, Math.min(p.max_value, inputValue));
            const deviceValue = p.data_type === 'float' ? Math.round(inputValue * getFloatMultiplier(p)) : inputValue;
            element.value = deviceValue;
            tempValues[sysex] = deviceValue;
            currentValues[sysex] = deviceValue;
            valueDisplay.value = p.data_type === 'float' ? inputValue.toFixed(decimalsFor(p)) : inputValue;
            updateOptionHint(param, deviceValue);
            controller.sendParameter(sysex, deviceValue);
            markEdited();
            const valuePercent = ((element.value - element.min) / (element.max - element.min)) * 100;
            element.style.background = `linear-gradient(to right, var(--primary-color) 0%, var(--primary-color) ${valuePercent}%, ${sliderTrackColor()} 0%, ${sliderTrackColor()} 100%)`;
            if (sysex === 20) updateUIColor();
            refreshKnobSpans();
            // console.log(`[text-input] Param ${sysex}, Value=${inputValue}`);
          });
        }
      } else if (uiType === 'select') {
        element.addEventListener('change', () => {
          const value = parseInt(element.value);
          tempValues[sysex] = value;
          currentValues[sysex] = value;
          controller.sendParameter(sysex, value);
          markEdited();
          if (sysex === 20) updateUIColor();
          refreshFollower(sysex);
          refreshKnobSpans();
        });
      } else if (uiType === 'switch') {
        element.addEventListener('input', () => {
          const value = element.checked ? 1 : 0;
          tempValues[sysex] = value;
          currentValues[sysex] = value;
          controller.sendParameter(sysex, value);
          markEdited();
        });
      } else if (uiType === 'degrees') {
        // each box is one bit of the value: assemble the mask from the whole row and send it
        element.querySelectorAll('.degree-box').forEach(box => {
          box.addEventListener('input', () => {
            let mask = 0;
            element.querySelectorAll('.degree-box').forEach(b => {
              if (b.checked) mask |= (1 << parseInt(b.dataset.bit));
            });
            tempValues[sysex] = mask;
            currentValues[sysex] = mask;
            controller.sendParameter(sysex, mask);
            markEdited();
          });
        });
      }
    });
  });
  refreshKnobSpans();
  updateUIColor();
}

function handleDataReceived(data) {
  // console.log(`[handleDataReceived] Bank=${data.bankNumber}, parameters.length=${data.parameters.length}`);
  if (data.firmwareVersion === undefined || isNaN(data.firmwareVersion)) {
    console.warn("[handleDataReceived] Invalid or missing firmware version");
    showNotification("Invalid firmware version", "error");
    return;
  }
  // the minichord changed bank by itself (its own buttons), which drops what wasn't saved
  if (currentBankNumber >= 0 && data.bankNumber !== currentBankNumber && unsavedEdits) {
    showNotification(`Now on bank ${data.bankNumber + 1}: the unsaved changes to bank ${currentBankNumber + 1} were dropped`, "error");
    unsavedEdits = handEdits = false;
  }
  // from firmware 39 any change of bank drops the snapshot, not only a load from here
  if (data.bankNumber !== currentBankNumber && snapshotReplaces()) snapshotBank = -1;
  currentValues = {};
  data.parameters.forEach((value, sysex) => {
    if (value !== undefined) {
      const param = findParameterBySysex(sysex);
      if (param) currentValues[sysex] = value;
    }
  });
  applyOverrideDefaults(currentValues);
  if (!unsavedEdits) noteBankName(data.bankNumber, presetName(currentValues));
  paintBankNames();
  showPresetName();
  rhythmPattern = data.rhythmData.map(bits => bits.reduce((acc, bit, i) => acc | (bit ? (1 << i) : 0), 0));
  targetBank = data.bankNumber;
  updateUI(data.bankNumber);
  // Toggle active/inactive based on firmware version. A control too new for this firmware
  // takes no pointer, so what holds it says why, on hover and on a click.
  const firmware = Math.round(data.firmwareVersion * 100);
  let newest = 0; // the newest firmware a greyed control asks for
  document.querySelectorAll('input:not(.always-on), button:not(.always-on), select:not(.always-on)').forEach(element => {
    const requiredVersion = parseFloat(element.getAttribute('version') || 0.01);
    const holder = element.closest('.button_div, .degree-row') || element.parentElement;
    if (requiredVersion <= data.firmwareVersion) {
      element.classList.add('active');
      element.classList.remove('inactive');
      if (holder?.dataset.needsFirmware) {
        delete holder.dataset.needsFirmware;
        holder.removeAttribute('title');
      }
    } else {
      element.classList.add('inactive');
      element.classList.remove('active');
      const needed = Math.round(requiredVersion * 100);
      newest = Math.max(newest, needed);
      if (holder) {
        holder.dataset.needsFirmware = needed;
        holder.title = firmwareNeed(needed, firmware);
      }
    }
  });
  showFirmwareNote(firmware, newest);
}

// Ben Poilve's newest firmware. Past it is the test-allFeatures fork, which this page's newer
// controls are for.
const OFFICIAL_FIRMWARE = 9;
const TEST_FIRMWARE_LINK = '<a href="https://github.com/keyandcableco/minichord/tree/test-allFeatures">test-allFeatures firmware</a>';
const TEST_FIRMWARE_CAVEAT = "It is experimental and may have bugs, and it isn't made or endorsed by Ben Poilve. Back up your banks before installing it.";

function firmwareNeed(needed, firmware) {
  return (needed > OFFICIAL_FIRMWARE ? `Needs the test-allFeatures firmware, version ${needed} or later.` : `Needs firmware ${needed} or later.`) +
    ` This minichord has ${firmware}.`;
}

// what the greyed controls are waiting for, above them, while there are any
function showFirmwareNote(firmware, newest) {
  const note = document.getElementById("firmware-note");
  if (!note) return;
  note.hidden = !newest;
  if (!newest) return;
  if (newest <= OFFICIAL_FIRMWARE) {
    note.innerHTML = `This minichord has firmware ${firmware}, so the greyed-out controls are off: they need firmware ${newest} or later. ` +
      `The <a href="https://minichord.com/user_manual/">minichord documentation</a> says how to update it.`;
  } else if (firmware <= OFFICIAL_FIRMWARE) {
    note.innerHTML = `This minichord has the official firmware (${firmware}), so the greyed-out controls are off: ` +
      `they need the ${TEST_FIRMWARE_LINK}, version ${newest} or later. ${TEST_FIRMWARE_CAVEAT}`;
  } else {
    note.innerHTML = `This minichord has version ${firmware} of the ${TEST_FIRMWARE_LINK}, so the greyed-out controls are off: ` +
      `they need version ${newest} or later. ${TEST_FIRMWARE_CAVEAT}`;
  }
}

// a click on a greyed control lands on what holds it: say why nothing happens
document.addEventListener("click", e => {
  const holder = e.target.closest?.("[data-needs-firmware]");
  if (!holder || !controller.isConnected()) return;
  e.preventDefault();
  e.stopPropagation();
  showNotification(holder.title, "error");
}, true);

async function updateUI(bankNumber) {
  if (bankNumber < 0) {
    console.warn(`[updateUI] Invalid bank number: ${bankNumber}`);
    return;
  }
  console.log(`[updateUI] Bank ${bankNumber + 1}, targetBank=${targetBank + 1}`);
  // The target follows the minichord to a new bank, but is otherwise left as picked: every
  // randomise or preset code reports back, and that used to put a picked target back silently.
  const bankChanged = bankNumber !== currentBankNumber;
  currentBankNumber = bankNumber;
  const bankSelect = document.getElementById("bank_number_selection");
  if (bankSelect && bankChanged) {
    bankSelect.value = bankNumber;
  }
  const params = await loadParameters();
  if (!params) return;
  Object.keys(params).forEach(group => {
    if (group === 'sysex_name_map') return;
    params[group].forEach(param => {
      const sysex = param.sysex_adress;
      const floatMultiplier = getFloatMultiplier(param);
      const value = currentValues[sysex] ?? (param.data_type === 'float' ? param.default_value * floatMultiplier : param.default_value);
      applyUIValue(param, value);
    });
  });
  // a double tap value takes its range from its control, so redo them once every control is set
  Object.keys(params).forEach(group => params[group].forEach(param => {
    if (param.follows_target != null) applyUIValue(param, currentValues[param.sysex_adress] ?? param.default_value);
  }));
  refreshKnobSpans();
  updateUIColor();
  refreshRhythmGrid();
    if (!isShowingNotification) {
    updateConnectionStatus(controller.isConnected(), null);
  }
}

function loadBankSettings(bankNumber) {
  if (!controller.isConnected()) return console.warn(`[loadBankSettings] No device connected for bank ${bankNumber}`);
  tempValues = {};
  controller.sendSysEx([0, 0, 0, bankNumber]);
  // console.log(`[loadBankSettings] Requesting settings for bank ${bankNumber}`);
}

async function loadParameterRanges() {
  try {
    const [parametersResponse, presetsResponse] = await Promise.all([
      fetch('parameters.json'),
      fetch('shared_presets.json').catch(() => null)
    ]);
    
    const parametersData = await parametersResponse.json();
    const presetsData = presetsResponse ? await presetsResponse.json() : null;
    
    const parameterRanges = {};
    
    let randomPreset = null;
    if (presetsData?.shared_presets?.length) {
      randomPreset = presetsData.shared_presets[Math.floor(Math.random() * presetsData.shared_presets.length)];
      console.log(`[loadParameterRanges] Using random preset: "${randomPreset.name}" by ${randomPreset.author}`);
    }
    
    const decodedPreset = randomPreset ? atob(randomPreset.value).split(';').map(v => parseFloat(v)) : null;
    
    ['global_parameter', 'harp_parameter', 'chord_parameter', 'rhythm_parameter'].forEach(category => {
      if (!parametersData[category]) return;
      parametersData[category].forEach(param => {
        const sysex = param.sysex_adress;
        const presetValue = decodedPreset ? decodedPreset[sysex] : null;
        let defaultValue = param.default_value;
        
        if (presetValue !== undefined && presetValue !== null && !isNaN(presetValue)) {
          defaultValue = param.data_type === 'float' ? presetValue / getFloatMultiplier(param) : presetValue;
        }
        
        parameterRanges[sysex] = {
          min: param.min_value,
          max: param.max_value,
          type: param.data_type,
          default: defaultValue,
          original_default: param.default_value
        };
      });
    });
    
    return parameterRanges;
  } catch (error) {
    console.error('[loadParameterRanges] Error:', error);
    try {
      const response = await fetch('parameters.json');
      const parametersData = await response.json();
      
      const parameterRanges = {};
      
      ['global_parameter', 'harp_parameter', 'chord_parameter', 'rhythm_parameter'].forEach(category => {
        if (!parametersData[category]) return;
        parametersData[category].forEach(param => {
          parameterRanges[param.sysex_adress] = {
            min: param.min_value,
            max: param.max_value,
            type: param.data_type,
            default: param.default_value,
            original_default: param.default_value
          };
        });
      });
      
      return parameterRanges;
    } catch (fallbackError) {
      console.error('[loadParameterRanges] Fallback error:', fallbackError);
      return {};
    }
  }
}

function normalRandom(mean, sigma) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * sigma + mean;
}

async function generateRandomPreset() {
  if (!deviceReady()) return;
  if (handEdits && !confirm(`Randomise? It replaces the changes made to bank ${currentBankNumber + 1}, which aren't saved.`)) return;
  
  const parameterRanges = await loadParameterRanges();
  const weirdness_factor = 0.10;
  const preset = Array(controller.parameter_size).fill(0);
  
  Object.entries(parameterRanges).forEach(([sysex, params]) => {
    const idx = parseInt(sysex);
    
    if (idx < 19 || RANDOMISE_FIXED.includes(idx)) {
      // keep what the minichord has now, not the factory default
      const param = findParameterBySysex(idx);
      const current = currentValues[idx];
      preset[idx] = current !== undefined && param
        ? (param.data_type === 'float' ? current / getFloatMultiplier(param) : current)
        : params.original_default;
    } else {
      const minVal = params.min;
      const maxVal = params.max;
      const center = params.default;
      const range = maxVal - minVal;
      const sigma = range * weirdness_factor;
      
      let value = normalRandom(center, sigma);
      value = Math.max(minVal, Math.min(maxVal, value));
      
      preset[idx] = params.type === 'float' ? Math.round(value * 100) / 100 : Math.round(value);
    }
  });
  
  for (let i = 2; i < controller.parameter_size; i++) {
    if (preset[i] !== undefined && parameterRanges[i] && controller.canWrite(i)) {
      const param = findParameterBySysex(i);
      if (!param) continue;
      const floatMultiplier = getFloatMultiplier(param);
      const valueToSend = param.data_type === 'float' ? Math.round(preset[i] * floatMultiplier) : preset[i];
      controller.sendParameter(i, valueToSend);
      currentValues[i] = valueToSend;
    }
  }
  
  controller.sendParameter(0, 0);
  markEdited(false);
  console.log("[generateRandomPreset] Random preset applied");
  showNotification("Random preset applied: save to a bank to keep it", "success");
}

function setupRhythmGridControls() {
  for (let step = 0; step < 16; step++) {
    for (let voice = 0; voice < 7; voice++) {
      const checkbox = document.getElementById(`rhythm-checkbox-${step}-${voice}`);
      if (checkbox) {
        checkbox.addEventListener('input', () => {
          const sysexAddress = BASE_ADDRESS_RHYTHM + step;
          let patternValue = currentValues[sysexAddress] ?? 0;
          if (checkbox.checked) {
            patternValue |= (1 << voice);
          } else {
            patternValue &= ~(1 << voice);
          }
          rhythmPattern[step] = patternValue;
          currentValues[sysexAddress] = patternValue;
          controller.sendParameter(sysexAddress, patternValue);
          markEdited();
          // console.log(`[rhythm-checkbox] Step ${step}, Voice ${voice}, Pattern ${patternValue}`);
        });
      }
    }
  }
}

async function initialize() {
  await initializeDefaultValues();
  loadTheme();
  await setupParameterControls();
  setupRhythmGridControls();
  controller.onConnectionChange = updateConnectionStatus;
  controller.onDataReceived = handleDataReceived;
  const connected = await controller.initialize();
  if (connected) loadBankSettings(0);
  document.getElementById("theme-select")?.addEventListener("change", e => setTheme(e.target.value));
}

document.getElementById("bank_number_selection")?.addEventListener("change", (e) => {
  targetBank = parseInt(e.target.value);
  console.log(`[bank_number_selection] Selected target bank ${targetBank + 1}`);
});

document.getElementById("save-to-bank-btn")?.addEventListener("click", () => {
  if (!deviceReady()) return;
  const bankSelect = document.getElementById("bank_number_selection");
  const saveBank = parseInt(bankSelect.value);
  // saving over another bank replaces it, and the minichord moves to it
  if (saveBank !== currentBankNumber && !confirm(`Save the settings from bank ${currentBankNumber + 1} over bank ${saveBank + 1}?\n\n` +
      `What bank ${saveBank + 1} holds now is replaced, and the minichord moves to bank ${saveBank + 1}.`)) return;
  console.log(`[save-to-bank-btn] Saving to bank ${saveBank + 1}`);
  controller.saveCurrentSettings(saveBank);
  noteBankName(saveBank, presetName(currentValues));   // the live sound's name goes with it
  bankCacheStale();
  markClean();
  if (snapshotBank >= 0) unsavedAtSnapshot = true; // the bank no longer holds what the snapshot does
  showNotification(saveBank === currentBankNumber ? `Saved to bank ${saveBank + 1}`
    : `Saved to bank ${saveBank + 1}, and moved to it`, "success");
});

// The name box in the toolbar: the live sound's name, sent once it is typed (Enter, or leaving the
// box) and kept with the preset by save, as any other change. Escape puts back what it was.
const presetNameBox = document.getElementById("preset-name");
function showPresetName() {
  if (presetNameBox && document.activeElement !== presetNameBox) presetNameBox.value = presetName(currentValues);
}
presetNameBox?.addEventListener("change", () => {
  if (!deviceReady() || !namesOnDevice()) return;
  const name = plainName(presetNameBox.value);
  presetNameBox.value = name;
  if (name === presetName(currentValues)) return;
  const values = [];
  setPresetName(values, name);
  for (let k = 0; k < NAME_SLOTS; k++) {
    const a = NAME_FIRST + k;
    currentValues[a] = values[a];
    controller.sendParameter(a, values[a]);
  }
  markEdited();
  refreshStatus();   // the bubble gives the new name
});
presetNameBox?.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); presetNameBox.blur(); }
  if (e.key === "Escape") { e.preventDefault(); presetNameBox.value = presetName(currentValues); presetNameBox.blur(); }
});

document.getElementById("load-bank-btn")?.addEventListener("click", () => {
  if (!deviceReady()) return;
  const bank = parseInt(document.getElementById("bank_number_selection").value);
  if (!okToDropEdits(`Load bank ${bank + 1}?`)) return;
  console.log(`[load-bank-btn] Loading bank ${bank + 1}`);
  // the minichord reports the bank's settings back by itself once it has loaded it
  controller.sendSysEx([0, 0, 4, bank]);
  snapshotBank = -1; // loading a bank drops the snapshot
  markClean();
  showNotification(`Loaded bank ${bank + 1}`, "success");
});

document.getElementById("snapshot-btn")?.addEventListener("click", () => {
  if (!deviceReady()) return;
  // From firmware 39 a snapshot can replace the one held, which is also what clears one the page
  // has lost track of (it was reloaded). Before that the minichord keeps the first.
  const replaces = snapshotReplaces();
  if (snapshotBank >= 0) {
    if (!replaces) {
      showNotification(`A snapshot from bank ${snapshotBank + 1} is held: revert to it or load a bank first`, "error");
      return;
    }
    if (!confirm(`Replace the snapshot taken on bank ${snapshotBank + 1}? The settings it holds can't be got back.`)) return;
  }
  controller.sendSysEx([0, 0, 5, replaces ? 1 : 0]);
  snapshotBank = currentBankNumber;
  unsavedAtSnapshot = unsavedEdits;
  showNotification("Snapshot taken", "success");
});

document.getElementById("revert-btn")?.addEventListener("click", () => {
  if (!deviceReady()) return;
  if (snapshotBank < 0) {
    showNotification("No snapshot taken", "error");
    return;
  }
  if (snapshotBank !== currentBankNumber &&
      !confirm(`The snapshot was taken on bank ${snapshotBank + 1}. Put its settings onto bank ${currentBankNumber + 1}?`)) {
    return;
  }
  // the minichord puts the settings back and reports them, which refreshes the page
  controller.sendSysEx([0, 0, 6, 0]);
  snapshotBank = -1;
  unsavedEdits = handEdits = unsavedAtSnapshot;
  refreshStatus();
  showNotification("Reverted to snapshot", "success");
});

// The settings drawer: its reset button names the target bank it would erase, and a button that
// opens something of its own (the bank sheet, a file) closes the drawer, which would sit over it
function labelResetBank() {
  const button = document.getElementById("reset-bank-btn");
  const select = document.getElementById("bank_number_selection");
  if (!button || !select) return;
  const bank = parseInt(select.value), name = bankNameShown(bank);
  button.textContent = `reset bank ${bank + 1}` + (name ? ` · ${name}` : "");
}
document.getElementById("bank_number_selection")?.addEventListener("change", labelResetBank);
document.getElementById("settings-drawer")?.addEventListener("toggle", e => {
  if (e.newState === "open") labelResetBank();
});
document.getElementById("settings-drawer")?.addEventListener("click", e => {
  if (e.target.closest("[data-close-settings]")) e.currentTarget.hidePopover();
});
// with no minichord, the bubble saying so opens the drawer at how to connect one
document.getElementById("notification-bubble")?.addEventListener("click", () => {
  if (minichord_device) return;
  const help = document.getElementById("connection-help");
  if (help) help.open = true;
  document.getElementById("settings-drawer")?.showPopover();
});

document.getElementById("reset-bank-btn")?.addEventListener("click", () => {
  if (!deviceReady()) return;
  const bank = parseInt(document.getElementById("bank_number_selection").value);
  // resetting another bank moves the minichord to it, which drops what wasn't saved here
  const away = bank !== currentBankNumber;
  const after = away
    ? ` The minichord moves to bank ${bank + 1}` + (unsavedEdits ? `, and the unsaved changes to bank ${currentBankNumber + 1} are lost.` : ".")
    : (unsavedEdits ? " The unsaved changes go with it." : "");
  const name = bankNameShown(bank);
  if (!confirm(`Reset bank ${bank + 1}${name ? ` (${name})` : ""} to its factory settings?\n\n` +
      `What bank ${bank + 1} holds now is erased. This can't be undone.${after}`)) return;
  console.log(`[reset-bank-btn] Resetting bank ${bank + 1}`);
  controller.resetBank(bank);
  bankCacheStale();
  markClean();
  // the name was for the preset that is gone
  const names = bankNamesGet();
  names[bank] = "";
  bankNamesSet(names);
  noteBankName(bank, "");
  showNotification(away ? `Reset bank ${bank + 1}, and moved to it` : `Reset bank ${bank + 1}`, "success");
});

document.getElementById("reset-all-banks-btn")?.addEventListener("click", () => {
  if (!deviceReady()) return;
  if (!confirm("Reset all twelve banks to their factory settings?\n\n" +
      "Every preset on the minichord is erased. This can't be undone: use \"back up all banks\" first to keep a copy.")) return;
  console.log("[reset-all-banks-btn] Resetting all banks");
  controller.resetMemory();
  bankCacheStale();
  markClean();
  bankNamesSet([]);
  for (let b = 0; b < 12; b++) noteBankName(b, "");
  showNotification("Reset all banks: the minichord is on bank 1", "success");
});

document.getElementById("export-settings-btn")?.addEventListener("click", async () => {
  if (!deviceReady()) return;
  const sysexArray = Array(controller.parameter_size).fill(0);
  Object.entries(currentValues).forEach(([sysex, value]) => {
    sysexArray[parseInt(sysex)] = value;
  });
  for (let i = 0; i < 16; i++) {
    sysexArray[BASE_ADDRESS_RHYTHM + i] = rhythmPattern[i] || 0;
  }
  // A code holds page 0 alone while page 1 is all at its defaults, as every code from before the
  // array grew did, so an editor that knows only page 0 still reads it; both pages otherwise. A
  // name alone doesn't make it the longer code: it goes with the code only when page 1 does.
  const page1AtDefaults = Object.entries(controller.page1_defaults)
    .every(([sysex, value]) => isNameAddress(+sysex) || sysexArray[sysex] === value);
  const codeLength = page1AtDefaults || !controller.has_page1 ? controller.page_size : controller.parameter_size;
  const outputBase64 = sysexArray.slice(0, codeLength).join(";");
  const encoded = btoa(outputBase64);
  console.log(`[export-settings-btn] Exported settings: ${encoded}`);
  try {
    await navigator.clipboard.writeText(encoded);
    showNotification("Preset code copied to clipboard", "success");
  } catch (error) {
    // no clipboard (permission, or a page not in focus): hand the code over to copy by hand
    prompt("Copy this preset code", encoded);
  }
});

document.getElementById("load-settings-btn")?.addEventListener("click", () => {
  if (!deviceReady()) return;
  const presetCode = prompt("Paste preset code");
  if (!presetCode) return;
  try {
    const parameters = atob(presetCode.trim()).split(";").map(v => parseFloat(v));
    // page 0 alone (every code from before the array grew) or both pages
    if (parameters.length !== controller.page_size && parameters.length !== controller.parameter_size) {
      console.warn("[load-settings-btn] Malformed preset code");
      showNotification("Malformed preset code", "error");
      return;
    }
    if (handEdits && !confirm(`Load this preset? It replaces the changes made to bank ${currentBankNumber + 1}, which aren't saved.`)) return;
    controller.applyPreset(parameters, (i, value) => {
      if (!findParameterBySysex(i)) return;
      value = Math.round(value);
      controller.sendParameter(i, value);
      currentValues[i] = value;
    });
    markEdited(false);
    console.log("[load-settings-btn] Loaded settings");
    showNotification("Preset loaded: save to a bank to keep it", "success");
  } catch (error) {
    console.warn("[load-settings-btn] Invalid preset code:", error);
    showNotification("Invalid preset code", "error");
  }
});

document.getElementById("randomise_btn")?.addEventListener("click", generateRandomPreset);

// The looper: each button writes setting 256 once, an action the minichord takes and forgets
// (1 record, 2 play, 3 stop, 4 clear, 5 overdub on or off). Chord memory's buttons work the same
// way on setting 287 (data-address).
document.querySelectorAll(".looper-btn").forEach(button => button.addEventListener("click", () => {
  if (!deviceReady()) return;
  controller.sendParameter(parseInt(button.dataset.address || "256"), parseInt(button.dataset.looperAction));
}));

initialize();