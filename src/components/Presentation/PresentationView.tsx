/**
 * Presentation mode: one page at a time, full screen on black, with a laser
 * pointer (drag) and keyboard / click navigation. Nothing is changed in the
 * document; leaving goes back to the page that was shown last.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { getDocumentProxy } from '../../pdf/documentManager';
import { createPageTransform } from '../../pdf/coordinateTransform';
import { isMultiplyAnnotation, renderAnnotations } from '../../pdf/annotationRenderer';
import type { Annotation } from '../../types/annotations';
import { addLaserPoint, clearLaser, endLaserTrail, startLaserTrail } from '../Laser/laserTrail';
import { LaserOverlay } from '../Laser/LaserOverlay';
import styles from './PresentationView.module.css';

const EMPTY: Annotation[] = [];
const MAX_CANVAS_PIXELS = 16_000_000;
const CLICK_SLOP_PX = 6;
const CONTROLS_HIDE_MS = 2200;

export function PresentationView() {
  const open = useUIStore((s) => s.presentationOpen);
  if (!open) return null;
  return <PresentationSurface />;
}

function PresentationSurface() {
  const setOpen = useUIStore((s) => s.setPresentationOpen);
  const docId = useDocumentStore((s) => s.activeDocId);
  const doc = useDocumentStore((s) => (s.activeDocId ? s.documents.get(s.activeDocId) ?? null : null));
  const pageCount = doc?.pageCount ?? 0;
  const [pageIndex, setPageIndex] = useState(() => doc?.activePageIndex ?? 0);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [controlsVisible, setControlsVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(pageIndex);
  pageRef.current = pageIndex;

  const annotations = useAnnotationStore(
    (s) => (docId ? s.docAnnotations.get(docId)?.pages.get(pageIndex)?.annotations : undefined) ?? EMPTY,
  );

  const close = useCallback(() => {
    clearLaser();
    if (docId) {
      const page = pageRef.current;
      useDocumentStore.getState().setActivePage(docId, page);
      void import('../../commands/bookmarkCommands').then(({ goToPage }) => {
        requestAnimationFrame(() => goToPage(docId, page));
      });
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setOpen(false);
  }, [docId, setOpen]);

  const go = useCallback((delta: number) => {
    setPageIndex((p) => Math.max(0, Math.min(pageCount - 1, p + delta)));
  }, [pageCount]);

  // Full screen while presenting; leaving full screen (Esc) ends the presentation.
  useEffect(() => {
    const root = rootRef.current;
    let entered = false;
    root?.requestFullscreen?.().then(() => { entered = true; }).catch(() => undefined);
    const onChange = () => {
      if (entered && !document.fullscreenElement) close();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [close]);

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The document went away (closed tab) or lost pages.
  useEffect(() => {
    if (!doc) setOpen(false);
    else if (pageIndex > pageCount - 1) setPageIndex(Math.max(0, pageCount - 1));
  }, [doc, pageCount, pageIndex, setOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'];
      const prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'];
      if (e.key === 'Escape') close();
      else if (next.includes(e.key)) go(1);
      else if (prev.includes(e.key)) go(-1);
      else if (e.key === 'Home') setPageIndex(0);
      else if (e.key === 'End') setPageIndex(Math.max(0, pageCount - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, go, pageCount]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);
  useEffect(() => {
    showControls();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [showControls]);

  // Render the page (and its annotations) to fit the screen.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    const identity = { docId: doc.id, instanceId: doc.instanceId };
    const proxy = getDocumentProxy(identity);
    if (!proxy) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;

    void (async () => {
      const page = await proxy.getPage(pageIndex + 1);
      if (cancelled) return;
      const displayRotation = doc.pageRotations[pageIndex] || 0;
      const unit = createPageTransform(page, { scale: 1, displayRotation });
      const scale = Math.min(size.width / unit.cssWidth, size.height / unit.cssHeight);
      const transform = createPageTransform(page, { scale, displayRotation });
      let dpr = Math.min(window.devicePixelRatio || 1, 3);
      const pixels = transform.cssWidth * transform.cssHeight * dpr * dpr;
      if (pixels > MAX_CANVAS_PIXELS) dpr *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);

      // Draw off-screen first so the previous page stays up until this one is ready.
      const buffer = document.createElement('canvas');
      buffer.width = Math.round(transform.cssWidth * dpr);
      buffer.height = Math.round(transform.cssHeight * dpr);
      const bctx = buffer.getContext('2d');
      if (!bctx) return;
      bctx.fillStyle = '#fff';
      bctx.fillRect(0, 0, buffer.width, buffer.height);
      task = page.render({ canvasContext: bctx, viewport: transform.viewport, transform: [dpr, 0, 0, dpr, 0, 0] });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;

      const paint = () => {
        if (cancelled) return;
        canvas.width = buffer.width;
        canvas.height = buffer.height;
        canvas.style.width = `${transform.cssWidth}px`;
        canvas.style.height = `${transform.cssHeight}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(buffer, 0, 0);
        const visible = annotations.filter((a) => !a.hidden);
        renderAnnotations(
          ctx,
          [...visible.filter(isMultiplyAnnotation), ...visible.filter((a) => !isMultiplyAnnotation(a))],
          transform,
          dpr,
          identity,
          paint, // images decode asynchronously: repaint when they are ready
        );
      };
      paint();
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageIndex, size.width, size.height, annotations]);

  // Pointer: drag = laser, click = next page.
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    startLaserTrail(e.clientX, e.clientY, e.timeStamp);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    showControls();
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) p.moved = true;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events) addLaserPoint(ev.clientX, ev.clientY, ev.timeStamp);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    pointer.current = null;
    endLaserTrail(e.timeStamp);
    if (!p.moved) {
      clearLaser();
      go(e.clientX < window.innerWidth * 0.2 ? -1 : 1);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${controlsVisible ? '' : styles.hideCursor}`}
      role="dialog"
      aria-label="Presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { pointer.current = null; endLaserTrail(); }}
      onContextMenu={(e) => { e.preventDefault(); go(-1); }}
    >
      <canvas ref={canvasRef} className={styles.page} />
      <div className={`${styles.controls} ${controlsVisible ? styles.controlsVisible : ''}`}>
        <button type="button" onClick={() => go(-1)} disabled={pageIndex === 0} aria-label="Previous page"><ChevronLeft size={18} /></button>
        <span className={styles.counter}>{pageIndex + 1} / {pageCount}</span>
        <button type="button" onClick={() => go(1)} disabled={pageIndex >= pageCount - 1} aria-label="Next page"><ChevronRight size={18} /></button>
        <span className={styles.hint}>Drag: laser · Click / → : next · Esc: exit</span>
        <button type="button" onClick={close} aria-label="End presentation"><X size={18} /></button>
      </div>
      <LaserOverlay zIndex={10001} />
    </div>
  );
}
