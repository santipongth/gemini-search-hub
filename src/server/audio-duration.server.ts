// Server-side audio duration parser. Pure JS (Worker-compatible) — handles
// the formats we accept: WebM/Matroska, Ogg, WAV, MP3, MP4/M4A.
//
// Returns duration in seconds, or null when the format is unrecognized or
// the duration field is unavailable. Designed to be defensive: any failure
// returns null rather than throwing, so callers can decide whether to fall
// back to client-supplied hints.

export function parseAudioDurationSeconds(
  bytes: Uint8Array,
  mimeType: string,
): number | null {
  try {
    const mt = mimeType.toLowerCase();
    if (mt.includes("wav") || mt.includes("wave")) return parseWav(bytes);
    if (mt.includes("webm") || mt.includes("matroska")) return parseEbml(bytes);
    if (mt.includes("ogg")) return parseOgg(bytes);
    if (mt.includes("mp4") || mt.includes("m4a") || mt.includes("aac"))
      return parseMp4(bytes);
    if (mt.includes("mpeg") || mt.includes("mp3")) return parseMp3(bytes);
    // Unknown MIME — try sniffing from magic bytes.
    return sniff(bytes);
  } catch {
    return null;
  }
}

function sniff(b: Uint8Array): number | null {
  // RIFF....WAVE
  if (
    b.length > 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45
  ) {
    return parseWav(b);
  }
  // EBML (WebM/Matroska)
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return parseEbml(b);
  }
  // OggS
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) {
    return parseOgg(b);
  }
  // ftyp at byte 4
  if (b.length > 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    return parseMp4(b);
  }
  // ID3 or MPEG sync
  if (
    (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
    (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
  ) {
    return parseMp3(b);
  }
  return null;
}

// ---------- WAV ----------

function parseWav(b: Uint8Array): number | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 44) return null;
  if (dv.getUint32(0, false) !== 0x52494646 /* "RIFF" */) return null;
  if (dv.getUint32(8, false) !== 0x57415645 /* "WAVE" */) return null;

  let p = 12;
  let sampleRate = 0;
  let byteRate = 0;
  let dataSize = 0;
  while (p + 8 <= b.length) {
    const tag = dv.getUint32(p, false);
    const size = dv.getUint32(p + 4, true);
    if (tag === 0x666d7420 /* "fmt " */) {
      sampleRate = dv.getUint32(p + 8 + 4, true);
      byteRate = dv.getUint32(p + 8 + 8, true);
    } else if (tag === 0x64617461 /* "data" */) {
      dataSize = size;
      break;
    }
    p += 8 + size + (size % 2);
  }
  if (byteRate > 0 && dataSize > 0) return dataSize / byteRate;
  if (sampleRate > 0 && dataSize > 0) return dataSize / (sampleRate * 2);
  return null;
}

// ---------- EBML / WebM / Matroska ----------

class EbmlReader {
  pos = 0;
  constructor(public b: Uint8Array) {}

  readVint(maskOff = false): { value: number; size: number } | null {
    if (this.pos >= this.b.length) return null;
    const first = this.b[this.pos];
    if (first === 0) return null;
    let length = 1;
    let mask = 0x80;
    while (length <= 8 && (first & mask) === 0) {
      length++;
      mask >>= 1;
    }
    if (length > 8) return null;
    if (this.pos + length > this.b.length) return null;
    let value = maskOff ? first & (mask - 1) : first;
    for (let i = 1; i < length; i++) value = value * 256 + this.b[this.pos + i];
    this.pos += length;
    return { value, size: length };
  }

  readId(): number | null {
    const v = this.readVint(false);
    return v ? v.value : null;
  }

  readSize(): number | null {
    const v = this.readVint(true);
    return v ? v.value : null;
  }

  readFloat(size: number): number | null {
    if (this.pos + size > this.b.length) return null;
    const dv = new DataView(this.b.buffer, this.b.byteOffset + this.pos, size);
    let v: number | null = null;
    if (size === 4) v = dv.getFloat32(0, false);
    else if (size === 8) v = dv.getFloat64(0, false);
    this.pos += size;
    return v;
  }

  readUint(size: number): number | null {
    if (this.pos + size > this.b.length || size > 8) return null;
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + this.b[this.pos + i];
    this.pos += size;
    return v;
  }
}

function parseEbml(b: Uint8Array): number | null {
  const r = new EbmlReader(b);

  // Skip outer EBML header, find Segment (0x18538067)
  while (r.pos < b.length) {
    const id = r.readId();
    const size = r.readSize();
    if (id === null || size === null) return null;
    if (id === 0x18538067) {
      return parseSegment(b, r.pos, Math.min(b.length, r.pos + size));
    }
    r.pos += size;
  }
  return null;
}

function parseSegment(b: Uint8Array, start: number, end: number): number | null {
  const r = new EbmlReader(b);
  r.pos = start;
  let timecodeScale = 1_000_000; // ns per tick (default)
  let durationTicks: number | null = null;

  while (r.pos < end) {
    const id = r.readId();
    const size = r.readSize();
    if (id === null || size === null) return null;
    if (id === 0x1549a966) {
      // Info element
      const infoEnd = Math.min(end, r.pos + size);
      while (r.pos < infoEnd) {
        const cid = r.readId();
        const csize = r.readSize();
        if (cid === null || csize === null) return null;
        if (cid === 0x2ad7b1) {
          // TimecodeScale (uint, ns)
          const v = r.readUint(csize);
          if (v !== null) timecodeScale = v;
        } else if (cid === 0x4489) {
          // Duration (float, ticks)
          const v = r.readFloat(csize);
          if (v !== null) durationTicks = v;
        } else {
          r.pos += csize;
        }
      }
      // We have what we need.
      if (durationTicks !== null) {
        return (durationTicks * timecodeScale) / 1e9;
      }
      return null;
    }
    r.pos += size;
  }
  return null;
}

// ---------- Ogg ----------

function parseOgg(b: Uint8Array): number | null {
  // Find first page to get sample rate from Vorbis/Opus identification header.
  // Then find last OggS page to read its granule_position, divide by sample rate.
  if (b.length < 27) return null;
  if (!(b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53)) return null;

  // Sample rate: try Opus head (search "OpusHead"), else Vorbis (search "vorbis").
  let sampleRate = 0;
  for (let i = 0; i < Math.min(b.length - 16, 65536); i++) {
    if (
      b[i] === 0x4f && b[i + 1] === 0x70 && b[i + 2] === 0x75 && b[i + 3] === 0x73 &&
      b[i + 4] === 0x48 && b[i + 5] === 0x65 && b[i + 6] === 0x61 && b[i + 7] === 0x64
    ) {
      // OpusHead: input sample rate at offset 12 (LE u32)
      const dv = new DataView(b.buffer, b.byteOffset + i, 16);
      sampleRate = dv.getUint32(12, true) || 48000;
      // Opus granule_position is always at 48 kHz regardless of input rate.
      sampleRate = 48000;
      break;
    }
    if (
      b[i] === 0x76 && b[i + 1] === 0x6f && b[i + 2] === 0x72 && b[i + 3] === 0x62 &&
      b[i + 4] === 0x69 && b[i + 5] === 0x73
    ) {
      // "vorbis" id header — sample rate at offset +5 (after "vorbis"+version 4)
      const off = i + 6 + 4 + 1; // past 'vorbis', version (4), channels (1)
      if (off + 4 <= b.length) {
        const dv = new DataView(b.buffer, b.byteOffset + off, 4);
        sampleRate = dv.getUint32(0, true);
      }
      break;
    }
  }
  if (!sampleRate) return null;

  // Find last "OggS" header in the file and read its granule_position (s64 LE at +6).
  let last = -1;
  for (let i = b.length - 27; i >= 0; i--) {
    if (b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;
  const dv = new DataView(b.buffer, b.byteOffset + last + 6, 8);
  // 8 bytes little-endian; read as low/high u32 to avoid BigInt edge cases.
  const lo = dv.getUint32(0, true);
  const hi = dv.getUint32(4, true);
  const granule = hi * 2 ** 32 + lo;
  if (!isFinite(granule) || granule <= 0) return null;
  return granule / sampleRate;
}

// ---------- MP4 / M4A ----------

function parseMp4(b: Uint8Array): number | null {
  // Walk top-level boxes, find moov, then mvhd inside it.
  const len = b.length;
  let p = 0;
  while (p + 8 <= len) {
    const dv = new DataView(b.buffer, b.byteOffset + p, Math.min(16, len - p));
    let size = dv.getUint32(0, false);
    const type = dv.getUint32(4, false);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit largesize
      if (p + 16 > len) break;
      const hi = dv.getUint32(8, false);
      const lo = dv.getUint32(12, false);
      size = hi * 2 ** 32 + lo;
      headerSize = 16;
    }
    if (size < headerSize || p + size > len) break;
    if (type === 0x6d6f6f76 /* "moov" */) {
      const r = findMvhd(b, p + headerSize, p + size);
      if (r !== null) return r;
    }
    p += size;
  }
  return null;
}

function findMvhd(b: Uint8Array, start: number, end: number): number | null {
  let p = start;
  while (p + 8 <= end) {
    const dv = new DataView(b.buffer, b.byteOffset + p, Math.min(16, end - p));
    const size = dv.getUint32(0, false);
    const type = dv.getUint32(4, false);
    if (size < 8 || p + size > end) return null;
    if (type === 0x6d766864 /* "mvhd" */) {
      // version(1) flags(3) ...
      const version = b[p + 8];
      if (version === 0) {
        // creation(4) modification(4) timescale(4) duration(4)
        const tsView = new DataView(b.buffer, b.byteOffset + p + 8 + 4, 16);
        const timescale = tsView.getUint32(8, false);
        const duration = tsView.getUint32(12, false);
        if (timescale > 0) return duration / timescale;
      } else if (version === 1) {
        // creation(8) modification(8) timescale(4) duration(8)
        const tsView = new DataView(b.buffer, b.byteOffset + p + 8 + 4, 28);
        const timescale = tsView.getUint32(16, false);
        const hi = tsView.getUint32(20, false);
        const lo = tsView.getUint32(24, false);
        const duration = hi * 2 ** 32 + lo;
        if (timescale > 0) return duration / timescale;
      }
      return null;
    }
    p += size;
  }
  return null;
}

// ---------- MP3 ----------

const MP3_BITRATES_V1L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const MP3_BITRATES_V2L3 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
];
const MP3_SAMPLE_RATES_V1 = [44100, 48000, 32000];
const MP3_SAMPLE_RATES_V2 = [22050, 24000, 16000];
const MP3_SAMPLE_RATES_V25 = [11025, 12000, 8000];

function parseMp3(b: Uint8Array): number | null {
  // Skip ID3v2 header if present.
  let off = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    if (b.length < 10) return null;
    const sz =
      ((b[6] & 0x7f) << 21) |
      ((b[7] & 0x7f) << 14) |
      ((b[8] & 0x7f) << 7) |
      (b[9] & 0x7f);
    off = 10 + sz;
  }
  if (off + 4 >= b.length) return null;

  // Find first MPEG frame sync (11 bits set).
  let p = off;
  while (p + 4 < b.length) {
    if (b[p] === 0xff && (b[p + 1] & 0xe0) === 0xe0) break;
    p++;
  }
  if (p + 4 >= b.length) return null;

  const h1 = b[p + 1], h2 = b[p + 2];
  const versionId = (h1 >> 3) & 0x3; // 0=v2.5, 2=v2, 3=v1
  const layer = (h1 >> 1) & 0x3; // 1=L3, 2=L2, 3=L1
  const bitrateIdx = (h2 >> 4) & 0xf;
  const sampleRateIdx = (h2 >> 2) & 0x3;
  if (layer === 0 || sampleRateIdx === 3 || bitrateIdx === 0 || bitrateIdx === 15)
    return null;

  // Try Xing/Info frame for VBR (most reliable).
  // Side info offset depends on MPEG version + channel mode.
  const channelMode = (h2 >> 6) & 0x3; // not needed precisely; scan a window
  void channelMode;
  for (let s = p + 4; s < Math.min(p + 200, b.length - 12); s++) {
    if (
      (b[s] === 0x58 && b[s + 1] === 0x69 && b[s + 2] === 0x6e && b[s + 3] === 0x67) ||
      (b[s] === 0x49 && b[s + 1] === 0x6e && b[s + 2] === 0x66 && b[s + 3] === 0x6f)
    ) {
      // Xing/Info header
      const flags = (b[s + 4] << 24) | (b[s + 5] << 16) | (b[s + 6] << 8) | b[s + 7];
      let q = s + 8;
      if (flags & 0x1) {
        const frames =
          (b[q] << 24) | (b[q + 1] << 16) | (b[q + 2] << 8) | b[q + 3];
        q += 4;
        const sr =
          versionId === 3
            ? MP3_SAMPLE_RATES_V1[sampleRateIdx]
            : versionId === 2
              ? MP3_SAMPLE_RATES_V2[sampleRateIdx]
              : MP3_SAMPLE_RATES_V25[sampleRateIdx];
        const samplesPerFrame = layer === 1 ? 1152 : 384; // L3 vs L1 (we mostly see L3)
        if (sr > 0 && frames > 0) return (frames * samplesPerFrame) / sr;
      }
      break;
    }
  }

  // Fallback: CBR estimate from first frame bitrate.
  const bitrate =
    versionId === 3
      ? MP3_BITRATES_V1L3[bitrateIdx]
      : MP3_BITRATES_V2L3[bitrateIdx];
  if (!bitrate) return null;
  // bitrate is in kbps. Approximate audio bytes = total - id3 header.
  const audioBytes = b.length - off;
  return (audioBytes * 8) / (bitrate * 1000);
}
