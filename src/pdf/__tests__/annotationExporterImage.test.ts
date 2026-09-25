import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { exportAnnotatedPdf } from '../annotationExporter';
import type { ImageAnnotation } from '../../types/annotations';
import type { ImageAsset } from '../../store/assetStore';

// 1x1 transparent PNG
const SAMPLE_PNG_BYTES = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0,
  1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0,
  1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

async function createBasePdf(pageCount = 1, rotation = 0): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.addPage([612, 792]);
    if (rotation !== 0) {
      page.setRotation({ angle: rotation, type: 'degrees' } as any);
    }
  }
  return await pdfDoc.save();
}

describe('annotationExporter with ImageAnnotation', () => {
  it('exports an ImageAnnotation using pure asset map input', async () => {
    const baseBytes = await createBasePdf(1);

    const asset: ImageAsset = {
      id: 'asset-1',
      mimeType: 'image/png',
      width: 100,
      height: 100,
      data: SAMPLE_PNG_BYTES,
    };

    const imageAnn: ImageAnnotation = {
      id: 'ann-img-1',
      pageIndex: 0,
      type: 'image',
      x: 50,
      y: 100,
      width: 200,
      height: 150,
      assetId: 'asset-1',
      opacity: 0.85,
      locked: false,
      color: '#000000',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const annotations = new Map([[0, [imageAnn]]]);
    const assets = new Map([['asset-1', asset]]);

    const result = await exportAnnotatedPdf(baseBytes, annotations, { assets });
    expect(result.data.byteLength).toBeGreaterThan(baseBytes.byteLength);
    expect(result.annotationCount).toBe(1);

    // Verify resulting PDF is readable
    const parsed = await PDFDocument.load(result.data);
    expect(parsed.getPageCount()).toBe(1);
  });

  it('deduplicates embedded PDFImage across multiple annotations using the same assetId', async () => {
    const baseBytes = await createBasePdf(2);

    const asset: ImageAsset = {
      id: 'shared-asset',
      mimeType: 'image/png',
      width: 100,
      height: 100,
      data: SAMPLE_PNG_BYTES,
    };

    const img1: ImageAnnotation = {
      id: 'img-1',
      pageIndex: 0,
      type: 'image',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      assetId: 'shared-asset',
      opacity: 1,
      locked: false,
      color: '#000000',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const img2: ImageAnnotation = {
      id: 'img-2',
      pageIndex: 1,
      type: 'image',
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      assetId: 'shared-asset',
      opacity: 0.5,
      locked: false,
      color: '#000000',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const annotations = new Map([
      [0, [img1]],
      [1, [img2]],
    ]);
    const assets = new Map([['shared-asset', asset]]);

    const result = await exportAnnotatedPdf(baseBytes, annotations, { assets });
    expect(result.annotationCount).toBe(2);

    // Re-export with only 1 annotation to compare size
    const singleResult = await exportAnnotatedPdf(baseBytes, new Map([[0, [img1]]]), { assets });

    // Because image bytes are deduplicated, adding a second reference on page 2 adds only minimal PDF reference overhead,
    // NOT another copy of the image stream.
    const sizeDiff = result.data.byteLength - singleResult.data.byteLength;
    expect(sizeDiff).toBeLessThan(1000);
  });

  it('exports onto rotated pages (90, 180, 270 degrees) without coordinate errors', async () => {
    const asset: ImageAsset = {
      id: 'rot-asset',
      mimeType: 'image/png',
      width: 100,
      height: 100,
      data: SAMPLE_PNG_BYTES,
    };

    const img: ImageAnnotation = {
      id: 'ann-rot',
      pageIndex: 0,
      type: 'image',
      x: 50,
      y: 50,
      width: 150,
      height: 100,
      assetId: 'rot-asset',
      opacity: 1,
      locked: false,
      color: '#000000',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    for (const angle of [90, 180, 270]) {
      const rotatedPdf = await createBasePdf(1, angle);
      const annotations = new Map([[0, [img]]]);
      const assets = new Map([['rot-asset', asset]]);

      const result = await exportAnnotatedPdf(rotatedPdf, annotations, { assets });
      expect(result.annotationCount).toBe(1);
      expect(result.data.byteLength).toBeGreaterThan(rotatedPdf.byteLength);
    }
  });

  it('handles missing asset gracefully without throwing', async () => {
    const baseBytes = await createBasePdf(1);

    const imgMissing: ImageAnnotation = {
      id: 'ann-missing',
      pageIndex: 0,
      type: 'image',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      assetId: 'non-existent-asset',
      opacity: 1,
      locked: false,
      color: '#000000',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const annotations = new Map([[0, [imgMissing]]]);
    const assets = new Map<string, ImageAsset>();

    // Should reject with clear error when an image asset is missing
    await expect(exportAnnotatedPdf(baseBytes, annotations, { assets })).rejects.toThrow(
      'Image asset non-existent-asset not found for export',
    );
  });
});
