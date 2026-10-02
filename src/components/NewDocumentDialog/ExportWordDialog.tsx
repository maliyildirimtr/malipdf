import { useEffect, useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import type { WordExportMode } from '../../commands/convertCommands';
import styles from './NewDocumentDialog.module.css';

/** File ▸ Export to Word (.docx)… */
export function ExportWordDialog() {
  const open = useUIStore((s) => s.exportWordOpen);
  const setOpen = useUIStore((s) => s.setExportWordOpen);
  const doc = useDocumentStore((s) => (s.activeDocId ? s.documents.get(s.activeDocId) : undefined));
  const [mode, setMode] = useState<WordExportMode>('text');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setBusy(false); }, [open]);

  if (!open || !doc) return null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    const { exportToWord } = await import('../../commands/convertCommands');
    const ok = await exportToWord(mode);
    setBusy(false);
    if (ok) setOpen(false);
  };

  const option = (value: WordExportMode, title: string, detail: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      className={`${styles.chip} ${mode === value ? styles.chipSelected : ''}`}
      style={{ display: 'block', width: '100%', height: 'auto', padding: '8px 10px', textAlign: 'left', whiteSpace: 'normal' }}
      onClick={() => setMode(value)}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{detail}</div>
    </button>
  );

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && !busy) setOpen(false); }}>
      <div className={styles.dialog} role="dialog" aria-label="Export to Word" style={{ width: 480 }}>
        <div className={styles.header}><h2>Export to Word</h2></div>
        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>CONTENT</div>
            <div role="radiogroup" aria-label="Content" style={{ display: 'grid', gap: 8 }}>
              {option('text', 'Editable text', 'Paragraphs with their fonts, sizes, bold and italic. Pictures and drawings on text pages are not included; pages with no text come in as pictures.')}
              {option('pages', 'Exact page look', 'Each page as a picture, with your annotations. Looks exactly like the PDF, but the text cannot be edited.')}
            </div>
            <div style={{ fontSize: 12, marginTop: 8, color: 'var(--color-text-secondary, #666)' }}>
              {mode === 'text' ? 'Scanned pages are read with text recognition when it is available (macOS).' : 'All pages, 150 dpi.'}
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button className={styles.createButton} onClick={() => void run()} disabled={busy}>{busy ? 'Exporting…' : 'Export…'}</button>
        </div>
      </div>
    </div>
  );
}
