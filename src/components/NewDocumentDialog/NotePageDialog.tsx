import React, { useEffect, useRef, useState } from 'react';
import { useUIStore, type NotePageStyle } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { makePageBackground, type BackgroundSpacing } from '../../document/newDocumentGenerator';
import { BACKGROUND_TYPES, BackgroundThumbnail } from './NewDocumentDialog';
import styles from './NewDocumentDialog.module.css';

const LINE_COLOR = '#999999';

/** Insert Note Page: a blank, lined, grid, dotted or millimetric page after the current one. */
export function NotePageDialog() {
  const isOpen = useUIStore((s) => s.notePageDialogOpen);
  const setOpen = useUIStore((s) => s.setNotePageDialogOpen);
  const saved = useUIStore((s) => s.notePageStyle);
  const setSaved = useUIStore((s) => s.setNotePageStyle);
  const [style, setStyle] = useState<NotePageStyle>(saved);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStyle(useUIStore.getState().notePageStyle);
    setBusy(false);
    const t = setTimeout(() => dialogRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [isOpen]);

  if (!isOpen) return null;

  const update = (patch: Partial<NotePageStyle>) => setStyle((s) => ({ ...s, ...patch }));

  const insert = async () => {
    if (busy) return;
    setBusy(true);
    setSaved(style);
    const { insertNotePage } = await import('../../commands/pageCommands');
    const ok = await insertNotePage({
      background: makePageBackground(style.type, style.spacingMm as BackgroundSpacing, LINE_COLOR),
      size: style.size,
    });
    setBusy(false);
    setOpen(false);
    if (ok) {
      const { activeDocId: docId, documents } = useDocumentStore.getState();
      const page = docId ? documents.get(docId)?.activePageIndex : undefined;
      if (docId && page !== undefined) {
        const { goToPage } = await import('../../commands/bookmarkCommands');
        requestAnimationFrame(() => requestAnimationFrame(() => goToPage(docId, page)));
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter') void insert();
  };

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      onKeyDown={onKeyDown}
    >
      <div className={styles.dialog} ref={dialogRef} tabIndex={-1} role="dialog" aria-label="Insert Note Page">
        <div className={styles.header}>
          <h2>Insert Note Page</h2>
        </div>
        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>PAPER</div>
            <div className={styles.thumbnailRow}>
              {BACKGROUND_TYPES.map((bg) => (
                <BackgroundThumbnail
                  key={bg.type}
                  type={bg.type}
                  spacing={style.spacingMm}
                  color={LINE_COLOR}
                  selected={style.type === bg.type}
                  onClick={() => update({ type: bg.type })}
                />
              ))}
            </div>
            {style.type !== 'blank' && (
              <div className={styles.contextualRow}>
                <div className={styles.chipGroup}>
                  {([5, 8, 10] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`${styles.chip} ${style.spacingMm === s ? styles.chipSelected : ''}`}
                      onClick={() => update({ spacingMm: s })}
                    >
                      {s} mm
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className={styles.divider} />
          <div className={styles.section}>
            <div className={styles.sectionHeader}>SIZE</div>
            <div className={styles.chipGroup}>
              <button
                type="button"
                className={`${styles.chip} ${style.size === 'like' ? styles.chipSelected : ''}`}
                onClick={() => update({ size: 'like' })}
              >
                Same as this page
              </button>
              <button
                type="button"
                className={`${styles.chip} ${style.size === 'a4' ? styles.chipSelected : ''}`}
                onClick={() => update({ size: 'a4' })}
              >
                A4 portrait
              </button>
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button className={styles.createButton} onClick={() => void insert()} disabled={busy}>
            {busy ? 'Inserting…' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  );
}
