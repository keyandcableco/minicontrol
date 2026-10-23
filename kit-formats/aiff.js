// AIFF and AIFC for the user drum kit (kits.js): Chrome's decodeAudioData can't read them, and a lot
// of drum sample packs from the Mac come as .aif, so this reads them itself. kits.js loads it with
// import() the first time an AIFF is dropped, so the page never fetches it otherwise.
//
// An AIFF is a FORM chunk of type AIFF or AIFC holding other chunks, every number big-endian:
//   COMM: channels (2 bytes), sample frames (4), bits a sample (2), the sample rate as an 80-bit
//         extended float (10); an AIFC goes on with its compression type (4 characters) and a name
//   SSND: an offset (4) and a block size (4), then the samples from 8 + offset, frame by frame
// Each chunk is its 4-character id, its length (4) and its data, padded to an even length.
//
// What this reads: plain AIFF, and AIFC whose type is NONE (big-endian, as AIFF), sowt (the same
// bytes the other way round), fl32 or fl64 (big-endian floats), ulaw or alaw (G.711, 8 bits a sample),
// at 1 to 32 bits (8, 16, 24 and 32 in practice), as many channels as it has. A sample takes whole
// bytes, left-justified when its bits don't fill them. Anything else (ima4, MAC3, a codec...) is
// refused with a word to convert it to WAV. maxFrames, when given, is the most frames read (a number,
// or a function of the file's sample rate that gives it): a longer file keeps its start, so a long
// file dropped by mistake isn't read whole.
//
// Streamed files: a writer that can't seek back (ffmpeg -f aiff to a pipe) leaves 0 where it can't know
// a length: the FORM's, the SSND's and COMM's frame count. A FORM or SSND length of 0 is taken to run to
// the end of the file, and a frame count of 0 is worked out from the SSND's bytes.
//
// Malformed files: a FORM length under 12, or too short for the chunks it holds, is read to the end of
// the file instead; a COMM cut short by the end of the file is refused, as is a file with no COMM or no
// SSND.

const CODECS = {NONE: 'int', sowt: 'int', twos: 'int', fl32: 'float', FL32: 'float', fl64: 'double', FL64: 'double',
  ulaw: 'ulaw', ULAW: 'ulaw', alaw: 'alaw', ALAW: 'alaw'};

export function parseAiff(input, maxFrames = Infinity) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = at => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 12 || id(0) !== 'FORM') throw new Error("it isn't an AIFF file");
  const form = id(8);
  if (form !== 'AIFF' && form !== 'AIFC') throw new Error("it isn't an AIFF file");
  // the chunks from 12 to end: {comm, ssnd, over (a chunk runs past end)}. An SSND of length 0 is a
  // streamed file's, its sound running to the end: nothing after it is a chunk.
  const walk = end => {
    let comm = null, ssnd = null, over = false;
    for (let at = 12; at + 8 <= end;) {
      const chunk = id(at), length = view.getUint32(at + 4), body = at + 8;
      if (chunk === 'SSND' && length === 0) { ssnd = {at: body, length: end - body}; break; }
      if (body + length > end) over = true;
      if (chunk === 'COMM') comm = {at: body, length};
      else if (chunk === 'SSND') ssnd = {at: body, length: Math.min(length, end - body)};
      at = body + length + (length & 1);
    }
    return {comm, ssnd, over};
  };
  // A FORM's length can be wrong in files from careless writers. Read to it, or to the end of the
  // file if that comes first; but to the end of the file when the length is 0 (streamed) or under 12,
  // or shorter than the chunks it holds (one runs past it, or COMM or SSND lies beyond it).
  const declared = view.getUint32(4);
  let chunks = walk(Math.min(bytes.length, 8 + declared));
  const short = chunks.over || !chunks.comm || !chunks.ssnd;
  if (declared < 12 || (short && 8 + declared < bytes.length)) chunks = walk(bytes.length);
  const {comm, ssnd} = chunks;
  if (!comm || comm.length < 18) throw new Error('it has no COMM chunk: convert it to WAV');
  if (comm.at + 18 > bytes.length) throw new Error('its COMM chunk is cut short: the file is damaged');
  if (!ssnd || ssnd.length < 8) throw new Error('it has no sound (no SSND chunk)');
  const channels = view.getInt16(comm.at);
  const framesSaid = view.getUint32(comm.at + 2);      // 0 in a streamed file: worked out from SSND below
  let bits = view.getInt16(comm.at + 6);
  const sampleRate = extended80(view, comm.at + 8);
  let compression = 'NONE';
  if (form === 'AIFC') {
    if (comm.length < 22 || comm.at + 22 > bytes.length) throw new Error('its COMM chunk is too short for an AIFC: convert it to WAV');
    compression = id(comm.at + 18);
  }
  const codec = CODECS[compression];
  if (!codec) throw new Error(`it is a compressed AIFC (${compression.trim()}): convert it to WAV`);
  if (channels < 1) throw new Error('it says it has no channels');
  // a float or G.711 AIFC's width is its codec's, whatever COMM's bits say
  if (codec === 'float') bits = 32;
  else if (codec === 'double') bits = 64;
  else if (codec === 'ulaw' || codec === 'alaw') bits = 8;
  else if (bits < 1 || bits > 32) throw new Error(`its samples are ${bits}-bit: convert it to WAV`);
  if (!(sampleRate >= 1000 && sampleRate <= 768000)) throw new Error(`its sample rate (${sampleRate} Hz) can't be right`);
  const width = (bits + 7) >> 3;
  const offset = view.getUint32(ssnd.at);
  const start = ssnd.at + 8 + offset;
  const available = Math.max(0, Math.floor((ssnd.at + ssnd.length - start) / (width * channels)));
  const frames = framesSaid || available;
  const most = typeof maxFrames === 'function' ? maxFrames(sampleRate) : maxFrames;
  const n = Math.max(0, Math.min(frames, available, Math.floor(most)));   // a file cut short keeps what it has
  const little = compression === 'sowt';
  const scale = 1 / 2 ** (8 * width - 1);
  const out = Array.from({length: channels}, () => new Float32Array(n));
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < channels; c++) {
      const p = start + (f * channels + c) * width;
      if (codec === 'float') { out[c][f] = view.getFloat32(p); continue; }
      if (codec === 'double') { out[c][f] = view.getFloat64(p); continue; }
      if (codec === 'ulaw') { out[c][f] = ulaw(bytes[p]) / 32768; continue; }
      if (codec === 'alaw') { out[c][f] = alaw(bytes[p]) / 32768; continue; }
      let v = 0;
      for (let k = 0; k < width; k++) v = v * 256 + bytes[little ? p + width - 1 - k : p + k];
      if (v >= 2 ** (8 * width - 1)) v -= 2 ** (8 * width);   // signed, two's complement
      out[c][f] = v * scale;
    }
  }
  return {sampleRate, channels: out, frames: n, bits, compression};
}

// G.711 mu-law and A-law, a byte to a 16-bit sample (ITU-T G.711, as sox and every phone decode them)
export function ulaw(byte) {
  const u = ~byte & 0xFF;
  const magnitude = ((((u & 0x0F) << 3) + 0x84) << ((u & 0x70) >> 4)) - 0x84;
  return u & 0x80 ? 0 - magnitude : magnitude;
}
export function alaw(byte) {
  const a = byte ^ 0x55;
  const exponent = (a & 0x70) >> 4;
  let magnitude = (a & 0x0F) << 4;
  magnitude = exponent ? (magnitude + 0x108) << (exponent - 1) : magnitude + 8;
  return a & 0x80 ? magnitude : 0 - magnitude;
}

// The sample rate as COMM holds it: an 80-bit IEEE 754 extended float, big-endian. A sign bit and a
// 15-bit exponent (bias 16383), then a 64-bit mantissa whose integer bit is stored, not implied; read
// as two 32-bit halves, as JavaScript's numbers can't hold 64 bits whole. 0 is all zeros, and an
// exponent of all ones (infinity or NaN) is no rate at all.
export function extended80(view, at) {
  const se = view.getUint16(at);
  const hi = view.getUint32(at + 2), lo = view.getUint32(at + 6);
  const exponent = se & 0x7FFF;
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  if (exponent === 0x7FFF) return NaN;
  const value = (hi * 2 ** 32 + lo) * 2 ** (exponent - 16383 - 63);
  return se & 0x8000 ? -value : value;
}
