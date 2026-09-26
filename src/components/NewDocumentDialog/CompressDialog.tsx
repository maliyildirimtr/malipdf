import React, { useEffect, useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { COMPRESS_LEVELS, type CompressLevel } from '../../pdf/compress';
import styles from './NewDocumentDialog.module.css';

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** PDF tools ▸ Reduce File Size… */
export function CompressDialog() {
  const open = useUIStore((s) => s.compressOpen);
  const setOpen = useUIStore((s) => s.setCompressOpen);
  const doc = useDocumentStore((s) => (s.activeDocId ? s.documents.get(s.activeDocId) : undefined));
  const [level, setLevel] = useState<CompressLevel>('medium');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setBusy(false); }, [open]);
  if (!open || !doc) return null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    const { reduceFileSize } = await import('../../commands/compressCommands');
    await reduceFileSize(level);
    setBusy(false);
    setOpen(false);
  };

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && !busy) setOpen(false); }}>
      <div className={styles.dialog} role="dialog" aria-label="Reduce File Size" style={{ width: 460 }}>
        <div className={styles.header}><h2>Reduce File Size</h2></div>
        <div className={styles.content}>
          <div className={styles.section}>
            <p style={{ margin: 0, fontSize: 13 }}>
              Now <b>{size(doc.sourceData.byteLength)}</b>. Photos and scans are saved again at a lower resolution;
              text and drawings stay sharp. You can undo it (⌘Z).
            </p>
          </div>
          <div className={styles.section} role="radiogroup" aria-label="Quality">
            {(Object.keys(COMPRESS_LEVELS) as CompressLevel[]).map((id) => (
              <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0', cursor: 'pointer' }}>
                <input type="radio" name="compress-level" checked={level === id} onChange={() => setLevel(id)} />
                <span><b>{COMPRESS_LEVELS[id].label}</b> — images up to {COMPRESS_LEVELS[id].maxSide} px</span>
              </label>
            ))}
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button className={styles.createButton} onClick={() => void run()} disabled={busy}>{busy ? 'Working…' : 'Reduce'}</button>
        </div>
      </div>
    </div>
  );
}
