/**
 * Page management commands: insert blank, duplicate, delete, rotate, reorder,
 * insert pages from another PDF, export selected pages.
 *
 * Each command builds a PagePlan (src/document/pagePlan.ts), rewrites the PDF
 * bytes off the main path, then commits synchronously after re-validating
 * that the document did not change meanwhile — one MUTATE_DOCUMENT_BYTES
 * history entry, so Undo/Redo restore pages AND annotations exactly.
 */
import { useFormStore } from '../store/formStore';
import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore, makeMutateDocumentBytesAction } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { useAssetStore } from '../store/assetStore';
import { usePageSelectionStore } from '../store/pageSelectionStore';
import type { Annotation, DocumentAnnotationState, DocumentState } from '../types/annotations';
import type { DocumentIdentity } from '../types/documentSession';
import {
  buildPdfFromPlan,
  isIdentityPlan,
  planDelete,
  planDuplicate,
  planExtract,
  planInsertBlank,
  planInsertExternal,
  planMove,
  planRotate,
  remapAnnotationsForPlan,
  remapViewRotationsForPlan,
  remapBookmarksForPlan,
  type PagePlan,
} from '../document/pagePlan';
import { exportAnnotatedPdf, loadDefaultExportFonts } from '../pdf/annotationExporter';
import { errorMessage, notifyUser } from '../utils/notify';
import type { PageBackground } from '../document/newDocumentGenerator';

let busy = false;

function activeDocument(): DocumentState | null {
  const store = useDocumentStore.getState();
  return store.activeDocId ? store.documents.get(store.activeDocId) ?? null : null;
}

function identityOf(doc: DocumentState): DocumentIdentity {
  return { docId: doc.id, instanceId: doc.instanceId };
}

/** Sidebar-selected pages of the active document, or its active page. */
export function targetPages(doc: DocumentState | null = activeDocument()): number[] {
  if (!doc) return [];
  const selected = usePageSelectionStore.getState().getPages(identityOf(doc)).filter((i) => i < doc.pageCount);
  return selected.length > 0 ? selected : [doc.activePageIndex];
}

function allAnnotations(docId: string): Annotation[] {
  const state = useAnnotationStore.getState().docAnnotations.get(docId);
  return state ? [...state.pages.values()].flatMap((p) => p.annotations) : [];
}

function groupByPage(annotations: readonly Annotation[]): DocumentAnnotationState {
  const pages = new Map<number, { pageIndex: number; annotations: Annotation[] }>();
  for (const ann of annotations) {
    const page = pages.get(ann.pageIndex) ?? { pageIndex: ann.pageIndex, annotations: [] };
    page.annotations.push(ann);
    pages.set(ann.pageIndex, page);
  }
  return { pages };
}

export interface ApplyPlanOptions {
  externalBytes?: Uint8Array;
  /** Page to show afterwards (new numbering). */
  activePageAfter?: number;
  /** Pages to leave selected in the sidebar afterwards (new numbering). */
  selectAfter?: number[];
}

/** Rewrite the active document according to `plan`. Resolves true if committed. */
export async function applyPagePlan(
  doc: DocumentState,
  plan: PagePlan,
  options: ApplyPlanOptions = {},
): Promise<boolean> {
  if (isIdentityPlan(plan, doc.pageCount)) return false;
  if (busy) {
    notifyUser('info', 'Another page operation is still running.');
    return false;
  }
  busy = true;
  try {
    const baseBytes = doc.sourceData;
    const newBytes = await buildPdfFromPlan(baseBytes, plan, options.externalBytes);

    // ── Synchronous commit: re-read everything after the last await ──
    const current = useDocumentStore.getState().documents.get(doc.id);
    if (!current || current.instanceId !== doc.instanceId) return false;
    if (current.sourceData !== baseBytes) {
      notifyUser('error', 'The document changed while pages were being updated. Please try again.');
      return false;
    }

    const beforeAnnotations = allAnnotations(doc.id);
    const afterAnnotations = remapAnnotationsForPlan(beforeAnnotations, plan);
    const afterRotations = remapViewRotationsForPlan(current.pageRotations, plan);
    const beforeBookmarks = current.bookmarks ?? [];
    const afterBookmarks = remapBookmarksForPlan(beforeBookmarks, plan);
    const afterPageCount = plan.length;
    const activePage = Math.max(0, Math.min(afterPageCount - 1, options.activePageAfter ?? current.activePageIndex));

    useDocumentStore.getState().updateDocument(doc.id, {
      sourceData: newBytes,
      sourceRevision: current.sourceRevision + 1,
      pageCount: afterPageCount,
      pageRotations: afterRotations,
      activePageIndex: activePage,
      bookmarks: afterBookmarks,
    });
    useAnnotationStore.setState((state) => {
      const docs = new Map(state.docAnnotations);
      docs.set(doc.id, groupByPage(afterAnnotations));
      return { docAnnotations: docs };
    });
    useHistoryStore.getState().push({
      ...makeMutateDocumentBytesAction(
        doc.id,
        baseBytes,
        newBytes,
        beforeAnnotations,
        afterAnnotations,
        current.pageRotations,
        afterRotations,
        current.pageCount,
        afterPageCount,
      ),
      beforeBookmarks,
      afterBookmarks,
    });

    const identity = identityOf(current);
    useSelectionStore.getState().clearSelection(identity);
    usePageSelectionStore.getState().setPages(identity, options.selectAfter ?? []);
    return true;
  } catch (error) {
    console.error('Page operation failed:', error);
    notifyUser('error', `Page operation failed: ${errorMessage(error)}`);
    return false;
  } finally {
    busy = false;
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

export async function insertBlankPage(): Promise<boolean> {
  const doc = activeDocument();
  if (!doc) return false;
  const after = Math.max(...targetPages(doc));
  return applyPagePlan(doc, planInsertBlank(doc.pageCount, after), { activePageAfter: after + 1, selectAfter: [after + 1] });
}

/** Insert a lined / grid / dotted note page after the current page. */
export async function insertNotePage(style: { background: PageBackground; size: 'like' | 'a4' }): Promise<boolean> {
  const doc = activeDocument();
  if (!doc) return false;
  const after = Math.max(...targetPages(doc));
  return applyPagePlan(doc, planInsertBlank(doc.pageCount, after, style), { activePageAfter: after + 1, selectAfter: [after + 1] });
}

export async function duplicatePages(): Promise<boolean> {
  const doc = activeDocument();
  if (!doc) return false;
  const pages = targetPages(doc);
  const plan = planDuplicate(doc.pageCount, pages);
  // New numbering of each copy: original index + number of copies before it + 1.
  const copies = pages.map((p, i) => p + i + 1);
  return applyPagePlan(doc, plan, { activePageAfter: copies[0], selectAfter: copies });
}

export async function deletePages(): Promise<boolean> {
  const doc = activeDocument();
  if (!doc) return false;
  const pages = targetPages(doc);
  if (pages.length >= doc.pageCount) {
    notifyUser('error', 'A document must keep at least one page.');
    return false;
  }
  return applyPagePlan(doc, planDelete(doc.pageCount, pages), { activePageAfter: Math.min(...pages) });
}

export async function rotatePages(rotateBy: 90 | -90): Promise<boolean> {
  const doc = activeDocument();
  if (!doc) return false;
  const pages = targetPages(doc);
  return applyPagePlan(doc, planRotate(doc.pageCount, pages, rotateBy), { selectAfter: pages });
}

/** Move pages so they start at insertion position `targetIndex` (original numbering). */
export async function movePages(pages: number[], targetIndex: number): Promise<boolean> {
  const doc = activeDocument();
  if (!doc || pages.length === 0) return false;
  const plan = planMove(doc.pageCount, pages, targetIndex);
  const moved = new Set(pages);
  const newPositions = plan.flatMap((e, i) => (e.kind === 'existing' && moved.has(e.from) ? [i] : []));
  return applyPagePlan(doc, plan, { activePageAfter: newPositions[0], selectAfter: newPositions });
}

export async function insertPagesFromPdf(): Promise<boolean> {
  const doc = activeDocument();
  if (!doc || !window.electronAPI?.openFile) return false;
  const files = await window.electronAPI.openFile();
  const file = files?.[0];
  if (!file?.data) return false;
  const latest = useDocumentStore.getState().documents.get(doc.id);
  if (!latest || latest.instanceId !== doc.instanceId) return false;

  const bytes = new Uint8Array(file.data);
  let count = 0;
  try {
    const { PDFDocument } = await import('pdf-lib');
    count = (await PDFDocument.load(bytes)).getPageCount();
  } catch (error) {
    notifyUser('error', `Could not read ${file.name}: ${errorMessage(error)}`);
    return false;
  }
  const after = Math.max(...targetPages(latest));
  const inserted = Array.from({ length: count }, (_, i) => after + 1 + i);
  return applyPagePlan(latest, planInsertExternal(latest.pageCount, after, count), {
    externalBytes: bytes,
    activePageAfter: after + 1,
    selectAfter: inserted,
  });
}

/** A new PDF with `pages` of `doc` (0-based), annotations flattened in. */
export async function buildPagesPdf(doc: DocumentState, pages: readonly number[]): Promise<Uint8Array> {
  const plan = planExtract([...pages]);
  const subsetBytes = await buildPdfFromPlan(doc.sourceData, plan);
  const subsetAnnotations = remapAnnotationsForPlan(allAnnotations(doc.id), plan);
  const annotationMap = new Map<number, Annotation[]>();
  for (const ann of subsetAnnotations) {
    annotationMap.set(ann.pageIndex, [...(annotationMap.get(ann.pageIndex) ?? []), ann]);
  }
  const fonts = subsetAnnotations.some((a) => a.type === 'text') ? await loadDefaultExportFonts() : undefined;
  const assets = useAssetStore.getState().getAssetsForDocument(identityOf(doc));
  return (await exportAnnotatedPdf(subsetBytes, annotationMap, { assets, fonts, formValues: useFormStore.getState().getValues(doc.id) })).data;
}

/** Save the selected pages (with their annotations flattened) as a new PDF. */
export async function exportSelectedPages(): Promise<boolean> {
  const doc = activeDocument();
  if (!doc || !window.electronAPI?.saveFile) return false;
  const pages = targetPages(doc);
  try {
    const result = { data: await buildPagesPdf(doc, pages) };

    const base = doc.title.replace(/\.pdf$/i, '');
    const label = pages.length === 1 ? `page ${pages[0] + 1}` : `${pages.length} pages`;
    const path = await window.electronAPI.saveFile(`${base} (${label}).pdf`);
    if (!path) return false;
    await window.electronAPI.writeFile(path, result.data.buffer as ArrayBuffer);
    notifyUser('success', `Exported ${label}.`);
    return true;
  } catch (error) {
    notifyUser('error', `Export failed: ${errorMessage(error)}`);
    return false;
  }
}
