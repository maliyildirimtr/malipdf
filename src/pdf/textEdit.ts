/** Geometry shared by the screen and the export for edited PDF text. */
import type { PdfPoint, TextEditAnnotation } from '../types/annotations';

/** Width the cover needs: the old line or the new text, whichever is longer. */
export function coverWidth(annotation: Pick<TextEditAnnotation, 'originalWidth' | 'textWidth'>): number {
  return Math.max(annotation.originalWidth, annotation.textWidth) + 1;
}

/** Corners of the cover (PDF space): bottom-left, bottom-right, top-right, top-left. */
export function coverQuad(a: Pick<TextEditAnnotation, 'origin' | 'angle' | 'ascent' | 'descent'>, width: number, pad = 0.6): PdfPoint[] {
  const dx = Math.cos(a.angle);
  const dy = Math.sin(a.angle);
  const at = (along: number, up: number) => ({ x: a.origin.x + dx * along - dy * up, y: a.origin.y + dy * along + dx * up });
  return [at(-pad, -a.descent - pad), at(width + pad, -a.descent - pad), at(width + pad, a.ascent + pad), at(-pad, a.ascent + pad)];
}

