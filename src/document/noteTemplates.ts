/**
 * Ready-made note page templates: Cornell notes, to-do list, weekly planner,
 * meeting notes and music staff paper. Drawn as vector lines and labels, so
 * they print sharply and stay light enough to write over.
 */
import { StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

export type NoteTemplateId = 'cornell' | 'todo' | 'weekly' | 'meeting' | 'music';

export const NOTE_TEMPLATES: { id: NoteTemplateId; label: string }[] = [
  { id: 'cornell', label: 'Cornell' },
  { id: 'todo', label: 'To-do' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'music', label: 'Music' },
];

const MM = 72 / 25.4;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function hex(color: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  const n = m ? parseInt(m[1], 16) : 0x999999;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Pen {
  page: PDFPage;
  color: RGB;
  font: PDFFont;
  line: (x1: number, y1: number, x2: number, y2: number, thickness?: number) => void;
  rect: (x: number, y: number, w: number, h: number, thickness?: number) => void;
  label: (text: string, x: number, y: number, size?: number) => void;
  /** Horizontal writing lines from `top` down to `bottom`. */
  lines: (x1: number, x2: number, top: number, bottom: number, step: number) => void;
}

function makePen(page: PDFPage, color: string): Pen {
  const c = hex(color);
  const font = page.doc.embedStandardFont(StandardFonts.HelveticaBold);
  const pen: Pen = {
    page, color: c, font,
    line: (x1, y1, x2, y2, thickness = 0.5) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: c }),
    rect: (x, y, w, h, thickness = 0.75) => page.drawRectangle({ x, y, width: w, height: h, borderColor: c, borderWidth: thickness }),
    label: (text, x, y, size = 9) => page.drawText(text, { x, y, size, font, color: c }),
    lines: (x1, x2, top, bottom, step) => {
      for (let y = top - step; y >= bottom + step * 0.4; y -= step) pen.line(x1, y, x2, y, 0.4);
    },
  };
  return pen;
}

/** Draw `template` over a page of `width` × `height` points. */
export function drawNoteTemplate(page: PDFPage, width: number, height: number, template: NoteTemplateId, spacingMm: number, color: string): void {
  const pen = makePen(page, color);
  const m = Math.min(width, height) * 0.06; // margin
  const step = Math.max(4, spacingMm) * MM;
  const left = m;
  const right = width - m;
  const top = height - m;
  const bottom = m;

  switch (template) {
    case 'cornell': {
      const titleH = Math.max(40, height * 0.07);
      const summaryH = height * 0.2;
      const cueX = left + (right - left) * 0.3;
      pen.label('TOPIC', left, top - 12);
      pen.label('DATE', right - 110, top - 12);
      pen.line(left, top - titleH, right, top - titleH, 1);
      pen.line(cueX, top - titleH, cueX, bottom + summaryH, 1);
      pen.line(left, bottom + summaryH, right, bottom + summaryH, 1);
      pen.label('CUES', left, top - titleH - 14, 8);
      pen.label('NOTES', cueX + 8, top - titleH - 14, 8);
      pen.label('SUMMARY', left, bottom + summaryH - 14, 8);
      pen.lines(cueX + 6, right, top - titleH - 18, bottom + summaryH, step);
      break;
    }
    case 'todo': {
      pen.label('TO-DO', left, top - 14, 14);
      pen.label('DATE', right - 110, top - 12);
      pen.line(left, top - 24, right, top - 24, 1);
      const row = Math.max(step, 8 * MM);
      const box = Math.min(row * 0.5, 12);
      for (let y = top - 24 - row; y >= bottom; y -= row) {
        pen.rect(left, y + (row - box) / 2 - row * 0.15, box, box);
        pen.line(left + box + 8, y, right, y, 0.4);
      }
      break;
    }
    case 'weekly': {
      pen.label('WEEK OF', left, top - 12);
      pen.line(left + 52, top - 13, left + 200, top - 13, 0.5);
      const gridTop = top - 26;
      const cols = width > height ? 4 : 2;
      const rows = 8 / cols;
      const cellW = (right - left) / cols;
      const cellH = (gridTop - bottom) / rows;
      const names = [...DAYS, 'Notes'];
      names.forEach((name, i) => {
        const cx = left + (i % cols) * cellW;
        const cy = gridTop - (Math.floor(i / cols) + 1) * cellH;
        pen.rect(cx, cy, cellW, cellH);
        pen.label(name.toUpperCase(), cx + 6, cy + cellH - 13, 8);
        pen.lines(cx + 6, cx + cellW - 6, cy + cellH - 16, cy, step);
      });
      break;
    }
    case 'meeting': {
      pen.label('MEETING', left, top - 14, 14);
      let y = top - 34;
      for (const field of ['DATE', 'ATTENDEES']) {
        pen.label(field, left, y + 3, 8);
        pen.line(left + 70, y, right, y, 0.5);
        y -= 22;
      }
      const actionsH = (y - bottom) * 0.3;
      pen.label('NOTES', left, y - 4, 8);
      pen.lines(left, right, y - 8, bottom + actionsH + 10, step);
      const ay = bottom + actionsH;
      pen.line(left, ay + 4, right, ay + 4, 1);
      pen.label('ACTION ITEMS', left, ay - 10, 8);
      const row = Math.max(step, 8 * MM);
      for (let ry = ay - 14 - row; ry >= bottom; ry -= row) {
        pen.rect(left, ry + 3, 9, 9);
        pen.line(left + 16, ry, right - 90, ry, 0.4);
        pen.line(right - 80, ry, right, ry, 0.4);
      }
      break;
    }
    case 'music': {
      const lineGap = 2 * MM;
      const staffH = lineGap * 4;
      const gap = staffH * 1.6;
      for (let y = top - 10; y - staffH >= bottom; y -= staffH + gap) {
        for (let k = 0; k < 5; k++) pen.line(left, y - k * lineGap, right, y - k * lineGap, 0.5);
        pen.line(left, y, left, y - staffH, 0.6);
        pen.line(right, y, right, y - staffH, 0.6);
      }
      break;
    }
  }
}
