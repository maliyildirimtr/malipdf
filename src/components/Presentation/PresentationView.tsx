/**
 * Presentation mode: one page at a time, full screen on black.
 *
 * Like PowerPoint's slide show: point with the laser, or write on the page
 * with a pen or highlighter and erase it again. Ink drawn here is kept aside;
 * when the show ends and there is ink, you choose to keep it (added to the
 * document as annotations, one undo step) or discard it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, ChevronUp, Circle, Eraser, Highlighter, Minus, Pen, Pointer, Settings2, Square, Trash2, Type, Undo2, X, type LucideIcon } from 'lucide-react';
import { useUIStore, PRESENTATION_TOOLS, type PresentationTool } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore, makeAddAction, makeBatchAction } from '../../store/historyStore';
import { getDocumentProxy } from '../../pdf/documentManager';
import { createPageTransform, screenPointsToPdf, screenToPdf, type PageTransform } from '../../pdf/coordinateTransform';
import { isMultiplyAnnotation, renderAnnotations } from '../../pdf/annotationRenderer';
import { hitTestAnnotation } from '../../pdf/annotationHitTest';
import { simplifyInkPoints, stabilizePoints } from '../../pdf/inkGeometry';
import type { Annotation, InputPoint, TextAnnotation } from '../../types/annotations';
import { autoSizeTextBox, canvasMeasure, cssFont, PDF_TEXT_CSS } from '../../pdf/textLayout';
import { nanoid } from '../../utils/nanoid';
import { addLaserPoint, clearLaser, endLaserTrail, startLaserTrail } from '../Laser/laserTrail';
import { LaserOverlay } from '../Laser/LaserOverlay';
import { ERASER_CURSOR, HIGHLIGHTER_CURSOR, LASER_CURSOR, PEN_CURSOR } from '../AnnotationCanvas/toolCursors';
import styles from './PresentationView.module.css';

const EMPTY: Annotation[] = [];
const MAX_CANVAS_PIXELS = 16_000_000;
const CLICK_SLOP_PX = 6;
const CONTROLS_HIDE_MS = 2200;

type ShapeTool = 'line' | 'arrow' | 'rectangle' | 'ellipse';
/** The active tool; shapes are picked from the Shapes menu. */
export type ShowTool = Exclude<PresentationTool, 'shapes'> | ShapeTool;

/** The ribbon's drag shapes (polygon needs clicks, so it is not offered here). */
const SHAPES: ReadonlyArray<{ tool: ShapeTool; label: string; icon: LucideIcon }> = [
  { tool: 'line', label: 'Line', icon: Minus },
  { tool: 'arrow', label: 'Arrow', icon: ArrowRight },
  { tool: 'rectangle', label: 'Rectangle', icon: Square },
  { tool: 'ellipse', label: 'Ellipse', icon: Circle },
];
const isShapeTool = (tool: ShowTool): tool is ShapeTool => SHAPES.some((x) => x.tool === tool);

const TOOL_BUTTONS: Record<Exclude<PresentationTool, 'shapes'>, { label: string; icon: LucideIcon }> = {
  laser: { label: 'Laser (L)', icon: Pointer },
  pen: { label: 'Pen (D)', icon: Pen },
  highlighter: { label: 'Highlighter (H)', icon: Highlighter },
  eraser: { label: 'Eraser (E)', icon: Eraser },
  text: { label: 'Text', icon: Type },
};
const TOOL_NAMES: Record<PresentationTool, string> = {
  laser: 'Laser', pen: 'Pen', highlighter: 'Highlighter', eraser: 'Eraser', text: 'Text', shapes: 'Shapes',
};

const PEN_COLORS = ['#e63946', '#1d4ed8', '#16a34a', '#111111', '#ffffff'];
const HIGHLIGHT_COLORS = ['#ffeb3b', '#7bed9f', '#74c0fc', '#ffa8a8'];

/** Shift: squares and circles; lines and arrows in 45° steps (as on the page). */
function constrainEnd(tool: ShapeTool, start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (tool === 'rectangle' || tool === 'ellipse') {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + (dx < 0 ? -1 : 1) * d, y: start.y + (dy < 0 ? -1 : 1) * d };
  }
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const dist = Math.hypot(dx, dy);
  return { x: start.x + Math.cos(angle) * dist, y: start.y + Math.sin(angle) * dist };
}

interface TextDraft { clientX: number; clientY: number; pdfX: number; pdfY: number; page: number; scale: number }

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
  // Colours, widths and styles are the main toolbar's: a change here shows there too.
  const toolOptions = useUIStore((s) => s.toolOptions);
  const lastShapeTool = useUIStore((s) => s.lastShapeTool);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const textCommitted = useRef(false);
  const [inkVersion, setInkVersion] = useState(0);
  const [keepPrompt, setKeepPrompt] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const shownTools = useUIStore((s) => s.presentationTools);
  const togglePresentationTool = useUIStore((s) => s.togglePresentationTool);
  const resetPresentationTools = useUIStore((s) => s.resetPresentationTools);

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
    setShapeMenuOpen(false);
    // Same tool in the main toolbar, so each tool uses (and changes) the same settings.
    if (next !== 'laser') useUIStore.getState().setActiveTool(next);
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
    if (isShapeTool(kind)) {
      if (pts.length < 2) return null;
      const start = pts[0];
      const end = shiftRef.current ? constrainEnd(kind, start, pts[pts.length - 1]) : pts[pts.length - 1];
      if (Math.hypot(end.x - start.x, end.y - start.y) < 4) return null;
      const now = Date.now();
      const shape = useUIStore.getState().toolOptions.shape;
      return {
        id: finished ? nanoid() : 'live', pageIndex: pageRef.current, locked: false, createdAt: now, updatedAt: now,
        type: 'shape', shapeKind: kind,
        startPoint: screenToPdf(start.x, start.y, transform),
        endPoint: screenToPdf(end.x, end.y, transform),
        color: shape.color, opacity: shape.opacity,
        strokeWidth: shape.strokeWidth, borderStyle: shape.borderStyle, fillColor: shape.fillColor, cornerRadius: 8,
      };
    }
    if (kind !== 'pen' && kind !== 'highlighter') return null;
    if (pts.length < (kind === 'highlighter' ? 2 : 1)) return null;
    const options = useUIStore.getState().toolOptions;
    const now = Date.now();
    const base = { id: finished ? nanoid() : 'live', pageIndex: pageRef.current, locked: false, createdAt: now, updatedAt: now };
    if (kind === 'highlighter') {
      let points = screenPointsToPdf(pts, transform);
      if (finished) points = simplifyInkPoints(points, 0.35 / transform.scale);
      return { ...base, type: 'highlight', points, color: options.highlighter.color, width: options.highlighter.width, opacity: options.highlighter.opacity };
    }
    let points = screenPointsToPdf(stabilizePoints(pts, options.pen.stabilizer), transform);
    if (finished) points = simplifyInkPoints(points, 0.35 / transform.scale, options.pen.pressureSensitive ? options.pen.width * 0.7 : 0);
    return {
      ...base, type: 'stroke', points, color: options.pen.color, width: options.pen.width, opacity: options.pen.opacity,
      smooth: options.pen.smooth, pressure: options.pen.pressureSensitive, penStyle: options.pen.penStyle,
    };
  }
  const shiftRef = useRef(false);

  // ── Text ──────────────────────────────────────────────────────────────

  const commitText = useCallback((draft: TextDraft, content: string) => {
    if (textCommitted.current) return;
    textCommitted.current = true;
    setTextDraft(null);
    if (!content.trim()) return;
    const style = useUIStore.getState().toolOptions.text;
    const size = autoSizeTextBox({ content, fontSize: style.fontSize, listStyle: style.listStyle }, canvasMeasure(style));
    const now = Date.now();
    const ann: TextAnnotation = {
      id: nanoid(), pageIndex: draft.page, type: 'text',
      bounds: { x: draft.pdfX, y: draft.pdfY - size.height, width: size.width, height: size.height },
      content,
      fontFamily: style.fontFamily, fontSize: style.fontSize, bold: style.bold, italic: style.italic, underline: style.underline,
      align: style.align, color: style.color, backgroundColor: style.backgroundColor,
      borderColor: style.borderColor, borderWidth: style.borderWidth, listStyle: style.listStyle,
      opacity: 1, locked: false, createdAt: now, updatedAt: now,
    };
    changeInk(draft.page, [...(sessionInk.current.get(draft.page) ?? []), ann]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      shiftRef.current = e.shiftKey;
      if ((e.target as HTMLElement | null)?.tagName === 'TEXTAREA') return;
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
      else if (k === 't') setTool('text');
      else if (k === 'c') clearPageInk();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyUp = (e: KeyboardEvent) => { shiftRef.current = e.shiftKey; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
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
    if ((e.target as HTMLElement).closest('button, textarea, [data-keep-prompt], [data-show-menu]')) return;
    setShapeMenuOpen(false);
    shiftRef.current = e.shiftKey;
    const eraserEnd = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (e.button !== 0 && !eraserEnd) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    const mode = eraserEnd ? 'eraser' : toolRef.current;
    if (mode === 'text') {
      pointer.current = null;
      const v = view.current;
      const local = localPoint(e.clientX, e.clientY, 0.5, 0);
      if (!v || !local || v.page !== pageRef.current || textDraft) return;
      e.preventDefault();
      const pdf = screenToPdf(local.x, local.y, v.transform);
      textCommitted.current = false;
      setTextDraft({ clientX: e.clientX, clientY: e.clientY, pdfX: pdf.x, pdfY: pdf.y, page: v.page, scale: v.transform.scale });
      return;
    }
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
    shiftRef.current = e.shiftKey;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) p.moved = true;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const eraserEnd = e.pointerType === 'pen' && (e.buttons & 32) !== 0;
    const mode = eraserEnd ? 'eraser' : toolRef.current;
    if (mode === 'laser') {
      for (const ev of events) addLaserPoint(ev.clientX, ev.clientY, ev.timeStamp);
    } else if (mode === 'eraser') {
      for (const ev of events) eraseAt(ev.clientX, ev.clientY);
    } else if (isShapeTool(mode)) {
      const q = localPoint(e.clientX, e.clientY, e.pressure, e.timeStamp);
      if (q) livePoints.current = [livePoints.current[0] ?? q, q];
      paintInk();
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
    if (mode === 'pen' || mode === 'highlighter' || isShapeTool(mode)) {
      const v = view.current;
      const ann = v && v.page === pageRef.current ? buildLiveInk(v.transform, true) : null;
      livePoints.current = [];
      if (ann) changeInk(ann.pageIndex, [...(sessionInk.current.get(ann.pageIndex) ?? []), ann]);
      else paintInk();
    }
  };

  const cursor = !controlsVisible && tool === 'laser'
    ? undefined
    : tool === 'text' ? 'text' : tool === 'pen' || isShapeTool(tool) ? PEN_CURSOR : tool === 'highlighter' ? HIGHLIGHTER_CURSOR : tool === 'eraser' ? ERASER_CURSOR : LASER_CURSOR;
  const colors = tool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS;
  const activeColor = tool === 'highlighter' ? toolOptions.highlighter.color
    : tool === 'text' ? toolOptions.text.color
      : isShapeTool(tool) ? toolOptions.shape.color : toolOptions.pen.color;
  const setColor = (color: string) => {
    const ui = useUIStore.getState();
    if (tool === 'highlighter') ui.updateHighlighterOptions({ color });
    else if (tool === 'text') ui.updateTextOptions({ color });
    else if (isShapeTool(tool)) ui.updateShapeOptions({ color });
    else ui.updatePenOptions({ color });
  };
  const currentShape: ShapeTool = isShapeTool(tool) ? tool : (SHAPES.some((x) => x.tool === lastShapeTool) ? lastShapeTool as ShapeTool : 'rectangle');
  const CurrentShapeIcon = SHAPES.find((x) => x.tool === currentShape)!.icon;
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

      <div className={`${styles.controls} ${controlsVisible || tool !== 'laser' || customizeOpen || shapeMenuOpen ? styles.controlsVisible : ''}`}>
        <button type="button" onClick={() => go(-1)} disabled={pageIndex === 0} aria-label="Previous page"><ChevronLeft size={18} /></button>
        <span className={styles.counter}>{pageIndex + 1} / {pageCount}</span>
        <button type="button" onClick={() => go(1)} disabled={pageIndex >= pageCount - 1} aria-label="Next page"><ChevronRight size={18} /></button>
        <span className={styles.divider} />
        {shownTools.map((t) => {
          if (t === 'shapes') {
            return (
              <div key={t} className={styles.customizeWrap} data-show-menu>
                <ToolButton label={SHAPES.find((x) => x.tool === currentShape)!.label} active={isShapeTool(tool)} onClick={() => setTool(currentShape)}>
                  <CurrentShapeIcon size={17} />
                </ToolButton>
                <button
                  type="button"
                  className={styles.disclosure}
                  onClick={() => setShapeMenuOpen((v) => !v)}
                  aria-expanded={shapeMenuOpen}
                  aria-label="Choose shape tool"
                  title="Choose shape tool"
                ><ChevronUp size={12} /></button>
                {shapeMenuOpen && (
                  <div className={`${styles.customizeMenu} ${styles.shapeMenu}`} role="menu" aria-label="Shapes">
                    {SHAPES.map(({ tool: shapeTool, label, icon: Icon }) => (
                      <button
                        key={shapeTool}
                        type="button"
                        role="menuitemradio"
                        aria-checked={tool === shapeTool}
                        data-active={tool === shapeTool || undefined}
                        className={styles.shapeItem}
                        onClick={() => setTool(shapeTool)}
                      >
                        <Icon size={17} /><span>{label}</span>
                      </button>
                    ))}
                    <div className={styles.menuHint}>Shift: square, circle, 45°</div>
                  </div>
                )}
              </div>
            );
          }
          const { label, icon: Icon } = TOOL_BUTTONS[t];
          return <ToolButton key={t} label={label} active={tool === t} onClick={() => setTool(t)}><Icon size={17} /></ToolButton>;
        })}
        {(tool === 'pen' || tool === 'highlighter' || tool === 'text' || isShapeTool(tool)) && (
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
                onClick={() => setColor(c)}
              />
            ))}
          </>
        )}
        <span className={styles.divider} />
        <button type="button" onClick={undoInk} disabled={undoStack.current.length === 0} aria-label="Undo ink (⌘Z)" title="Undo ink (⌘Z)"><Undo2 size={17} /></button>
        <button type="button" onClick={clearPageInk} disabled={!pageHasInk} aria-label="Erase all ink on this page (C)" title="Erase all ink on this page (C)"><Trash2 size={17} /></button>
        <span className={styles.divider} />
        <div className={styles.customizeWrap} data-show-menu>
          <button
            type="button"
            onClick={() => { setCustomizeOpen((v) => !v); setShapeMenuOpen(false); }}
            data-active={customizeOpen || undefined}
            aria-expanded={customizeOpen}
            aria-label="Customize toolbar"
            title="Customize toolbar"
          ><Settings2 size={17} /></button>
          {customizeOpen && (
            <div className={styles.customizeMenu} role="dialog" aria-label="Customize toolbar">
              <div className={styles.customizeTitle}>Show in toolbar</div>
              {PRESENTATION_TOOLS.map((t) => (
                <label key={t} className={styles.customizeItem}>
                  <input
                    type="checkbox"
                    checked={shownTools.includes(t)}
                    disabled={shownTools.length === 1 && shownTools.includes(t)}
                    onChange={() => togglePresentationTool(t)}
                  />
                  {TOOL_NAMES[t]}
                </label>
              ))}
              <button type="button" className={styles.customizeReset} onClick={resetPresentationTools}>Reset</button>
            </div>
          )}
        </div>
        <button type="button" onClick={close} aria-label="End presentation" title="End presentation (Esc)"><X size={18} /></button>
      </div>

      {textDraft && (
        <textarea
          className={styles.textDraft}
          autoFocus
          rows={1}
          style={{
            left: textDraft.clientX,
            top: textDraft.clientY,
            font: cssFont(toolOptions.text).replace(/(\d+(?:\.\d+)?)px/, (_, n) => `${Number(n) * textDraft.scale}px`),
            color: toolOptions.text.color,
            ...PDF_TEXT_CSS,
          }}
          aria-label="Text"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { textCommitted.current = true; setTextDraft(null); }
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitText(textDraft, e.currentTarget.value);
          }}
          onBlur={(e) => commitText(textDraft, e.currentTarget.value)}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
        />
      )}

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
