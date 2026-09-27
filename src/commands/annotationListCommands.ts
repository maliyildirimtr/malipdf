/** Actions behind the Annotations panel: reveal, hide/show, lock/unlock, delete. */
import type { Annotation } from '../types/annotations';
import { measureLabel } from '../pdf/measure';
import { useAnnotationStore } from '../store/annotationStore';
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore, makeBatchAction, makeRemoveAction, makeUpdateAction, type HistoryActionDraft } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { useUIStore } from '../store/uiStore';

export type AnnotationFilter = 'all' | 'pen' | 'highlight' | 'text' | 'shape' | 'image';

export const ANNOTATION_FILTERS: { id: AnnotationFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pen', label: 'Pen' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'text', label: 'Text' },
  { id: 'shape', label: 'Shape' },
  { id: 'image', label: 'Image' },
];

export function matchesFilter(annotation: Annotation, filter: AnnotationFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'pen': return annotation.type === 'stroke';
    case 'highlight': return annotation.type === 'highlight' || annotation.type === 'markup';
    case 'text': return annotation.type === 'text' || annotation.type === 'note' || annotation.type === 'textEdit';
    case 'shape': return annotation.type === 'shape' || annotation.type === 'freeform' || annotation.type === 'measure';
    case 'image': return annotation.type === 'image';
  }
}

export function describeAnnotation(annotation: Annotation): string {
  switch (annotation.type) {
    case 'stroke': return 'Pen';
    case 'highlight': return 'Highlight';
    case 'text': {
      const text = annotation.content.replace(/\s+/g, ' ').trim();
      return text.length > 28 ? `${text.slice(0, 28)}…` : text || 'Text';
    }
    case 'shape': return ({ line: 'Line', arrow: 'Arrow', rectangle: 'Rectangle', roundedRect: 'Rounded rectangle', ellipse: 'Ellipse' })[annotation.shapeKind];
    case 'freeform': return 'Polygon';
    case 'image': return 'Image';
    case 'markup': {
      const kind = ({ highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikethrough' })[annotation.markup];
      const text = annotation.text.replace(/\s+/g, ' ').trim();
      return text ? `${kind}: ${text.length > 22 ? `${text.slice(0, 22)}…` : text}` : kind;
    }
    case 'textEdit': {
      const text = annotation.text.replace(/\s+/g, ' ').trim();
      return text ? `Edited text: ${text.length > 22 ? `${text.slice(0, 22)}…` : text}` : 'Deleted text';
    }
    case 'measure':
      return `${annotation.kind === 'area' ? 'Area' : 'Distance'}: ${measureLabel(annotation)}`;
    case 'note': {
      const text = annotation.content.replace(/\s+/g, ' ').trim();
      return text ? `Note: ${text.length > 24 ? `${text.slice(0, 24)}…` : text}` : 'Note';
    }
  }
}

/** Update one annotation as a single undoable step. */
export function patchAnnotation(docId: string, annotation: Annotation, patch: Partial<Pick<Annotation, 'hidden' | 'locked'>>): void {
  const after = { ...annotation, ...patch, updatedAt: Date.now() } as Annotation;
  useAnnotationStore.getState().replaceAnnotation(docId, annotation.pageIndex, after);
  useHistoryStore.getState().push(makeUpdateAction(docId, annotation, after));
  if (patch.hidden || patch.locked) {
    // A hidden or locked annotation cannot stay selected.
    const doc = useDocumentStore.getState().documents.get(docId);
    if (!doc) return;
    const identity = { docId, instanceId: doc.instanceId };
    const selection = useSelectionStore.getState().getSelection(identity);
    if (selection?.selectedIds.includes(annotation.id)) {
      const remaining = selection.selectedIds.filter((id) => id !== annotation.id);
      useSelectionStore.getState().setSelection(identity, selection.pageIndex ?? annotation.pageIndex, remaining);
    }
  }
}

export function deleteAnnotation(docId: string, annotation: Annotation): void {
  const store = useAnnotationStore.getState();
  const page = store.getPageAnnotations(docId, annotation.pageIndex);
  const index = page.findIndex((a) => a.id === annotation.id);
  if (index < 0) return;
  store.removeAnnotation(docId, annotation.pageIndex, annotation.id);
  useHistoryStore.getState().push(makeRemoveAction(docId, annotation, index));
}

/** Scroll to the annotation's page and select it (Select tool). */
export function revealAnnotation(docId: string, annotation: Annotation): void {
  const doc = useDocumentStore.getState().documents.get(docId);
  if (!doc) return;
  useDocumentStore.getState().setActivePage(docId, annotation.pageIndex);
  document.querySelector(
    `[data-doc-id="${docId}"][data-instance-id="${doc.instanceId}"][data-page-index="${annotation.pageIndex}"]`,
  )?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (annotation.hidden || annotation.locked) return;
  useUIStore.getState().setActiveTool('select');
  useSelectionStore.getState().setSelection({ docId, instanceId: doc.instanceId }, annotation.pageIndex, [annotation.id]);
}

// ─── Groups ────────────────────────────────────────────────────────────────────

export type AnnotationListItem =
  | { kind: 'single'; annotation: Annotation }
  | { kind: 'group'; key: string; annotations: Annotation[] };

/** Handwriting: each stroke is its own annotation, so a word is many rows. */
const GROUPABLE = new Set<Annotation['type']>(['stroke', 'highlight']);

function groupKey(annotation: Annotation): string | null {
  if (!GROUPABLE.has(annotation.type)) return null;
  const tags = [...(annotation.tags ?? [])].sort().join(',');
  return `${annotation.type}|${annotation.color.toLowerCase()}|${tags}`;
}

/**
 * Consecutive pen (or highlighter) strokes of the same colour and tags become
 * one group, e.g. "Pen × 8". Everything else stays a row of its own.
 */
export function groupAnnotations(annotations: readonly Annotation[]): AnnotationListItem[] {
  const items: AnnotationListItem[] = [];
  let run: Annotation[] = [];
  let runKey: string | null = null;
  const flush = () => {
    if (run.length >= 2) items.push({ kind: 'group', key: run[0].id, annotations: run });
    else for (const annotation of run) items.push({ kind: 'single', annotation });
    run = [];
    runKey = null;
  };
  for (const annotation of annotations) {
    const key = groupKey(annotation);
    if (key === null) {
      flush();
      items.push({ kind: 'single', annotation });
      continue;
    }
    if (key !== runKey) flush();
    run.push(annotation);
    runKey = key;
  }
  flush();
  return items;
}

/** Update several annotations as one undoable step. */
export function patchAnnotations(docId: string, annotations: readonly Annotation[], patch: Partial<Pick<Annotation, 'hidden' | 'locked'>>): void {
  if (annotations.length === 0) return;
  const store = useAnnotationStore.getState();
  const actions: HistoryActionDraft[] = [];
  for (const annotation of annotations) {
    const after = { ...annotation, ...patch, updatedAt: Date.now() } as Annotation;
    store.replaceAnnotation(docId, annotation.pageIndex, after);
    actions.push(makeUpdateAction(docId, annotation, after));
  }
  useHistoryStore.getState().push(actions.length === 1 ? actions[0] : makeBatchAction(docId, actions));
  if (patch.hidden || patch.locked) {
    const doc = useDocumentStore.getState().documents.get(docId);
    if (!doc) return;
    const identity = { docId, instanceId: doc.instanceId };
    const selection = useSelectionStore.getState().getSelection(identity);
    if (!selection) return;
    const gone = new Set(annotations.map((a) => a.id));
    const remaining = selection.selectedIds.filter((id) => !gone.has(id));
    if (remaining.length !== selection.selectedIds.length) {
      useSelectionStore.getState().setSelection(identity, selection.pageIndex ?? annotations[0].pageIndex, remaining);
    }
  }
}

/** Delete several annotations as one undoable step. */
export function deleteAnnotations(docId: string, annotations: readonly Annotation[]): void {
  const store = useAnnotationStore.getState();
  const byPage = new Map<number, Annotation[]>();
  for (const annotation of annotations) byPage.set(annotation.pageIndex, [...(byPage.get(annotation.pageIndex) ?? []), annotation]);
  const actions: HistoryActionDraft[] = [];
  for (const [pageIndex, list] of byPage) {
    const page = store.getPageAnnotations(docId, pageIndex);
    // Highest index first, so undo puts them back in their original order.
    const indexed = list
      .map((annotation) => ({ annotation, index: page.findIndex((a) => a.id === annotation.id) }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => b.index - a.index);
    for (const { annotation, index } of indexed) {
      store.removeAnnotation(docId, pageIndex, annotation.id);
      actions.push(makeRemoveAction(docId, annotation, index));
    }
  }
  if (actions.length === 0) return;
  useHistoryStore.getState().push(actions.length === 1 ? actions[0] : makeBatchAction(docId, actions));
}

/** Scroll to the group's page and select every stroke in it. */
export function revealAnnotations(docId: string, annotations: readonly Annotation[]): void {
  const first = annotations[0];
  if (!first) return;
  revealAnnotation(docId, { ...first, locked: true } as Annotation); // scroll only
  const selectable = annotations.filter((a) => !a.hidden && !a.locked && a.pageIndex === first.pageIndex);
  const doc = useDocumentStore.getState().documents.get(docId);
  if (!doc || selectable.length === 0) return;
  useUIStore.getState().setActiveTool('select');
  useSelectionStore.getState().setSelection({ docId, instanceId: doc.instanceId }, first.pageIndex, selectable.map((a) => a.id));
}
