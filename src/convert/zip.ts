/**
 * Minimal ZIP writer (no compression) for building .docx files.
 *
 * Office files are ZIP archives; "stored" entries are valid and Word opens
 * them. Pictures are already compressed (JPEG/PNG), so storing costs little;
 * the XML parts are small.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

/** DOS date/time for 1 Jan 2024 00:00 (a fixed date keeps output reproducible). */
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const files = entries.map((entry) => {
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    return { name: encoder.encode(entry.name), data, crc: crc32(data) };
  });
  const localSize = files.reduce((sum, f) => sum + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((sum, f) => sum + 46 + f.name.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff || files.length > 0xffff) {
    throw new Error('The document is too large for a Word file.');
  }
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];

  for (const f of files) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true); // version needed
    view.setUint16(at + 6, 0x0800, true); // UTF-8 names
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, DOS_TIME, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, f.crc, true);
    view.setUint32(at + 18, f.data.length, true);
    view.setUint32(at + 22, f.data.length, true);
    view.setUint16(at + 26, f.name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(f.name, at + 30);
    out.set(f.data, at + 30 + f.name.length);
    at += 30 + f.name.length + f.data.length;
  }

  const centralStart = at;
  files.forEach((f, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true); // version made by
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, f.crc, true);
    view.setUint32(at + 20, f.data.length, true);
    view.setUint32(at + 24, f.data.length, true);
    view.setUint16(at + 28, f.name.length, true);
    // extra, comment, disk, internal attrs = 0; external attrs = 0
    view.setUint32(at + 42, offsets[i], true);
    out.set(f.name, at + 46);
    at += 46 + f.name.length;
  });

  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, files.length, true);
  view.setUint16(at + 10, files.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}
