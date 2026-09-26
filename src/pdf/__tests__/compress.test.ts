import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFNumber } from 'pdf-lib';
import { compressPdf, type ImageEncoder } from '../compress';

async function pdfWithImage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const w = 400, h = 300;
  const pixels = new Uint8Array(w * h * 3);
  let seed = 7;
  for (let i = 0; i < pixels.length; i++) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; pixels[i] = (seed >> 16) & 255; }
  const image = doc.context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' });
  const ref = doc.context.register(image);
  page.node.setXObject(PDFName.of('Im1'), ref);
  page.pushOperators();
  // An orphan object that nothing uses.
  doc.context.register(doc.context.obj({ Unused: true }));
  return doc.save();
}

const fakeEncoder: ImageEncoder = {
  fromJpeg: async () => null,
  fromRaw: async (image, maxSide) => {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    return { data: new Uint8Array(1000).fill(1), width: Math.round(image.width * scale), height: Math.round(image.height * scale), gray: false };
  },
};

describe('reduce file size', () => {
  it('re-encodes big RGB images as JPEG and drops unused objects', async () => {
    const doc = await PDFDocument.load(await pdfWithImage());
    const report = await compressPdf(doc, 'small', fakeEncoder);
    expect(report.recompressed).toBe(1);
    expect(report.removedObjects).toBeGreaterThanOrEqual(1);
    const images = [...doc.context.enumerateIndirectObjects()]
      .map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
    expect(images).toHaveLength(1);
    expect(images[0].dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
    expect((images[0].dict.get(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(400);
    expect(images[0].contents.byteLength).toBe(1000);
  });

  it('keeps an image when the new one would not be smaller', async () => {
    const doc = await PDFDocument.load(await pdfWithImage());
    const report = await compressPdf(doc, 'small', { ...fakeEncoder, fromRaw: async (i) => ({ data: new Uint8Array(10_000_000), width: i.width, height: i.height, gray: false }) });
    expect(report.recompressed).toBe(0);
  });
});
