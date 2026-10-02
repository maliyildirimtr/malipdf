/**
 * Works around a fontkit subsetting bug.
 *
 * fontkit copies glyphs into a subset assuming every glyph's data has an even
 * length. Some fonts (Carlito) store glyphs unpadded, and their subsets come
 * out with broken outlines (most letters vanish in the saved PDF). This adds
 * the missing zero byte after each odd-length glyph and rewrites `loca` — the
 * outlines themselves are untouched. Fonts that are already padded are
 * returned as they are.
 */

interface TableRecord {
  tag: string;
  offset: number;
  length: number;
  recordAt: number;
}

function readTables(view: DataView): Map<string, TableRecord> {
  const count = view.getUint16(4);
  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    tables.set(tag, { tag, offset: view.getUint32(at + 8), length: view.getUint32(at + 12), recordAt: at });
  }
  return tables;
}

/** TrueType bytes with every glyph padded to an even length. */
export function padTrueTypeGlyphs(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 12) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565) return bytes; // not TrueType outlines
  const tables = readTables(view);
  const head = tables.get('head');
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  const maxp = tables.get('maxp');
  if (!head || !loca || !glyf || !maxp) return bytes;

  const longLoca = view.getInt16(head.offset + 50) === 1;
  const glyphCount = view.getUint16(maxp.offset + 4);
  const offsets: number[] = [];
  for (let i = 0; i <= glyphCount; i++) {
    offsets.push(longLoca ? view.getUint32(loca.offset + i * 4) : view.getUint16(loca.offset + i * 2) * 2);
  }
  let odd = false;
  for (let i = 0; i < glyphCount && !odd; i++) odd = (offsets[i + 1] - offsets[i]) % 2 === 1;
  if (!odd) return bytes;

  // New glyf: each glyph followed by a zero byte when its length is odd.
  const newOffsets: number[] = [0];
  let size = 0;
  for (let i = 0; i < glyphCount; i++) {
    const length = Math.max(0, offsets[i + 1] - offsets[i]);
    size += length + (length % 2);
    newOffsets.push(size);
  }
  const newGlyf = new Uint8Array(size);
  for (let i = 0; i < glyphCount; i++) {
    const length = Math.max(0, offsets[i + 1] - offsets[i]);
    newGlyf.set(bytes.subarray(glyf.offset + offsets[i], glyf.offset + offsets[i] + length), newOffsets[i]);
  }
  const newLoca = new Uint8Array((glyphCount + 1) * 4);
  const locaView = new DataView(newLoca.buffer);
  newOffsets.forEach((offset, i) => locaView.setUint32(i * 4, offset));

  // Rebuild the file: all other tables copied as they are, glyf/loca replaced.
  const records = [...tables.values()].sort((a, b) => a.offset - b.offset);
  const headerSize = 12 + tables.size * 16;
  const content = (record: TableRecord) =>
    record.tag === 'glyf' ? newGlyf : record.tag === 'loca' ? newLoca : bytes.subarray(record.offset, record.offset + record.length);
  let total = headerSize;
  for (const record of records) total += (content(record).byteLength + 3) & ~3;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  out.set(bytes.subarray(0, headerSize), 0);
  let at = headerSize;
  for (const record of records) {
    const data = content(record);
    out.set(data, at);
    outView.setUint32(record.recordAt + 8, at);
    outView.setUint32(record.recordAt + 12, data.byteLength);
    at += (data.byteLength + 3) & ~3;
  }
  // head.indexToLocFormat = long; head.checkSumAdjustment is not checked by readers here.
  outView.setInt16(outView.getUint32(head.recordAt + 8) + 50, 1);
  return out;
}
