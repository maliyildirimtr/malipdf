import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { normalizeAndCreateImageAsset } from '../../pdf/imageUtils';
import { imagesToPdf, type ImagePageSize, type PreparedImage } from '../../pdf/imagesToPdf';
import { openDocumentBytes } from '../../document/openDocumentBytes';
import { errorMessage, notifyUser } from '../../utils/notify';
import styles from './NewDocumentDialog.module.css';

interface Item { id: string; name: string; url: string; image: PreparedImage }

/** File ▸ New PDF from Images… */
export function ImagesToPdfDialog() {
  const open = useUIStore((s) => s.imagesToPdfOpen);
  const setOpen = useUIStore((s) => s.setImagesToPdfOpen);
  const [items, setItems] = useState<Item[]>([]);
  const [size, setSize] = useState<ImagePageSize>('a4');
  const [margin, setMargin] = useState(0);
  const [busy, setBusy] = useState(false);
  const target = useUIStore((s) => s.imagesDialogTarget);
  const setTarget = useUIStore((s) => s.setImagesDialogTarget);
  const [wordText, setWordText] = useState(false);
  const [ocr, setOcr] = useState(false);
  useEffect(() => {
    if (!open) return;
    void import('../../commands/convertCommands').then((m) => m.wordOcrAvailable()).then(setOcr, () => setOcr(false));
  }, [open]);

  const addImages = async () => {
    const files = await window.electronAPI?.openImages?.();
    if (!files || files.length === 0) return;
    setBusy(true);
    const added: Item[] = [];
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const file of sorted) {
      try {
        const asset = await normalizeAndCreateImageAsset(file.data, file.mimeType);
        const url = URL.createObjectURL(new Blob([asset.data as BlobPart], { type: asset.mimeType }));
        added.push({ id: asset.id, name: file.name, url, image: { mimeType: asset.mimeType, width: asset.width, height: asset.height, data: asset.data } });
      } catch (error) {
        notifyUser('error', `${file.name}: ${errorMessage(error)}`);
      }
    }
    setItems((list) => [...list, ...added]);
    setBusy(false);
  };

  useEffect(() => {
    if (!open) {
      setItems((list) => { list.forEach((i) => URL.revokeObjectURL(i.url)); return []; });
      return;
    }
    setBusy(false);
    void addImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const move = (index: number, delta: number) => setItems((list) => {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
    return next;
  });
  const remove = (id: string) => setItems((list) => list.filter((i) => {
    if (i.id === id) URL.revokeObjectURL(i.url);
    return i.id !== id;
  }));

  const create = async () => {
    if (busy || items.length === 0) return;
    setBusy(true);
    if (target === 'word') {
      const { exportPicturesToWord } = await import('../../commands/convertCommands');
      const ok = await exportPicturesToWord(items.map((i) => ({ name: i.name, ...i.image })), wordText && ocr);
      setBusy(false);
      if (ok) setOpen(false);
      return;
    }
    try {
      const bytes = await imagesToPdf(items.map((i) => i.image), size, margin);
      const name = items.length === 1 ? items[0].name.replace(/\.[^.]+$/, '') : 'Images';
      await openDocumentBytes(`${name}.pdf`, null, bytes.buffer as ArrayBuffer, { markDirty: true });
      setOpen(false);
    } catch (error) {
      notifyUser('error', `The PDF could not be made: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const chip = (selected: boolean, label: string, onClick: () => void) => (
    <button type="button" role="radio" aria-checked={selected} className={`${styles.chip} ${selected ? styles.chipSelected : ''}`} onClick={onClick}>{label}</button>
  );

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && !busy) setOpen(false); }}>
      <div className={styles.dialog} role="dialog" aria-label={target === 'word' ? 'Word Document from Images' : 'New PDF from Images'} style={{ width: 620 }}>
        <div className={styles.header}><h2>{target === 'word' ? 'Word Document from Images' : 'New PDF from Images'}</h2></div>
        <div className={styles.content}>
          <div className={styles.section}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10, maxHeight: 300, overflow: 'auto' }} aria-label="Pages">
              {items.map((item, index) => (
                <figure key={item.id} style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} data-image-item>
                  <div style={{ position: 'relative', width: 96, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f1f4', borderRadius: 6 }}>
                    <img src={item.url} alt={item.name} style={{ maxWidth: 88, maxHeight: 112, boxShadow: '0 1px 4px rgba(0,0,0,.2)' }} />
                    <span style={{ position: 'absolute', top: 4, left: 6, fontSize: 11, fontWeight: 600 }}>{index + 1}</span>
                  </div>
                  <figcaption style={{ fontSize: 11, maxWidth: 104, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>{item.name}</figcaption>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button type="button" aria-label={`Move ${item.name} earlier`} disabled={index === 0} onClick={() => move(index, -1)} style={iconButton}><ArrowUp size={13} /></button>
                    <button type="button" aria-label={`Move ${item.name} later`} disabled={index === items.length - 1} onClick={() => move(index, 1)} style={iconButton}><ArrowDown size={13} /></button>
                    <button type="button" aria-label={`Remove ${item.name}`} onClick={() => remove(item.id)} style={iconButton}><X size={13} /></button>
                  </div>
                </figure>
              ))}
              <button type="button" onClick={() => void addImages()} disabled={busy}
                style={{ width: 96, height: 120, border: '1.5px dashed #bbb', borderRadius: 6, background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 12, color: 'inherit' }}>
                <Plus size={18} /> Add images
              </button>
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>MAKE</div>
            <div className={styles.chipGroup} role="radiogroup" aria-label="Output">
              {chip(target === 'pdf', 'PDF', () => setTarget('pdf'))}
              {chip(target === 'word', 'Word (.docx)', () => setTarget('word'))}
            </div>
          </div>
          {target === 'word' && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>WORD CONTENT</div>
              <div className={styles.chipGroup} role="radiogroup" aria-label="Word content">
                {chip(!wordText || !ocr, 'Pictures (one per page)', () => setWordText(false))}
                {ocr && chip(wordText, 'Text (recognized)', () => setWordText(true))}
              </div>
              <div style={{ fontSize: 12, marginTop: 8, color: 'var(--color-text-secondary, #666)' }}>
                {ocr
                  ? (wordText ? 'The writing in each picture becomes editable text.' : 'Each picture goes on its own A4 page.')
                  : 'Each picture goes on its own A4 page. Turning pictures into text needs text recognition (macOS).'}
              </div>
            </div>
          )}
          {target === 'pdf' && <>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>PAGE SIZE</div>
            <div className={styles.chipGroup} role="radiogroup" aria-label="Page size">
              {chip(size === 'a4', 'A4', () => setSize('a4'))}
              {chip(size === 'letter', 'Letter', () => setSize('letter'))}
              {chip(size === 'image', 'Same as the image', () => setSize('image'))}
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>MARGIN</div>
            <div className={styles.chipGroup} role="radiogroup" aria-label="Margin">
              {chip(margin === 0, 'None', () => setMargin(0))}
              {chip(margin === 18, 'Small', () => setMargin(18))}
              {chip(margin === 36, 'Normal', () => setMargin(36))}
            </div>
          </div>
          </>}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button className={styles.createButton} onClick={() => void create()} disabled={busy || items.length === 0}>
            {busy ? 'Working…' : target === 'word'
              ? `Save Word File (${items.length} picture${items.length === 1 ? '' : 's'})…`
              : `Create PDF (${items.length} page${items.length === 1 ? '' : 's'})`}
          </button>
        </div>
      </div>
    </div>
  );
}

const iconButton: React.CSSProperties = { width: 24, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'inherit' };
