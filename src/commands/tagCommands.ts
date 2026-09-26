/** Tags on annotations ("Important", "Exam"…) and filtering by them. */
import type { Annotation } from '../types/annotations';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore, makeBatchAction, makeUpdateAction, type HistoryActionDraft } from '../store/historyStore';

export interface TagInfo { id: string; label: string; color: string }

export const BUILT_IN_TAGS: TagInfo[] = [
  { id: 'important', label: 'Important', color: '#e5484d' },
  { id: 'exam', label: 'Exam', color: '#f76b15' },
  { id: 'question', label: 'Question', color: '#0090ff' },
  { id: 'review', label: 'Review', color: '#8e4ec6' },
  { id: 'done', label: 'Done', color: '#30a46c' },
];

const PALETTE = ['#12a594', '#d6409f', '#ab6400', '#3e63dd', '#6e56cf', '#e54666'];

/** Label and colour for any tag, also user-made ones. */
export function tagInfo(id: string): TagInfo {
  const known = BUILT_IN_TAGS.find((t) => t.id === id);
  if (known) return known;
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { id, label: id, color: PALETTE[hash % PALETTE.length] };
}

/** A clean tag from what the user typed (lower case, trimmed, max 24 chars). */
export function normalizeTag(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 24).toLocaleLowerCase('tr');
}

/** Every tag used in a list of annotations, built-in tags first. */
export function usedTags(annotations: readonly Annotation[]): string[] {
  const used = new Set(annotations.flatMap((a) => a.tags ?? []));
  const builtIn = BUILT_IN_TAGS.map((t) => t.id).filter((id) => used.has(id));
  const custom = [...used].filter((id) => !BUILT_IN_TAGS.some((t) => t.id === id)).sort();
  return [...builtIn, ...custom];
}

/**
 * Add `tag` to all of `annotations`, or remove it when every one already has
 * it. One undo step.
 */
export function toggleTag(docId: string, annotations: readonly Annotation[], tag: string): void {
  const id = normalizeTag(tag);
  if (!id || annotations.length === 0) return;
  const remove = annotations.every((a) => a.tags?.includes(id));
  const store = useAnnotationStore.getState();
  const actions: HistoryActionDraft[] = [];
  for (const annotation of annotations) {
    const current = annotation.tags ?? [];
    const tags = remove ? current.filter((t) => t !== id) : current.includes(id) ? current : [...current, id];
    const after = { ...annotation, tags: tags.length ? tags : undefined, updatedAt: Date.now() } as Annotation;
    store.replaceAnnotation(docId, annotation.pageIndex, after);
    actions.push(makeUpdateAction(docId, annotation, after));
  }
  useHistoryStore.getState().push(actions.length === 1 ? actions[0] : makeBatchAction(docId, actions));
}
