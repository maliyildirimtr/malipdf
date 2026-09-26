/** Choose tags for annotations: built-in tags, tags already in use, or a new one. */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Tag } from 'lucide-react';
import type { Annotation } from '../../types/annotations';
import { BUILT_IN_TAGS, normalizeTag, tagInfo, toggleTag, usedTags } from '../../commands/tagCommands';
import { useAnnotationStore } from '../../store/annotationStore';
import { useDocumentStore } from '../../store/documentStore';
import { useSelectionStore } from '../../store/selectionStore';
import styles from './Tags.module.css';

export function TagPill({ id, small = false }: { id: string; small?: boolean }) {
  const info = tagInfo(id);
  return (
    <span className={`${styles.pill} ${small ? styles.pillSmall : ''}`} style={{ ['--tag' as string]: info.color }}>
      {info.label}
    </span>
  );
}

export function TagPicker({ docId, annotations }: { docId: string; annotations: Annotation[] }) {
  const all = useAnnotationStore((s) => s.docAnnotations.get(docId));
  const [draft, setDraft] = useState('');
  const everything = all ? [...all.pages.values()].flatMap((p) => p.annotations) : [];
  const ids = [...new Set([...BUILT_IN_TAGS.map((t) => t.id), ...usedTags(everything)])];
  const has = (id: string) => annotations.length > 0 && annotations.every((a) => a.tags?.includes(id));

  const add = () => {
    const id = normalizeTag(draft);
    if (!id) return;
    toggleTag(docId, annotations.filter((a) => !a.tags?.includes(id)), id);
    setDraft('');
  };

  return (
    <div className={styles.picker} role="group" aria-label="Tags" onKeyDown={(e) => e.stopPropagation()}>
      {ids.map((id) => {
        const on = has(id);
        const info = tagInfo(id);
        return (
          <button key={id} type="button" className={`${styles.option} ${on ? styles.optionOn : ''}`} aria-pressed={on}
            style={{ ['--tag' as string]: info.color }} onClick={() => toggleTag(docId, annotations, id)}>
            <span className={styles.dot} />{info.label}{on && <Check size={12} />}
          </button>
        );
      })}
      <form className={styles.newTag} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={draft} placeholder="New tag…" aria-label="New tag" maxLength={24} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" aria-label="Add tag" disabled={!draft.trim()}><Plus size={13} /></button>
      </form>
    </div>
  );
}

/** "Tags" button for the current selection (Select / Lasso tools). */
export function SelectionTagButton() {
  const docId = useDocumentStore((s) => s.activeDocId);
  const doc = useDocumentStore((s) => (s.activeDocId ? s.documents.get(s.activeDocId) : undefined));
  const selection = useSelectionStore((s) => (doc ? s.getSelection({ docId: doc.id, instanceId: doc.instanceId }) : null));
  const pageAnnotations = useAnnotationStore((s) => (docId && selection?.pageIndex != null ? s.docAnnotations.get(docId)?.pages.get(selection.pageIndex)?.annotations : undefined));
  const selected = (pageAnnotations ?? []).filter((a) => selection?.selectedIds.includes(a.id));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !popRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!docId) return null;
  return (
    <div className={styles.anchor} ref={ref}>
      <button type="button" className={styles.shelfButton} disabled={selected.length === 0} aria-expanded={open}
        onClick={() => setOpen((v) => !v)} title="Tag the selected annotations">
        <Tag size={14} aria-hidden="true" /> Tags
      </button>
      {open && selected.length > 0 && (() => {
        // In a portal: the tool shelf clips anything that sticks out of it.
        const r = ref.current?.getBoundingClientRect();
        return createPortal(
          <div ref={popRef} data-keeps-selection className={styles.popover} style={{ position: 'fixed', top: (r?.bottom ?? 0) + 6, left: Math.min(r?.left ?? 0, window.innerWidth - 220) }}>
            <TagPicker docId={docId} annotations={selected} />
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
