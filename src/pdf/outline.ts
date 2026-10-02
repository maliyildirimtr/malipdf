/** Reads a PDF's own table of contents (outline) through pdf.js. */
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface OutlineNode {
  id: string;
  title: string;
  /** Target page, or null when the entry has no page (e.g. a web link). */
  pageIndex: number | null;
  url: string | null;
  bold: boolean;
  italic: boolean;
  children: OutlineNode[];
}

type RawItem = {
  title: string;
  dest: string | unknown[] | null;
  url?: string | null;
  bold?: boolean;
  italic?: boolean;
  items?: RawItem[];
};

export const MAX_OUTLINE_ITEMS = 5000;

export async function resolvePage(pdf: PDFDocumentProxy, dest: RawItem['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const target = explicit[0];
    if (Number.isInteger(target)) return target as number;
    if (target && typeof target === 'object' && 'num' in target) {
      return await pdf.getPageIndex(target as { num: number; gen: number });
    }
  } catch {
    // Broken destination: show the entry without a page.
  }
  return null;
}

export async function loadOutline(pdf: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = (await pdf.getOutline()) as RawItem[] | null;
  if (!raw) return [];
  let count = 0;
  const convert = async (items: RawItem[], prefix: string): Promise<OutlineNode[]> => {
    const nodes: OutlineNode[] = [];
    for (let index = 0; index < items.length && count < MAX_OUTLINE_ITEMS; index++) {
      count++;
      const item = items[index];
      const id = `${prefix}${index}`;
      nodes.push({
        id,
        title: (item.title ?? '').trim() || 'Untitled',
        pageIndex: await resolvePage(pdf, item.dest),
        url: typeof item.url === 'string' ? item.url : null,
        bold: item.bold === true,
        italic: item.italic === true,
        children: item.items?.length ? await convert(item.items, `${id}.`) : [],
      });
    }
    return nodes;
  };
  return convert(raw, '');
}
