import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { alphaChannel, embedPicture, EXPORT_DPI, exportPixelSize, looksLikePhoto, packPicture } from '../imagePacking';

describe('image packing', () => {
  it('tells photos from screenshots by how badly they compress as PNG', () => {
    const png = (bytes: number, w: number, h: number) => ({ mimeType: 'image/png' as const, width: w, height: h, data: new Uint8Array(bytes) });
    expect(looksLikePhoto(png(15_000_000, 3840, 3072))).toBe(true);
    expect(looksLikePhoto(png(600_000, 3000, 2000))).toBe(false); // screenshot of text
    expect(looksLikePhoto(png(40_000, 200, 200))).toBe(false); // small
    expect(looksLikePhoto({ ...png(10, 1, 1), mimeType: 'image/jpeg' })).toBe(true);
  });

  it('embeds at print resolution for the placed size, never larger than the original', () => {
    // 417 × 334 pt at 300 dpi
    expect(exportPixelSize({ width: 3840, height: 3072 }, 417, 334)).toEqual({ width: 1740, height: 1392 });
    expect(exportPixelSize({ width: 800, height: 600 }, 417, 334)).toEqual({ width: 800, height: 600 });
    expect(EXPORT_DPI).toBe(300);
  });

  it('finds transparency', () => {
    expect(alphaChannel(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]))).toBeNull();
    expect(Array.from(alphaChannel(new Uint8ClampedArray([1, 2, 3, 0, 4, 5, 6, 128]))!)).toEqual([0, 128]);
  });

  it('keeps pictures unchanged without a canvas (Node)', async () => {
    const onePixelPng = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const picture = { mimeType: 'image/png' as const, width: 1, height: 1, data: onePixelPng };
    expect(await packPicture(picture)).toBe(picture);
    const pdf = await PDFDocument.create();
    const image = await embedPicture(pdf, picture, 10, 10);
    expect(image.width).toBe(1);
  });
});
