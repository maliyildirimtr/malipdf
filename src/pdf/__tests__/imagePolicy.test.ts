import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_DIMENSION,
  planImageNormalization,
  readImageHeaderSize,
  readJpegOrientation,
} from '../imagePolicy';

/** Minimal JPEG: SOI, APP1/Exif with one Orientation entry, SOF0, EOI. */
function jpeg({ orientation, width, height, littleEndian = false }: {
  orientation?: number; width: number; height: number; littleEndian?: boolean;
}): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  if (orientation !== undefined) {
    const u16 = (v: number) => (littleEndian ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
    const u32 = (v: number) => (littleEndian
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24]
      : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
    const tiff = [
      ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8),
      ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0),
    ];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const length = payload.length + 2;
    bytes.push(0xff, 0xe1, length >> 8, length & 0xff, ...payload);
  }
  bytes.push(0xff, 0xc0, 0, 11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0);
  bytes.push(0xff, 0xd9);
  return Uint8Array.from(bytes);
}

function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

describe('image policy', () => {
  it('reads EXIF orientation in both byte orders, defaulting to 1', () => {
    expect(readJpegOrientation(jpeg({ orientation: 6, width: 10, height: 20 }))).toBe(6);
    expect(readJpegOrientation(jpeg({ orientation: 8, width: 10, height: 20, littleEndian: true }))).toBe(8);
    expect(readJpegOrientation(jpeg({ width: 10, height: 20 }))).toBe(1);
    expect(readJpegOrientation(Uint8Array.from([1, 2, 3]))).toBe(1);
  });

  it('reads pixel size from PNG and JPEG headers without decoding', () => {
    expect(readImageHeaderSize(pngHeader(4000, 3000), 'image/png')).toEqual({ width: 4000, height: 3000 });
    expect(readImageHeaderSize(jpeg({ orientation: 6, width: 640, height: 480 }), 'image/jpeg')).toEqual({ width: 640, height: 480 });
  });

  it('keeps normal images byte-for-byte', () => {
    expect(planImageNormalization({ width: 1200, height: 800 }, 'image/png', 1).reencode).toBe(false);
    expect(planImageNormalization({ width: 1200, height: 800 }, 'image/jpeg', 1).reencode).toBe(false);
  });

  it('re-encodes rotated phone photos and WebP', () => {
    expect(planImageNormalization({ width: 3000, height: 4000 }, 'image/jpeg', 6)).toMatchObject({ reencode: true, outputMimeType: 'image/jpeg' });
    expect(planImageNormalization({ width: 100, height: 100 }, 'image/webp', 1)).toMatchObject({ reencode: true, outputMimeType: 'image/png' });
  });

  it('downscales oversized images and refuses gigantic ones', () => {
    const plan = planImageNormalization({ width: 12000, height: 3000 }, 'image/png', 1);
    expect(plan).toMatchObject({ reencode: true, width: MAX_IMAGE_DIMENSION, height: 750 });
    expect(() => planImageNormalization({ width: 20000, height: 20000 }, 'image/png', 1)).toThrow(/too large/);
  });
});
