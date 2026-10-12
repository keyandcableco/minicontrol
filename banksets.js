//-->>BANK SETS: twelve presets to choose from, or to mix into your own twelve
// The sets are banksets.json's (generate_banksets.py lists them from presets/ and banksets/),
// and any set file loaded from this computer. "Your 12" starts as the minichord's banks kept as
// they are; a preset dropped into one is written to that bank, and only those banks are written.
// Each set is a backup file (banks.js's format), so a set saved here restores like any backup,
// and one shared on GitHub joins the list once merged.

const BANKSETS_URL = "banksets.json";
const SHARE_URL = "https://github.com/keyandcableco/minicontrol/upload/main/banksets";
const MINE_KEY = "minicontrol_my_twelve";
const IMPORTED_KEY = "minicontrol_imported_sets";
const IMPORTED_MAX = 6;

const banksetsSheet = document.getElementById("banksets-sheet");
let banksets = null;           // the sets listed, ours and shared, then any loaded from a file
const setFiles = {};           // set id -> its file, once fetched
const setsOpen = new Set();    // the sets whose presets are shown
let mine = Array(BANK_COUNT).fill(null);   // per bank: null (kept) or { set, title, name, blurb, hue, values, written }
let minePicked = 0;            // the bank the next preset added goes into
let saving = false;            // the save form is open

const bsEsc = text => String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function storeGet(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { }
}

// ---- the sets ----

async function loadBanksets() {
  if (banksets) return;
  let listed = [];
  try {
    listed = (await fetch(BANKSETS_URL).then(r => r.json())).banksets || [];
  } catch (e) {
    console.warn("[bank sets] Couldn't read the list:", e);
  }
  const imported = storeGet(IMPORTED_KEY, []).filter(s => s && s.data && !backupProblem(s.data));
  imported.forEach(s => { setFiles[s.id] = s.data; });
  banksets = [...listed, ...imported.map(s => ({ ...s, data: undefined }))];
}

async function setFile(set) {
  if (setFiles[set.id]) return setFiles[set.id];
  const data = await fetch(set.file).then(r => r.json());
  const problem = backupProblem(data);
  if (problem) throw new Error(problem);
  setFiles[set.id] = data;
  return data;
}

// a set file's bank entries, by bank number
function setEntry(data, bank) {
  return data.banks.find(e => e.bank === bank);
}

// what a set file says of itself, for the list: as generate_banksets.py lists a shared set
function describeSetFile(data, fallbackTitle) {
  return {
    title: String(data.title || fallbackTitle).slice(0, 60),
    author: String(data.author || "you").slice(0, 40),
    description: String(data.description || "").slice(0, 600),
    firmware: Number.isInteger(data.firmware_version) ? data.firmware_version : null,
    presets: data.banks.slice().sort((a, b) => a.bank - b.bank).map(e => ({
      bank: e.bank, name: (e.name || "bank " + (e.bank + 1)).slice(0, 24),
      hue: Number.isInteger(e.values[BANK_HUE_ADDRESS]) ? e.values[BANK_HUE_ADDRESS] : null,
      blurb: String(e.blurb || "").slice(0, 300),
    })),
  };
}

function firmwareNow() {
  return controller.firmware_version != null ? Math.round(controller.firmware_version * 100) : null;
}

// ---- your twelve ----

function saveMine() {
  storeSet(MINE_KEY, mine);
}

function loadMine() {
  const kept = storeGet(MINE_KEY, null);
  if (Array.isArray(kept) && kept.length === BANK_COUNT) {
    mine = kept.map(m => (m && Array.isArray(m.values) && !backupProblem({ minichord_backup: 1, banks: [{ bank: 0, values: m.values }] }) ? m : null));
  }
}

async function putPreset(set, bank, slot) {
  const data = await setFile(set);
  const entry = setEntry(data, bank);
  if (!entry) return;
  const shown = set.presets.find(p => p.bank === bank) || {};
  mine[slot] = { set: set.id, title: set.title, name: entry.name || shown.name || "", blurb: shown.blurb || "",
                 hue: entry.values[BANK_HUE_ADDRESS] ?? shown.hue, values: entry.values.slice(), written: false };
  saveMine();
}

// the next bank to fill after one: the next one still kept, else simply the next
function nextSlot(from) {
  for (let i = 1; i <= BANK_COUNT; i++) {
    const s = (from + i) % BANK_COUNT;
    if (!mine[s]) return s;
  }
  return (from + 1) % BANK_COUNT;
}

const toWrite = () => mine.map((m, i) => (m && !m.written ? i : -1)).filter(i => i >= 0);

// a bank kept as it is, as the bank sheet last read it, if it has
function keptName(i) {
  if (bankState.read && bankState.original && bankState.original[i]) {
    return (namesOnDevice() ? presetName(bankState.original[i]) : (bankState.originalNames || [])[i]) || "";
  }
  return "";
}

// ---- hearing one, and writing ----

async function hearPreset(set, bank) {
  if (!deviceReady()) return;
  const data = await setFile(set);
  const entry = setEntry(data, bank);
  if (!entry) return;
  if (handEdits && !confirm(`Hear ${entry.name || "this preset"}? It replaces the changes made to bank ${currentBankNumber + 1}, which aren't saved.`)) return;
  const values = restoreValues(entry);
  // what the set leaves to the minichord (MIDI, the plate, USB audio) stays as it is
  for (let a = 0; a < controller.parameter_size; a++) if (values[a] == null) values[a] = currentValues[a] ?? 0;
  controller.applyPreset(values, (i, value) => {
    if (!findParameterBySysex(i)) return;
    value = Math.round(value);
    controller.sendParameter(i, value);
    currentValues[i] = value;
  });
  markEdited(false);
  showNotification(`Playing ${entry.name || "the preset"}: save to a bank to keep it`, "success");
}

async function writeMine() {
  if (!deviceReady()) return;
  const banks = toWrite();
  if (!banks.length) return;
  const fw = firmwareNow();
  const newer = [...new Set(banks.map(i => mine[i].values[controller.firmware_adress]).filter(v => fw != null && v > fw))];
  const note = newer.length ? `\n\nSome were made on firmware ${Math.max(...newer)} and this minichord has ${fw}: settings it doesn't have yet are left out.` : "";
  if (!confirm(`Write ${banks.length === 1 ? "bank " + (banks[0] + 1) : "banks " + banks.map(i => i + 1).join(", ")} to the minichord? ` +
    `What ${banks.length === 1 ? "it holds" : "they hold"} now is replaced. Back up first if you want to keep it.` + note + unsavedNote())) return;
  if (!deviceReady()) return;
  bankState.busy = true;
  const startingBank = controller.active_bank_number;
  try {
    for (let n = 0; n < banks.length; n++) {
      const i = banks[n];
      showProgress(`Writing bank ${i + 1} (${n + 1} of ${banks.length})…`);
      const values = restoreValues({ name: mine[i].name, values: mine[i].values });
      await writeBank(i, values);
      noteBankName(i, presetName(values));
      mine[i].written = true;
      saveMine();
    }
    showNotification(`Wrote ${banks.length === 1 ? "1 bank" : banks.length + " banks"}`, "success");
  } catch (e) {
    showNotification(`Couldn't write: ${e.message}. Some banks may already have been written.`, "error");
  } finally {
    bankCacheStale();
    await returnToBank(startingBank);
    showProgress(null);
    bankState.busy = false;
  }
  renderBanksets();
}

// Your twelve as a set file: the presets put in, and the banks kept as the minichord has them
// where the bank sheet has read them
function mineAsFile(title, author, description) {
  const banks = [];
  mine.forEach((m, i) => {
    if (m) banks.push({ bank: i, name: m.name, blurb: m.blurb || undefined, values: m.values });
    else if (bankState.read && bankState.original && bankState.original[i]) {
      banks.push({ bank: i, name: keptName(i), values: bankState.original[i].slice() });
    }
  });
  const firmware = banks.map(b => b.values[controller.firmware_adress]).filter(Number.isInteger);
  return {
    minichord_backup: BACKUP_FORMAT,
    title, author, description,
    created: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"),
    firmware_version: firmware.length ? Math.max(...firmware) : null,
    parameter_size: Math.max(...banks.map(b => b.values.length)),
    banks,
  };
}

function loadSetFile() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "application/json,.json";
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { showNotification("That file isn't valid JSON", "error"); return; }
    const problem = backupProblem(data);
    if (problem) { showNotification(problem, "error"); return; }
    const set = await addLocalSet(data, f.name.replace(/\.json$/i, ""));
    renderBanksets();
    showNotification(`Added ${set.title}`, "success");
  });
  inp.click();
}

// A set file joins the list, kept in this browser with the newest few (the instruction box's
// "save these banks as a set" adds one too)
async function addLocalSet(data, fallbackTitle) {
  await loadBanksets();
  const id = "file-" + Date.now();
  const set = { id, ...describeSetFile(data, fallbackTitle), local: true };
  setFiles[id] = data;
  banksets.push(set);
  setsOpen.add(id);
  const imported = storeGet(IMPORTED_KEY, []).concat([{ ...set, data }]).slice(-IMPORTED_MAX);
  storeSet(IMPORTED_KEY, imported);
  return set;
}

function forgetSetFile(id) {
  banksets = banksets.filter(s => s.id !== id);
  delete setFiles[id];
  storeSet(IMPORTED_KEY, storeGet(IMPORTED_KEY, []).filter(s => s.id !== id));
  renderBanksets();
}

// ---- the sheet ----

function swatch(hue) {
  return `<span class="bank-swatch"${hue != null ? ` style="background:hsl(${hue}, 100%, 50%)"` : ""}></span>`;
}

function mineHtml() {
  const kept = mine.filter(m => !m).length;
  let html = `<div class="bs-head"><h3>your 12</h3>` +
    (mine.some(Boolean) ? `<button type="button" class="bs-quiet" data-bs="clear-all">clear</button>` : "") + `</div>` +
    `<p class="bs-note">Pick a bank, then add a preset to it, or drag one in. ` +
    (kept ? `Banks left empty stay as they are.` : ``) + `</p><ol class="bs-mine">`;
  mine.forEach((m, i) => {
    const picked = i === minePicked;
    const name = m ? m.name : keptName(i);
    html += `<li class="bs-slot${picked ? " picked" : ""}${m ? (m.written ? " written" : " chosen") : " kept"}" data-slot="${i}" draggable="${m ? "true" : "false"}">` +
      `<button type="button" class="bs-slot-pick" data-bs="pick" data-slot="${i}" aria-pressed="${picked}" ` +
      `title="${m ? bsEsc(m.blurb || m.name) : "kept as it is on the minichord"}">` +
      `<span class="bs-num">${i + 1}</span>${m ? swatch(m.hue) : `<span class="bank-swatch bs-empty"></span>`}` +
      `<span class="bs-slot-name">${bsEsc(name || (m ? "no name" : "kept as it is"))}</span>` +
      `<span class="bs-slot-from">${m ? bsEsc(m.title) + (m.written ? " · written" : "") : name ? "kept as it is" : ""}</span></button>` +
      (m ? `<button type="button" class="bs-x" data-bs="unset" data-slot="${i}" aria-label="keep bank ${i + 1} as it is">×</button>` : "") +
      `</li>`;
  });
  html += `</ol>`;
  if (!bankState.read) {
    html += `<p class="bs-note">Kept banks show their names once the minichord's banks are read. ` +
      `<button type="button" class="bs-quiet" data-bs="read">read them</button></p>`;
  }
  return html;
}

function setHtml(set) {
  const open = setsOpen.has(set.id);
  const fw = firmwareNow();
  const newer = set.firmware != null && fw != null && set.firmware > fw;
  let html = `<article class="bs-set${open ? " open" : ""}" data-set="${bsEsc(set.id)}">` +
    `<div class="bs-set-head"><div class="bs-swatches">${set.presets.map(p => swatch(p.hue)).join("")}</div>` +
    `<h4>${bsEsc(set.title)}</h4><span class="bs-by">${set.local ? "from your computer" : "by " + bsEsc(set.author)}` +
    `${set.firmware ? " · firmware " + set.firmware : ""}</span></div>` +
    (newer ? `<p class="bs-warn">Made for firmware ${set.firmware}; this minichord has ${fw}, so its newest settings won't play.</p>` : "") +
    (set.description ? `<p class="bs-about">${bsEsc(set.description)}</p>` : "") +
    `<div class="bs-set-actions"><button type="button" data-bs="toggle">${open ? "hide" : "show"} the 12</button>` +
    `<button type="button" data-bs="use-all">use all 12</button>` +
    (set.local ? `<button type="button" class="bs-quiet" data-bs="forget">remove</button>` : "") + `</div>`;
  if (open) {
    html += `<ol class="bs-presets">` + set.presets.map(p =>
      `<li class="bs-preset" draggable="true" data-bank="${p.bank}">${swatch(p.hue)}` +
      `<span class="bs-preset-text"><span class="bs-preset-name">${bsEsc(p.name)}</span>` +
      (p.blurb ? `<span class="bs-preset-blurb" title="${bsEsc(p.blurb)}">${bsEsc(p.blurb)}</span>` : "") + `</span>` +
      `<button type="button" data-bs="hear" data-bank="${p.bank}" aria-label="hear ${bsEsc(p.name)}">hear</button>` +
      `<button type="button" data-bs="add" data-bank="${p.bank}" aria-label="put ${bsEsc(p.name)} in bank ${minePicked + 1}">to ${minePicked + 1}</button></li>`).join("") +
      `</ol>`;
  }
  return html + `</article>`;
}

function saveHtml() {
  if (!saving) return "";
  const partial = mine.some((m, i) => !m && !(bankState.read && bankState.original && bankState.original[i]));
  return `<form class="bs-save" data-bs-form="save">` +
    `<label>name of the set <input name="title" maxlength="60" required autocomplete="off"></label>` +
    `<label>your name <input name="author" maxlength="40" autocomplete="off"></label>` +
    `<label>what it's for <textarea name="description" maxlength="600" rows="2"></textarea></label>` +
    (partial ? `<p class="bs-note">Kept banks go in only once the minichord's banks are read; the file has the presets you put in.</p>` : "") +
    `<div class="bs-save-actions"><button type="submit">save the file</button><button type="button" class="bs-quiet" data-bs="cancel-save">cancel</button></div>` +
    `<p class="bs-note">To share it, <a href="${SHARE_URL}" target="_blank" rel="noopener">upload the file on GitHub</a>: ` +
    `once it's added, everyone can pick it here.</p></form>`;
}

function renderBanksets() {
  const body = document.getElementById("banksets-body");
  if (!body || !banksets) return;
  const focus = document.activeElement?.closest?.("[data-bs]")?.dataset;
  const pending = toWrite();
  const ours = banksets.filter(s => !s.shared && !s.local), shared = banksets.filter(s => s.shared), local = banksets.filter(s => s.local);
  body.innerHTML =
    `<div class="bs-layout"><section class="bs-mine-panel">${mineHtml()}</section><section class="bs-sets-panel">` +
    (ours.length ? `<h3>sets</h3>${ours.map(setHtml).join("")}` : "") +
    (shared.length ? `<h3>shared by players</h3>${shared.map(setHtml).join("")}` : "") +
    (local.length ? `<h3>from your computer</h3>${local.map(setHtml).join("")}` : "") +
    (!banksets.length ? `<p class="bs-note">Couldn't read the list of sets.</p>` : "") +
    `<button type="button" class="bs-quiet" data-bs="load-file">load a set file…</button></section></div>`;
  document.getElementById("banksets-save").innerHTML = saveHtml();
  document.getElementById("banksets-summary").textContent = !pending.length ? (mine.some(Boolean) ? "Nothing new to write" : "Nothing to write yet")
    : (pending.length === 1 ? "Bank " : "Banks ") + pending.map(i => i + 1).join(", ") + " will be rewritten";
  const write = document.getElementById("banksets-write");
  write.textContent = pending.length ? `write ${pending.length === 1 ? "1 bank" : pending.length + " banks"} to the minichord` : "write to the minichord";
  write.disabled = !pending.length || bankState.busy;
  document.getElementById("banksets-save-btn").disabled = !mine.some(Boolean) && !bankState.read;
  alwaysOn(body);
  alwaysOn(document.getElementById("banksets-save"));
  if (focus?.bs) body.querySelector(`[data-bs="${focus.bs}"]${focus.slot ? `[data-slot="${focus.slot}"]` : ""}`)?.focus();
}

async function openBanksets() {
  if (!banksetsSheet) return;
  loadMine();
  banksetsSheet.showPopover();
  document.getElementById("banksets-body").innerHTML = `<p class="bs-note">Reading the sets…</p>`;
  await loadBanksets();
  renderBanksets();
}

banksetsSheet?.addEventListener("click", async e => {
  const button = e.target.closest("[data-bs]");
  if (!button) return;
  const action = button.dataset.bs;
  const set = banksets?.find(s => s.id === button.closest("[data-set]")?.dataset.set);
  const slot = button.dataset.slot != null ? parseInt(button.dataset.slot) : null;
  const bank = button.dataset.bank != null ? parseInt(button.dataset.bank) : null;
  try {
    if (action === "pick") minePicked = slot;
    if (action === "unset") { mine[slot] = null; saveMine(); }
    if (action === "clear-all" && confirm("Clear your 12? Every bank goes back to being kept as it is.")) { mine = Array(BANK_COUNT).fill(null); saveMine(); }
    if (action === "toggle") setsOpen.has(set.id) ? setsOpen.delete(set.id) : setsOpen.add(set.id);
    if (action === "hear") await hearPreset(set, bank);
    if (action === "add") { await putPreset(set, bank, minePicked); minePicked = nextSlot(minePicked); }
    if (action === "use-all") {
      if (mine.some(Boolean) && !confirm(`Put all of ${set.title} in your 12, in place of what's there?`)) return;
      for (const p of set.presets) await putPreset(set, p.bank, p.bank);
    }
    if (action === "forget") forgetSetFile(set.id);
    if (action === "load-file") loadSetFile();
    if (action === "cancel-save") saving = false;
    if (action === "read") {
      if (!deviceReady() || !okToDropEdits("Read the banks? Reading them loads each bank in turn.")) return;
      bankState.busy = true;
      try {
        await loadBankParams();
        await readAllBanks((i, n) => showProgress(`Reading bank ${i + 1} of ${n}…`));
      } finally { showProgress(null); bankState.busy = false; }
    }
  } catch (error) {
    showNotification(`Couldn't read that set: ${error.message}`, "error");
  }
  renderBanksets();
});

// a preset dragged from a set onto one of your 12, or one of your 12 onto another to swap them
banksetsSheet?.addEventListener("dragstart", e => {
  const preset = e.target.closest?.(".bs-preset");
  const slot = e.target.closest?.(".bs-slot");
  if (preset) e.dataTransfer.setData("text/plain", JSON.stringify({ set: preset.closest("[data-set]").dataset.set, bank: parseInt(preset.dataset.bank) }));
  else if (slot) e.dataTransfer.setData("text/plain", JSON.stringify({ slot: parseInt(slot.dataset.slot) }));
});
banksetsSheet?.addEventListener("dragover", e => {
  const slot = e.target.closest?.(".bs-slot");
  if (!slot) return;
  e.preventDefault();
  banksetsSheet.querySelectorAll(".bs-slot.over").forEach(s => s.classList.remove("over"));
  slot.classList.add("over");
});
banksetsSheet?.addEventListener("dragleave", e => e.target.closest?.(".bs-slot")?.classList.remove("over"));
banksetsSheet?.addEventListener("drop", async e => {
  const slot = e.target.closest?.(".bs-slot");
  if (!slot) return;
  e.preventDefault();
  slot.classList.remove("over");
  let what;
  try { what = JSON.parse(e.dataTransfer.getData("text/plain")); } catch (err) { return; }
  const to = parseInt(slot.dataset.slot);
  if (what.slot != null) {
    [mine[what.slot], mine[to]] = [mine[to], mine[what.slot]];
    [mine[what.slot], mine[to]].forEach(m => { if (m) m.written = false; });
    saveMine();
  } else {
    const set = banksets.find(s => s.id === what.set);
    if (set) { try { await putPreset(set, what.bank, to); } catch (err) { showNotification(`Couldn't read that set: ${err.message}`, "error"); } }
  }
  minePicked = to;
  renderBanksets();
});

banksetsSheet?.addEventListener("submit", e => {
  const form = e.target.closest("[data-bs-form]");
  if (!form) return;
  e.preventDefault();
  const title = form.title.value.trim();
  if (!title) return;
  const data = mineAsFile(title, form.author.value.trim(), form.description.value.trim());
  if (!data.banks.length) { showNotification("Put a preset in your 12 first", "error"); return; }
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-set";
  downloadJson(data, slug + ".json");
  saving = false;
  renderBanksets();
  showNotification(`Saved ${slug}.json`, "success");
});

document.getElementById("banksets-write")?.addEventListener("click", writeMine);
document.getElementById("banksets-save-btn")?.addEventListener("click", () => {
  saving = !saving;
  renderBanksets();
  if (saving) document.querySelector("#banksets-save input[name=title]")?.focus();
});
document.getElementById("banksets-btn")?.addEventListener("click", openBanksets);
document.getElementById("banksets-drawer-btn")?.addEventListener("click", openBanksets);
