/**
 * Presentation mode: one page at a time, full screen on black.
 *
 * Like PowerPoint's slide show: point with the laser, or write on the page
 * with a pen or highlighter and erase it again. Ink drawn here is kept aside;
 * when the show ends and there is ink, you choose to keep it (added to the
 * document as annotations, one undo step) or discard it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eraser, Highlighter, Pen, Pointer, Trash2, Undo2, X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore, makeAddAction, makeBatchAction } from '../../store/historyStore';
import { getDocumentProxy } from '../../pdf/documentManager';
import { createPageTransform, screenPointsToPdf, screenToPdf, type PageTransform } from '../../pdf/coordinateTransform';
import { isMultiplyAnnotation, renderAnnotations } from '../../pdf/annotationRenderer';
import { hitTestAnnotation } from '../../pdf/annotationHitTest';
import { simplifyInkPoints, stabilizePoints } from '../../pdf/inkGeometry';
import type { Annotation, InputPoint } from '../../types/annotations';
import { nanoid } from '../../utils/nanoid';
import { addLaserPoint, clearLaser, endLaserTrail, startLaserTrail } from '../Laser/laserTrail';
import { LaserOverlay } from '../Laser/LaserOverlay';
import { ERASER_CURSOR, HIGHLIGHTER_CURSOR, LASER_CURSOR, PEN_CURSOR } from '../AnnotationCanvas/toolCursors';
import styles from './PresentationView.module.css';

const EMPTY: Annotation[] = [];
const MAX_CANVAS_PIXELS = 16_000_000;
const CLICK_SLOP_PX = 6;
const CONTROLS_HIDE_MS = 2200;

export type ShowTool = 'laser' | 'pen' | 'highlighter' | 'eraser';

const PEN_COLORS = ['#e63946', '#1d4ed8', '#16a34a', '#111111', '#ffffff'];
const HIGHLIGHT_COLORS = ['#ffeb3b', '#7bed9f', '#74c0fc', '#ffa8a8'];

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
  const [tool, setToolState] = useState<ShowTool>('laser');
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [inkVersion, setInkVersion] = useState(0);
  const [keepPrompt, setKeepPrompt] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const highlightCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(pageIndex);
  pageRef.current = pageIndex;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  /** Where the current page is drawn (set once it has rendered). */
  const view = useRef<{ page: number; transform: PageTransform; dpr: number } | null>(null);
  /** Ink drawn during the show, per page, not yet in the document. */
  const sessionInk = useRef(new Map<number, Annotation[]>());
  const undoStack = useRef<{ page: number; before: Annotation[] }[]>([]);
  const livePoints = useRef<InputPoint[]>([]);
  const closingRef = useRef(false);

  const annotations = useAnnotationStore(
    (s) => (docId ? s.docAnnotations.get(docId)?.pages.get(pageIndex)?.annotations : undefined) ?? EMPTY,
  );

  const inkCount = () => [...sessionInk.current.values()].reduce((n, list) => n + list.length, 0);

  const finishClose = useCallback((keep: boolean) => {
    clearLaser();
    if (docId && keep) {
      const added = [...sessionInk.current.values()].flat();
      if (added.length) {
        const store = useAnnotationStore.getState();
        for (const ann of added) store.addAnnotation(docId, ann);
        const actions = added.map((ann) => makeAddAction(docId, ann));
        useHistoryStore.getState().push(actions.length === 1 ? actions[0] : makeBatchAction(docId, actions));
      }
    }
    sessionInk.current.clear();
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

  /** End the show; ask first when there is ink to keep. */
  const close = useCallback(() => {
    if (closingRef.current) return;
    if (inkCount() > 0) {
      closingRef.current = true;
      setKeepPrompt(true);
      return;
    }
    finishClose(false);
  }, [finishClose]);

  const go = useCallback((delta: number) => {
    livePoints.current = [];
    setPageIndex((p) => Math.max(0, Math.min(pageCount - 1, p + delta)));
  }, [pageCount]);

  const setTool = useCallback((next: ShowTool) => {
    livePoints.current = [];
    pointer.current = null;
    endLaserTrail();
    setToolState(next);
  }, []);

  // ── Session ink ────────────────────────────────────────────────────────

  const paintInk = useCallback(() => {
    const v = view.current;
    const hl = highlightCanvasRef.current;
    const ink = inkCanvasRef.current;
    const pageCanvas = canvasRef.current;
    if (!v || !hl || !ink || !pageCanvas || v.page !== pageRef.current) return;
    for (const c of [hl, ink]) {
      if (c.width !== pageCanvas.width || c.height !== pageCanvas.height) {
        c.width = pageCanvas.width;
        c.height = pageCanvas.height;
      }
      c.style.width = pageCanvas.style.width;
      c.style.height = pageCanvas.style.height;
      const ctx = c.getContext('2d');
      ctx?.setTransform(1, 0, 0, 1, 0, 0);
      ctx?.clearRect(0, 0, c.width, c.height);
    }
    const list = [...(sessionInk.current.get(v.page) ?? [])];
    const live = buildLiveInk(v.transform);
    if (live) list.push(live);
    const hctx = hl.getContext('2d');
    const ictx = ink.getContext('2d');
    if (hctx) renderAnnotations(hctx, list.filter(isMultiplyAnnotation), v.transform, v.dpr);
    if (ictx) renderAnnotations(ictx, list.filter((a) => !isMultiplyAnnotation(a)), v.transform, v.dpr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildLiveInk(transform: PageTransform, finished = false): Annotation | null {
    const pts = livePoints.current;
    const kind = toolRef.current;
    if (kind !== 'pen' && kind !== 'highlighter') return null;
    if (pts.length < (kind === 'highlighter' ? 2 : 1)) return null;
    const options = useUIStore.getState().toolOptions;
    const now = Date.now();
    const base = { id: finished ? nanoid() : 'live', pageIndex: pageRef.current, locked: false, createdAt: now, updatedAt: now };
    if (kind === 'highlighter') {
      let points = screenPointsToPdf(pts, transform);
      if (finished) points = simplifyInkPoints(points, 0.35 / transform.scale);
      return { ...base, type: 'highlight', points, color: highlightColorRef.current, width: options.highlighter.width, opacity: 0.4 };
    }
    let points = screenPointsToPdf(stabilizePoints(pts, options.pen.stabilizer), transform);
    if (finished) points = simplifyInkPoints(points, 0.35 / transform.scale, options.pen.pressureSensitive ? options.pen.width * 0.7 : 0);
    return {
      ...base, type: 'stroke', points, color: penColorRef.current, width: Math.max(2, options.pen.width), opacity: 1,
      smooth: true, pressure: options.pen.pressureSensitive,
    };
  }
  const penColorRef = useRef(penColor);
  penColorRef.current = penColor;
  const highlightColorRef = useRef(highlightColor);
  highlightColorRef.current = highlightColor;

  const changeInk = useCallback((page: number, next: Annotation[]) => {
    undoStack.current.push({ page, before: sessionInk.current.get(page) ?? [] });
    if (next.length) sessionInk.current.set(page, next);
    else sessionInk.current.delete(page);
    setInkVersion((n) => n + 1);
  }, []);

  const undoInk = useCallback(() => {
    const last = undoStack.current.pop();
    if (!last) return;
    if (last.before.length) sessionInk.current.set(last.page, last.before);
    else sessionInk.current.delete(last.page);
    if (last.page !== pageRef.current) setPageIndex(last.page);
    setInkVersion((n) => n + 1);
  }, []);

  const clearPageInk = useCallback(() => {
    const page = pageRef.current;
    if ((sessionInk.current.get(page) ?? []).length) changeInk(page, []);
  }, [changeInk]);

  useEffect(() => { paintInk(); }, [inkVersion, pageIndex, paintInk]);

  // ── Window, keys, controls ────────────────────────────────────────────

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
      if (keepPrompt) {
        if (e.key === 'Enter') finishClose(true);
        else if (e.key === 'Escape') finishClose(false);
        else return;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'];
      const prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'];
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'z') undoInk();
      else if (e.metaKey || e.ctrlKey || e.altKey) return;
      else if (e.key === 'Escape') close();
      else if (next.includes(e.key)) go(1);
      else if (prev.includes(e.key)) go(-1);
      else if (e.key === 'Home') setPageIndex(0);
      else if (e.key === 'End') setPageIndex(Math.max(0, pageCount - 1));
      else if (k === 'l') setTool('laser');
      else if (k === 'd') setTool('pen');
      else if (k === 'h') setTool('highlighter');
      else if (k === 'e') setTool('eraser');
      else if (k === 'c') clearPageInk();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, go, pageCount, keepPrompt, finishClose, undoInk, setTool, clearPageInk]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
  }, []);
  useEffect(() => {
    showControls();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [showControls, tool]);

  // ── Page rendering ────────────────────────────────────────────────────

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
        view.current = { page: pageIndex, transform, dpr };
        paintInk();
      };
      paint();
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageIndex, size.width, size.height, annotations, paintInk]);

  // ── Pointer ───────────────────────────────────────────────────────────

  function localPoint(clientX: number, clientY: number, pressure: number, time: number): InputPoint | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top, pressure: pressure > 0 ? pressure : 0.5, timestamp: time };
  }

  function eraseAt(clientX: number, clientY: number) {
    const v = view.current;
    const local = localPoint(clientX, clientY, 0.5, 0);
    if (!v || !local || v.page !== pageRef.current) return;
    const p = screenToPdf(local.x, local.y, v.transform);
    const list = sessionInk.current.get(v.page) ?? [];
    const tolerance = 10 / v.transform.scale;
    const keep = list.filter((a) => !hitTestAnnotation(p, a, tolerance));
    if (keep.length !== list.length) changeInk(v.page, keep);
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, [data-keep-prompt]')) return;
    const eraserEnd = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (e.button !== 0 && !eraserEnd) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    const mode = eraserEnd ? 'eraser' : toolRef.current;
    if (mode === 'laser') {
      startLaserTrail(e.clientX, e.clientY, e.timeStamp);
    } else if (mode === 'eraser') {
      eraseAt(e.clientX, e.clientY);
    } else {
      const p = localPoint(e.clientX, e.clientY, e.pressure, e.timeStamp);
      livePoints.current = p ? [p] : [];
      paintInk();
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p) {
      if (toolRef.current === 'laser' || e.clientY > window.innerHeight - 120) showControls();
      return;
    }
    if (p.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) p.moved = true;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const eraserEnd = e.pointerType === 'pen' && (e.buttons & 32) !== 0;
    const mode = eraserEnd ? 'eraser' : toolRef.current;
    if (mode === 'laser') {
      for (const ev of events) addLaserPoint(ev.clientX, ev.clientY, ev.timeStamp);
    } else if (mode === 'eraser') {
      for (const ev of events) eraseAt(ev.clientX, ev.clientY);
    } else {
      for (const ev of events) {
        const q = localPoint(ev.clientX, ev.clientY, ev.pressure, ev.timeStamp);
        if (q) livePoints.current.push(q);
      }
      paintInk();
    }
  };

  const endPointer = (e: React.PointerEvent | null) => {
    const p = pointer.current;
    if (!p || (e && p.id !== e.pointerId)) return;
    pointer.current = null;
    const mode = toolRef.current;
    if (mode === 'laser') {
      endLaserTrail(e?.timeStamp);
      if (e && !p.moved) {
        clearLaser();
        go(e.clientX < window.innerWidth * 0.2 ? -1 : 1);
      }
      return;
    }
    if (mode === 'pen' || mode === 'highlighter') {
      const v = view.current;
      const ann = v && v.page === pageRef.current ? buildLiveInk(v.transform, true) : null;
      livePoints.current = [];
      if (ann) changeInk(ann.pageIndex, [...(sessionInk.current.get(ann.pageIndex) ?? []), ann]);
      else paintInk();
    }
  };

  const cursor = !controlsVisible && tool === 'laser'
    ? undefined
    : tool === 'pen' ? PEN_CURSOR : tool === 'highlighter' ? HIGHLIGHTER_CURSOR : tool === 'eraser' ? ERASER_CURSOR : LASER_CURSOR;
  const colors = tool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS;
  const activeColor = tool === 'highlighter' ? highlightColor : penColor;
  const pageHasInk = (sessionInk.current.get(pageIndex)?.length ?? 0) > 0;
  void inkVersion; // re-render when ink changes (undo / clear buttons)

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${cursor ? '' : styles.hideCursor}`}
      style={cursor ? { cursor } : undefined}
      role="dialog"
      aria-label="Presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={() => { endPointer(null); endLaserTrail(); }}
      onContextMenu={(e) => { e.preventDefault(); go(-1); }}
    >
      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.page} />
        <canvas ref={highlightCanvasRef} className={styles.inkLayer} style={{ mixBlendMode: 'multiply' }} />
        <canvas ref={inkCanvasRef} className={styles.inkLayer} />
      </div>

      <div className={`${styles.controls} ${controlsVisible || tool !== 'laser' ? styles.controlsVisible : ''}`}>
        <button type="button" onClick={() => go(-1)} disabled={pageIndex === 0} aria-label="Previous page"><ChevronLeft size={18} /></button>
        <span className={styles.counter}>{pageIndex + 1} / {pageCount}</span>
        <button type="button" onClick={() => go(1)} disabled={pageIndex >= pageCount - 1} aria-label="Next page"><ChevronRight size={18} /></button>
        <span className={styles.divider} />
        <ToolButton label="Laser (L)" active={tool === 'laser'} onClick={() => setTool('laser')}><Pointer size={17} /></ToolButton>
        <ToolButton label="Pen (D)" active={tool === 'pen'} onClick={() => setTool('pen')}><Pen size={17} /></ToolButton>
        <ToolButton label="Highlighter (H)" active={tool === 'highlighter'} onClick={() => setTool('highlighter')}><Highlighter size={17} /></ToolButton>
        <ToolButton label="Eraser (E)" active={tool === 'eraser'} onClick={() => setTool('eraser')}><Eraser size={17} /></ToolButton>
        {(tool === 'pen' || tool === 'highlighter') && (
          <>
            <span className={styles.divider} />
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.swatch} ${activeColor === c ? styles.swatchActive : ''}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                aria-pressed={activeColor === c}
                onClick={() => (tool === 'highlighter' ? setHighlightColor(c) : setPenColor(c))}
              />
            ))}
          </>
        )}
        <span className={styles.divider} />
        <button type="button" onClick={undoInk} disabled={undoStack.current.length === 0} aria-label="Undo ink (⌘Z)" title="Undo ink (⌘Z)"><Undo2 size={17} /></button>
        <button type="button" onClick={clearPageInk} disabled={!pageHasInk} aria-label="Erase all ink on this page (C)" title="Erase all ink on this page (C)"><Trash2 size={17} /></button>
        <span className={styles.divider} />
        <button type="button" onClick={close} aria-label="End presentation" title="End presentation (Esc)"><X size={18} /></button>
      </div>

      {keepPrompt && (
        <div className={styles.promptBackdrop} data-keep-prompt>
          <div className={styles.prompt} role="alertdialog" aria-label="Keep ink annotations?">
            <p className={styles.promptTitle}>Keep your ink annotations?</p>
            <p className={styles.promptText}>What you wrote during the presentation can be added to the document.</p>
            <div className={styles.promptButtons}>
              <button type="button" className={styles.promptSecondary} onClick={() => finishClose(false)}>Discard</button>
              <button type="button" className={styles.promptPrimary} onClick={() => finishClose(true)} autoFocus>Keep</button>
            </div>
          </div>
        </div>
      )}

      <LaserOverlay zIndex={10001} />
    </div>
  );
}

function ToolButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={active ? 'active' : undefined} data-active={active || undefined} aria-pressed={active} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}
