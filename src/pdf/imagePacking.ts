/**
 * Keeps inserted pictures small in the saved PDF.
 *
 * A PNG is lossless, which is right for screenshots of text but very large
 * for photos: a 3840 × 3072 photo with a transparent background is ~15 MB
 * as PNG and under 1 MB as JPEG. So:
 *
 * - On the page, a picture is embedded at no more than EXPORT_DPI for the
 *   largest size it is placed at. Photos go in as JPEG; transparency is kept
 *   with a separate soft mask (SMask).
 * - For re-editing (MaliPDF's editable data), a photo PNG is stored as JPEG,
 *   or as WebP when it has transparency. The packed bytes are cached, so
 *   saving again does not re-encode (and lose quality) each time.
 *
 * Without a canvas (tests in Node) pictures are embedded unchanged.
 */
import { PDFName, PDFRawStream, PDFStream, type PDFDocument, type PDFImage } from 'pdf-lib';

export type PackedMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface PictureData {
  readonly mimeType: PackedMime;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** Print quality. Pictures are never embedded sharper than this. */
export const EXPORT_DPI = 300;
const PHOTO_BYTES_PER_PIXEL = 0.5;
const PHOTO_MIN_BYTES = 256 * 1024;
const JPEG_QUALITY = 0.88;
const STORE_QUALITY = 0.9;

/** Photos compress badly as PNG; screenshots, diagrams and text do not. */
export function looksLikePhoto(picture: PictureData): boolean {
  if (picture.mimeType !== 'image/png') return true;
  const bytes = picture.data.byteLength;
  return bytes >= PHOTO_MIN_BYTES && bytes / Math.max(1, picture.width * picture.height) >= PHOTO_BYTES_PER_PIXEL;
}

/** Pixel size that gives EXPORT_DPI at the placed size (in points). Never enlarges. */
export function exportPixelSize(picture: { width: number; height: number }, placedWidth: number, placedHeight: number) {
  const need = Math.max(
    (Math.abs(placedWidth) / 72) * EXPORT_DPI / picture.width,
    (Math.abs(placedHeight) / 72) * EXPORT_DPI / picture.height,
  );
  const scale = Number.isFinite(need) && need > 0 ? Math.min(1, need) : 1;
  return {
    width: Math.max(1, Math.round(picture.width * scale)),
    height: Math.max(1, Math.round(picture.height * scale)),
  };
}

export function canvasAvailable(): boolean {
  return typeof createImageBitmap === 'function' && (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined');
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): { ctx: Canvas2D; toBlob: (type: string, quality?: number) => Promise<Blob> } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get OffscreenCanvas 2D context.');
    return { ctx, toBlob: (type, quality) => canvas.convertToBlob({ type, quality }) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get Canvas 2D context.');
  return {
    ctx,
    toBlob: (type, quality) => new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode image.'))), type, quality)),
  };
}

async function rasterize(picture: PictureData, width: number, height: number): Promise<ImageData> {
  const bitmap = await createImageBitmap(new Blob([picture.data as BlobPart], { type: picture.mimeType }));
  try {
    const { ctx } = makeCanvas(width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    bitmap.close?.();
  }
}

async function encode(pixels: ImageData, type: PackedMime, quality?: number): Promise<Uint8Array> {
  const { ctx, toBlob } = makeCanvas(pixels.width, pixels.height);
  ctx.putImageData(pixels, 0, 0);
  const blob = await toBlob(type, quality);
  if (blob.type && blob.type !== type) throw new Error(`This system cannot encode ${type}.`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** The alpha channel, or null when every pixel is opaque. */
export function alphaChannel(rgba: Uint8ClampedArray): Uint8Array | null {
  const alpha = new Uint8Array(rgba.length / 4);
  let transparent = false;
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) {
    alpha[i] = rgba[j];
    if (rgba[j] !== 255) transparent = true;
  }
  return transparent ? alpha : null;
}

/** Same colours, fully opaque (JPEG has no alpha; the SMask carries it). */
function opaque(pixels: ImageData): ImageData {
  const copy = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  for (let j = 3; j < copy.data.length; j += 4) copy.data[j] = 255;
  return copy;
}

/**
 * Embed a picture for display at up to `placedWidth` × `placedHeight` points.
 */
export async function embedPicture(pdfDoc: PDFDocument, picture: PictureData, placedWidth: number, placedHeight: number): Promise<PDFImage> {
  if (!canvasAvailable()) {
    if (picture.mimeType === 'image/jpeg') return pdfDoc.embedJpg(picture.data);
    if (picture.mimeType === 'image/png') return pdfDoc.embedPng(picture.data);
    throw new Error('WebP pictures need the MaliPDF app to be exported.');
  }
  const target = exportPixelSize(picture, placedWidth, placedHeight);
  const shrink = target.width < picture.width * 0.85;
  const photo = looksLikePhoto(picture);
  if (!shrink && picture.mimeType === 'image/jpeg') return pdfDoc.embedJpg(picture.data);
  if (!shrink && picture.mimeType === 'image/png' && !photo) return pdfDoc.embedPng(picture.data);

  const size = shrink ? target : { width: picture.width, height: picture.height };
  const pixels = await rasterize(picture, size.width, size.height);
  if (!photo) return pdfDoc.embedPng(await encode(pixels, 'image/png'));

  const alpha = alphaChannel(pixels.data);
  const image = await pdfDoc.embedJpg(await encode(alpha ? opaque(pixels) : pixels, 'image/jpeg', JPEG_QUALITY));
  if (alpha) {
    await image.embed();
    const context = pdfDoc.context;
    const mask = context.register(context.flateStream(alpha, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: size.width,
      Height: size.height,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8,
    }));
    const stream = context.lookup(image.ref);
    if (stream instanceof PDFRawStream || stream instanceof PDFStream) stream.dict.set(PDFName.of('SMask'), mask);
  }
  return image;
}

const packed = new WeakMap<object, PictureData>();

/**
 * Compact form of a picture for storage (editable data). Photos become JPEG,
 * or WebP when they have transparency; anything else is kept as it is.
 */
export async function packPicture<T extends PictureData>(picture: T): Promise<PictureData> {
  const cached = packed.get(picture);
  if (cached) return cached;
  let result: PictureData = picture;
  if (picture.mimeType === 'image/png' && canvasAvailable() && looksLikePhoto(picture)) {
    try {
      const pixels = await rasterize(picture, picture.width, picture.height);
      const hasAlpha = alphaChannel(pixels.data) !== null;
      const mimeType: PackedMime = hasAlpha ? 'image/webp' : 'image/jpeg';
      const data = await encode(hasAlpha ? pixels : opaque(pixels), mimeType, STORE_QUALITY);
      if (data.byteLength < picture.data.byteLength * 0.8) {
        result = { mimeType, width: picture.width, height: picture.height, data };
      }
    } catch {
      result = picture; // keep the original if this system cannot encode
    }
  }
  packed.set(picture, result);
  return result;
}
