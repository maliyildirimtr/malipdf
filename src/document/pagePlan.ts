/**
 * Page management engine.
 *
 * Every page operation (insert blank, duplicate, delete, rotate, reorder,
 * insert from another PDF, export a subset) is expressed as a PagePlan: the
 * list of pages the resulting document should have, in order. One function
 * turns a plan into PDF bytes; another moves annotations along with their
 * pages. Undo/redo is the existing MUTATE_DOCUMENT_BYTES history action.
 */
import { PDFDocument, degrees, type PDFPage } from 'pdf-lib';
import type { Annotation, Bookmark } from '../types/annotations';
import { nanoid } from '../utils/nanoid';
import { drawPageBackground, type PageBackground } from './newDocumentGenerator';

export const A4_PORTRAIT_PT = { width: 595.28, height: 841.89 } as const;

export type PagePlanEntry =
  /** A page of the current document. Using the same `from` twice duplicates it. */
  | { kind: 'existing'; from: number; rotateBy?: number }
  /**
   * A blank page with the size and rotation of page `likePage`. With a
   * `background` or a fixed `size` the page is created upright (rotation 0)
   * at the size page `likePage` is shown at, so lines run the right way.
   */
  | { kind: 'blank'; likePage: number; background?: PageBackground; size?: 'like' | 'a4' }
  /** Page `sourceIndex` of the external PDF passed to buildPdfFromPlan. */
  | { kind: 'external'; sourceIndex: number };

export type PagePlan = PagePlanEntry[];

type ExistingEntry = Extract<PagePlanEntry, { kind: 'existing' }>;

export function identityPlan(pageCount: number): ExistingEntry[] {
  return Array.from({ length: pageCount }, (_, from) => ({ kind: 'existing' as const, from }));
}

const normalizeQuarterTurn = (value: number) => ((Math.round(value / 90) * 90) % 360 + 360) % 360;

/**
 * Apply `plan` to `sourceBytes`. Pages are re-used in place (document-level
 * objects such as outlines, metadata and forms are kept); duplicates and
 * external pages are deep-copied with pdf-lib.
 */
export async function buildPdfFromPlan(
  sourceBytes: Uint8Array,
  plan: PagePlan,
  externalBytes?: Uint8Array,
): Promise<Uint8Array> {
  if (plan.length === 0) throw new Error('A document must keep at least one page.');
  const doc = await PDFDocument.load(sourceBytes);
  const original = doc.getPages();
  const external = plan.some((e) => e.kind === 'external')
    ? await PDFDocument.load(requireBytes(externalBytes))
    : null;

  // Resolve every entry to a PDFPage BEFORE touching the page tree.
  const used = new Set<number>();
  const pages: PDFPage[] = [];
  for (const entry of plan) {
    if (entry.kind === 'existing') {
      const page = original[entry.from];
      if (!page) throw new RangeError(`Page ${entry.from + 1} does not exist.`);
      if (used.has(entry.from)) {
        const [copy] = await doc.copyPages(doc, [entry.from]);
        pages.push(copy);
      } else {
        used.add(entry.from);
        pages.push(page);
      }
    } else if (entry.kind === 'external') {
      if (!external || entry.sourceIndex < 0 || entry.sourceIndex >= external.getPageCount()) {
        throw new RangeError(`Inserted PDF has no page ${entry.sourceIndex + 1}.`);
      }
      const [copy] = await doc.copyPages(external, [entry.sourceIndex]);
      pages.push(copy);
    } else {
      pages.push(null as unknown as PDFPage); // created after the tree is emptied
    }
  }

  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);

  plan.forEach((entry, index) => {
    if (entry.kind === 'blank') {
      const like = original[entry.likePage] ?? original[0];
      const { width, height } = like.getSize();
      const angle = like.getRotation().angle;
      if (!entry.background && entry.size !== 'a4') {
        const page = doc.insertPage(index, [width, height]);
        page.setRotation(degrees(angle));
        return;
      }
      const shown = normalizeQuarterTurn(angle) % 180 === 0 ? { width, height } : { width: height, height: width };
      const size = entry.size === 'a4' ? A4_PORTRAIT_PT : shown;
      const page = doc.insertPage(index, [size.width, size.height]);
      if (entry.background) drawPageBackground(page, size.width, size.height, entry.background);
      return;
    }
    const page = pages[index];
    doc.insertPage(index, page);
    if (entry.kind === 'existing' && entry.rotateBy) {
      page.setRotation(degrees(normalizeQuarterTurn(page.getRotation().angle + entry.rotateBy)));
    }
  });

  return doc.save();
}

function requireBytes(bytes: Uint8Array | undefined): Uint8Array {
  if (!bytes) throw new Error('An external PDF is required for this operation.');
  return bytes;
}

/**
 * Move annotations with their pages. The first use of a page keeps the
 * original annotation ids; duplicated pages get fresh ids. Annotations of
 * pages that are not in the plan are dropped (history keeps them for undo).
 */
export function remapAnnotationsForPlan(annotations: readonly Annotation[], plan: PagePlan): Annotation[] {
  const byPage = new Map<number, Annotation[]>();
  for (const ann of annotations) {
    const list = byPage.get(ann.pageIndex) ?? [];
    list.push(ann);
    byPage.set(ann.pageIndex, list);
  }
  const used = new Set<number>();
  const result: Annotation[] = [];
  plan.forEach((entry, newIndex) => {
    if (entry.kind !== 'existing') return;
    const firstUse = !used.has(entry.from);
    used.add(entry.from);
    for (const ann of byPage.get(entry.from) ?? []) {
      result.push(firstUse
        ? (ann.pageIndex === newIndex ? ann : { ...ann, pageIndex: newIndex } as Annotation)
        : { ...structuredClone(ann), id: nanoid(), pageIndex: newIndex } as Annotation);
    }
  });
  return result;
}

/** Bookmarks follow their page (first copy); bookmarks of deleted pages go. */
export function remapBookmarksForPlan(bookmarks: readonly Bookmark[], plan: PagePlan): Bookmark[] {
  const firstIndex = new Map<number, number>();
  plan.forEach((entry, newIndex) => {
    if (entry.kind === 'existing' && !firstIndex.has(entry.from)) firstIndex.set(entry.from, newIndex);
  });
  return bookmarks
    .flatMap((bookmark) => {
      const pageIndex = firstIndex.get(bookmark.pageIndex);
      return pageIndex === undefined ? [] : [pageIndex === bookmark.pageIndex ? bookmark : { ...bookmark, pageIndex }];
    })
    .sort((a, b) => a.pageIndex - b.pageIndex);
}

/** View-only rotations (DocumentState.pageRotations) follow their pages. */
export function remapViewRotationsForPlan(rotations: Record<number, number>, plan: PagePlan): Record<number, number> {
  const result: Record<number, number> = {};
  plan.forEach((entry, newIndex) => {
    if (entry.kind === 'existing' && rotations[entry.from]) result[newIndex] = rotations[entry.from];
  });
  return result;
}

// ─── Plan builders ───────────────────────────────────────────────────────────

const sortedUnique = (indices: Iterable<number>) => [...new Set(indices)].sort((a, b) => a - b);

export function planInsertBlank(
  pageCount: number,
  afterIndex: number,
  options: { background?: PageBackground; size?: 'like' | 'a4' } = {},
): PagePlan {
  const plan: PagePlan = identityPlan(pageCount);
  const at = Math.max(0, Math.min(pageCount, afterIndex + 1));
  const entry: PagePlanEntry = { kind: 'blank', likePage: Math.max(0, Math.min(pageCount - 1, afterIndex)) };
  if (options.background && options.background.type !== 'blank') entry.background = options.background;
  if (options.size === 'a4') entry.size = 'a4';
  plan.splice(at, 0, entry);
  return plan;
}

/** Each selected page is followed by its copy. */
export function planDuplicate(pageCount: number, indices: Iterable<number>): PagePlan {
  const selected = new Set(indices);
  return identityPlan(pageCount).flatMap((entry) => (
    selected.has(entry.from) ? [entry, { kind: 'existing' as const, from: entry.from }] : [entry]
  ));
}

export function planDelete(pageCount: number, indices: Iterable<number>): PagePlan {
  const doomed = new Set(indices);
  const plan = identityPlan(pageCount).filter((entry) => !doomed.has(entry.from));
  if (plan.length === 0) throw new Error('A document must keep at least one page.');
  return plan;
}

export function planRotate(pageCount: number, indices: Iterable<number>, rotateBy: number): PagePlan {
  const selected = new Set(indices);
  return identityPlan(pageCount).map((entry) => (
    selected.has(entry.from) ? { ...entry, rotateBy } : entry
  ));
}

/**
 * Move the selected pages (kept in their relative order) so they start at
 * `targetIndex`, an insertion position in the ORIGINAL numbering (0 … pageCount).
 */
export function planMove(pageCount: number, indices: Iterable<number>, targetIndex: number): PagePlan {
  const moving = sortedUnique(indices).filter((i) => i >= 0 && i < pageCount);
  const movingSet = new Set(moving);
  const target = Math.max(0, Math.min(pageCount, targetIndex));
  const before = identityPlan(target).filter((e) => !movingSet.has(e.from));
  const after = identityPlan(pageCount).slice(target).filter((e) => !movingSet.has(e.from));
  return [...before, ...moving.map((from) => ({ kind: 'existing' as const, from })), ...after];
}

export function planInsertExternal(pageCount: number, afterIndex: number, externalPageCount: number): PagePlan {
  const plan: PagePlan = identityPlan(pageCount);
  const at = Math.max(0, Math.min(pageCount, afterIndex + 1));
  plan.splice(at, 0, ...Array.from({ length: externalPageCount }, (_, sourceIndex) => ({ kind: 'external' as const, sourceIndex })));
  return plan;
}

export function planExtract(indices: Iterable<number>): PagePlan {
  return sortedUnique(indices).map((from) => ({ kind: 'existing' as const, from }));
}

export function isIdentityPlan(plan: PagePlan, pageCount: number): boolean {
  return plan.length === pageCount
    && plan.every((e, i) => e.kind === 'existing' && e.from === i && !e.rotateBy);
}
