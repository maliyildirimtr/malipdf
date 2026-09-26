import React, { useEffect, useMemo, useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { splitByRanges } from '../../document/splitPlan';
import { errorMessage } from '../../utils/notify';
import styles from './NewDocumentDialog.module.css';

type Scope = 'all' | 'current' | 'range';

/** PDF tools ▸ Export Pages as Images… */
export function ExportImagesDialog() {
  const open = useUIStore((s) => s.exportImagesOpen);
  const setOpen = useUIStore((s) => s.setExportImagesOpen);
  const doc = useDocumentStore((s) => (s.activeDocId ? s.documents.get(s.activeDocId) : undefined));
  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  const [dpi, setDpi] = useState(150);
  const [scope, setScope] = useState<Scope>('all');
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setBusy(false); }, [open]);

  const pageCount = doc?.pageCount ?? 0;
  const pages = useMemo((): { list: number[]; error: string } => {
    if (!doc) return { list: [], error: '' };
    if (scope === 'current') return { list: [doc.activePageIndex], error: '' };
    if (scope === 'all') return { list: Array.from({ length: pageCount }, (_, i) => i), error: '' };
    try {
      return { list: [...new Set(splitByRanges(pageCount, range).flatMap((p) => p.pages))].sort((a, b) => a - b), error: '' };
    } catch (error) {
      return { list: [], error: range.trim() ? errorMessage(error) : '' };
    }
  }, [doc, scope, range, pageCount]);

  if (!open || !doc) return null;

  const run = async () => {
    if (busy || pages.list.length === 0) return;
    setBusy(true);
    const { exportPagesAsImages } = await import('../../commands/exportImagesCommands');
    const ok = await exportPagesAsImages({ format, dpi, pages: pages.list });
    setBusy(false);
    if (ok) setOpen(false);
  };

  const chip = (selected: boolean, label: string, onClick: () => void) => (
    <button type="button" role="radio" aria-checked={selected} className={`${styles.chip} ${selected ? styles.chipSelected : ''}`} onClick={onClick}>{label}</button>
  );

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && !busy) setOpen(false); }}>
      <div className={styles.dialog} role="dialog" aria-label="Export Pages as Images" style={{ width: 460 }}>
        <div className={styles.header}><h2>Export Pages as Images</h2></div>
        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>FORMAT</div>
            <div className={styles.chipGroup} role="radiogroup" aria-label="Format">
              {chip(format === 'png', 'PNG (sharp)', () => setFormat('png'))}
              {chip(format === 'jpg', 'JPG (smaller)', () => setFormat('jpg'))}
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>RESOLUTION</div>
            <div className={styles.chipGroup} role="radiogroup" aria-label="Resolution">
              {chip(dpi === 72, 'Screen (72 dpi)', () => setDpi(72))}
              {chip(dpi === 150, 'Standard (150 dpi)', () => setDpi(150))}
              {chip(dpi === 300, 'Print (300 dpi)', () => setDpi(300))}
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>PAGES</div>
            <div className={styles.chipGroup} role="radiogroup" aria-label="Pages">
              {chip(scope === 'all', `All (${pageCount})`, () => setScope('all'))}
              {chip(scope === 'current', 'This page', () => setScope('current'))}
              {chip(scope === 'range', 'Pages…', () => setScope('range'))}
            </div>
            {scope === 'range' && (
              <input type="text" value={range} placeholder="e.g. 1-3, 7" aria-label="Page range" autoFocus
                style={{ marginTop: 8, height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid var(--color-border, #d0d0d0)', font: 'inherit' }}
                onChange={(e) => setRange(e.target.value)} />
            )}
            {pages.error && <div style={{ color: '#d32f2f', fontSize: 12, marginTop: 6 }}>{pages.error}</div>}
            <div style={{ fontSize: 12, marginTop: 8, color: 'var(--color-text-secondary, #666)' }}>Annotations are included. One image per page.</div>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button className={styles.createButton} onClick={() => void run()} disabled={busy || pages.list.length === 0}>{busy ? 'Exporting…' : 'Export…'}</button>
        </div>
      </div>
    </div>
  );
}
