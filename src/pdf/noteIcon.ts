/**
 * The sticky-note icon, shared by the page view and the PDF appearance
 * stream so both look the same. Coordinates are in a unit box, y down.
 */
export interface NoteIconPath {
  points: [number, number][];
  closed: boolean;
  role: 'body' | 'fold' | 'line';
}

export const NOTE_ICON_PATHS: readonly NoteIconPath[] = [
  { role: 'body', closed: true, points: [[0.08, 0.08], [0.92, 0.08], [0.92, 0.68], [0.68, 0.92], [0.08, 0.92]] },
  { role: 'fold', closed: true, points: [[0.92, 0.68], [0.68, 0.68], [0.68, 0.92]] },
  { role: 'line', closed: false, points: [[0.22, 0.3], [0.78, 0.3]] },
  { role: 'line', closed: false, points: [[0.22, 0.46], [0.78, 0.46]] },
  { role: 'line', closed: false, points: [[0.22, 0.62], [0.54, 0.62]] },
];

/** Outline width as a fraction of the icon size. */
export const NOTE_ICON_STROKE = 0.06;

/** `hex` mixed toward black (for the outline, fold and lines). */
export function noteShade(hex: string, amount = 0.45): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#5a4a00';
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}
