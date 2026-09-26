import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { splitByRanges, splitEvery, type SplitPart } from '../../document/splitPlan';
import { errorMessage } from '../../utils/notify';
import styles from './NewDocumentDialog.module.css';

type Mode = 'every' | 'ranges' | 'single';

/** Split Document: save parts of the open PDF as separate files. */
export function SplitDialog() {
  const isOpen = useUIStore((s) => s.splitDialogOpen);
  const setOpen = useUIStore((s) => s.setSplitDialogOpen);
  const pageCount = useDocumentStore((s) => (s.activeDocId ? s.documents.get(s.activeDocId)?.pageCount ?? 0 : 0));
  const [mode, setMode] = useState<Mode>('every');
  const [every, setEvery] = useState(2);
  const [ranges, setRanges] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setBusy(false);
    const t = setTimeout(() => dialogRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [isOpen]);

  const plan = useMemo((): { parts: SplitPart[]; error: string } => {
    if (pageCount === 0) return { parts: [], error: '' };
    try {
      if (mode === 'single') return { parts: splitEvery(pageCount, 1), error: '' };
      if (mode === 'every') return { parts: splitEvery(pageCount, every), error: '' };
      return { parts: ranges.trim() ? splitByRanges(pageCount, ranges) : [], error: '' };
    } catch (error) {
      return { parts: [], error: errorMessage(error) };
    }
  }, [mode, every, ranges, pageCount]);

  if (!isOpen) return null;

  const run = async () => {
    if (busy || plan.parts.length === 0) return;
    setBusy(true);
    const { splitDocument } = await import('../../commands/combineSplitCommands');
    const ok = await splitDocument(plan.parts);
    setBusy(false);
    if (ok) setOpen(false);
  };

  const chip = (value: Mode, label: string) => (
    <button type="button" className={`${styles.chip} ${mode === value ? styles.chipSelected : ''}`} aria-pressed={mode === value} onClick={() => setMode(value)}>
      {label}
    </button>
  );

  const preview = plan.parts.slice(0, 6).map((p) => p.label).join(', ') + (plan.parts.length > 6 ? ', …' : '');

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') setOpen(false);
        if (e.key === 'Enter') void run();
      }}
    >
      <div className={styles.dialog} ref={dialogRef} tabIndex={-1} role="dialog" aria-label="Split Document">
        <div className={styles.header}><h2>Split Document</h2></div>
        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>SPLIT</div>
            <div className={styles.chipGroup}>
              {chip('every', 'Every few pages')}
              {chip('ranges', 'By page ranges')}
              {chip('single', 'Each page')}
            </div>
            {mode === 'every' && (
              <div className={styles.contextualRow}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  Pages per file
                  <input
                    type="number" min={1} max={Math.max(1, pageCount)} value={every} aria-label="Pages per file"
                    style={{ width: 64, height: 26, padding: '0 6px', borderRadius: 6, border: '1px solid var(--border-color, #d0d0d0)' }}
                    onChange={(e) => setEvery(Math.max(1, Math.min(pageCount || 1, Number(e.target.value) || 1)))}
                  />
                </label>
              </div>
            )}
            {mode === 'ranges' && (
              <div className={styles.contextualRow}>
                <input
                  type="text" value={ranges} placeholder={`e.g. 1-3, 4-${Math.max(4, Math.min(pageCount, 10))}, ${Math.min(pageCount, 11)}-`} aria-label="Page ranges"
                  autoFocus
                  style={{ flex: 1, height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border-color, #d0d0d0)', font: 'inherit' }}
                  onChange={(e) => setRanges(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className={styles.section}>
            <div style={{ fontSize: 12, color: plan.error ? '#d32f2f' : 'var(--text-secondary, #666)' }} role={plan.error ? 'alert' : undefined}>
              {plan.error || (plan.parts.length
                ? `${plan.parts.length} file${plan.parts.length === 1 ? '' : 's'} from ${pageCount} pages: ${preview}. Annotations are included.`
                : 'Type the page ranges, separated by commas.')}
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button className={styles.createButton} onClick={() => void run()} disabled={busy || plan.parts.length === 0}>
            {busy ? 'Splitting…' : 'Split…'}
          </button>
        </div>
      </div>
    </div>
  );
}
