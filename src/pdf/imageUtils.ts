/**
 * Image Utilities
 *
 * Image validation, normalization, default sizing, and async target snapshotting.
 */

import type { DocumentIdentity } from '../types/documentSession';
import type { PdfBox } from './coordinateTransform';
import type { PdfPoint, PdfRect } from '../types/annotations';
import type { ImageAsset } from '../store/assetStore';
import { useDocumentStore } from '../store/documentStore';
import {
  MAX_IMAGE_PIXELS,
  planImageNormalization,
  readImageHeaderSize,
  readJpegOrientation,
} from './imagePolicy';

export const MAX_IMAGE_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Validates that raw bytes and MIME type conform to supported constraints.
 */
export function validateImageBytes(bytes: Uint8Array, mimeType: string): void {
  if (bytes.byteLength === 0) {
    throw new Error('Image data is empty (0 bytes).');
  }
  if (bytes.byteLength > MAX_IMAGE_FILE_SIZE_BYTES) {
    throw new Error(
      `Image size exceeds maximum allowed limit (${Math.round(MAX_IMAGE_FILE_SIZE_BYTES / (1024 * 1024))}MB).`,
    );
  }
  const normalizedMime = mimeType.toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw new Error(`Unsupported image format: ${mimeType}. Supported formats: PNG, JPEG, WebP.`);
  }
}

/**
 * Normalizes input image bytes:
 * - Decodes to verify dimensions > 0
 * - Transcodes WebP once on import to PNG bytes (so exporter and render cache only deal with PNG/JPEG)
 * - Returns a semantic ImageAsset ready to store
 */
export async function normalizeAndCreateImageAsset(
  rawBytes: Uint8Array | ArrayBuffer,
  inputMimeType: string,
): Promise<ImageAsset> {
  const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  const mime = inputMimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : inputMimeType.toLowerCase();
  validateImageBytes(bytes, mime);

  // If running in headless node/test environment without DOM/canvas,
  // we handle standard PNG/JPEG inspection if createImageBitmap is absent.
  if (typeof window === 'undefined' || (typeof createImageBitmap === 'undefined' && typeof document === 'undefined')) {
    return {
      id: crypto.randomUUID(),
      mimeType: mime === 'image/webp' ? 'image/png' : (mime as 'image/png' | 'image/jpeg'),
      width: 800,
      height: 600,
      data: bytes,
    };
  }

  // Cheap header check first, so a huge image is refused before decoding it.
  const headerSize = readImageHeaderSize(bytes, mime);
  if (headerSize && headerSize.width * headerSize.height > MAX_IMAGE_PIXELS) {
    planImageNormalization(headerSize, mime, 1); // throws the user-facing size error
  }

  // Decode once. Browsers apply EXIF orientation here, so the decoded size
  // is the upright size.
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const decoded = await decodeImage(blob);
  try {
    const orientation = mime === 'image/jpeg' ? readJpegOrientation(bytes) : 1;
    const plan = planImageNormalization({ width: decoded.width, height: decoded.height }, mime, orientation);

    if (!plan.reencode) {
      return {
        id: crypto.randomUUID(),
        mimeType: mime as 'image/png' | 'image/jpeg',
        width: decoded.width,
        height: decoded.height,
        data: bytes,
      };
    }

    // Re-encode: WebP → PNG, bake EXIF rotation into JPEG pixels (pdf-lib
    // ignores EXIF), and downscale oversized images.
    const data = await encodeImage(decoded.source, plan.width, plan.height, plan.outputMimeType);
    return {
      id: crypto.randomUUID(),
      mimeType: plan.outputMimeType,
      width: plan.width,
      height: plan.height,
      data,
    };
  } finally {
    decoded.release();
  }
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
  }
  const img = await loadImageElement(blob);
  return {
    source: img,
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    release: () => {},
  };
}

async function encodeImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  mimeType: 'image/png' | 'image/jpeg',
): Promise<Uint8Array> {
  const quality = mimeType === 'image/jpeg' ? 0.92 : undefined;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get OffscreenCanvas 2D context.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: mimeType, quality });
    return new Uint8Array(await blob.arrayBuffer());
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get Canvas 2D context.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mimeType, quality));
    if (!blob) throw new Error('Failed to encode image.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to decode image element: ${String(err)}`));
    };
    img.src = url;
  });
}

/**
 * Calculates sensible default bounds for an inserted image on a PDF page.
 * - Preserves aspect ratio
 * - Fits within 70% of the page box if natural size is huge
 * - Positions at insertPoint (centered) or page center if no insertPoint is specified
 * - Clamps coordinates to keep the image inside the page box
 */
export function calculateDefaultImageBounds(
  imgWidth: number,
  imgHeight: number,
  pageBox: PdfBox,
  insertPoint?: PdfPoint,
): PdfRect {
  const aspect = imgWidth / imgHeight;
  const maxAllowedWidth = pageBox.width * 0.7;
  const maxAllowedHeight = pageBox.height * 0.7;

  let targetWidth = imgWidth;
  let targetHeight = imgHeight;

  // Scale down if larger than 70% of page bounds
  if (targetWidth > maxAllowedWidth || targetHeight > maxAllowedHeight) {
    const scale = Math.min(maxAllowedWidth / targetWidth, maxAllowedHeight / targetHeight);
    targetWidth = Math.round(targetWidth * scale);
    targetHeight = Math.round(targetHeight * scale);
  }

  // Minimum sensible dimensions
  targetWidth = Math.max(20, targetWidth);
  targetHeight = Math.max(20, Math.round(targetWidth / aspect));

  let x: number;
  let y: number;

  if (insertPoint) {
    // Center at insertPoint
    x = insertPoint.x - targetWidth / 2;
    y = insertPoint.y - targetHeight / 2;
  } else {
    // Center on page
    x = pageBox.xMin + (pageBox.width - targetWidth) / 2;
    y = pageBox.yMin + (pageBox.height - targetHeight) / 2;
  }

  // Clamp within page bounds
  const minX = pageBox.xMin;
  const maxX = pageBox.xMin + Math.max(0, pageBox.width - targetWidth);
  const minY = pageBox.yMin;
  const maxY = pageBox.yMin + Math.max(0, pageBox.height - targetHeight);

  x = Math.max(minX, Math.min(maxX, x));
  y = Math.max(minY, Math.min(maxY, y));

  return {
    x,
    y,
    width: targetWidth,
    height: targetHeight,
  };
}

// ─── Async Target Guard ───────────────────────────────────────────────────────

export interface InsertTargetSnapshot {
  readonly identity: DocumentIdentity;
  readonly pageIndex: number;
}

/**
 * Capture snapshot of intended target document and page before starting an async operation.
 */
export function createInsertTargetSnapshot(): InsertTargetSnapshot | null {
  const docStore = useDocumentStore.getState();
  const activeDocId = docStore.activeDocId;
  if (!activeDocId) return null;
  const doc = docStore.documents.get(activeDocId);
  if (!doc) return null;
  return {
    identity: { docId: doc.id, instanceId: doc.instanceId },
    pageIndex: doc.activePageIndex,
  };
}

/**
 * Verify that the target document and page are still alive and valid after an async operation.
 */
export function isInsertTargetValid(snapshot: InsertTargetSnapshot | null): boolean {
  if (!snapshot) return false;
  const docStore = useDocumentStore.getState();
  const doc = docStore.documents.get(snapshot.identity.docId);
  if (!doc) return false;
  if (doc.instanceId !== snapshot.identity.instanceId) return false;
  if (snapshot.pageIndex < 0 || snapshot.pageIndex >= doc.pageCount) return false;
  return true;
}
