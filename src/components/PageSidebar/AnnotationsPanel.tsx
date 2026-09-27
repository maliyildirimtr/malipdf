/** Sidebar list of every annotation in the active document. */
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, LockOpen, Tag, Trash2 } from 'lucide-react';
import { TagPicker, TagPill } from '../Tags/TagPicker';
import { tagInfo, usedTags } from '../../commands/tagCommands';
import type { Annotation } from '../../types/annotations';
import { useAnnotationStore } from '../../store/annotationStore';
import {
  ANNOTATION_FILTERS,
  deleteAnnotation,
  deleteAnnotations,
  describeAnnotation,
  groupAnnotations,
  patchAnnotations,
  revealAnnotations,
  matchesFilter,
  patchAnnotation,
  revealAnnotation,
  type AnnotationFilter,
} from '../../commands/annotationListCommands';
import styles from './PageSidebar.module.css';

export function AnnotationsPanel({ docId }: { docId: string }) {
  const docState = useAnnotationStore((state) => state.docAnnotations.get(docId));
  const [filter, setFilter] = useState<AnnotationFilter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const tags = useMemo(() => usedTags([...(docState?.pages.values() ?? [])].flatMap((p) => p.annotations)), [docState]);
  const activeTag = tagFilter && tags.includes(tagFilter) ? tagFilter : null;

  const pages = useMemo(() => {
    const result: { pageIndex: number; annotations: Annotation[] }[] = [];
    for (const page of docState?.pages.values() ?? []) {
      const visible = page.annotations.filter((a) => matchesFilter(a, filter) && (!activeTag || a.tags?.includes(activeTag)));
      if (visible.length > 0) result.push({ pageIndex: page.pageIndex, annotations: visible });
    }
    return result.sort((a, b) => a.pageIndex - b.pageIndex);
  }, [docState, filter, activeTag]);

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
      {tags.length > 0 && (
        <div className={styles.filterRow} role="radiogroup" aria-label="Filter by tag">
          <button type="button" role="radio" aria-checked={!activeTag}
            className={`${styles.filterChip} ${!activeTag ? styles.filterChipActive : ''}`} onClick={() => setTagFilter(null)}>
            Any tag
          </button>
          {tags.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={activeTag === id}
              className={`${styles.filterChip} ${activeTag === id ? styles.filterChipActive : ''}`}
              style={activeTag === id ? { background: tagInfo(id).color, borderColor: tagInfo(id).color, color: '#ffffff' } : { color: tagInfo(id).color }}
              onClick={() => setTagFilter(activeTag === id ? null : id)}>
              {tagInfo(id).label}
            </button>
          ))}
        </div>
      )}
      <div className={styles.annotationList}>
        {total === 0 && <div className={styles.emptyPanel}><span>No annotations</span></div>}
        {pages.map((page) => (
          <section key={page.pageIndex}>
            <h4 className={styles.annotationPageHeading}>Page {page.pageIndex + 1}</h4>
            {groupAnnotations(page.annotations).map((item) => (
              item.kind === 'group'
                ? <GroupRow key={item.key} docId={docId} annotations={item.annotations} />
                : <AnnotationRow key={item.annotation.id} docId={docId} annotation={item.annotation} />
            ))}
          </section>
        ))}
      </div>
      <p className={styles.annotationHint}>Hidden annotations are not drawn into the PDF. Save keeps them for MaliPDF; Export PDF leaves them out.</p>
    </div>
  );
}

function AnnotationRow({ docId, annotation }: { docId: string; annotation: Annotation }) {
  const swatch = annotation.type === 'image' ? 'transparent' : annotation.color;
  const [tagging, setTagging] = useState(false);
  return (
    <>
    <div
      className={`${styles.annotationRow} ${annotation.hidden ? styles.annotationRowHidden : ''}`}
      style={annotation.tags?.length ? { flexWrap: 'wrap', justifyContent: 'flex-end' } : undefined}
      role="button"
      tabIndex={0}
      onClick={() => revealAnnotation(docId, annotation)}
      onKeyDown={(event) => event.key === 'Enter' && revealAnnotation(docId, annotation)}
      title="Show on page"
    >
      <span className={styles.annotationSwatch} style={{ background: swatch }} aria-hidden="true" />
      <span className={styles.annotationLabel} style={annotation.tags?.length ? { display: 'flex', flexDirection: 'column', whiteSpace: 'normal', flexBasis: 'calc(100% - 24px)' } : undefined}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-no-translate={annotation.type === 'text' && annotation.content.trim() ? true : undefined}>{describeAnnotation(annotation)}</span>
        {annotation.tags?.length ? (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
            {annotation.tags.map((t) => <TagPill key={t} id={t} small />)}
          </span>
        ) : null}
      </span>
      <RowButton label="Tags" onClick={() => setTagging((v) => !v)}>
        <Tag size={13} />
      </RowButton>
      <RowButton
        label={annotation.hidden ? 'Show' : 'Hide'}
        on={annotation.hidden === true}
        onClick={() => patchAnnotation(docId, annotation, { hidden: !annotation.hidden })}
      >
        {annotation.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </RowButton>
      <RowButton
        label={annotation.locked ? 'Unlock' : 'Lock'}
        on={annotation.locked === true}
        onClick={() => patchAnnotation(docId, annotation, { locked: !annotation.locked })}
      >
        {annotation.locked ? <Lock size={13} /> : <LockOpen size={13} />}
      </RowButton>
      <RowButton label="Delete" onClick={() => deleteAnnotation(docId, annotation)}>
        <Trash2 size={13} />
      </RowButton>
    </div>
    {tagging && (
      <div style={{ margin: '2px 6px 8px 22px', padding: 4, borderRadius: 8, border: '1px solid var(--color-border, #e0e0e4)', background: 'var(--color-bg-elevated, #fff)' }}>
        <TagPicker docId={docId} annotations={[annotation]} />
      </div>
    )}
    </>
  );
}

/** Several strokes in a row, same colour: one row that opens to show each. */
function GroupRow({ docId, annotations }: { docId: string; annotations: Annotation[] }) {
  const [open, setOpen] = useState(false);
  const [tagging, setTagging] = useState(false);
  const first = annotations[0];
  const allHidden = annotations.every((a) => a.hidden);
  const allLocked = annotations.every((a) => a.locked);
  const tags = first.tags ?? [];
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <div
        className={`${styles.annotationRow} ${allHidden ? styles.annotationRowHidden : ''}`}
        style={tags.length ? { flexWrap: 'wrap', justifyContent: 'flex-end' } : undefined}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => revealAnnotations(docId, annotations)}
        onKeyDown={(event) => event.key === 'Enter' && revealAnnotations(docId, annotations)}
        title="Show on page"
      >
        <button
          type="button"
          className={styles.groupToggle}
          aria-label={open ? 'Collapse' : 'Expand'}
          title={open ? 'Collapse' : 'Expand'}
          onClick={(event) => { event.stopPropagation(); setOpen((v) => !v); }}
        >
          <Chevron size={12} />
        </button>
        <span className={styles.annotationSwatch} style={{ background: first.color }} aria-hidden="true" />
        <span className={styles.annotationLabel} style={tags.length ? { display: 'flex', flexDirection: 'column', whiteSpace: 'normal', flexBasis: 'calc(100% - 40px)' } : undefined}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{`${describeAnnotation(first)} × ${annotations.length}`}</span>
          {tags.length ? (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
              {tags.map((t) => <TagPill key={t} id={t} small />)}
            </span>
          ) : null}
        </span>
        <RowButton label="Tags" onClick={() => setTagging((v) => !v)}>
          <Tag size={13} />
        </RowButton>
        <RowButton label={allHidden ? 'Show' : 'Hide'} on={allHidden} onClick={() => patchAnnotations(docId, annotations, { hidden: !allHidden })}>
          {allHidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </RowButton>
        <RowButton label={allLocked ? 'Unlock' : 'Lock'} on={allLocked} onClick={() => patchAnnotations(docId, annotations, { locked: !allLocked })}>
          {allLocked ? <Lock size={13} /> : <LockOpen size={13} />}
        </RowButton>
        <RowButton label="Delete" onClick={() => deleteAnnotations(docId, annotations)}>
          <Trash2 size={13} />
        </RowButton>
      </div>
      {tagging && (
        <div style={{ margin: '2px 6px 8px 22px', padding: 4, borderRadius: 8, border: '1px solid var(--color-border, #e0e0e4)', background: 'var(--color-bg-elevated, #fff)' }}>
          <TagPicker docId={docId} annotations={annotations} />
        </div>
      )}
      {open && (
        <div className={styles.groupChildren}>
          {annotations.map((annotation) => <AnnotationRow key={annotation.id} docId={docId} annotation={annotation} />)}
        </div>
      )}
    </>
  );
}

function RowButton({ label, onClick, on = false, children }: { label: string; onClick: () => void; on?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`${styles.rowButton} ${on ? styles.rowButtonOn : ''}`}
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
