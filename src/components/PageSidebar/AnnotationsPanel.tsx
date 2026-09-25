/** Sidebar list of every annotation in the active document. */
import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import type { Annotation } from '../../types/annotations';
import { useAnnotationStore } from '../../store/annotationStore';
import {
  ANNOTATION_FILTERS,
  deleteAnnotation,
  describeAnnotation,
  matchesFilter,
  patchAnnotation,
  revealAnnotation,
  type AnnotationFilter,
} from '../../commands/annotationListCommands';
import styles from './PageSidebar.module.css';

export function AnnotationsPanel({ docId }: { docId: string }) {
  const docState = useAnnotationStore((state) => state.docAnnotations.get(docId));
  const [filter, setFilter] = useState<AnnotationFilter>('all');

  const pages = useMemo(() => {
    const result: { pageIndex: number; annotations: Annotation[] }[] = [];
    for (const page of docState?.pages.values() ?? []) {
      const visible = page.annotations.filter((a) => matchesFilter(a, filter));
      if (visible.length > 0) result.push({ pageIndex: page.pageIndex, annotations: visible });
    }
    return result.sort((a, b) => a.pageIndex - b.pageIndex);
  }, [docState, filter]);

  const total = pages.reduce((sum, page) => sum + page.annotations.length, 0);

  return (
    <div className={styles.annotationsPanel}>
      <div className={styles.filterRow} role="radiogroup" aria-label="Filter annotations">
        {ANNOTATION_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={filter === option.id}
            className={`${styles.filterChip} ${filter === option.id ? styles.filterChipActive : ''}`}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className={styles.annotationList}>
        {total === 0 && <div className={styles.emptyPanel}><span>No annotations</span></div>}
        {pages.map((page) => (
          <section key={page.pageIndex}>
            <h4 className={styles.annotationPageHeading}>Page {page.pageIndex + 1}</h4>
            {page.annotations.map((annotation) => (
              <AnnotationRow key={annotation.id} docId={docId} annotation={annotation} />
            ))}
          </section>
        ))}
      </div>
      <p className={styles.annotationHint}>Hidden annotations are not included when saving or exporting.</p>
    </div>
  );
}

function AnnotationRow({ docId, annotation }: { docId: string; annotation: Annotation }) {
  const swatch = annotation.type === 'image' ? 'transparent' : annotation.color;
  return (
    <div
      className={`${styles.annotationRow} ${annotation.hidden ? styles.annotationRowHidden : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => revealAnnotation(docId, annotation)}
      onKeyDown={(event) => event.key === 'Enter' && revealAnnotation(docId, annotation)}
      title="Show on page"
    >
      <span className={styles.annotationSwatch} style={{ background: swatch }} aria-hidden="true" />
      <span className={styles.annotationLabel}>{describeAnnotation(annotation)}</span>
      <RowButton
        label={annotation.hidden ? 'Show' : 'Hide'}
        onClick={() => patchAnnotation(docId, annotation, { hidden: !annotation.hidden })}
      >
        {annotation.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </RowButton>
      <RowButton
        label={annotation.locked ? 'Unlock' : 'Lock'}
        onClick={() => patchAnnotation(docId, annotation, { locked: !annotation.locked })}
      >
        {annotation.locked ? <Lock size={13} /> : <LockOpen size={13} />}
      </RowButton>
      <RowButton label="Delete" onClick={() => deleteAnnotation(docId, annotation)}>
        <Trash2 size={13} />
      </RowButton>
    </div>
  );
}

function RowButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={styles.rowButton}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
