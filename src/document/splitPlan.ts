/**
 * Split PDF: which pages go into which new file. Page numbers here are
 * 1-based as the user types them; the result uses 0-based page indices.
 */
export interface SplitPart {
  /** 0-based page indices, in order. */
  pages: number[];
  /** "1-3", "5", … for the file name. */
  label: string;
}

function label(pages: number[]): string {
  const first = pages[0] + 1;
  const last = pages[pages.length - 1] + 1;
  return first === last ? `page ${first}` : `pages ${first}-${last}`;
}

const part = (pages: number[]): SplitPart => ({ pages, label: label(pages) });

/** Parts of `size` pages each (the last may be shorter). */
export function splitEvery(pageCount: number, size: number): SplitPart[] {
  const n = Math.max(1, Math.floor(size));
  const parts: SplitPart[] = [];
  for (let start = 0; start < pageCount; start += n) {
    parts.push(part(Array.from({ length: Math.min(n, pageCount - start) }, (_, i) => start + i)));
  }
  return parts;
}

/**
 * One part per comma-separated range: "1-3, 5, 8-" (open end = last page).
 * Throws a readable error for anything that is not a valid range.
 */
export function splitByRanges(pageCount: number, text: string): SplitPart[] {
  const chunks = text.split(/[,;]/).map((c) => c.trim()).filter(Boolean);
  if (chunks.length === 0) throw new Error('Type page ranges, for example 1-3, 4-10, 11-.');
  return chunks.map((chunk) => {
    const m = /^(\d+)?\s*(?:[-–]\s*(\d+)?)?$/.exec(chunk);
    if (!m || (!m[1] && !m[2])) throw new Error(`"${chunk}" is not a page range.`);
    const isRange = chunk.includes('-') || chunk.includes('–');
    const from = m[1] ? Number(m[1]) : 1;
    const to = isRange ? (m[2] ? Number(m[2]) : pageCount) : from;
    if (from < 1 || to > pageCount || from > to) {
      throw new Error(`"${chunk}" is outside pages 1–${pageCount}.`);
    }
    return part(Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
  });
}
