/**
 * Reduce File Size: re-save large photos in the PDF as smaller JPEGs, drop
 * unused objects and pack the rest into compressed object streams. Text,
 * vector drawings and fonts are not touched.
 */
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFRef,
} from 'pdf-lib';
import { collectGarbage } from './editableData';

export type CompressLevel = 'small' | 'medium' | 'high';

export const COMPRESS_LEVELS: Record<CompressLevel, { maxSide: number; quality: number; label: string }> = {
  small: { maxSide: 1200, quality: 0.6, label: 'Smallest (screen)' },
  medium: { maxSide: 2000, quality: 0.75, label: 'Balanced' },
  high: { maxSide: 3000, quality: 0.85, label: 'High quality (print)' },
};

/** Raw pixels of a decoded image (8 bits per component). */
export interface RawImage { width: number; height: number; channels: 1 | 3; data: Uint8Array }

/** Browser side: turn an image into a JPEG no larger than `maxSide`. */
export interface ImageEncoder {
  fromJpeg: (jpeg: Uint8Array, maxSide: number, quality: number) => Promise<{ data: Uint8Array; width: number; height: number; gray: boolean } | null>;
  fromRaw: (image: RawImage, maxSide: number, quality: number) => Promise<{ data: Uint8Array; width: number; height: number; gray: boolean } | null>;
}

export interface CompressReport { images: number; recompressed: number; removedObjects: number }

const name = (dict: PDFDict, key: string) => dict.get(PDFName.of(key));

function filterNames(dict: PDFDict): string[] {
  const filter = name(dict, 'Filter');
  if (filter instanceof PDFName) return [filter.asString()];
  if (filter instanceof PDFArray) return filter.asArray().map((f) => (f instanceof PDFName ? f.asString() : ''));
  return [];
}

/** Colour channels for plain RGB / gray images (null = leave the image alone). */
function channelsOf(doc: PDFDocument, dict: PDFDict): 1 | 3 | null {
  const cs = doc.context.lookup(name(dict, 'ColorSpace'));
  if (cs instanceof PDFName) {
    if (cs.asString() === '/DeviceRGB') return 3;
    if (cs.asString() === '/DeviceGray') return 1;
    return null;
  }
  if (cs instanceof PDFArray && cs.size() >= 2) {
    const kind = cs.get(0);
    if (kind instanceof PDFName && kind.asString() === '/ICCBased') {
      const profile = doc.context.lookup(cs.get(1));
      const n = profile instanceof PDFRawStream ? profile.dict.get(PDFName.of('N')) : undefined;
      if (n instanceof PDFNumber) return n.asNumber() === 3 ? 3 : n.asNumber() === 1 ? 1 : null;
    }
  }
  return null;
}

export async function compressPdf(doc: PDFDocument, level: CompressLevel, encoder: ImageEncoder, onProgress?: (done: number, total: number) => void): Promise<CompressReport> {
  const { maxSide, quality } = COMPRESS_LEVELS[level];
  const images: [PDFRef, PDFRawStream][] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const subtype = object.dict.get(PDFName.of('Subtype'));
    if (subtype instanceof PDFName && subtype.asString() === '/Image') images.push([ref, object]);
  }

  let recompressed = 0;
  for (let i = 0; i < images.length; i++) {
    onProgress?.(i, images.length);
    const [ref, stream] = images[i];
    const dict = stream.dict;
    if (name(dict, 'ImageMask')?.toString() === 'true' || name(dict, 'Mask') || name(dict, 'Decode')) continue;
    const bpc = name(dict, 'BitsPerComponent');
    if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) continue;
    const channels = channelsOf(doc, dict);
    if (!channels) continue;
    const filters = filterNames(dict);
    const oldSize = stream.contents.byteLength;
    if (oldSize < 40_000) continue; // small images are not worth it

    let result = null;
    try {
      if (filters.length === 1 && filters[0] === '/DCTDecode') {
        result = await encoder.fromJpeg(stream.contents, maxSide, quality);
      } else if (filters.every((f) => f === '/FlateDecode') && !name(dict, 'DecodeParms')) {
        const width = (name(dict, 'Width') as PDFNumber).asNumber();
        const height = (name(dict, 'Height') as PDFNumber).asNumber();
        const data = decodePDFRawStream(stream).decode();
        if (data.byteLength !== width * height * channels) continue;
        result = await encoder.fromRaw({ width, height, channels, data }, maxSide, quality);
      }
    } catch {
      continue; // unusual image: keep it as it is
    }
    if (!result || result.data.byteLength > oldSize * 0.9) continue;

    const next = doc.context.stream(result.data, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: result.width,
      Height: result.height,
      BitsPerComponent: 8,
      ColorSpace: result.gray ? 'DeviceGray' : 'DeviceRGB',
      Filter: 'DCTDecode',
    });
    // Keep a soft mask (transparency) and interpolation hints.
    for (const key of ['SMask', 'Interpolate', 'Intent']) {
      const value = name(dict, key);
      if (value) next.dict.set(PDFName.of(key), value);
    }
    doc.context.assign(ref, next);
    recompressed++;
  }
  onProgress?.(images.length, images.length);
  const removedObjects = collectGarbage(doc.context);
  return { images: images.length, recompressed, removedObjects };
}

/** Browser encoder using canvas. */
export const canvasEncoder: ImageEncoder = {
  async fromJpeg(jpeg, maxSide, quality) {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));
    try {
      return await encodeBitmap(bitmap, bitmap.width, bitmap.height, maxSide, quality);
    } finally {
      bitmap.close();
    }
  },
  async fromRaw(image, maxSide, quality) {
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);
    for (let p = 0, q = 0; p < image.width * image.height; p++, q += 4) {
      if (image.channels === 3) {
        rgba[q] = image.data[p * 3]; rgba[q + 1] = image.data[p * 3 + 1]; rgba[q + 2] = image.data[p * 3 + 2];
      } else {
        rgba[q] = rgba[q + 1] = rgba[q + 2] = image.data[p];
      }
      rgba[q + 3] = 255;
    }
    const bitmap = await createImageBitmap(new ImageData(rgba, image.width, image.height));
    try {
      const out = await encodeBitmap(bitmap, image.width, image.height, maxSide, quality);
      return out && image.channels === 1 ? { ...out, gray: false } : out;
    } finally {
      bitmap.close();
    }
  },
};

async function encodeBitmap(bitmap: ImageBitmap, width: number, height: number, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  canvas.width = canvas.height = 0;
  if (!blob) return null;
  return { data: new Uint8Array(await blob.arrayBuffer()), width: w, height: h, gray: false };
}
