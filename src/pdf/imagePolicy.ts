/**
 * Pure image policy helpers (no DOM): header parsing, size limits and the
 * decision whether an inserted image must be re-encoded.
 */

/** Refuse images above this many pixels (decoded RGBA would exceed ~200 MB). */
export const MAX_IMAGE_PIXELS = 50_000_000;
/** Downscale so the longest side is at most this (plenty for print at 300 DPI on A3). */
export const MAX_IMAGE_DIMENSION = 6000;

export interface ImageSize {
  width: number;
  height: number;
}

/** Width/height from PNG IHDR or JPEG SOFn without decoding; null if unknown. */
export function readImageHeaderSize(bytes: Uint8Array, mimeType: string): ImageSize | null {
  if (mimeType === 'image/png') {
    // 8-byte signature, then IHDR: length(4) 'IHDR'(4) width(4) height(4)
    if (bytes.length < 24 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === 'image/jpeg') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = view.getUint16(offset + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    }
  }
  return null;
}

/**
 * EXIF orientation (1–8) of a JPEG, 1 when absent. Browsers apply it when
 * decoding, but pdf-lib embeds JPEG bytes as-is — so a rotated phone photo
 * would export sideways unless it is re-encoded upright.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return 1; // image data / end: no EXIF found
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && length >= 8) {
      const start = offset + 4;
      // "Exif\0\0"
      if (view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return 1;
      const tiff = start + 6;
      if (tiff + 8 > bytes.length) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd0 = tiff + view.getUint32(tiff + 4, little);
      if (ifd0 + 2 > bytes.length) return 1;
      const entries = view.getUint16(ifd0, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > bytes.length) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

export interface ImageNormalizationPlan {
  /** Re-encode (downscale, bake orientation, or transcode WebP). */
  reencode: boolean;
  outputMimeType: 'image/png' | 'image/jpeg';
  /** Target pixel size after orientation and downscaling. */
  width: number;
  height: number;
}

/**
 * @param decoded size as the browser decodes it (orientation already applied)
 */
export function planImageNormalization(
  decoded: ImageSize,
  mimeType: string,
  orientation: number,
): ImageNormalizationPlan {
  if (decoded.width <= 0 || decoded.height <= 0) throw new Error('Image has zero dimensions.');
  if (decoded.width * decoded.height > MAX_IMAGE_PIXELS) {
    throw new Error(
      `Image is too large (${decoded.width} × ${decoded.height} px). `
      + `The maximum is ${Math.round(MAX_IMAGE_PIXELS / 1e6)} megapixels.`,
    );
  }
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const outputMimeType = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const reencode = scale < 1 || mimeType === 'image/webp' || (mimeType === 'image/jpeg' && orientation !== 1);
  return { reencode, outputMimeType, width, height };
}
