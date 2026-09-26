/** Helpers for the signature pad: find the ink and crop to it. */

export interface InkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounding box of all non-transparent pixels, or null when empty. */
export function findInkBounds(alpha: (x: number, y: number) => number, width: number, height: number): InkBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha(x, y) > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Crop a canvas to its ink (plus padding) and return a PNG data URL. */
export function canvasToTrimmedPng(canvas: HTMLCanvasElement, padding = 8, maxWidth = 1200): string | null {
  const ctx = canvas.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = findInkBounds((x, y) => data[(y * canvas.width + x) * 4 + 3], canvas.width, canvas.height);
  if (!bounds) return null;
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const w = Math.min(canvas.width - x, bounds.width + padding * 2);
  const h = Math.min(canvas.height - y, bounds.height + padding * 2);
  const scale = Math.min(1, maxWidth / w);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  out.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Width of an inserted signature in PDF points. */
export const SIGNATURE_WIDTH_PT = 150;
