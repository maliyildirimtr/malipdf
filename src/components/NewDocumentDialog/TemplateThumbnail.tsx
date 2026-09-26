import React from 'react';
import { NOTE_TEMPLATES, type NoteTemplateId } from '../../document/noteTemplates';
import styles from './NewDocumentDialog.module.css';

/** Small preview of a note template (48 × 64). */
function TemplateArt({ id, color }: { id: NoteTemplateId; color: string }) {
  const s = { stroke: color, strokeWidth: 0.6 } as const;
  const rows = (x1: number, x2: number, y1: number, y2: number, step = 4) =>
    Array.from({ length: Math.floor((y2 - y1) / step) }, (_, i) => <line key={`${x1}-${y1}-${i}`} x1={x1} x2={x2} y1={y1 + (i + 1) * step} y2={y1 + (i + 1) * step} {...s} strokeWidth={0.35} />);
  switch (id) {
    case 'cornell':
      return <>
        <line x1={3} x2={45} y1={8} y2={8} {...s} />
        <line x1={16} x2={16} y1={8} y2={50} {...s} />
        <line x1={3} x2={45} y1={50} y2={50} {...s} />
        {rows(17, 45, 8, 48)}
      </>;
    case 'todo':
      return <>
        <line x1={3} x2={45} y1={8} y2={8} {...s} />
        {Array.from({ length: 9 }, (_, i) => (
          <g key={i}>
            <rect x={4} y={11 + i * 5.8} width={3} height={3} fill="none" {...s} strokeWidth={0.45} />
            <line x1={9} x2={45} y1={14 + i * 5.8} y2={14 + i * 5.8} {...s} strokeWidth={0.35} />
          </g>
        ))}
      </>;
    case 'weekly':
      return <>
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={3 + (i % 2) * 21} y={7 + Math.floor(i / 2) * 14} width={21} height={14} fill="none" {...s} strokeWidth={0.45} />
        ))}
      </>;
    case 'meeting':
      return <>
        <line x1={12} x2={45} y1={8} y2={8} {...s} strokeWidth={0.4} />
        <line x1={12} x2={45} y1={12} y2={12} {...s} strokeWidth={0.4} />
        {rows(3, 45, 14, 42)}
        <line x1={3} x2={45} y1={44} y2={44} {...s} />
        {Array.from({ length: 4 }, (_, i) => <rect key={i} x={4} y={47 + i * 4} width={2.5} height={2.5} fill="none" {...s} strokeWidth={0.4} />)}
      </>;
    case 'music':
      return <>
        {Array.from({ length: 6 }, (_, st) => Array.from({ length: 5 }, (_, k) => (
          <line key={`${st}-${k}`} x1={3} x2={45} y1={6 + st * 9.5 + k * 1.3} y2={6 + st * 9.5 + k * 1.3} {...s} strokeWidth={0.3} />
        )))}
      </>;
  }
}

export function TemplateThumbnail({ id, color, selected, onClick }: { id: NoteTemplateId; color: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`${styles.thumbnailBtn} ${selected ? styles.thumbnailSelected : ''}`} onClick={onClick} aria-pressed={selected}>
      <div className={styles.thumbnailPreview}>
        <svg viewBox="0 0 48 64" width="48" height="64" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="48" height="64" fill="white" stroke="#ccc" strokeWidth="1" />
          <TemplateArt id={id} color={color} />
        </svg>
      </div>
      <span className={styles.thumbnailLabel}>{NOTE_TEMPLATES.find((t) => t.id === id)?.label}</span>
    </button>
  );
}
