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
// RANDOMISE leaves these alone: device, MIDI, tuning, double tap and hover settings
const RANDOMISE_FIXED = [32, 33, 34, 35, 41, 97, 106, 107, 108, 109, 110, 117, 197, 200, 201, 209, 210, 211, 212, 237, 238,
  241, 242, 243, 244, 249, 250, 251];

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
    const bankText = currentBankNumber >= 0 ? ` | Bank ${currentBankNumber + 1}` : '';
    textElement.textContent = connected ? `minichord connected${bankText}` : "minichord disconnected";
    bubbleElement.style.display = 'flex';
  }
  if (message && !isShowingNotification) {
    showNotification(message, connected ? "success" : "error");
  }
  if (!connected) {
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
  }, 3000);
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
          const valuePercent = ((element.value - element.min) / (element.max - element.min)) * 100;
          element.style.background = `linear-gradient(to right, var(--primary-color) 0%, var(--primary-color) ${valuePercent}%, ${sliderTrackColor()} 0%, ${sliderTrackColor()} 100%)`;
          if (sysex === 20) updateUIColor();
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
            const valuePercent = ((element.value - element.min) / (element.max - element.min)) * 100;
            element.style.background = `linear-gradient(to right, var(--primary-color) 0%, var(--primary-color) ${valuePercent}%, ${sliderTrackColor()} 0%, ${sliderTrackColor()} 100%)`;
            if (sysex === 20) updateUIColor();
            // console.log(`[text-input] Param ${sysex}, Value=${inputValue}`);
          });
        }
      } else if (uiType === 'select') {
        element.addEventListener('change', () => {
          const value = parseInt(element.value);
          tempValues[sysex] = value;
          currentValues[sysex] = value;
          controller.sendParameter(sysex, value);
          if (sysex === 20) updateUIColor();
          refreshFollower(sysex);
        });
      } else if (uiType === 'switch') {
        element.addEventListener('input', () => {
          const value = element.checked ? 1 : 0;
          tempValues[sysex] = value;
          currentValues[sysex] = value;
          controller.sendParameter(sysex, value);
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
          });
        });
      }
    });
  });
  updateUIColor();
}

function handleDataReceived(data) {
  // console.log(`[handleDataReceived] Bank=${data.bankNumber}, parameters.length=${data.parameters.length}`);
  if (data.firmwareVersion === undefined || isNaN(data.firmwareVersion)) {
    console.warn("[handleDataReceived] Invalid or missing firmware version");
    showNotification("Invalid firmware version", "error");
    return;
  }
  currentValues = {};
  data.parameters.forEach((value, sysex) => {
    if (value !== undefined) {
      const param = findParameterBySysex(sysex);
      if (param) currentValues[sysex] = value;
    }
  });
  applyOverrideDefaults(currentValues);
  rhythmPattern = data.rhythmData.map(bits => bits.reduce((acc, bit, i) => acc | (bit ? (1 << i) : 0), 0));
  targetBank = data.bankNumber;
  updateUI(data.bankNumber);
  // Toggle active/inactive based on firmware version
  document.querySelectorAll('input:not(.always-on), button:not(.always-on), select:not(.always-on)').forEach(element => {
    const requiredVersion = parseFloat(element.getAttribute('version') || 0.01);
    if (requiredVersion <= data.firmwareVersion) {
      element.classList.add('active');
      element.classList.remove('inactive');
    } else {
      element.classList.add('inactive');
      element.classList.remove('active');
    }
  });
}

async function updateUI(bankNumber) {
  if (bankNumber < 0) {
    console.warn(`[updateUI] Invalid bank number: ${bankNumber}`);
    return;
  }
  console.log(`[updateUI] Bank ${bankNumber + 1}, targetBank=${targetBank + 1}`);
  currentBankNumber = bankNumber;
  const bankSelect = document.getElementById("bank_number_selection");
  if (bankSelect && parseInt(bankSelect.value) !== bankNumber) {
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
  if (!controller.isConnected()) {
    document.getElementById("information_zone")?.focus();
    showNotification("No device connected", "error");
    return;
  }
  
  const parameterRanges = await loadParameterRanges();
  const weirdness_factor = 0.10;
  const preset = Array(256).fill(0);
  
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
  
  for (let i = 2; i < 256; i++) {
    if (preset[i] !== undefined && parameterRanges[i]) {
      const param = findParameterBySysex(i);
      if (!param) continue;
      const floatMultiplier = getFloatMultiplier(param);
      const valueToSend = param.data_type === 'float' ? Math.round(preset[i] * floatMultiplier) : preset[i];
      controller.sendParameter(i, valueToSend);
      currentValues[i] = valueToSend;
    }
  }
  
  controller.sendParameter(0, 0);
  console.log("[generateRandomPreset] Random preset applied");
  showNotification("Random preset applied", "success");
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
  if (!controller.isConnected()) {
    console.warn("[save-to-bank-btn] No device connected");
    document.getElementById("information_zone")?.focus();
    return;
  }
  const bankSelect = document.getElementById("bank_number_selection");
  const saveBank = parseInt(bankSelect.value);
  console.log(`[save-to-bank-btn] Saving to bank ${saveBank + 1}`);
  controller.saveCurrentSettings(saveBank);
  bankCacheStale();
  showNotification(`Saved to bank ${saveBank + 1}`, "success");
});

document.getElementById("load-bank-btn")?.addEventListener("click", () => {
  if (!controller.isConnected()) {
    console.warn("[load-bank-btn] No device connected");
    document.getElementById("information_zone")?.focus();
    return;
  }
  const bank = parseInt(document.getElementById("bank_number_selection").value);
  console.log(`[load-bank-btn] Loading bank ${bank + 1}`);
  // the minichord reports the bank's settings back by itself once it has loaded it
  controller.sendSysEx([0, 0, 4, bank]);
  snapshotBank = -1; // loading a bank drops the snapshot
  showNotification(`Loaded bank ${bank + 1}`, "success");
});

document.getElementById("snapshot-btn")?.addEventListener("click", () => {
  if (!controller.isConnected()) {
    console.warn("[snapshot-btn] No device connected");
    document.getElementById("information_zone")?.focus();
    return;
  }
  if (snapshotBank >= 0) {
    // the minichord keeps the first snapshot and ignores another until it is reverted
    showNotification("A snapshot is already held: revert to it first", "error");
    return;
  }
  controller.sendSysEx([0, 0, 5, 0]);
  snapshotBank = currentBankNumber;
  showNotification("Snapshot taken", "success");
});

document.getElementById("revert-btn")?.addEventListener("click", () => {
  if (!controller.isConnected()) {
    console.warn("[revert-btn] No device connected");
    document.getElementById("information_zone")?.focus();
    return;
  }
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
  showNotification("Reverted to snapshot", "success");
});

document.getElementById("reset-bank-btn")?.addEventListener("click", () => {
  if (!controller.isConnected()) {
    console.warn("[reset-bank-btn] No device connected");
    document.getElementById("information_zone")?.focus();
    return;
  }
  console.log(`[reset-bank-btn] Resetting bank ${currentBankNumber + 1}`);
  controller.resetCurrentBank();
  bankCacheStale();
  showNotification(`Reset bank ${currentBankNumber + 1}`, "success");
});

document.getElementById("reset-all-banks-btn")?.addEventListener("click", () => {
  if (!controller.isConnected()) {
    console.warn("[reset-all-banks-btn] No device connected");
    document.getElementById("information_zone")?.focus();
    return;
  }
  console.log("[reset-all-banks-btn] Resetting all banks");
  controller.resetMemory();
  bankCacheStale();
  showNotification("Reset all banks", "success");
});

document.getElementById("export-settings-btn")?.addEventListener("click", () => {
  if (!controller.isConnected()) {
    console.warn("[export-settings-btn] No device connected");
    document.getElementById("information_zone")?.focus();
    return;
  }
  const sysexArray = Array(256).fill(0);
  Object.entries(currentValues).forEach(([sysex, value]) => {
    sysexArray[parseInt(sysex)] = value;
  });
  for (let i = 0; i < 16; i++) {
    sysexArray[BASE_ADDRESS_RHYTHM + i] = rhythmPattern[i] || 0;
  }
  const outputBase64 = sysexArray.join(";");
  const encoded = btoa(outputBase64);
  navigator.clipboard.writeText(encoded);
  console.log(`[export-settings-btn] Exported settings: ${encoded}`);
  showNotification("Preset code copied to clipboard", "success");
});

document.getElementById("load-settings-btn")?.addEventListener("click", () => {
  if (!controller.isConnected()) {
    console.warn("[load-settings-btn] No device connected");
    document.getElementById("information_zone")?.focus();
    return;
  }
  const presetCode = prompt("Paste preset code");
  if (!presetCode) return;
  try {
    const parameters = atob(presetCode).split(";").map(v => parseFloat(v));
    if (parameters.length !== 256) {
      console.warn("[load-settings-btn] Malformed preset code");
      showNotification("Malformed preset code", "error");
      return;
    }
    for (let i = 2; i < parameters.length; i++) {
      const param = findParameterBySysex(i);
      if (param) {
        const value = param.data_type === "float" ? Math.round(parameters[i]) : Math.round(parameters[i]);
        controller.sendParameter(i, value);
        currentValues[i] = value;
      }
    }
    controller.sendParameter(0, 0);
    console.log("[load-settings-btn] Loaded settings");
    showNotification("Preset loaded", "success");
  } catch (error) {
    console.warn("[load-settings-btn] Invalid preset code:", error);
    showNotification("Invalid preset code", "error");
  }
});

document.getElementById("randomise_btn")?.addEventListener("click", generateRandomPreset);

initialize();