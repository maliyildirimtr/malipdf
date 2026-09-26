/** Actions behind the Annotations panel: reveal, hide/show, lock/unlock, delete. */
import type { Annotation } from '../types/annotations';
import { measureLabel } from '../pdf/measure';
import { useAnnotationStore } from '../store/annotationStore';
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore, makeRemoveAction, makeUpdateAction } from '../store/historyStore';
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
