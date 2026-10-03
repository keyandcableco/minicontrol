class MiniChordController {
  constructor() {
    this.device = false;
    this.parameter_size = 256;
    this.pendingSave = false;
    this.base_adress_rythm = 220;
    this.active_bank_number = -1;
    this.firmware_adress = 7;
    this.float_multiplier = 100.0;
    this.MIDI_request_option = { sysex: true };
    this.onConnectionChange = null;
    this.onDataReceived = null;
    this.isInitializing = false; // New flag

  }

   async initialize() {
    if (this.isInitializing) return false; // Prevent concurrent initialization
    this.isInitializing = true;
    try {
      const midiAccess = await navigator.requestMIDIAccess(this.MIDI_request_option);
      return await this.handleMIDIAccess(midiAccess);
    } catch (err) {
      console.error("MIDI init failed:", err);
      if (this.onConnectionChange) {
        this.onConnectionChange(false, "MIDI init failed: " + err.message);
      }
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  async handleMIDIAccess(midiAccess) {
    let foundOutput = false;
    let foundInput = false;

    for (const output of midiAccess.outputs.values()) {
      if (output.name.toLowerCase().includes("minichord")) {
        this.device = output;
        try {
          this.device.send([0xF0, 0, 0, 0, 0, 0xF7]);
          this.sendSysEx([0, 0, 0, 0]);
          foundOutput = true;
        } catch (sendError) {
          console.error("Error sending initial SysEx:", sendError);
          this.device = false;
          if (this.onConnectionChange) {
            this.onConnectionChange(false, "Error sending initial SysEx: " + sendError.message);
          }
          return false;
        }
        break;
      }
    }
    for (const input of midiAccess.inputs.values()) {
      if (input.name.toLowerCase().includes("minichord")) {
        input.onmidimessage = (msg) => this.processCurrentData(msg);
        foundInput = true;
        break;
      }
    }
    if (!foundOutput || !foundInput) {
      this.device = false;
      if (this.onConnectionChange) {
        this.onConnectionChange(false, "minichord not found.");
      }
      return false;
    }
    midiAccess.onstatechange = (e) => this.handleStateChange(e);
    if (this.onConnectionChange) {
      this.onConnectionChange(true, "minichord connected");
    }
    return true;
  }

  handleStateChange(event) {
    const name = event.port.name.toLowerCase();
    if (event.port.state === "disconnected" && name.includes("minichord")) {
      this.device = false;
      this.pendingSave = false; // Reset pendingSave
      // Clean up input handlers
      for (const input of event.target.inputs.values()) {
        if (input.name.toLowerCase().includes("minichord")) {
          input.onmidimessage = null;
        }
      }
      if (this.onConnectionChange) {
        this.onConnectionChange(false, "minichord disconnected");
      }
    }
    if (event.port.state === "connected" && !this.device && name.includes("minichord")) {
      this.initialize(); // Note: This is async, but we don’t await it here to avoid blocking
    }
  }


  processCurrentData(midiMessage) {
  if (!midiMessage.data) {
    console.warn("[processCurrentData] No data received");
    return;
  }
  const data = midiMessage.data.slice(1);
  const expectedLength = this.parameter_size * 2 + 1;
  if (data.length !== expectedLength) {
    console.warn(`[processCurrentData] Invalid data length, got ${data.length}, expected ${expectedLength}`);
    return;
  }
  const processedData = {
    parameters: [],
    rhythmData: [],
    bankNumber: data[2 * 1],
    firmwareVersion: 0
  };
  console.log(`[processCurrentData] Received data for bank ${processedData.bankNumber}, timestamp=${Date.now()}`);
  for (let i = 2; i < this.parameter_size; i++) {
    if (2 * i + 1 >= data.length) {
      console.warn(`[processCurrentData] Data index out of bounds at i=${i}`);
      return;
    }
    const sysex_value = data[2 * i] + 128 * data[2 * i + 1];
    if (i === this.firmware_adress) {
      processedData.firmwareVersion = sysex_value / 100.0;
      console.log(`[PROCESS DATA] Firmware version: ${processedData.firmwareVersion}`);
    } else if (i >= this.base_adress_rythm && i < this.base_adress_rythm + 16) {
      const j = i - this.base_adress_rythm;
      const rhythmBits = [];
      for (let k = 0; k < 7; k++) {
        rhythmBits[k] = !!(sysex_value & (1 << k));
      }
      processedData.rhythmData[j] = rhythmBits;
      processedData.parameters[i] = sysex_value;
    } else {
      processedData.parameters[i] = sysex_value;
    }
    if (i === 32 || i === 20 || (i >= 187 && i <= 191) || i === 99 || i === 30) {
      console.log(`[PROCESS DATA] Sysex=${i}, value=${sysex_value}, bank=${processedData.bankNumber}`);
    }
  }
  this.active_bank_number = processedData.bankNumber;
  this.firmware_version = processedData.firmwareVersion;
  // every address exactly as the dump carried it, for reading a bank to write it back
  processedData.rawParameters = [];
  for (let i = 0; i < this.parameter_size; i++) {
    processedData.rawParameters[i] = data[2 * i] + 128 * data[2 * i + 1];
  }
  if (this.pendingSave && typeof currentValues !== 'undefined') {
    for (let i = 2; i < this.parameter_size; i++) {
      if (processedData.parameters[i] !== undefined && currentValues[i] !== undefined) {
        if (processedData.parameters[i] !== currentValues[i]) {
          console.warn(`[processCurrentData] Mismatch for Sysex=${i}, device=${processedData.parameters[i]}, currentValues=${currentValues[i]}`);
        }
      }
    }
  }
  if (this.onDataReceived) {
    this.onDataReceived(processedData);
  }
}

  sendSysEx(bytes) {
    if (!this.device) return;
    const isInvalid = bytes.some(b => b >= 0xF0 && b !== 0xF7);
    if (isInvalid) {
      console.error("Invalid SysEx message:", bytes);
      return;
    }
    this.device.send([0xF0, ...bytes, 0xF7]);
  }

  sendParameter(address, value) {
    if (!this.device) {
      console.warn(`sendParameter: no device connected, address=${address}, value=${value}`);
      return false;
    }
    const finalValue = Math.round(value);
    const loVal = finalValue % 128;
    const hiVal = Math.floor(finalValue / 128);
    const loAddr = address % 128;
    const hiAddr = Math.floor(address / 128);
    try {
      this.sendSysEx([loAddr, hiAddr, loVal, hiVal]);
      console.log(`[SEND PARAMETER] Sysex=${address}, value=${finalValue}`);
      return true;
    } catch (error) {
      console.error(`sendParameter: failed, address=${address}, value=${finalValue}, error=`, error);
      return false;
    }
  }

  saveCurrentSettings(bankNumber) {
    if (!this.device) {
      console.warn(`[SAVE] No device connected for bank ${bankNumber}`);
      return false;
    }
    try {
      this.pendingSave = true;
      this.sendSysEx([0, 0, 2, bankNumber]);
      console.log(`[SAVE] Sent sysex=[0, 0, 2, ${bankNumber}] for bank ${bankNumber}`);
      setTimeout(() => {
        this.pendingSave = false;
        console.log(`[SAVE] Cleared pendingSave for bank ${bankNumber}`);
      }, 500);
      return true;
    } catch (error) {
      console.error(`[SAVE] Failed to send save command for bank ${bankNumber}:`, error);
      this.pendingSave = false;
      return false;
    }
  }

  // Ask the minichord to report its live parameters (control command 0).
  requestCurrentData() {
    if (!this.device) return false;
    this.sendSysEx([0, 0, 0, 0]);
    return true;
  }

  // Ask the minichord to load a bank (control command 4); it reports the bank once loaded.
  loadBank(bankNumber) {
    if (!this.device) return false;
    this.sendSysEx([0, 0, 4, bankNumber]);
    return true;
  }

  // Load a bank and resolve with its stored parameters. Chains onto the existing
  // callback for one dump rather than replacing it; `quiet` keeps that callback
  // from running, so a walk over twelve banks doesn't redraw the page twelve times.
  readBank(bankNumber, timeoutMs, quiet) {
    if (!this.device) return Promise.reject(new Error("not connected"));
    return new Promise((resolve, reject) => {
      const previous = this.onDataReceived;
      let settled = false;
      let nudges = [];
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        nudges.forEach(clearTimeout);
        this.onDataReceived = previous;
        reject(new Error("timed out reading bank " + (bankNumber + 1)));
      }, timeoutMs || 3000);
      this.onDataReceived = data => {
        if (previous && !quiet) previous(data);
        if (settled) return;
        // A dump says which bank it describes, and it has to be checked. Loading a
        // bank reports on its own, so a dump from the previous step of a walk can
        // still be in flight; taking it would read the bank before the one asked
        // for, and writing that back copies one preset over another.
        if (data.bankNumber !== bankNumber) return;
        settled = true;
        clearTimeout(timer);
        nudges.forEach(clearTimeout);
        this.onDataReceived = previous;
        resolve(data.rawParameters);
      };
      // Loading reports back, but ask again in case the report is missed. An early
      // ask can be answered by a dump of the previous bank, ignored above, so it repeats.
      this.loadBank(bankNumber);
      nudges = [80, 400, 900].map(ms => setTimeout(() => {
        if (!settled) this.requestCurrentData();
      }, ms));
    });
  }

  resetCurrentBank() {
    if (!this.device || this.active_bank_number === -1) return;
    this.sendSysEx([0, 0, 3, this.active_bank_number]);
  }

  resetMemory() {
    this.sendSysEx([0, 0, 1, 0]);
  }

  isConnected() {
    return !!this.device;
  }
}