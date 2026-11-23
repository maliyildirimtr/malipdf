/**
 * Annotation clipboard: Copy / Cut / Paste / Duplicate.
 *
 * Annotations (and the image assets they reference) are kept in an in-app
 * clipboard. The system clipboard only receives a marker string, so:
 *  - pasting inside MaliPDF restores the exact annotations, even across
 *    documents (image assets are carried along);
 *  - copying something else anywhere (text, an image) replaces the marker, and
 *    the next ⌘V pastes that instead.
 *
 * Paste goes to the active page of the active document; pasting back onto the
 * page it was copied from offsets each paste so copies do not stack exactly.
 */
import type { Annotation } from '../types/annotations';
import type { DocumentIdentity } from '../types/documentSession';
import type { ImageAsset } from '../store/assetStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useAssetStore } from '../store/assetStore';
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore, makeBatchAction, makeRemoveAction, type HistoryActionDraft } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { documentSessionStore } from '../store/documentSessionStore';
import { translateAnnotation } from '../pdf/annotationTransform';
import { getGroupBounds } from '../pdf/annotationGeometry';
import { nanoid } from '../utils/nanoid';

/** Offset (PDF points) applied per repeated paste / duplicate on the same page. */
export const PASTE_OFFSET = 12;
const MARKER_PREFIX = 'MaliPDF-annotations:';

interface ClipboardContents {
  token: string;
  annotations: Annotation[];
  assets: Map<string, ImageAsset>;
  source: { docId: string; pageIndex: number };
  pasteCount: number;
}

let clipboard: ClipboardContents | null = null;

export interface SelectionContext {
  identity: DocumentIdentity;
  pageIndex: number;
  annotations: Annotation[];
}

/** The selected annotations of the active document, in z-order. */
export function getActiveSelection(): SelectionContext | null {
  const identity = documentSessionStore.getState().activeIdentity;
  if (!identity) return null;
  const selection = useSelectionStore.getState().getSelection(identity);
  if (!selection || selection.pageIndex === null || selection.selectedIds.length === 0) return null;
  const selected = new Set(selection.selectedIds);
  const annotations = useAnnotationStore.getState()
    .getPageAnnotations(identity.docId, selection.pageIndex)
    .filter((a) => selected.has(a.id));
  if (annotations.length === 0) return null;
  return { identity, pageIndex: selection.pageIndex, annotations };
}

export function hasClipboardAnnotations(): boolean {
  return clipboard !== null;
}

/** Marker string written to the system clipboard for the current copy. */
export function clipboardMarker(): string | null {
  return clipboard ? `${MARKER_PREFIX}${clipboard.token}` : null;
}

export function isOwnClipboardMarker(text: string | null | undefined): boolean {
  return !!text && !!clipboard && text === `${MARKER_PREFIX}${clipboard.token}`;
}

/** Copy the selection into the in-app clipboard. Returns the marker, or null. */
export function copySelection(): string | null {
  const context = getActiveSelection();
  if (!context) return null;
  const assetStore = useAssetStore.getState();
  const assets = new Map<string, ImageAsset>();
  for (const ann of context.annotations) {
    if (ann.type === 'image') {
      const asset = assetStore.getAsset(context.identity, ann.assetId);
      if (asset) assets.set(asset.id, asset);
    }
  }
  clipboard = {
    token: nanoid(),
    annotations: context.annotations.map((a) => structuredClone(a)),
    assets,
    source: { docId: context.identity.docId, pageIndex: context.pageIndex },
    pasteCount: 0,
  };
  return clipboardMarker();
}

/** Copy, then delete the selection as one undo step. */
export function cutSelection(): string | null {
  const context = getActiveSelection();
  const marker = copySelection();
  if (!context || !marker) return null;
  // A cut then paste on the same page should land exactly where it was.
  if (clipboard) clipboard.pasteCount = -1;
  removeAnnotations(context);
  return marker;
}

function removeAnnotations(context: SelectionContext): void {
  const { identity, pageIndex } = context;
  const annotationStore = useAnnotationStore.getState();
  const current = annotationStore.getPageAnnotations(identity.docId, pageIndex);
  const doomed = new Set(context.annotations.map((a) => a.id));
  const remaining: Annotation[] = [];
  const actions: HistoryActionDraft[] = [];
  for (const ann of current) {
    if (doomed.has(ann.id)) actions.push(makeRemoveAction(identity.docId, ann, remaining.length));
    else remaining.push(ann);
  }
  if (actions.length === 0) return;
  annotationStore.setPageAnnotations(identity.docId, pageIndex, remaining);
  useHistoryStore.getState().push(actions.length === 1 ? actions[0] : makeBatchAction(identity.docId, actions));
  useSelectionStore.getState().clearSelection(identity);
}

/**
 * Insert copies of `annotations` on `pageIndex` of the active document, as one
 * undo step, and select them. Returns the new annotations.
 */
function insertCopies(
  annotations: readonly Annotation[],
  assets: ReadonlyMap<string, ImageAsset>,
  pageIndex: number,
  offset: number,
): Annotation[] {
  const docStore = useDocumentStore.getState();
  const docId = docStore.activeDocId;
  const doc = docId ? docStore.documents.get(docId) : undefined;
  if (!doc || pageIndex < 0 || pageIndex >= doc.pageCount) return [];
  const identity: DocumentIdentity = { docId: doc.id, instanceId: doc.instanceId };

  const assetStore = useAssetStore.getState();
  for (const [assetId, asset] of assets) {
    if (!assetStore.getAsset(identity, assetId)) assetStore.addAsset(identity, asset);
  }

  const now = Date.now();
  const annotationStore = useAnnotationStore.getState();
  const startIndex = annotationStore.getPageAnnotations(doc.id, pageIndex).length;
  const copies = annotations.map((source) => {
    // PDF user space: +x is right, +y is up → offset right and down.
    const moved = translateAnnotation(structuredClone(source), offset, -offset);
    return { ...moved, id: nanoid(), pageIndex, createdAt: now, updatedAt: now } as Annotation;
  });

  const actions: HistoryActionDraft[] = copies.map((ann, i) => ({
    type: 'ADD_ANNOTATION',
    docId: doc.id,
    pageIndex,
    annotationId: ann.id,
    index: startIndex + i,
    before: null,
    after: ann,
  }));
  for (const ann of copies) annotationStore.addAnnotation(doc.id, ann);
  useHistoryStore.getState().push(actions.length === 1 ? actions[0] : makeBatchAction(doc.id, actions));
  useSelectionStore.getState().setSelection(identity, pageIndex, copies.map((a) => a.id));
  return copies;
}

/** Paste the in-app clipboard onto the active page. Returns the pasted annotations. */
export function pasteAnnotations(): Annotation[] {
  if (!clipboard) return [];
  const docStore = useDocumentStore.getState();
  const doc = docStore.activeDocId ? docStore.documents.get(docStore.activeDocId) : undefined;
  if (!doc) return [];

  const targetPage = doc.activePageIndex;
  const samePlace = clipboard.source.docId === doc.id && clipboard.source.pageIndex === targetPage;
  const offset = samePlace ? (clipboard.pasteCount + 1) * PASTE_OFFSET : 0;
  const pasted = insertCopies(clipboard.annotations, clipboard.assets, targetPage, offset);
  if (pasted.length > 0 && samePlace) clipboard.pasteCount += 1;
  return pasted;
}

/** Duplicate the selection in place (slightly offset). Leaves the clipboard alone. */
export function duplicateSelection(): Annotation[] {
  const context = getActiveSelection();
  if (!context) return [];
  const assets = new Map<string, ImageAsset>();
  const assetStore = useAssetStore.getState();
  for (const ann of context.annotations) {
    if (ann.type === 'image') {
      const asset = assetStore.getAsset(context.identity, ann.assetId);
      if (asset) assets.set(asset.id, asset);
    }
  }
  // Duplicate onto the selection's own page, even if another page is active.
  const docStore = useDocumentStore.getState();
  if (docStore.activeDocId !== context.identity.docId) return [];
  return insertCopiesOnPage(context, assets);
}

function insertCopiesOnPage(context: SelectionContext, assets: Map<string, ImageAsset>): Annotation[] {
  return insertCopies(context.annotations, assets, context.pageIndex, PASTE_OFFSET);
}

/** Delete the active selection in one undoable step. */
export function deleteSelection(): boolean {
  const context = getActiveSelection();
  if (!context) return false;
  removeAnnotations(context);
  return true;
}

/** Recolor all colorable annotations in the active selection as one undoable step. */
export function recolorSelection(color: string): boolean {
  const context = getActiveSelection();
  if (!context) return false;
  const { identity, pageIndex, annotations } = context;
  const annotationStore = useAnnotationStore.getState();
  const actions: HistoryActionDraft[] = [];
  const now = Date.now();
  for (const ann of annotations) {
    if (!('color' in ann)) continue;
    const before = structuredClone(ann);
    const after = { ...structuredClone(ann), color, updatedAt: now } as Annotation;
    annotationStore.replaceAnnotation(identity.docId, pageIndex, after);
    actions.push({
      type: 'UPDATE_ANNOTATION',
      docId: identity.docId,
      pageIndex,
      annotationId: ann.id,
      before,
      after,
    });
  }
  if (actions.length === 0) return false;
  useHistoryStore.getState().push(actions.length === 1 ? actions[0] : makeBatchAction(identity.docId, actions));
  return true;
}

/**
 * Move the active selection from its current page to `targetPageIndex` as one
 * atomic undoable step. Works for photos (images), strokes, shapes, text boxes,
 * and lasso groups alike.
 *
 * If `targetCenterPdf` is given (e.g. from dragging across pages), the group is
 * centered on that PDF point on the target page; otherwise coordinates are kept.
 */
export function moveSelectionToPage(
  targetPageIndex: number,
  targetCenterPdf?: { x: number; y: number },
): Annotation[] {
  const context = getActiveSelection();
  if (!context) return [];
  const { identity, pageIndex: sourcePageIndex, annotations } = context;
  if (sourcePageIndex === targetPageIndex) return [];

  const docStore = useDocumentStore.getState();
  const doc = docStore.documents.get(identity.docId);
  if (!doc || targetPageIndex < 0 || targetPageIndex >= doc.pageCount) return [];

  let dx = 0;
  let dy = 0;
  if (targetCenterPdf) {
    const bounds = getGroupBounds(annotations);
    if (bounds) {
      dx = targetCenterPdf.x - (bounds.x + bounds.width / 2);
      dy = targetCenterPdf.y - (bounds.y + bounds.height / 2);
    }
  }

  const annotationStore = useAnnotationStore.getState();
  const sourceList = annotationStore.getPageAnnotations(identity.docId, sourcePageIndex);
  const doomed = new Set(annotations.map((a) => a.id));
  const remainingSource: Annotation[] = [];
  const actions: HistoryActionDraft[] = [];
  for (const ann of sourceList) {
    if (doomed.has(ann.id)) {
      actions.push(makeRemoveAction(identity.docId, ann, remainingSource.length));
    } else {
      remainingSource.push(ann);
    }
  }

  const now = Date.now();
  const targetStartIdx = annotationStore.getPageAnnotations(identity.docId, targetPageIndex).length;
  const moved: Annotation[] = annotations.map((ann) => {
    const shifted = dx !== 0 || dy !== 0 ? translateAnnotation(structuredClone(ann), dx, dy) : structuredClone(ann);
    return { ...shifted, pageIndex: targetPageIndex, updatedAt: now } as Annotation;
  });

  annotationStore.setPageAnnotations(identity.docId, sourcePageIndex, remainingSource);
  moved.forEach((ann, i) => {
    annotationStore.addAnnotation(identity.docId, ann);
    actions.push({
      type: 'ADD_ANNOTATION',
      docId: identity.docId,
      pageIndex: targetPageIndex,
      annotationId: ann.id,
      index: targetStartIdx + i,
      before: null,
      after: ann,
    });
  });

  useHistoryStore.getState().push(makeBatchAction(identity.docId, actions));
  useSelectionStore.getState().setSelection(identity, targetPageIndex, moved.map((a) => a.id));
  docStore.setActivePage(identity.docId, targetPageIndex);
  return moved;
}

/** Test helper. */
export function resetAnnotationClipboard(): void {
  clipboard = null;
}
