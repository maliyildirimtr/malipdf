/**
 * AnnotationCanvas
 *
 * Full interaction layer for a single PDF page.
 *
 * Canvas layer architecture (bottom to top):
 *   Layer 0: PDF canvas (rendered by PDFPage, below this component)
 *   Layer 1: annotationCanvasRef  — committed annotations (static, re-drawn on store change)
 *   Layer 2: drawingCanvasRef     — live preview (active stroke / shape / selection drag)
 *   Layer 3: interactionRef (div) — pointer events
 *
 * Tools and their interaction models:
 *   pen / highlighter  → pointer stream → screenPoints → commit to store as stroke/highlight
 *   eraser             → pointer move → hit test in PDF space → remove annotation on click
 *   line/arrow/rect/ellipse/roundedRect
 *                      → drag preview on drawing canvas → commit shape on pointer up
 *   text               → click → place <textarea> overlay → commit on Ctrl+Enter or blur
 *   select             → click (hit test) or drag (rubber-band) → show selection + handles
 *                        → move/resize selected annotations on drag
 *   hand               → drag pan (handled in DocumentArea, pass-through here)
 *
 * Performance contract:
 *   - Pointer events NEVER cause React state updates mid-gesture (uses refs)
 *   - drawingCanvasRef is cleared + redrawn via requestAnimationFrame
 *   - annotationCanvasRef re-renders on every React render (store change triggers re-render)
 *   - React state used only for: text editing overlay visibility, text cursor position
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  Annotation,
  InputPoint,
  ToolType,
  PdfPoint,
  ShapeKind,
} from '../../types/annotations';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore, makeAddAction, makeRemoveAction, makeMoveAction } from '../../store/historyStore';
import { useUIStore } from '../../store/uiStore';
import {
  pdfRectToScreenBounds,
  screenRectToPdfBounds,
  screenToPdf,
  screenPointsToPdf,
  pdfToScreen,
  type PageTransform,
} from '../../pdf/coordinateTransform';
import {
  renderAnnotations,
  renderActiveStroke,
  renderShapePreview,
  renderSelectionOverlay,
  renderSelectionRect,
} from '../../pdf/annotationRenderer';
import {
  hitTestAnnotations,
  hitTestResizeHandle,
  getAnnotationBounds,
  getResizeHandles,
  eraserHitTest,
  rectsIntersect,
} from '../../pdf/annotationHitTest';
import type { ResizeHandle } from '../../pdf/annotationHitTest';
import { nanoid } from '../../utils/nanoid';
import {
  computeSafeCanvasOutputScale,
  releaseCanvas,
} from '../../pdf/canvasMemory';
import { CANCEL_ACTIVE_INTERACTION_EVENT } from '../../commands';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnnotationCanvasProps {
  docId: string;
  pageIndex: number;
  transform: PageTransform;
  onInteractionPinChange?: (pinned: boolean) => void;
}

type InteractionMode =
  | 'idle'
  | 'drawing'       // pen / highlighter
  | 'shapeDrawing'  // shape tools dragging
  | 'erasing'       // eraser active
  | 'selectDrag'    // rubber-band selection
  | 'moving'        // moving selected annotations
  | 'resizing';     // resizing selected annotation

// ─── Text overlay state ───────────────────────────────────────────────────────

interface TextOverlay {
  x: number;   // CSS pixels (left)
  y: number;   // CSS pixels (top)
  pdfX: number;
  pdfY: number;
}

// ─── Cursor map ───────────────────────────────────────────────────────────────

function getCursor(tool: ToolType, mode: InteractionMode): string {
  if (mode === 'moving') return 'move';
  if (mode === 'resizing') return 'nwse-resize';
  switch (tool) {
    case 'hand':        return 'grab';
    case 'select':      return 'default';
    case 'pen':         return 'crosshair';
    case 'highlighter': return 'crosshair';
    case 'eraser':      return 'cell';
    case 'text':        return 'text';
    case 'line':
    case 'arrow':
    case 'rectangle':
    case 'roundedRect':
    case 'ellipse':     return 'crosshair';
    default:            return 'default';
  }
}

function toolToShapeKind(tool: ToolType): ShapeKind | null {
  switch (tool) {
    case 'line':        return 'line';
    case 'arrow':       return 'arrow';
    case 'rectangle':   return 'rectangle';
    case 'roundedRect': return 'roundedRect';
    case 'ellipse':     return 'ellipse';
    default:            return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const AnnotationCanvas = React.memo<AnnotationCanvasProps>(function AnnotationCanvas({
  docId,
  pageIndex,
  transform,
  onInteractionPinChange,
}) {
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef    = useRef<HTMLCanvasElement>(null);
  const interactionRef      = useRef<HTMLDivElement>(null);
  const textareaRef         = useRef<HTMLTextAreaElement>(null);

  // Interaction refs (no React re-renders during gestures)
  const mode             = useRef<InteractionMode>('idle');
  const activePoints     = useRef<InputPoint[]>([]);
  const shapeStart       = useRef<{ screenX: number; screenY: number; pdfX: number; pdfY: number } | null>(null);
  const selectionStart   = useRef<{ screenX: number; screenY: number } | null>(null);
  const currentEnd       = useRef<{ screenX: number; screenY: number }>({ screenX: 0, screenY: 0 });
  const selectedIds      = useRef<Set<string>>(new Set());
  const moveAnchor       = useRef<{ screenX: number; screenY: number; pdfX: number; pdfY: number } | null>(null);
  const moveBefore       = useRef<Map<string, Annotation>>(new Map());
  const resizeHandle     = useRef<ResizeHandle | null>(null);
  const resizeBefore     = useRef<Annotation | null>(null);
  const rafId            = useRef<number | null>(null);
  const pendingRender    = useRef(false);
  const textEditingRef   = useRef(false);
  const suppressTextBlurCommitRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const gestureToolRef   = useRef<ToolType | null>(null);
  const selectionBefore  = useRef<Set<string>>(new Set());

  // React state only for text overlay (needs DOM update)
  const [textOverlay, setTextOverlay] = useState<TextOverlay | null>(null);

  const { toolOptions, activeTool, temporaryTool, setIsDrawing } = useUIStore();
  const interactionTool = temporaryTool ?? activeTool;
  const { addAnnotation, removeAnnotation, replaceAnnotation, getPageAnnotations } = useAnnotationStore();
  const { push: pushHistory } = useHistoryStore();

  const { scale, cssWidth: width, cssHeight: height } = transform;
  const dpr = computeSafeCanvasOutputScale(
    width,
    height,
    window.devicePixelRatio || 1,
  );

  // ── Canvas sizing ─────────────────────────────────────────────────────────

  function sizeCanvas(canvas: HTMLCanvasElement | null) {
    if (!canvas) return;
    canvas.width  = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  useEffect(() => {
    sizeCanvas(annotationCanvasRef.current);
    sizeCanvas(drawingCanvasRef.current);
    redrawAnnotationLayer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, dpr]);

  // ── Annotation layer (completed annotations + selection overlay) ──────────

  const redrawAnnotationLayer = useCallback(() => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const annotations = getPageAnnotations(docId, pageIndex);
    renderAnnotations(ctx, annotations, transform, dpr);

    // Draw selection overlays for selected annotations
    if (selectedIds.current.size > 0) {
      for (const id of selectedIds.current) {
        const ann = annotations.find(a => a.id === id);
        if (!ann) continue;

        const bounds = getAnnotationBounds(ann);
        const screenBounds = pdfRectToScreenBounds(bounds, transform);

        // Convert PDF-space handle positions to screen
        const handles = getResizeHandles(bounds).map(h => pdfToScreen(h.x, h.y, transform));
        renderSelectionOverlay(ctx, screenBounds, handles, dpr);
      }
    }
  }, [docId, pageIndex, transform, dpr, getPageAnnotations]);

  // Re-render whenever store or selection changes
  useEffect(() => {
    redrawAnnotationLayer();
  });

  // ── Drawing canvas helpers ────────────────────────────────────────────────

  function clearDrawingCanvas() {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function schedulePreviewRender() {
    if (pendingRender.current) return;
    pendingRender.current = true;
    rafId.current = requestAnimationFrame(() => {
      pendingRender.current = false;
      renderPreview();
    });
  }

  function renderPreview() {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const m = mode.current;

    if (m === 'drawing') {
      const pts = activePoints.current;
      if (pts.length < 2) return;
      const isHL = (gestureToolRef.current ?? interactionTool) === 'highlighter';
      renderActiveStroke(
        ctx, pts,
        isHL ? toolOptions.highlighter.color : toolOptions.pen.color,
        (isHL ? toolOptions.highlighter.width : toolOptions.pen.width) * scale,
        isHL ? toolOptions.highlighter.opacity : toolOptions.pen.opacity,
        isHL,
        dpr,
      );
    } else if (m === 'shapeDrawing' && shapeStart.current) {
      const { screenX: sx, screenY: sy } = shapeStart.current;
      const { screenX: ex, screenY: ey } = currentEnd.current;
      const sk = toolToShapeKind(gestureToolRef.current ?? interactionTool)!;
      renderShapePreview(
        ctx, sk, sx, sy, ex, ey,
        toolOptions.shape.color,
        toolOptions.shape.strokeWidth * scale,
        toolOptions.shape.fillColor,
        toolOptions.shape.opacity,
        dpr,
      );
    } else if (m === 'selectDrag' && selectionStart.current) {
      const { screenX: sx, screenY: sy } = selectionStart.current;
      const { screenX: ex, screenY: ey } = currentEnd.current;
      renderSelectionRect(ctx, sx, sy, ex, ey, dpr);
    }
  }

  // ── Pointer helpers ───────────────────────────────────────────────────────

  function getPagePoint(e: React.PointerEvent<HTMLDivElement> | PointerEvent): { screenX: number; screenY: number } {
    const rect = interactionRef.current!.getBoundingClientRect();
    return { screenX: e.clientX - rect.left, screenY: e.clientY - rect.top };
  }

  function getInputPoint(e: React.PointerEvent<HTMLDivElement>): InputPoint {
    const { screenX, screenY } = getPagePoint(e);
    return { x: screenX, y: screenY, pressure: e.pressure > 0 ? e.pressure : 0.5, timestamp: e.timeStamp };
  }

  function screenToPdfPoint(screenX: number, screenY: number): PdfPoint {
    return screenToPdf(screenX, screenY, transform);
  }

  // ── Pointer down ──────────────────────────────────────────────────────────

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return; // left button only
    
    // Pass through to DocumentArea for panning
    if (interactionTool === 'hand') return;

    e.preventDefault();
    interactionRef.current?.setPointerCapture(e.pointerId);
    activePointerIdRef.current = e.pointerId;
    gestureToolRef.current = interactionTool;
    setIsDrawing(true);
    onInteractionPinChange?.(true);

    const { screenX, screenY } = getPagePoint(e);
    const pdfPt = screenToPdfPoint(screenX, screenY);

    // ── Pen / Highlighter ──
    if (interactionTool === 'pen' || interactionTool === 'highlighter') {
      mode.current = 'drawing';
      activePoints.current = [{ x: screenX, y: screenY, pressure: e.pressure > 0 ? e.pressure : 0.5, timestamp: e.timeStamp }];
      schedulePreviewRender();
      return;
    }

    // ── Eraser ──
    if (interactionTool === 'eraser') {
      mode.current = 'erasing';
      doErase(pdfPt);
      return;
    }

    // ── Shape tools ──
    const shapeKind = toolToShapeKind(interactionTool);
    if (shapeKind) {
      mode.current = 'shapeDrawing';
      shapeStart.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
      currentEnd.current = { screenX, screenY };
      schedulePreviewRender();
      return;
    }

    // ── Text ──
    if (interactionTool === 'text') {
      openTextOverlay(screenX, screenY, pdfPt.x, pdfPt.y);
      return;
    }

    // ── Select ──
    if (interactionTool === 'select') {
      const annotations = getPageAnnotations(docId, pageIndex);

      // First: check if clicking on a resize handle of a selected annotation
      if (selectedIds.current.size === 1) {
        const [selId] = selectedIds.current;
        const selAnn = annotations.find(a => a.id === selId);
        if (selAnn) {
          const bounds = getAnnotationBounds(selAnn);
          const handles = getResizeHandles(bounds);
          const hit = hitTestResizeHandle(pdfPt, handles, transform);
          if (hit) {
            mode.current = 'resizing';
            resizeHandle.current = hit;
            resizeBefore.current = selAnn;
            return;
          }
        }
      }

      // Second: hit-test annotations
      const hit = hitTestAnnotations(pdfPt, annotations, transform);
      if (hit) {
        // If not already selected, replace selection
        if (!selectedIds.current.has(hit.id)) {
          selectedIds.current = new Set([hit.id]);
        }
        // Start move
        mode.current = 'moving';
        moveAnchor.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
        // Snapshot annotations before move
        moveBefore.current = new Map();
        for (const id of selectedIds.current) {
          const ann = annotations.find(a => a.id === id);
          if (ann) moveBefore.current.set(id, structuredClone(ann));
        }
      } else {
        // Start rubber-band selection
        selectionBefore.current = new Set(selectedIds.current);
        selectedIds.current = new Set();
        mode.current = 'selectDrag';
        selectionStart.current = { screenX, screenY };
        currentEnd.current = { screenX, screenY };
        schedulePreviewRender();
      }
      return;
    }

    // ── Hand ── (DocumentArea handles panning, we pass through)
  }

  // ── Pointer move ──────────────────────────────────────────────────────────

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const m = mode.current;
    if (m === 'idle') return;
    e.preventDefault();

    const { screenX, screenY } = getPagePoint(e);
    const pdfPt = screenToPdfPoint(screenX, screenY);

    if (m === 'drawing') {
      // Use coalesced events for stylus fidelity
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      const rect = interactionRef.current!.getBoundingClientRect();
      for (const ev of events) {
        activePoints.current.push({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          pressure: ev.pressure > 0 ? ev.pressure : 0.5,
          timestamp: ev.timeStamp,
        });
      }
      schedulePreviewRender();
      return;
    }

    if (m === 'erasing') {
      doErase(pdfPt);
      return;
    }

    if (m === 'shapeDrawing') {
      currentEnd.current = { screenX, screenY };
      schedulePreviewRender();
      return;
    }

    if (m === 'selectDrag') {
      currentEnd.current = { screenX, screenY };
      schedulePreviewRender();
      return;
    }

    if (m === 'moving' && moveAnchor.current) {
      const dx = pdfPt.x - moveAnchor.current.pdfX;
      const dy = pdfPt.y - moveAnchor.current.pdfY;
      moveAnchor.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
      moveSelectedAnnotations(dx, dy);
      return;
    }

    if (m === 'resizing' && resizeHandle.current && resizeBefore.current) {
      resizeAnnotation(pdfPt);
      return;
    }
  }

  // ── Pointer up ────────────────────────────────────────────────────────────

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const m = mode.current;
    if (interactionRef.current?.hasPointerCapture(e.pointerId)) {
      interactionRef.current.releasePointerCapture(e.pointerId);
    }
    activePointerIdRef.current = null;
    e.preventDefault();
    clearDrawingCanvas();

    if (m === 'drawing') {
      commitStroke();
    } else if (m === 'shapeDrawing') {
      commitShape();
    } else if (m === 'selectDrag') {
      commitRubberBand();
    } else if (m === 'moving') {
      commitMove();
    } else if (m === 'resizing') {
      commitResize();
    }

    mode.current = 'idle';
    shapeStart.current = null;
    selectionStart.current = null;
    moveAnchor.current = null;
    resizeHandle.current = null;
    resizeBefore.current = null;
    activePoints.current = [];
    gestureToolRef.current = null;
    selectionBefore.current = new Set();
    moveBefore.current.clear();
    setIsDrawing(textEditingRef.current);
    if (!textEditingRef.current) onInteractionPinChange?.(false);
  }

  function onPointerCancel() {
    cancelActiveInteraction();
  }

  // ── Stroke commit ─────────────────────────────────────────────────────────

  function commitStroke() {
    const screenPts = activePoints.current;
    if (screenPts.length < 2) return;

    const pdfPts = screenPointsToPdf(screenPts, transform);
    const id = nanoid();
    const now = Date.now();

    if (gestureToolRef.current === 'highlighter') {
      const ann = {
        id, pageIndex, type: 'highlight' as const,
        points: pdfPts,
        color: toolOptions.highlighter.color,
        width: toolOptions.highlighter.width,
        opacity: toolOptions.highlighter.opacity,
        locked: false, createdAt: now, updatedAt: now,
      };
      addAnnotation(docId, ann);
      pushHistory(makeAddAction(docId, ann));
    } else {
      const ann = {
        id, pageIndex, type: 'stroke' as const,
        points: pdfPts,
        color: toolOptions.pen.color,
        width: toolOptions.pen.width,
        opacity: toolOptions.pen.opacity,
        smooth: toolOptions.pen.smooth,
        pressure: toolOptions.pen.pressureSensitive,
        locked: false, createdAt: now, updatedAt: now,
      };
      addAnnotation(docId, ann);
      pushHistory(makeAddAction(docId, ann));
    }
  }

  // ── Shape commit ──────────────────────────────────────────────────────────

  function commitShape() {
    if (!shapeStart.current) return;
    const { screenX: ex, screenY: ey } = currentEnd.current;
    // Require minimum drag distance to avoid accidental tiny shapes
    const dx = ex - shapeStart.current.screenX;
    const dy = ey - shapeStart.current.screenY;
    if (Math.hypot(dx, dy) < 4) return;

    const endPdf = screenToPdfPoint(ex, ey);
    const shapeKind = toolToShapeKind(gestureToolRef.current ?? interactionTool)!;
    const id = nanoid();
    const now = Date.now();
    const ann = {
      id, pageIndex, type: 'shape' as const,
      shapeKind,
      startPoint: { x: shapeStart.current.pdfX, y: shapeStart.current.pdfY },
      endPoint: { x: endPdf.x, y: endPdf.y },
      color: toolOptions.shape.color,
      opacity: toolOptions.shape.opacity,
      strokeWidth: toolOptions.shape.strokeWidth,
      fillColor: toolOptions.shape.fillColor,
      cornerRadius: 8,
      locked: false, createdAt: now, updatedAt: now,
    };
    addAnnotation(docId, ann);
    pushHistory(makeAddAction(docId, ann));
  }

  // ── Eraser ────────────────────────────────────────────────────────────────

  function doErase(pdfPt: PdfPoint) {
    const annotations = getPageAnnotations(docId, pageIndex);
    // Eraser size: 20 CSS pixels converted to PDF points
    const eraserPdf = 10 / scale;
    const hits = eraserHitTest(pdfPt, annotations, eraserPdf);
    for (const ann of hits) {
      removeAnnotation(docId, pageIndex, ann.id);
      pushHistory(makeRemoveAction(docId, ann));
      selectedIds.current.delete(ann.id);
    }
  }

  // ── Selection: rubber-band commit ─────────────────────────────────────────

  function commitRubberBand() {
    if (!selectionStart.current) return;
    const { screenX: sx, screenY: sy } = selectionStart.current;
    const { screenX: ex, screenY: ey } = currentEnd.current;

    // Convert rubber-band corners to PDF space
    const selectionRect = screenRectToPdfBounds(
      { x: sx, y: sy, width: ex - sx, height: ey - sy },
      transform,
    );

    const annotations = getPageAnnotations(docId, pageIndex);
    const newSelection = new Set<string>();
    for (const ann of annotations) {
      const bounds = getAnnotationBounds(ann);
      if (rectsIntersect(bounds, selectionRect)) {
        newSelection.add(ann.id);
      }
    }
    selectedIds.current = newSelection;
  }

  // ── Move ─────────────────────────────────────────────────────────────────

  function moveSelectedAnnotations(dx: number, dy: number) {
    const annotations = getPageAnnotations(docId, pageIndex);
    for (const id of selectedIds.current) {
      const ann = annotations.find(a => a.id === id);
      if (!ann) continue;
      applyMoveToAnnotation(ann, dx, dy);
    }
  }

  function applyMoveToAnnotation(ann: Annotation, dx: number, dy: number) {
    switch (ann.type) {
      case 'stroke':
      case 'highlight': {
        const moved = {
          ...ann,
          points: ann.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })),
          updatedAt: Date.now(),
        };
        replaceAnnotation(docId, pageIndex, moved);
        break;
      }
      case 'text': {
        const moved = {
          ...ann,
          bounds: { ...ann.bounds, x: ann.bounds.x + dx, y: ann.bounds.y + dy },
          updatedAt: Date.now(),
        };
        replaceAnnotation(docId, pageIndex, moved);
        break;
      }
      case 'shape': {
        const moved = {
          ...ann,
          startPoint: { x: ann.startPoint.x + dx, y: ann.startPoint.y + dy },
          endPoint: { x: ann.endPoint.x + dx, y: ann.endPoint.y + dy },
          updatedAt: Date.now(),
        };
        replaceAnnotation(docId, pageIndex, moved);
        break;
      }
    }
  }

  function commitMove() {
    const annotations = getPageAnnotations(docId, pageIndex);
    for (const [id, before] of moveBefore.current) {
      const after = annotations.find(a => a.id === id);
      if (after) pushHistory(makeMoveAction(docId, before, after));
    }
    moveBefore.current.clear();
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  function resizeAnnotation(pdfPt: PdfPoint) {
    const ann = resizeBefore.current;
    if (!ann || !resizeHandle.current || ann.type !== 'shape') return;

    const h = resizeHandle.current.id;
    const { startPoint, endPoint } = ann;
    let { x: x1, y: y1 } = startPoint;
    let { x: x2, y: y2 } = endPoint;

    // Adjust the appropriate corner/edge
    if (h.includes('n')) y2 = pdfPt.y;
    if (h.includes('s')) y1 = pdfPt.y;
    if (h.includes('w')) x1 = pdfPt.x;
    if (h.includes('e')) x2 = pdfPt.x;

    const moved = { ...ann, startPoint: { x: x1, y: y1 }, endPoint: { x: x2, y: y2 }, updatedAt: Date.now() };
    replaceAnnotation(docId, pageIndex, moved);
  }

  function commitResize() {
    const before = resizeBefore.current;
    if (!before) return;
    const annotations = getPageAnnotations(docId, pageIndex);
    const after = annotations.find(a => a.id === before.id);
    if (after) pushHistory(makeMoveAction(docId, before, after));
  }

  function cancelActiveInteraction(): boolean {
    const activeMode = mode.current;
    const hadTextEditor = textEditingRef.current;
    if (activeMode === 'idle' && !hadTextEditor) return false;

    if (activeMode === 'moving') {
      for (const annotation of moveBefore.current.values()) {
        replaceAnnotation(docId, pageIndex, structuredClone(annotation));
      }
    } else if (activeMode === 'resizing' && resizeBefore.current) {
      replaceAnnotation(docId, pageIndex, structuredClone(resizeBefore.current));
    } else if (activeMode === 'selectDrag') {
      selectedIds.current = new Set(selectionBefore.current);
    }

    if (hadTextEditor) {
      suppressTextBlurCommitRef.current = true;
      textEditingRef.current = false;
      setTextOverlay(null);
    }

    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = null;
    pendingRender.current = false;
    clearDrawingCanvas();

    const pointerId = activePointerIdRef.current;
    if (pointerId !== null && interactionRef.current?.hasPointerCapture(pointerId)) {
      interactionRef.current.releasePointerCapture(pointerId);
    }

    activePointerIdRef.current = null;
    mode.current = 'idle';
    activePoints.current = [];
    shapeStart.current = null;
    selectionStart.current = null;
    moveAnchor.current = null;
    moveBefore.current.clear();
    resizeHandle.current = null;
    resizeBefore.current = null;
    gestureToolRef.current = null;
    selectionBefore.current = new Set();
    setIsDrawing(false);
    onInteractionPinChange?.(false);
    redrawAnnotationLayer();
    return true;
  }

  useEffect(() => {
    const handleCancelRequest = (event: Event) => {
      if (!cancelActiveInteraction()) return;
      event.preventDefault();
    };
    document.addEventListener(CANCEL_ACTIVE_INTERACTION_EVENT, handleCancelRequest);
    return () => document.removeEventListener(CANCEL_ACTIVE_INTERACTION_EVENT, handleCancelRequest);
  });

  // ── Text overlay ──────────────────────────────────────────────────────────

  function openTextOverlay(screenX: number, screenY: number, pdfX: number, pdfY: number) {
    suppressTextBlurCommitRef.current = false;
    textEditingRef.current = true;
    setIsDrawing(true);
    onInteractionPinChange?.(true);
    setTextOverlay({ x: screenX, y: screenY, pdfX, pdfY });
    // Focus textarea on next tick
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function commitText(content: string, overlay: TextOverlay) {
    if (!content.trim()) return; // Discard empty annotations
    const id = nanoid();
    const now = Date.now();
    const opts = toolOptions.text;
    const textHeight = opts.fontSize * 4;
    const ann = {
      id, pageIndex, type: 'text' as const,
      bounds: {
        x: overlay.pdfX,
        y: overlay.pdfY - textHeight,
        width: 200,
        height: textHeight,
      },
      content,
      fontSize: opts.fontSize,
      fontFamily: opts.fontFamily,
      bold: opts.bold,
      italic: opts.italic,
      underline: opts.underline,
      align: opts.align,
      color: opts.color,
      backgroundColor: opts.backgroundColor,
      opacity: 1,
      locked: false, createdAt: now, updatedAt: now,
    };
    addAnnotation(docId, ann);
    pushHistory(makeAddAction(docId, ann));
  }

  function onTextKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelActiveInteraction();
      return;
    }
    // Ctrl/Cmd + Enter → commit
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const content = (e.target as HTMLTextAreaElement).value;
      if (textOverlay) commitText(content, textOverlay);
      suppressTextBlurCommitRef.current = true;
      textEditingRef.current = false;
      setIsDrawing(false);
      onInteractionPinChange?.(false);
      setTextOverlay(null);
    }
    // Plain Enter → newline (default textarea behavior, no preventDefault)
  }

  function onTextBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    if (suppressTextBlurCommitRef.current) {
      suppressTextBlurCommitRef.current = false;
      return;
    }
    const content = e.target.value;
    if (textOverlay && content.trim()) commitText(content, textOverlay);
    textEditingRef.current = false;
    setIsDrawing(false);
    onInteractionPinChange?.(false);
    setTextOverlay(null);
  }

  // ── Keyboard: Delete selected annotations ─────────────────────────────────

  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
      if (selectedIds.current.size === 0) return;

      const annotations = getPageAnnotations(docId, pageIndex);
      for (const id of selectedIds.current) {
        const ann = annotations.find(a => a.id === id);
        if (ann) {
          removeAnnotation(docId, pageIndex, id);
          pushHistory(makeRemoveAction(docId, ann));
        }
      }
      selectedIds.current = new Set();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [docId, pageIndex, getPageAnnotations, removeAnnotation, pushHistory]);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      pendingRender.current = false;
      setIsDrawing(false);
      releaseCanvas(annotationCanvasRef.current);
      releaseCanvas(drawingCanvasRef.current);
      onInteractionPinChange?.(false);
    };
  }, [onInteractionPinChange, setIsDrawing]);

  // ── Render ────────────────────────────────────────────────────────────────

  const cursor = getCursor(interactionTool, mode.current);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width,
        height,
        overflow: 'hidden',
      }}
    >
      {/* Layer 1: Completed annotations */}
      <canvas
        ref={annotationCanvasRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />

      {/* Layer 2: Live preview (active stroke / shape / selection drag) */}
      <canvas
        ref={drawingCanvasRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />

      {/* Layer 3: Interaction surface */}
      <div
        ref={interactionRef}
        style={{ position: 'absolute', inset: 0, cursor, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />

      {/* Text editing overlay */}
      {textOverlay && (
        <textarea
          ref={textareaRef}
          style={{
            position: 'absolute',
            left: textOverlay.x,
            top: textOverlay.y - 4,
            minWidth: 180,
            minHeight: 36,
            fontSize: toolOptions.text.fontSize,
            fontFamily: toolOptions.text.fontFamily,
            fontWeight: toolOptions.text.bold ? 'bold' : 'normal',
            fontStyle: toolOptions.text.italic ? 'italic' : 'normal',
            color: toolOptions.text.color,
            background: toolOptions.text.backgroundColor === 'transparent'
              ? 'rgba(255,255,255,0.92)'
              : toolOptions.text.backgroundColor,
            border: '1.5px solid rgba(59,130,246,0.8)',
            borderRadius: 3,
            padding: '4px 6px',
            outline: 'none',
            resize: 'both',
            zIndex: 100,
            lineHeight: 1.4,
          }}
          placeholder="Type text… (Ctrl+Enter to confirm, Esc to cancel)"
          onKeyDown={onTextKeyDown}
          onBlur={onTextBlur}
          autoFocus
        />
      )}
    </div>
  );
});

export default AnnotationCanvas;
