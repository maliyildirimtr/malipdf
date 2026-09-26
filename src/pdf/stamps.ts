/**
 * Rubber stamps (APPROVED, TASLAK, …) rendered to a transparent PNG and
 * inserted as an image annotation, so they can be moved, resized and saved
 * like any other image.
 */

export interface StampSpec {
  text: string;
  color: string;
  /** Second, smaller line (e.g. today's date). */
  subtext?: string;
}

export interface StampPreset {
  id: string;
  text: string;
  color: string;
}

export const STAMP_COLORS = {
  green: '#15803d',
  red: '#b91c1c',
  blue: '#1d4ed8',
  gray: '#4b5563',
  orange: '#c2410c',
} as const;

export const STAMP_PRESETS: StampPreset[] = [
  { id: 'approved', text: 'APPROVED', color: STAMP_COLORS.green },
  { id: 'rejected', text: 'REJECTED', color: STAMP_COLORS.red },
  { id: 'draft', text: 'DRAFT', color: STAMP_COLORS.gray },
  { id: 'confidential', text: 'CONFIDENTIAL', color: STAMP_COLORS.red },
  { id: 'final', text: 'FINAL', color: STAMP_COLORS.blue },
  { id: 'received', text: 'RECEIVED', color: STAMP_COLORS.blue },
  { id: 'onaylandi', text: 'ONAYLANDI', color: STAMP_COLORS.green },
  { id: 'reddedildi', text: 'REDDEDİLDİ', color: STAMP_COLORS.red },
  { id: 'taslak', text: 'TASLAK', color: STAMP_COLORS.gray },
  { id: 'gizli', text: 'GİZLİ', color: STAMP_COLORS.red },
  { id: 'incelendi', text: 'İNCELENDİ', color: STAMP_COLORS.orange },
];

export const MAX_STAMP_TEXT = 40;

/** Uppercase with Turkish rules (i → İ), trimmed and length-limited. */
export function normalizeStampText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR').slice(0, MAX_STAMP_TEXT);
}

export function todayLabel(date = new Date()): string {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Size of the stamp in PDF points, keeping the PNG's aspect ratio. */
export function stampSizePt(pixelWidth: number, pixelHeight: number, hasSubtext: boolean): { width: number; height: number } {
  const height = hasSubtext ? 48 : 34;
  return { width: Math.round((pixelWidth / pixelHeight) * height), height };
}

const SCALE = 4; // render at 4× so the stamp stays sharp when printed
const FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';

export async function renderStampPng(spec: StampSpec): Promise<{ bytes: ArrayBuffer; width: number; height: number }> {
  const text = normalizeStampText(spec.text) || 'STAMP';
  const subtext = spec.subtext?.trim().slice(0, 60) || '';
  const mainSize = 26 * SCALE;
  const subSize = 11 * SCALE;
  const padX = 14 * SCALE;
  const padY = 8 * SCALE;
  const border = 3 * SCALE;
  const gap = 3 * SCALE;

  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `bold ${mainSize}px ${FONT}`;
  const mainWidth = measure.measureText(text).width + text.length * 1.5 * SCALE;
  measure.font = `bold ${subSize}px ${FONT}`;
  const subWidth = subtext ? measure.measureText(subtext).width : 0;

  const width = Math.ceil(Math.max(mainWidth, subWidth) + padX * 2 + border * 2);
  const height = Math.ceil(mainSize + (subtext ? subSize + gap : 0) + padY * 2 + border * 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = spec.color;
  ctx.fillStyle = spec.color;
  ctx.lineWidth = border;
  const inset = border / 2;
  const radius = 8 * SCALE;
  ctx.beginPath();
  ctx.roundRect(inset, inset, width - border, height - border, radius);
  ctx.stroke();
  ctx.lineWidth = SCALE;
  ctx.beginPath();
  ctx.roundRect(border * 2, border * 2, width - border * 4, height - border * 4, radius * 0.6);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold ${mainSize}px ${FONT}`;
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${1.5 * SCALE}px`;
  const mainBaseline = border + padY + mainSize * 0.85;
  ctx.fillText(text, width / 2, mainBaseline);
  if (subtext) {
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
    ctx.font = `bold ${subSize}px ${FONT}`;
    ctx.fillText(subtext, width / 2, mainBaseline + gap + subSize);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The stamp could not be drawn.');
  return { bytes: await blob.arrayBuffer(), width, height };
}
