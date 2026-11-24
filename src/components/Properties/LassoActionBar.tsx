/**
 * Floating action bar shown above lasso / multi-selection (and single selected
 * images/strokes on Tablet/iPadOS): Delete, Copy, Cut, Duplicate, Recolor,
 * Capture Image (Görsel Al), and Move to Page (Sayfaya Taşı).
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  ArrowRightLeft,
  Camera,
  Copy,
  CopyPlus,
  Palette,
  Scissors,
  Trash2,
} from 'lucide-react';
import type { Annotation } from '../../types/annotations';
import type { DocumentIdentity } from '../../types/documentSession';
import type { PageTransform } from '../../pdf/coordinateTransform';
import { pdfRectToScreenBounds } from '../../pdf/coordinateTransform';
import { getGroupBounds } from '../../pdf/annotationGeometry';
import { renderAnnotations } from '../../pdf/annotationRenderer';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  moveSelectionToPage,
  recolorSelection,
} from '../../commands/clipboardCommands';
import { notifyUser } from '../../utils/notify';
import styles from './LassoActionBar.module.css';

const QUICK_COLORS = [
  '#1a1a2e',
  '#154a87',
  '#2563eb',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
];

interface LassoActionBarProps {
  annotations: Annotation[];
  transform: PageTransform;
  identity: DocumentIdentity;
  pageIndex: number;
  canvasRef: React.RefObject<HTMLElement>;
}

export function LassoActionBar({
  annotations,
  transform,
  identity,
  pageIndex,
  canvasRef,
}: LassoActionBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [subMenu, setSubMenu] = useState<'color' | 'movePage' | null>(null);

  const pageCount = useDocumentStore((s) => s.documents.get(identity.docId)?.pageCount ?? 1);
  const isDrawing = useUIStore((s) => s.isDrawing);
  const hasColorable = annotations.some((a) => 'color' in a);

  useLayoutEffect(() => {
    const update = () => {
      const canvasEl = canvasRef.current;
      const barEl = barRef.current;
      if (!canvasEl) return;
      const groupBounds = getGroupBounds(annotations);
      if (!groupBounds) return;

      const canvasRect = canvasEl.getBoundingClientRect();
      const screenRect = pdfRectToScreenBounds(groupBounds, transform);
      const barW = barEl?.offsetWidth || 380;
      const barH = barEl?.offsetHeight || 46;

      const anchorCenterX = canvasRect.left + screenRect.x + screenRect.width / 2;
      const anchorTop = canvasRect.top + screenRect.y;
      const anchorBottom = canvasRect.top + screenRect.y + screenRect.height;

      const vw = window.visualViewport?.width ?? window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const margin = 12;
      const topSafe = 72;

      let top = anchorTop - barH - 12;
      if (top < topSafe) {
        top = Math.min(vh - barH - margin, anchorBottom + 12);
      }
      const left = Math.max(margin, Math.min(vw - barW - margin, anchorCenterX - barW / 2));
      setPos({ left, top });
    };

    update();
    window.addEventListener('scroll', update, { passive: true, capture: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    };
  }, [annotations, transform, canvasRef, subMenu]);

  if (annotations.length === 0 || isDrawing) return null;

  const stop = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleDelete = () => {
    deleteSelection();
  };

  const handleCopy = () => {
    const marker = copySelection();
    if (marker) {
      void navigator.clipboard?.writeText?.(marker).catch(() => {});
      notifyUser('success', 'Copied selection');
    }
  };

  const handleCut = () => {
    const marker = cutSelection();
    if (marker) {
      void navigator.clipboard?.writeText?.(marker).catch(() => {});
      notifyUser('info', 'Cut selection — tap Paste on any page');
    }
  };

  const handleDuplicate = () => {
    duplicateSelection();
  };

  const handleCaptureImage = async () => {
    const groupBounds = getGroupBounds(annotations);
    if (!groupBounds) return;
    const screenRect = pdfRectToScreenBounds(groupBounds, transform);
    const pad = 16;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(24, Math.ceil(screenRect.width + pad * 2));
    const h = Math.max(24, Math.ceil(screenRect.height + pad * 2));

    const off = document.createElement('canvas');
    off.width = Math.round(w * dpr);
    off.height = Math.round(h * dpr);
    const ctx = off.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.save();
    ctx.translate((-screenRect.x + pad) * dpr, (-screenRect.y + pad) * dpr);
    renderAnnotations(ctx, annotations, transform, dpr, identity);
    ctx.restore();

    try {
      const blob = await new Promise<Blob | null>((resolve) => off.toBlob(resolve, 'image/png'));
      if (!blob) return;
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          notifyUser('success', 'Selection image copied to clipboard');
          return;
        } catch {
          // Fall through to file download
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `malipdf-selection-p${pageIndex + 1}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notifyUser('success', 'Selection image saved');
    } catch {
      notifyUser('error', 'Could not capture selection image');
    }
  };

  const handleMoveToPage = (targetPage: number) => {
    setSubMenu(null);
    const moved = moveSelectionToPage(targetPage);
    if (moved.length > 0) {
      document
        .querySelector(`[data-doc-id="${identity.docId}"][data-instance-id="${identity.instanceId}"][data-page-index="${targetPage}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      notifyUser('success', `Moved to page ${targetPage + 1}`);
    }
  };

  return ReactDOM.createPortal(
    <div
      ref={barRef}
      data-keeps-selection="true"
      className={styles.wrapper}
      style={pos ? { left: pos.left, top: pos.top } : { opacity: 0, pointerEvents: 'none' }}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={stop}
      role="toolbar"
      aria-label="Selection actions"
    >
      <div className={styles.bar}>
        <button type="button" className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={handleDelete}>
          <Trash2 size={15} />
          <span>Delete</span>
        </button>
        <button type="button" className={styles.actionBtn} onClick={handleCopy}>
          <Copy size={15} />
          <span>Copy</span>
        </button>
        <button type="button" className={styles.actionBtn} onClick={handleCut}>
          <Scissors size={15} />
          <span>Cut</span>
        </button>
        <button type="button" className={styles.actionBtn} onClick={handleDuplicate}>
          <CopyPlus size={15} />
          <span>Duplicate</span>
        </button>
        {hasColorable && (
          <button
            type="button"
            className={`${styles.actionBtn} ${subMenu === 'color' ? styles.actionBtnActive : ''}`}
            onClick={() => setSubMenu((m) => (m === 'color' ? null : 'color'))}
          >
            <Palette size={15} />
            <span>Color</span>
          </button>
        )}
        <button type="button" className={styles.actionBtn} onClick={() => void handleCaptureImage()}>
          <Camera size={15} />
          <span>Take Screenshot</span>
        </button>
        {pageCount > 1 && (
          <button
            type="button"
            className={`${styles.actionBtn} ${subMenu === 'movePage' ? styles.actionBtnActive : ''}`}
            onClick={() => setSubMenu((m) => (m === 'movePage' ? null : 'movePage'))}
          >
            <ArrowRightLeft size={15} />
            <span>Move to Page</span>
          </button>
        )}
      </div>

      {subMenu === 'color' && (
        <div className={styles.subPopover}>
          <div className={styles.colorRow}>
            {QUICK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.colorDot}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onClick={() => {
                  recolorSelection(c);
                  setSubMenu(null);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {subMenu === 'movePage' && (
        <div className={styles.subPopover}>
          <div className={styles.pageGrid}>
            {pageIndex > 0 && (
              <button
                type="button"
                className={styles.pageNavChip}
                onClick={() => handleMoveToPage(pageIndex - 1)}
              >
                ↑ {pageIndex}
              </button>
            )}
            {pageIndex < pageCount - 1 && (
              <button
                type="button"
                className={styles.pageNavChip}
                onClick={() => handleMoveToPage(pageIndex + 1)}
              >
                ↓ {pageIndex + 2}
              </button>
            )}
            {Array.from({ length: Math.min(pageCount, 24) }, (_, idx) => (
              <button
                key={idx}
                type="button"
                disabled={idx === pageIndex}
                className={`${styles.pageChip} ${idx === pageIndex ? styles.pageChipCurrent : ''}`}
                onClick={() => handleMoveToPage(idx)}
              >
                {idx + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
