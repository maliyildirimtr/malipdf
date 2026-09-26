/**
 * Header, footer, page numbers and watermark, written into the pages
 * themselves (so every PDF app shows and prints them). Positions follow the
 * page as it is shown, also on rotated pages.
 */
import { degrees, rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';

export type NumberFormat = 'n' | 'page-n' | 'n-of-total' | 'page-n-of-total';
export type Corner = 'left' | 'center' | 'right';

export interface PageStampOptions {
  pageNumbers?: { format: NumberFormat; position: 'top' | 'bottom'; align: Corner; start: number };
  header?: { text: string; align: Corner };
  footer?: { text: string; align: Corner };
  watermark?: { text: string; opacity: number; size: number; color: string; diagonal: boolean };
  /** Font size for header, footer and numbers (pt). */
  fontSize: number;
  color: string;
  /** 0-based page indices to stamp. */
  pages: number[];
  /** Leave out the first page of the selection (cover page). */
  skipFirst?: boolean;
}

export function formatPageNumber(format: NumberFormat, n: number, total: number): string {
  switch (format) {
    case 'n': return String(n);
    case 'page-n': return `Page ${n}`;
    case 'n-of-total': return `${n} / ${total}`;
    case 'page-n-of-total': return `Page ${n} of ${total}`;
  }
}

/** Placeholders in header / footer text: {page}, {pages}, {date}, {title}. */
export function fillPlaceholders(text: string, values: { page: number; pages: number; date: string; title: string }): string {
  return text
    .replace(/\{page\}/g, String(values.page))
    .replace(/\{pages\}/g, String(values.pages))
    .replace(/\{date\}/g, values.date)
    .replace(/\{title\}/g, values.title);
}

function hex(color: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  const n = m ? parseInt(m[1], 16) : 0x444444;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** The page as shown (after /Rotate): its size and a mapping to PDF space. */
export function visualFrame(page: PDFPage) {
  const box = page.getCropBox();
  const x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = rotation === 90 || rotation === 270;
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  /** Visual point (origin bottom-left as shown) → PDF user space. */
  const toPdf = (vx: number, vy: number): { x: number; y: number } => {
    switch (rotation) {
      case 90: return { x: x1 - vy, y: y0 + vx };
      case 180: return { x: x1 - vx, y: y1 - vy };
      case 270: return { x: x0 + vy, y: y1 - vx };
      default: return { x: x0 + vx, y: y0 + vy };
    }
  };
  return { width, height, rotation, toPdf };
}

/** Draw `text` so it reads normally on the shown page, starting at visual (vx, vy). */
function drawVisualText(page: PDFPage, frame: ReturnType<typeof visualFrame>, text: string, vx: number, vy: number,
  opts: { font: PDFFont; size: number; color: ReturnType<typeof hex>; opacity?: number; angle?: number }) {
  const angle = opts.angle ?? 0;
  const p = frame.toPdf(vx, vy);
  page.drawText(text, {
    x: p.x, y: p.y, size: opts.size, font: opts.font, color: opts.color, opacity: opts.opacity ?? 1,
    rotate: degrees(frame.rotation + angle),
  });
}

function alignedX(frame: { width: number }, textWidth: number, align: Corner, margin: number): number {
  if (align === 'left') return margin;
  if (align === 'right') return frame.width - margin - textWidth;
  return (frame.width - textWidth) / 2;
}

/**
 * Stamp the pages. `font` must cover the text (use an embedded Unicode font
 * for Turkish letters). Returns how many pages were changed.
 */
export function applyPageStamps(pdf: PDFDocument, options: PageStampOptions, font: PDFFont, meta: { title: string; date: string }): number {
  const pages = options.pages.filter((i) => i >= 0 && i < pdf.getPageCount());
  const targets = options.skipFirst ? pages.slice(1) : pages;
  const total = pdf.getPageCount();
  const color = hex(options.color);
  const size = options.fontSize;
  let count = 0;

  targets.forEach((pageIndex, i) => {
    const page = pdf.getPage(pageIndex);
    const frame = visualFrame(page);
    const margin = Math.max(18, Math.min(frame.width, frame.height) * 0.05);
    const values = { page: pageIndex + 1, pages: total, ...meta };
    let changed = false;

    if (options.watermark && options.watermark.text.trim()) {
      const wm = options.watermark;
      const text = fillPlaceholders(wm.text, values);
      const w = font.widthOfTextAtSize(text, wm.size);
      const angle = wm.diagonal ? Math.atan2(frame.height, frame.width) * (180 / Math.PI) : 0;
      const rad = (angle * Math.PI) / 180;
      // Centre the text on the page along its angle.
      const h = wm.size * 0.7;
      const cx = frame.width / 2 - (Math.cos(rad) * w) / 2 + (Math.sin(rad) * h) / 2;
      const cy = frame.height / 2 - (Math.sin(rad) * w) / 2 - (Math.cos(rad) * h) / 2;
      drawVisualText(page, frame, text, cx, cy, { font, size: wm.size, color: hex(wm.color), opacity: wm.opacity, angle });
      changed = true;
    }
    const line = (text: string, align: Corner, top: boolean) => {
      const w = font.widthOfTextAtSize(text, size);
      const vy = top ? frame.height - margin * 0.6 - size : margin * 0.6;
      drawVisualText(page, frame, text, alignedX(frame, w, align, margin), vy, { font, size, color });
      changed = true;
    };
    if (options.header?.text.trim()) line(fillPlaceholders(options.header.text, values), options.header.align, true);
    if (options.footer?.text.trim()) line(fillPlaceholders(options.footer.text, values), options.footer.align, false);
    if (options.pageNumbers) {
      const pn = options.pageNumbers;
      const shownTotal = targets.length + pn.start - 1;
      line(formatPageNumber(pn.format, pn.start + i, shownTotal), pn.align, pn.position === 'top');
    }
    if (changed) count++;
  });
  return count;
}
