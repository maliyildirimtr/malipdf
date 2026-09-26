import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { splitByRanges } from '../../document/splitPlan';
import { formatPageNumber, fillPlaceholders, type Corner, type NumberFormat, type PageStampOptions } from '../../pdf/pageStamps';
import { errorMessage } from '../../utils/notify';
import styles from './NewDocumentDialog.module.css';
import local from './HeaderFooterDialog.module.css';

type Scope = 'all' | 'current' | 'range';

const FORMATS: { id: NumberFormat; label: string }[] = [
  { id: 'n', label: '1' },
  { id: 'n-of-total', label: '1 / 20' },
  { id: 'page-n', label: 'Page 1' },
  { id: 'page-n-of-total', label: 'Page 1 of 20' },
];

function AlignPicker({ value, onChange, label }: { value: Corner; onChange: (v: Corner) => void; label: string }) {
  return (
    <div className={styles.chipGroup} role="radiogroup" aria-label={label}>
      {(['left', 'center', 'right'] as const).map((a) => (
        <button key={a} type="button" role="radio" aria-checked={value === a}
          className={`${styles.chip} ${value === a ? styles.chipSelected : ''}`} onClick={() => onChange(a)}>
          {a === 'left' ? 'Left' : a === 'center' ? 'Center' : 'Right'}
        </button>
      ))}
    </div>
  );
}

/** Insert ▸ Header, Footer & Page Numbers… */
export function HeaderFooterDialog() {
  const open = useUIStore((s) => s.headerFooterOpen);
  const setOpen = useUIStore((s) => s.setHeaderFooterOpen);
  const doc = useDocumentStore((s) => (s.activeDocId ? s.documents.get(s.activeDocId) : undefined));
  const [numbers, setNumbers] = useState(true);
  const [format, setFormat] = useState<NumberFormat>('n-of-total');
  const [numPos, setNumPos] = useState<'top' | 'bottom'>('bottom');
  const [numAlign, setNumAlign] = useState<Corner>('center');
  const [start, setStart] = useState(1);
  const [header, setHeader] = useState('');
  const [headerAlign, setHeaderAlign] = useState<Corner>('left');
  const [footer, setFooter] = useState('');
  const [footerAlign, setFooterAlign] = useState<Corner>('left');
  const [watermark, setWatermark] = useState('');
  const [wmColor, setWmColor] = useState('#d32f2f');
  const [wmOpacity, setWmOpacity] = useState(0.15);
  const [wmDiagonal, setWmDiagonal] = useState(true);
  const [fontSize, setFontSize] = useState(10);
  const [color, setColor] = useState('#555555');
  const [scope, setScope] = useState<Scope>('all');
  const [range, setRange] = useState('');
  const [skipFirst, setSkipFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    const t = setTimeout(() => ref.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  const pageCount = doc?.pageCount ?? 0;
  const pages = useMemo((): { list: number[]; error: string } => {
    if (!doc) return { list: [], error: '' };
    if (scope === 'current') return { list: [doc.activePageIndex], error: '' };
    if (scope === 'all') return { list: Array.from({ length: pageCount }, (_, i) => i), error: '' };
    try {
      return { list: [...new Set(splitByRanges(pageCount, range).flatMap((p) => p.pages))].sort((a, b) => a - b), error: '' };
    } catch (error) {
      return { list: [], error: range.trim() ? errorMessage(error) : 'Type pages, e.g. 2-10' };
    }
  }, [doc, scope, range, pageCount]);

  if (!open || !doc) return null;

  const nothing = !numbers && !header.trim() && !footer.trim() && !watermark.trim();
  const sample = { page: 1, pages: pageCount, date: new Date().toLocaleDateString(), title: doc.title.replace(/\.pdf$/i, '') };

  const apply = async () => {
    if (busy || nothing || pages.list.length === 0) return;
    setBusy(true);
    const options: PageStampOptions = {
      pages: pages.list, fontSize, color, skipFirst,
      ...(numbers ? { pageNumbers: { format, position: numPos, align: numAlign, start } } : {}),
      ...(header.trim() ? { header: { text: header, align: headerAlign } } : {}),
      ...(footer.trim() ? { footer: { text: footer, align: footerAlign } } : {}),
      ...(watermark.trim() ? { watermark: { text: watermark, opacity: wmOpacity, size: 64, color: wmColor, diagonal: wmDiagonal } } : {}),
    };
    const { addPageStamps } = await import('../../commands/pageStampCommands');
    const ok = await addPageStamps(options);
    setBusy(false);
    if (ok) setOpen(false);
  };

  // Tiny preview of the first page.
  const pos = (align: Corner) => (align === 'left' ? 10 : align === 'right' ? 110 : 60);
  const anchor = (align: Corner) => (align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle');

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); }}>
      <div className={`${styles.dialog} ${local.wide}`} ref={ref} tabIndex={-1} role="dialog" aria-label="Header, Footer & Page Numbers">
        <div className={styles.header}><h2>Header, Footer &amp; Page Numbers</h2></div>
        <div className={local.layout}>
          <div className={local.form}>
            <label className={local.check}><input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} /> Page numbers</label>
            {numbers && (
              <div className={local.indent}>
                <div className={styles.chipGroup} role="radiogroup" aria-label="Number format">
                  {FORMATS.map((f) => (
                    <button key={f.id} type="button" role="radio" aria-checked={format === f.id}
                      className={`${styles.chip} ${format === f.id ? styles.chipSelected : ''}`} onClick={() => setFormat(f.id)}>{f.label}</button>
                  ))}
                </div>
                <div className={local.row}>
                  <select value={numPos} aria-label="Page number position" onChange={(e) => setNumPos(e.target.value as 'top' | 'bottom')}>
                    <option value="bottom">Bottom</option><option value="top">Top</option>
                  </select>
                  <AlignPicker label="Page number alignment" value={numAlign} onChange={setNumAlign} />
                  <label>Start at <input type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))} /></label>
                </div>
              </div>
            )}
            <label className={local.field}>Header
              <input type="text" value={header} placeholder="e.g. {title} — {date}" onChange={(e) => setHeader(e.target.value)} />
            </label>
            {header.trim() && <div className={local.indent}><AlignPicker label="Header alignment" value={headerAlign} onChange={setHeaderAlign} /></div>}
            <label className={local.field}>Footer
              <input type="text" value={footer} placeholder="e.g. Mehmet Ali — Physics notes" onChange={(e) => setFooter(e.target.value)} />
            </label>
            {footer.trim() && <div className={local.indent}><AlignPicker label="Footer alignment" value={footerAlign} onChange={setFooterAlign} /></div>}
            <small className={local.hint}>{'You can use {page}, {pages}, {date} and {title} in the text.'}</small>
            <label className={local.field}>Watermark
              <input type="text" value={watermark} placeholder="e.g. DRAFT, CONFIDENTIAL" onChange={(e) => setWatermark(e.target.value)} />
            </label>
            {watermark.trim() && (
              <div className={`${local.indent} ${local.row}`}>
                <input type="color" value={wmColor} aria-label="Watermark colour" onChange={(e) => setWmColor(e.target.value)} />
                <label>Opacity <input type="range" min={0.05} max={0.6} step={0.05} value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} /></label>
                <label className={local.check}><input type="checkbox" checked={wmDiagonal} onChange={(e) => setWmDiagonal(e.target.checked)} /> Diagonal</label>
              </div>
            )}
            <div className={local.row}>
              <label>Text size <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>{[8, 9, 10, 11, 12, 14].map((s) => <option key={s} value={s}>{s} pt</option>)}</select></label>
              <input type="color" value={color} aria-label="Text colour" onChange={(e) => setColor(e.target.value)} />
            </div>
            <div className={styles.divider} />
            <div className={styles.chipGroup} role="radiogroup" aria-label="Pages">
              {([['all', 'All pages'], ['current', 'This page'], ['range', 'Pages…']] as const).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={scope === id}
                  className={`${styles.chip} ${scope === id ? styles.chipSelected : ''}`} onClick={() => setScope(id)}>{label}</button>
              ))}
            </div>
            {scope === 'range' && <input className={local.rangeInput} type="text" value={range} placeholder="e.g. 2-10" aria-label="Page range" onChange={(e) => setRange(e.target.value)} />}
            {pages.error && <small className={local.error}>{pages.error}</small>}
            <label className={local.check}><input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} /> Skip the first page (cover)</label>
          </div>
          <svg className={local.preview} viewBox="0 0 120 170" aria-label="Preview">
            <rect x="0.5" y="0.5" width="119" height="169" fill="#fff" stroke="#ccc" />
            {[40, 52, 64, 76, 88, 100, 112].map((y) => <line key={y} x1="14" x2="106" y1={y} y2={y} stroke="#e6e6e6" strokeWidth="3" />)}
            {watermark.trim() && (
              <text x="60" y="88" textAnchor="middle" fontSize="16" fontWeight="700" fill={wmColor} opacity={wmOpacity * 2}
                transform={wmDiagonal ? 'rotate(-54.8 60 85)' : undefined}>{watermark.slice(0, 14)}</text>
            )}
            {header.trim() && <text x={pos(headerAlign)} y="14" textAnchor={anchor(headerAlign)} fontSize="6" fill={color}>{fillPlaceholders(header, sample).slice(0, 30)}</text>}
            {footer.trim() && <text x={pos(footerAlign)} y={numbers && numPos === 'bottom' && numAlign === footerAlign ? 150 : 162} textAnchor={anchor(footerAlign)} fontSize="6" fill={color}>{fillPlaceholders(footer, sample).slice(0, 30)}</text>}
            {numbers && <text x={pos(numAlign)} y={numPos === 'top' ? (header.trim() && headerAlign === numAlign ? 24 : 14) : 162} textAnchor={anchor(numAlign)} fontSize="6" fill={color}>{formatPageNumber(format, start, pageCount + start - 1)}</text>}
          </svg>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button className={styles.createButton} onClick={() => void apply()} disabled={busy || nothing || pages.list.length === 0}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </div>
  );
}
