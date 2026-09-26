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
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  TextAnnotation,
  Annotation,
  InputPoint,
  ToolType,
  PdfPoint,
  ShapeKind,
  ImageAnnotation,
  PdfRect,
} from '../../types/annotations';
import type { DocumentIdentity } from '../../types/documentSession';
import { useAnnotationStore } from '../../store/annotationStore';
import { useSelectionStore } from '../../store/selectionStore';
import { useAssetStore } from '../../store/assetStore';
import { useHistoryStore, makeAddAction, makeRemoveAction, makeMoveAction, makeBatchAction, makeUpdateAction, type HistoryActionDraft } from '../../store/historyStore';
import { useDocumentStore } from '../../store/documentStore';
import {
  normalizeAndCreateImageAsset,
  calculateDefaultImageBounds,
  createInsertTargetSnapshot,
  isInsertTargetValid,
  SUPPORTED_IMAGE_MIME_TYPES,
  type InsertTargetSnapshot,
} from '../../pdf/imageUtils';
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
  renderShapePreview,
  renderSelectionOverlay,
  renderSelectionRect,
  renderFreeform,
} from '../../pdf/annotationRenderer';
import { simplifyInkPoints } from '../../pdf/inkGeometry';
import { FloatingInspector } from '../Properties/FloatingInspector';
import { getAnnotationBounds, getGroupBounds } from '../../pdf/annotationGeometry';
import { translateAnnotation, scaleAnnotationFromBounds, computeResizeTargetBounds } from '../../pdf/annotationTransform';
import {
  hitTestAnnotations,
  hitTestSelectedBounds,
  hitTestResizeHandle,
  getResizeHandles,
  eraserHitTest,
  rectsIntersect,
  hitTestMarquee,
} from '../../pdf/annotationHitTest';
import { eraseStrokePath, generateId } from '../../pdf/eraserGeometry';
import type { ResizeHandle } from '../../pdf/annotationHitTest';
import { nanoid } from '../../utils/nanoid';
import {
  computeSafeCanvasOutputScale,
  releaseCanvas,
} from '../../pdf/canvasMemory';
import { CANCEL_ACTIVE_INTERACTION_EVENT } from '../../commands';
import { errorMessage, notifyUser } from '../../utils/notify';
import { isEditableTarget } from '../../commands/keyboardShortcuts';
import { autoSizeTextBox, canvasMeasure, cssFont, LINE_HEIGHT, MAX_AUTO_TEXT_WIDTH, TEXT_PADDING } from '../../pdf/textLayout';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnnotationCanvasProps {
  docId: string;
  instanceId: number;
  pageIndex: number;
  transform: PageTransform;
  onInteractionPinChange?: (pinned: boolean) => void;
}

type InteractionMode =
  | 'idle'
  | 'drawing'       // pen / highlighter
  | 'shapeDrawing'  // shape tools dragging
  | 'erasing'       // eraser active
  | 'freeformDrawing' // freeform polygon drawing
  | 'selectDrag'    // rubber-band selection
  | 'moving'        // moving selected annotations
  | 'resizing';     // resizing selected annotation

// ─── Text overlay state ───────────────────────────────────────────────────────

type TextStyle = Pick<TextAnnotation,
  'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'underline' | 'align'
  | 'color' | 'backgroundColor' | 'borderColor' | 'borderWidth' | 'listStyle'>;

interface TextOverlay {
  x: number;   // CSS pixels (left)
  y: number;   // CSS pixels (top)
  pdfX: number; // PDF x of the box's left edge
  pdfY: number; // PDF y of the box's TOP edge
  /** Set when editing an existing annotation. */
  editingId?: string;
  initial: string;
  style: TextStyle;
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
    case 'freeform':    return 'crosshair';
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

// Stable fallback — MUST be a module-level constant so its reference never changes
const EMPTY_ANNOTATIONS: Annotation[] = [];
const EMPTY_IDS: string[] = [];

// ─── Component ────────────────────────────────────────────────────────────────

const boundsCache = new WeakMap<Annotation, PdfRect>();
function getCachedBounds(annotation: Annotation): PdfRect {
  let bounds = boundsCache.get(annotation);
  if (!bounds) {
    bounds = getAnnotationBounds(annotation);
    boundsCache.set(annotation, bounds);
  }
  return bounds;
}
function unionRects(a: PdfRect, b: PdfRect): PdfRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
function rectsOverlap(a: PdfRect, b: PdfRect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/** Points closer than this (screen px) to the drawn line are dropped on pen-up. */
const INK_SIMPLIFY_PX = 0.35;
/** Touches this soon after pen input are treated as a resting palm. */
const PALM_REJECTION_MS = 1000;

const AnnotationCanvas = React.memo<AnnotationCanvasProps>(function AnnotationCanvas({
  docId,
  instanceId,
  pageIndex,
  transform,
  onInteractionPinChange,
}) {
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  // Highlights live on their own layer (CSS mix-blend-mode: multiply) under
  // the ink layer, so the page text below them stays dark.
  const highlightCanvasRef  = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef    = useRef<HTMLCanvasElement>(null);
  const interactionRef      = useRef<HTMLDivElement>(null);
  const textareaRef         = useRef<HTMLTextAreaElement>(null);

  // Interaction refs (no React re-renders during gestures)
  const mode             = useRef<InteractionMode>('idle');
  const activePoints     = useRef<InputPoint[]>([]);
  const shapeStart       = useRef<{ screenX: number; screenY: number; pdfX: number; pdfY: number } | null>(null);
  const selectionStart   = useRef<{ screenX: number; screenY: number } | null>(null);
  const currentEnd       = useRef<{ screenX: number; screenY: number }>({ screenX: 0, screenY: 0 });
  const moveAnchor       = useRef<{ screenX: number; screenY: number; pdfX: number; pdfY: number } | null>(null);
  const moveBefore       = useRef<Map<string, Annotation>>(new Map()); // Also used for resize original state
  const originalGroupBounds = useRef<import('../../types/annotations').PdfRect | null>(null);
  const resizeHandle     = useRef<ResizeHandle | null>(null);
  const rafId            = useRef<number | null>(null);
  const pendingRender    = useRef(false);
  const textEditingRef   = useRef(false);
  const editingTextIdRef = useRef<string | null>(null);
  const suppressTextBlurCommitRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const gestureToolRef   = useRef<ToolType | null>(null);
  const selectionBefore  = useRef<string[]>([]);
  const gestureSelectedIdsRef = useRef<string[]>([]);
  const shiftKeyRef = useRef(false);
  const predictedPoints = useRef<InputPoint[]>([]);
  const lastPenInputAt = useRef(0);
  const layerRedrawId = useRef<number | null>(null);
  const pendingRedrawRegion = useRef<PdfRect | null>(null);
  const lastLayerDraw = useRef<{
    list: Annotation[]; transform: PageTransform; dpr: number; overlay: boolean; width: number; height: number;
  } | null>(null);

  // Eraser gesture state
  const eraserHitsRef = useRef<Map<string, { type: 'delete' } | { type: 'split', segments: InputPoint[][]; pieces: Annotation[] }>>(new Map());
  const lastEraserPointRef = useRef<PdfPoint | null>(null);
  const originalEraserSnapshotRef = useRef<Annotation[]>([]);

  // React state only for text overlay (needs DOM update)
  const [textOverlay, setTextOverlay] = useState<TextOverlay | null>(null);

  // Narrow selectors: whole-store subscriptions re-rendered every mounted page
  // on any unrelated UI / annotation / history change.
  const toolOptions = useUIStore(state => state.toolOptions);
  const activeTool = useUIStore(state => state.activeTool);
  const temporaryTool = useUIStore(state => state.temporaryTool);
  const setIsDrawing = useUIStore(state => state.setIsDrawing);
  const interactionTool = temporaryTool ?? activeTool;
  const addAnnotation = useAnnotationStore(state => state.addAnnotation);
  const replaceAnnotation = useAnnotationStore(state => state.replaceAnnotation);
  const getPageAnnotations = useAnnotationStore(state => state.getPageAnnotations);
  // IMPORTANT: fallback MUST be the stable EMPTY_ANNOTATIONS constant (never `|| []`).
  // Returning a new `[]` literal every render causes an infinite re-render loop
  // because Zustand uses reference equality to detect changes.
  const annotations = useAnnotationStore(
    state => state.docAnnotations.get(docId)?.pages.get(pageIndex)?.annotations ?? EMPTY_ANNOTATIONS
  );
  const pushHistory = useHistoryStore(state => state.push);
  const identity: DocumentIdentity = useMemo(
    () => ({ docId, instanceId }),
    [docId, instanceId],
  );

  const selectionState = useSelectionStore(state => state.getSelection(identity));
  // Same stability rule for the ids array
  const selectedIdsArray = (selectionState?.pageIndex === pageIndex)
    ? selectionState.selectedIds
    : EMPTY_IDS;

  // A selection belongs to the Select tool. Switching to another persistent
  // tool clears it; the temporary Space/Hand gesture does not.
  useEffect(() => {
    if (activeTool !== 'select' && selectedIdsArray.length > 0) {
      useSelectionStore.getState().clearSelection(identity);
    }
  }, [activeTool, identity, selectedIdsArray.length]);

  // Clear the selection when the user clicks outside all pages (e.g. DocumentArea background, sidebar).
  // Clicking on any page will be handled by that page's onPointerDown.
  useEffect(() => {
    if (selectedIdsArray.length === 0) return;

    const clearWhenOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-annotation-canvas="true"]')) {
        return;
      }
      useSelectionStore.getState().clearSelection(identity);
    };

    document.addEventListener('pointerdown', clearWhenOutside);
    return () => document.removeEventListener('pointerdown', clearWhenOutside);
  }, [identity, selectedIdsArray, docId, pageIndex]);

  // Handle global Escape (cancel drawing/gesture)
  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey
        && mode.current === 'idle' && !textEditingRef.current
        && selectedIdsArray.length === 1 && !isEditableTarget(e.target)) {
        const selected = getPageAnnotations(docId, pageIndex).find((a) => a.id === selectedIdsArray[0]);
        if (selected?.type === 'text') {
          e.preventDefault();
          openTextEditor(selected);
          return;
        }
      }
      if (e.key === 'Escape') {
        if (mode.current !== 'idle') {
          cancelActiveInteraction();
        } else if (selectedIdsArray.length > 0) {
          useSelectionStore.getState().clearSelection(identity);
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeydown, true);
    return () => document.removeEventListener('keydown', handleGlobalKeydown, true);
  }, [identity, selectedIdsArray.length]);

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

  // Cancel any active drawing if the user switches tools
  useEffect(() => {
    cancelActiveInteraction();
  }, [interactionTool]);

  useEffect(() => {
    sizeCanvas(highlightCanvasRef.current);
    sizeCanvas(annotationCanvasRef.current);
    sizeCanvas(drawingCanvasRef.current);
    redrawAnnotationLayer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, dpr]);

  // ── Annotation layer (completed annotations + selection overlay) ──────────

  /**
   * Redraws the highlight + ink layers.
   * - Full redraw by default.
   * - `region` (PDF space): only that area is cleared and repainted, with just
   *   the annotations that overlap it (used by the eraser).
   * - Append fast path: when the page only gained annotations at the top of
   *   the stack (a new stroke), only the new ones are painted.
   */
  const redrawAnnotationLayer = useCallback((region?: PdfRect) => {
    if (layerRedrawId.current !== null) {
      cancelAnimationFrame(layerRedrawId.current);
      layerRedrawId.current = null;
    }
    if (!region) pendingRedrawRegion.current = null;
    const canvas = annotationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const highlightCanvas = highlightCanvasRef.current;
    const highlightCtx = highlightCanvas?.getContext('2d') ?? null;

    const isActiveGesture = mode.current === 'moving' || mode.current === 'resizing';
    const activeIds = isActiveGesture ? gestureSelectedIdsRef.current : [];
    
    const selectionState = useSelectionStore.getState().getSelection(identity);
    const transientStyle = selectionState?.pageIndex === pageIndex ? selectionState.transientStyle : undefined;
    const currentSelectedIds = selectionState?.pageIndex === pageIndex ? selectionState.selectedIds : [];
    const currentAnnotations = getPageAnnotations(docId, pageIndex);

    const committedAnnotations: Annotation[] = [];
    for (const a of currentAnnotations) {
      if (a.hidden || a.id === editingTextIdRef.current) continue;
      if (activeIds.includes(a.id)) continue;
      
      const eraseHit = eraserHitsRef.current.get(a.id);
      if (eraseHit?.type === 'delete') continue;

      if (eraseHit?.type === 'split' && (a.type === 'stroke' || a.type === 'highlight')) {
        // Draw the remaining pieces instead of the original
        committedAnnotations.push(...eraseHit.pieces);
        continue;
      }

      if (transientStyle && currentSelectedIds.length === 1 && a.id === currentSelectedIds[0]) {
        // Safe shallow merge of the transient style for live preview
        committedAnnotations.push({ ...a, ...transientStyle } as Annotation);
      } else {
        committedAnnotations.push(a);
      }
    }

    const showOverlay = currentSelectedIds.length > 0 && !isActiveGesture;
    const previous = lastLayerDraw.current;
    const sameSurface = previous !== null && previous.transform === transform && previous.dpr === dpr
      && previous.width === canvas.width && previous.height === canvas.height;

    const paint = (list: Annotation[]) => {
      if (highlightCtx) {
        renderAnnotations(highlightCtx, list.filter((a) => a.type === 'highlight'), transform, dpr, identity);
        renderAnnotations(ctx, list.filter((a) => a.type !== 'highlight'), transform, dpr, identity, () => redrawAnnotationLayer());
      } else {
        renderAnnotations(ctx, list, transform, dpr, identity, () => redrawAnnotationLayer());
      }
    };

    if (region && sameSurface && !previous!.overlay && !showOverlay) {
      // ── Partial repaint (eraser) ──
      const screen = pdfRectToScreenBounds(region, transform);
      const pad = 2;
      const x = Math.floor((screen.x - pad) * dpr);
      const y = Math.floor((screen.y - pad) * dpr);
      const w = Math.ceil((screen.width + pad * 2) * dpr);
      const h = Math.ceil((screen.height + pad * 2) * dpr);
      const layers = highlightCtx ? [ctx, highlightCtx] : [ctx];
      for (const layer of layers) {
        layer.save();
        layer.beginPath();
        layer.rect(x, y, w, h);
        layer.clip();
        layer.clearRect(x, y, w, h);
      }
      paint(committedAnnotations.filter((a) => rectsOverlap(getCachedBounds(a), region)));
      for (const layer of layers) layer.restore();
      lastLayerDraw.current = { list: committedAnnotations, transform, dpr, overlay: false, width: canvas.width, height: canvas.height };
      return;
    }

    if (!region && sameSurface && !previous!.overlay && !showOverlay
      && committedAnnotations.length > previous!.list.length
      && previous!.list.every((a, i) => committedAnnotations[i] === a)) {
      // ── Append fast path (new stroke on top) ──
      paint(committedAnnotations.slice(previous!.list.length));
      lastLayerDraw.current = { ...previous!, list: committedAnnotations };
      return;
    }

    // ── Full repaint ──
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (highlightCanvas && highlightCtx) highlightCtx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);
    paint(committedAnnotations);

    // Draw selection overlays for selected annotations (unless they are being actively moved/resized)
    if (showOverlay) {
      const selectedAnns: Annotation[] = [];
      for (const id of currentSelectedIds) {
        const ann = currentAnnotations.find(a => a.id === id);
        if (!ann) continue;
        
        let effectiveAnn = ann;
        if (transientStyle && currentSelectedIds.length === 1 && id === currentSelectedIds[0]) {
          effectiveAnn = { ...ann, ...transientStyle } as Annotation;
        }
        selectedAnns.push(effectiveAnn);
      }
      
      const groupBounds = getGroupBounds(selectedAnns);
      if (groupBounds) {
        const screenBounds = pdfRectToScreenBounds(groupBounds, transform);
        const handles = getResizeHandles(groupBounds).map(h => pdfToScreen(h.x, h.y, transform));
        renderSelectionOverlay(ctx, screenBounds, handles, dpr);
      }
    }
    lastLayerDraw.current = {
      list: committedAnnotations, transform, dpr, overlay: showOverlay, width: canvas.width, height: canvas.height,
    };
  }, [docId, pageIndex, transform, dpr, annotations, selectedIdsArray, getPageAnnotations, identity]);

  // Re-render whenever store or selection changes
  useEffect(() => {
    redrawAnnotationLayer();
  }, [redrawAnnotationLayer, selectionState?.transientStyle]);

  /** Coalesce many redraw requests (eraser) into one per animation frame. */
  function scheduleLayerRedraw(region?: PdfRect) {
    if (region) {
      const r = pendingRedrawRegion.current;
      pendingRedrawRegion.current = r ? unionRects(r, region) : region;
    }
    if (layerRedrawId.current !== null) return;
    layerRedrawId.current = requestAnimationFrame(() => {
      layerRedrawId.current = null;
      const pending = pendingRedrawRegion.current;
      pendingRedrawRegion.current = null;
      redrawAnnotationLayer(pending ?? undefined);
    });
  }

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
      const pts = [...activePoints.current, ...predictedPoints.current];
      const preview = buildInkAnnotation(pts, gestureToolRef.current ?? interactionTool);
      if (preview) renderAnnotations(ctx, [preview], transform, dpr);
    } else if (m === 'freeformDrawing') {
      const screenPts = activePoints.current;
      if (screenPts.length < 1) return;
      
      const currentEndScreen = currentEnd.current;
      const tempScreenPts = [...screenPts, { x: currentEndScreen.screenX, y: currentEndScreen.screenY, pressure: 0.5, timestamp: 0 }];
      
      // We must convert to PDF points for renderFreeform, but only for the preview
      const tempPdfPts = screenPointsToPdf(tempScreenPts, transform);
      
      const tempAnn: import('../../types/annotations').FreeformAnnotation = {
        id: 'temp', type: 'freeform', pageIndex: 0,
        points: tempPdfPts,
        color: toolOptions.shape.color,
        strokeWidth: toolOptions.shape.strokeWidth,
        fillColor: toolOptions.shape.fillColor,
        opacity: toolOptions.shape.opacity, locked: false, createdAt: 0, updatedAt: 0
      };
      
      ctx.save();
      ctx.scale(dpr, dpr); // same clamped output scale as the canvas backing store
      renderFreeform(ctx, tempAnn, transform);
      ctx.restore();
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
        toolOptions.shape.borderStyle,
      );
    } else if (m === 'selectDrag' && selectionStart.current) {
      const { screenX: sx, screenY: sy } = selectionStart.current;
      const { screenX: ex, screenY: ey } = currentEnd.current;
      renderSelectionRect(ctx, sx, sy, ex, ey, dpr);
    } else if (m === 'erasing') {
      const pts = activePoints.current;
      if (pts.length > 0) {
        const lastPt = pts[pts.length - 1];
        const radius = (toolOptions.eraser.size / 2);
        
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#666';
        ctx.stroke();
        ctx.restore();
      }
    } else if (m === 'moving' && moveAnchor.current && shapeStart.current) {
      const dx = moveAnchor.current.pdfX - shapeStart.current.pdfX;
      const dy = moveAnchor.current.pdfY - shapeStart.current.pdfY;
      
      const movedAnns: Annotation[] = [];
      for (const id of gestureSelectedIdsRef.current) {
        const before = moveBefore.current.get(id);
        if (before) {
          movedAnns.push(translateAnnotation(before, dx, dy));
        }
      }
      
      renderAnnotations(ctx, movedAnns, transform, dpr, identity);
      
      for (const ann of movedAnns) {
        const bounds = getAnnotationBounds(ann);
        const screenBounds = pdfRectToScreenBounds(bounds, transform);
        const handles = getResizeHandles(bounds).map(h => pdfToScreen(h.x, h.y, transform));
        renderSelectionOverlay(ctx, screenBounds, handles, dpr);
      }
    } else if (m === 'resizing' && resizeHandle.current && moveAnchor.current && originalGroupBounds.current) {
      const targetBounds = getTargetGroupBounds();
      const resizedAnns: Annotation[] = [];
      
      for (const id of gestureSelectedIdsRef.current) {
        const before = moveBefore.current.get(id);
        if (before) {
          resizedAnns.push(scaleAnnotationFromBounds(before, originalGroupBounds.current, targetBounds));
        }
      }
      
      renderAnnotations(ctx, resizedAnns, transform, dpr, identity);
      
      const newGroupBounds = getGroupBounds(resizedAnns);
      if (newGroupBounds) {
        const screenBounds = pdfRectToScreenBounds(newGroupBounds, transform);
        const handles = getResizeHandles(newGroupBounds).map(h => pdfToScreen(h.x, h.y, transform));
        renderSelectionOverlay(ctx, screenBounds, handles, dpr);
      }
    }
  }

  // ── Pointer helpers ───────────────────────────────────────────────────────

  /**
   * The annotation for a pen/highlighter gesture (screen points). Used for
   * the live preview and the committed stroke, so both look identical.
   */
  function buildInkAnnotation(screenPts: InputPoint[], tool: ToolType | null, simplify = false): Annotation | null {
    const isHighlight = tool === 'highlighter';
    if (screenPts.length < (isHighlight ? 2 : 1)) return null;
    let pdfPts = screenPointsToPdf(screenPts, transform);
    const now = Date.now();
    if (isHighlight) {
      const options = toolOptions.highlighter;
      if (simplify) pdfPts = simplifyInkPoints(pdfPts, INK_SIMPLIFY_PX / scale);
      return {
        id: nanoid(), pageIndex, type: 'highlight',
        points: pdfPts, color: options.color, width: options.width, opacity: options.opacity,
        locked: false, createdAt: now, updatedAt: now,
      };
    }
    const options = toolOptions.pen;
    if (simplify) pdfPts = simplifyInkPoints(pdfPts, INK_SIMPLIFY_PX / scale, options.pressureSensitive ? options.width * 0.7 : 0);
    return {
      id: nanoid(), pageIndex, type: 'stroke',
      points: pdfPts, color: options.color, width: options.width, opacity: options.opacity,
      smooth: options.smooth, pressure: options.pressureSensitive,
      locked: false, createdAt: now, updatedAt: now,
    };
  }

  /** Only one pointer draws at a time; a resting palm is ignored while a pen is in use. */
  function isForeignPointer(e: React.PointerEvent<HTMLDivElement>): boolean {
    if (e.pointerType === 'pen') lastPenInputAt.current = e.timeStamp;
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return true;
    return e.pointerType === 'touch' && e.timeStamp - lastPenInputAt.current < PALM_REJECTION_MS;
  }

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
    if (isForeignPointer(e)) return;
    
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
    // The preview layer multiplies only while a highlighter is drawn.
    if (drawingCanvasRef.current) {
      drawingCanvasRef.current.style.mixBlendMode = interactionTool === 'highlighter' ? 'multiply' : 'normal';
    }

    // ── Pen / Highlighter ──
    if (interactionTool === 'pen' || interactionTool === 'highlighter') {
      mode.current = 'drawing';
      predictedPoints.current = [];
      activePoints.current = [{ x: screenX, y: screenY, pressure: e.pressure > 0 ? e.pressure : 0.5, timestamp: e.timeStamp }];
      schedulePreviewRender();
      return;
    }

    // ── Freeform ──
    if (interactionTool === 'freeform') {
      if (mode.current === 'idle') {
        mode.current = 'freeformDrawing';
        activePoints.current = [{ x: screenX, y: screenY, pressure: e.pressure > 0 ? e.pressure : 0.5, timestamp: e.timeStamp }];
        currentEnd.current = { screenX, screenY };
        setIsDrawing(true);
        onInteractionPinChange?.(true);
        schedulePreviewRender();
      } else if (mode.current === 'freeformDrawing') {
        const startPtScreen = activePoints.current[0];
        const distToStart = Math.hypot(screenX - startPtScreen.x, screenY - startPtScreen.y);
        
        // Complete if double-clicked or clicking near the start vertex
        if (e.nativeEvent.detail >= 2 || (activePoints.current.length >= 2 && distToStart < 12)) {
          commitFreeform();
        } else {
          activePoints.current.push({ x: screenX, y: screenY, pressure: e.pressure > 0 ? e.pressure : 0.5, timestamp: e.timeStamp });
          currentEnd.current = { screenX, screenY };
          schedulePreviewRender();
        }
      }
      return;
    }

    // ── Eraser ──
    if (interactionTool === 'eraser') {
      mode.current = 'erasing';
      
      const currentSelectionState = useSelectionStore.getState().getSelection(identity);
      if (currentSelectionState?.selectedIds.length) {
        useSelectionStore.getState().clearSelection(identity);
      }
      
      eraserHitsRef.current.clear();
      lastEraserPointRef.current = pdfPt;
      originalEraserSnapshotRef.current = structuredClone(getPageAnnotations(docId, pageIndex));
      
      // We don't push into activePoints; eraser doesn't draw a stroke, it just draws a cursor
      activePoints.current = [{ x: screenX, y: screenY, pressure: 0.5, timestamp: e.timeStamp }];
      
      doEraseSweptPath(pdfPt);
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
      const existing = hitTestAnnotations(pdfPt, getPageAnnotations(docId, pageIndex), transform);
      if (existing?.type === 'text') {
        openTextEditor(existing);
        return;
      }
      openTextOverlay(screenX, screenY, pdfPt.x, pdfPt.y);
      return;
    }

    // ── Select ──
    if (interactionTool === 'select') {
      const annotations = getPageAnnotations(docId, pageIndex);
      const currentSelectionState = useSelectionStore.getState().getSelection(identity);
      const activeIds = currentSelectionState?.pageIndex === pageIndex ? currentSelectionState.selectedIds : [];
      const selectedAnns = activeIds.map(id => annotations.find(a => a.id === id)).filter(Boolean) as Annotation[];

      // First: check if clicking on a resize handle of the selected group
      if (selectedAnns.length > 0) {
        // Group resize is disabled if the group contains a text annotation, to prevent distortion
        const canResize = !selectedAnns.some(a => a.type === 'text');
        
        if (canResize) {
          const groupBounds = getGroupBounds(selectedAnns);
          if (groupBounds) {
            const handles = getResizeHandles(groupBounds);
            const hit = hitTestResizeHandle(pdfPt, handles, transform);
            if (hit) {
              mode.current = 'resizing';
              resizeHandle.current = hit;
              originalGroupBounds.current = groupBounds;
              shapeStart.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
              moveAnchor.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
              gestureSelectedIdsRef.current = [...activeIds];
              
              moveBefore.current = new Map();
              for (const ann of selectedAnns) {
                moveBefore.current.set(ann.id, structuredClone(ann));
              }
              
              redrawAnnotationLayer(); // Exclude from committed
              schedulePreviewRender(); // Draw on transient
              return;
            }
          }
        }
      }

      // Second: check if we hit any annotation
      const hit = hitTestAnnotations(pdfPt, annotations, transform, activeIds);
      
      const isAdditive = e.metaKey || e.ctrlKey || e.shiftKey; // Ctrl=Cmd is still accepted here as fallback for non-mac, but meta/shift is preferred as requested
      // The user requested: "Preferred: Cmd+click, Shift+click. Windows support gerekiyorsa platform-safe Ctrl semantics ayrıca ele alınabilir. Current Phase 7 macOS behavior must remain predictable."
      // Let's use metaKey or shiftKey for additive.
      const isModifier = e.metaKey || e.shiftKey;

      if (hit && hit.type === 'text' && e.detail >= 2 && !isModifier) {
        openTextEditor(hit);
        return;
      }

      if (hit) {
        let newIds = [...activeIds];
        
        if (isModifier) {
          // Toggle selection
          if (newIds.includes(hit.id)) {
            newIds = newIds.filter(id => id !== hit.id);
          } else {
            newIds.push(hit.id);
          }
          useSelectionStore.getState().setSelection(identity, pageIndex, newIds);
          
          // Modifier clicks do NOT start a move gesture to keep semantics deterministic
          return;
        } else {
          // If clicking an unselected annotation, replace selection
          if (!activeIds.includes(hit.id)) {
            newIds = [hit.id];
            useSelectionStore.getState().setSelection(identity, pageIndex, newIds);
          }
          
          // Start move gesture
          mode.current = 'moving';
          shapeStart.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
          moveAnchor.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
          gestureSelectedIdsRef.current = [...newIds];
          
          moveBefore.current = new Map();
          for (const id of newIds) {
            const ann = annotations.find(a => a.id === id);
            if (ann) moveBefore.current.set(id, structuredClone(ann));
          }
          
          redrawAnnotationLayer();
          schedulePreviewRender();
          return;
        }
      } else {
        // Clicked empty space. 
        // We do NOT clear selection immediately.
        // We wait for a small drag to either start Marquee, or if no drag, pointerUp will clear it.
        // Let's start the selectDrag mode, but it won't render or commit unless distance > threshold.
        // We store the selection before to optionally restore it if we just clicked and didn't drag.
        selectionBefore.current = [...activeIds];
        
        if (!isModifier) {
          // If no modifier, empty click *will* clear selection eventually, but we can do it optimistically here
          // so the selection UI disappears immediately when clicking empty space.
          // BUT wait, what if they cancel the gesture? `selectionBefore` restores it.
          useSelectionStore.getState().clearSelection(identity);
        }
        
        mode.current = 'selectDrag';
        selectionStart.current = { screenX, screenY };
        currentEnd.current = { screenX, screenY };
        schedulePreviewRender();
      }
      return;
    }
  }

  // ── Pointer move ──────────────────────────────────────────────────────────

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (isForeignPointer(e)) return;
    shiftKeyRef.current = e.shiftKey;
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
      // Predicted points shorten the visible lag; they are preview-only.
      predictedPoints.current = (e.nativeEvent.getPredictedEvents?.() ?? []).slice(0, 2).map((ev) => ({
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
        pressure: ev.pressure > 0 ? ev.pressure : 0.5,
        timestamp: ev.timeStamp,
      }));
      schedulePreviewRender();
      return;
    }

    if (m === 'freeformDrawing') {
      if (e.buttons === 1) { // Left mouse button is down, draw freehand
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
      }
      currentEnd.current = { screenX, screenY };
      schedulePreviewRender();
      return;
    }

    if (m === 'erasing') {
      // Use coalesced events to avoid gaps
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      const rect = interactionRef.current!.getBoundingClientRect();
      for (const ev of events) {
        activePoints.current.push({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          pressure: 0.5,
          timestamp: ev.timeStamp,
        });
        const intermediatePdfPt = screenToPdfPoint(ev.clientX - rect.left, ev.clientY - rect.top);
        doEraseSweptPath(intermediatePdfPt);
      }
      return;
    }

    if (m === 'shapeDrawing') {
      let endX = screenX;
      let endY = screenY;
      if (e.shiftKey && shapeStart.current) {
        const dx = screenX - shapeStart.current.screenX;
        const dy = screenY - shapeStart.current.screenY;
        const tool = gestureToolRef.current ?? interactionTool;
        if (tool === 'rectangle' || tool === 'ellipse' || tool === 'roundedRect') {
          // Constrain to 1:1 aspect ratio
          const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
          endX = shapeStart.current.screenX + (dx < 0 ? -1 : 1) * maxDist;
          endY = shapeStart.current.screenY + (dy < 0 ? -1 : 1) * maxDist;
        } else if (tool === 'line' || tool === 'arrow') {
          // Constrain to 45 degree increments
          const angle = Math.atan2(dy, dx);
          const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const dist = Math.sqrt(dx * dx + dy * dy);
          endX = shapeStart.current.screenX + Math.cos(snappedAngle) * dist;
          endY = shapeStart.current.screenY + Math.sin(snappedAngle) * dist;
        }
      }
      currentEnd.current = { screenX: endX, screenY: endY };
      schedulePreviewRender();
      return;
    }

    if (m === 'selectDrag') {
      currentEnd.current = { screenX, screenY };
      schedulePreviewRender();
      return;
    }

    if (m === 'moving' && moveAnchor.current) {
      moveAnchor.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
      schedulePreviewRender();
      return;
    }

    if (m === 'resizing' && resizeHandle.current && originalGroupBounds.current) {
      moveAnchor.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
      schedulePreviewRender();
      return;
    }
  }

  // ── Pointer up ────────────────────────────────────────────────────────────

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    const m = mode.current;
    predictedPoints.current = [];
    if (interactionRef.current?.hasPointerCapture(e.pointerId)) {
      interactionRef.current.releasePointerCapture(e.pointerId);
    }
    activePointerIdRef.current = null;
    e.preventDefault();
    
    if (m !== 'freeformDrawing') {
      clearDrawingCanvas();
    }

    if (m === 'drawing') {
      commitStroke();
    } else if (m === 'erasing') {
      commitEraser();
    } else if (m === 'shapeDrawing') {
      commitShape();
    } else if (m === 'selectDrag') {
      commitRubberBand(e);
    } else if (m === 'moving') {
      commitMove();
    } else if (m === 'resizing') {
      commitResize();
    }

    if (m === 'freeformDrawing') {
      // activePoints are screen-space (CSS px) while drawing a polygon.
      const startPtScreen = activePoints.current[0];
      if (startPtScreen && activePoints.current.length >= 3) {
        const { screenX, screenY } = getPagePoint(e);
        const distToStart = Math.hypot(screenX - startPtScreen.x, screenY - startPtScreen.y);
        if (distToStart < 12) {
          commitFreeform();
          return;
        }
      }
    } else {
      mode.current = 'idle';
      shapeStart.current = null;
      selectionStart.current = null;
      moveAnchor.current = null;
      resizeHandle.current = null;
      originalGroupBounds.current = null;
      activePoints.current = [];
      gestureToolRef.current = null;
      selectionBefore.current = [];
      moveBefore.current.clear();
      gestureSelectedIdsRef.current = [];
      setIsDrawing(textEditingRef.current);
      if (!textEditingRef.current) onInteractionPinChange?.(false);
      redrawAnnotationLayer(); // redraw committed layer after transient gesture completes
    }
  }

  function onPointerCancel() {
    cancelActiveInteraction();
  }

  // Capture lost without a pointerup/pointercancel (OS focus change, window
  // hidden for a screenshot, …): abandon the gesture instead of leaving it armed.
  function onLostPointerCapture(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== e.pointerId) return;
    if (mode.current === 'idle' || mode.current === 'freeformDrawing') return;
    cancelActiveInteraction();
  }

  // ── Stroke commit ─────────────────────────────────────────────────────────

  function commitStroke() {
    // A single tap with the pen leaves a dot; the highlighter needs a drag.
    const ann = buildInkAnnotation(activePoints.current, gestureToolRef.current, true);
    if (!ann) return;
    addAnnotation(docId, ann);
    pushHistory(makeAddAction(docId, ann));
  }

  // ── Freeform commit ───────────────────────────────────────────────────────

  function commitFreeform() {
    const screenPts = activePoints.current;
    if (screenPts.length < 3) {
      cancelActiveInteraction();
      return;
    }

    const pdfPts = screenPointsToPdf(screenPts, transform);
    const id = nanoid();
    const now = Date.now();

    const ann: import('../../types/annotations').FreeformAnnotation = {
      id, pageIndex, type: 'freeform',
      points: pdfPts,
      color: toolOptions.shape.color,
      strokeWidth: toolOptions.shape.strokeWidth,
      fillColor: toolOptions.shape.fillColor,
      opacity: toolOptions.shape.opacity,
      locked: false, createdAt: now, updatedAt: now,
    };
    
    addAnnotation(docId, ann);
    pushHistory(makeAddAction(docId, ann));
    
    // reset mode
    mode.current = 'idle';
    activePoints.current = [];
    currentEnd.current = { screenX: 0, screenY: 0 };
    setIsDrawing(false);
    onInteractionPinChange?.(false);
    clearDrawingCanvas();
    redrawAnnotationLayer();
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
      borderStyle: toolOptions.shape.borderStyle,
      fillColor: toolOptions.shape.fillColor,
      cornerRadius: 8,
      locked: false, createdAt: now, updatedAt: now,
    };
    addAnnotation(docId, ann);
    pushHistory(makeAddAction(docId, ann));
  }

  // ── Eraser ────────────────────────────────────────────────────────────────

  function doEraseSweptPath(currentPdfPt: PdfPoint) {
    const prevPdfPt = lastEraserPointRef.current ?? currentPdfPt;
    const eraserRadiusPdf = toolOptions.eraser.size / (2 * scale);
    
    // We only mutate eraserHitsRef based on originalEraserSnapshotRef, 
    // ensuring we don't double-split or lose track of original annotations.
    let changed = false;
    let dirty: PdfRect | null = null;
    const markDirty = (ann: Annotation) => {
      const bounds = getCachedBounds(ann);
      dirty = dirty ? unionRects(dirty, bounds) : bounds;
    };

    const sweepMinX = Math.min(prevPdfPt.x, currentPdfPt.x);
    const sweepMaxX = Math.max(prevPdfPt.x, currentPdfPt.x);
    const sweepMinY = Math.min(prevPdfPt.y, currentPdfPt.y);
    const sweepMaxY = Math.max(prevPdfPt.y, currentPdfPt.y);

    // For object erasing, we can use the existing eraserHitTest on current and prev points
    const objectHits = new Set<string>();
    if (toolOptions.eraser.mode === 'object') {
      const hitsCurrent = eraserHitTest(currentPdfPt, originalEraserSnapshotRef.current, eraserRadiusPdf);
      const hitsPrev = eraserHitTest(prevPdfPt, originalEraserSnapshotRef.current, eraserRadiusPdf);
      hitsCurrent.forEach(h => objectHits.add(h.id));
      hitsPrev.forEach(h => objectHits.add(h.id));
    }

    for (const ann of originalEraserSnapshotRef.current) {
      if (ann.locked || ann.hidden) continue;
      
      // If already deleted in this sweep, skip
      const existingHit = eraserHitsRef.current.get(ann.id);
      if (existingHit?.type === 'delete') continue;

      if (toolOptions.eraser.mode === 'object') {
        if (objectHits.has(ann.id)) {
           eraserHitsRef.current.set(ann.id, { type: 'delete' });
           markDirty(ann);
           changed = true;
        }
      } else if (toolOptions.eraser.mode === 'stroke' && (ann.type === 'stroke' || ann.type === 'highlight')) {
        // Cheap reject: skip strokes whose padded bounds miss the eraser capsule.
        const bounds = getAnnotationBounds(ann);
        const reach = eraserRadiusPdf;
        if (bounds.x - reach > sweepMaxX || bounds.x + bounds.width + reach < sweepMinX
          || bounds.y - reach > sweepMaxY || bounds.y + bounds.height + reach < sweepMinY) {
          continue;
        }

        // Find existing segments or use original points
        const pointsToSplit = (existingHit?.type === 'split') ? existingHit.segments : [ann.points];

        const newSegments: InputPoint[][] = [];
        let didSplit = false;

        for (const segment of pointsToSplit) {
          const result = eraseStrokePath(segment, ann.width, prevPdfPt, currentPdfPt, eraserRadiusPdf);
          if (result.erased) didSplit = true;
          newSegments.push(...result.segments);
        }

        if (didSplit) {
          if (newSegments.length === 0) {
             eraserHitsRef.current.set(ann.id, { type: 'delete' });
          } else {
             eraserHitsRef.current.set(ann.id, {
               type: 'split',
               segments: newSegments,
               pieces: newSegments.map((points) => ({ ...ann, points } as Annotation)),
             });
          }
          markDirty(ann);
          changed = true;
        }
      }
    }

    lastEraserPointRef.current = currentPdfPt;
    
    if (changed) {
      // Repaint only the touched area, at most once per frame.
      scheduleLayerRedraw(dirty ?? undefined);
    }
    schedulePreviewRender(); // update the eraser cursor
  }

  function commitEraser() {
    if (eraserHitsRef.current.size === 0) return;

    const annotationStore = useAnnotationStore.getState();
    const current = annotationStore.getPageAnnotations(docId, pageIndex);
    const nextAnnotations: Annotation[] = [];
    const actions: HistoryActionDraft[] = [];
    const now = Date.now();

    // Walk the page in z-order. Split pieces take the erased stroke's place and
    // every action records its array index, so undo/redo restore stacking
    // order exactly (actions replay sequentially against the evolving list).
    for (const ann of current) {
      const hit = eraserHitsRef.current.get(ann.id);
      const original = hit ? originalEraserSnapshotRef.current.find(a => a.id === ann.id) : undefined;
      if (!hit || !original) {
        nextAnnotations.push(ann);
        continue;
      }

      const position = nextAnnotations.length;
      actions.push({
        type: 'REMOVE_ANNOTATION',
        docId,
        pageIndex,
        annotationId: ann.id,
        index: position,
        before: ann,
        after: null,
      });

      if (hit.type === 'split' && (original.type === 'stroke' || original.type === 'highlight')) {
        for (const pts of hit.segments) {
          const piece = { ...original, id: generateId(), points: pts, updatedAt: now } as Annotation;
          actions.push({
            type: 'ADD_ANNOTATION',
            docId,
            pageIndex,
            annotationId: piece.id,
            index: nextAnnotations.length,
            before: null,
            after: piece,
          });
          nextAnnotations.push(piece);
        }
      }
    }

    if (actions.length > 0) {
      annotationStore.setPageAnnotations(docId, pageIndex, nextAnnotations);
      pushHistory(makeBatchAction(docId, actions));
    }

    eraserHitsRef.current.clear();
    originalEraserSnapshotRef.current = [];
    lastEraserPointRef.current = null;
    redrawAnnotationLayer();
  }

  // ── Selection: rubber-band commit ─────────────────────────────────────────

  function commitRubberBand(e: React.PointerEvent<HTMLDivElement>) {
    if (!selectionStart.current) return;
    const { screenX: sx, screenY: sy } = selectionStart.current;
    const { screenX: ex, screenY: ey } = currentEnd.current;

    const isModifier = e.metaKey || e.shiftKey;

    if (Math.hypot(ex - sx, ey - sy) < 4) {
      // Empty click
      if (isModifier) {
        // Modifier + empty click -> restore previous selection
        useSelectionStore.getState().setSelection(identity, pageIndex, selectionBefore.current);
      } else {
        // Plain empty click -> clear selection (already optimistically cleared in down)
      }
      return;
    }

    // Convert rubber-band corners to PDF space
    const selectionRect = screenRectToPdfBounds(
      { x: Math.min(sx, ex), y: Math.min(sy, ey), width: Math.abs(ex - sx), height: Math.abs(ey - sy) },
      transform,
    );

    const annotations = getPageAnnotations(docId, pageIndex);
    const newSelection: string[] = [];
    
    // Maintain z-order (same order as annotations array)
    for (const ann of annotations) {
      if (ann.hidden || ann.locked) continue;
      if (hitTestMarquee(selectionRect, ann)) {
        newSelection.push(ann.id);
      }
    }
    
    let finalSelection = newSelection;
    if (isModifier) {
      // Additive selection
      const combined = new Set([...selectionBefore.current, ...newSelection]);
      finalSelection = Array.from(combined);
      // Re-sort to maintain z-order
      finalSelection = annotations.filter(a => combined.has(a.id)).map(a => a.id);
    }
    
    useSelectionStore.getState().setSelection(identity, pageIndex, finalSelection);
  }

  // ── Move ─────────────────────────────────────────────────────────────────



  function commitMove() {
    if (!shapeStart.current || !moveAnchor.current) return;
    const dx = moveAnchor.current.pdfX - shapeStart.current.pdfX;
    const dy = moveAnchor.current.pdfY - shapeStart.current.pdfY;
    
    // Only commit to store if there was actual movement
    if (Math.hypot(dx, dy) > 0.001) {
      const actions: HistoryActionDraft[] = [];
      for (const [id, before] of moveBefore.current) {
        const after = translateAnnotation(before, dx, dy);
        after.updatedAt = Date.now(); // update time
        replaceAnnotation(docId, pageIndex, after);
        actions.push({
          type: 'MOVE_ANNOTATION',
          docId, pageIndex, annotationId: id,
          before: structuredClone(before),
          after: structuredClone(after),
        });
      }
      
      if (actions.length === 1) {
        pushHistory(makeMoveAction(docId, actions[0].before!, actions[0].after!));
      } else if (actions.length > 1) {
        pushHistory(makeBatchAction(docId, actions));
      }
    }
    moveBefore.current.clear();
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  function commitResize() {
    if (!resizeHandle.current || !moveAnchor.current || !originalGroupBounds.current) return;
    
    const targetGroupBounds = getTargetGroupBounds();
    
    const actions: HistoryActionDraft[] = [];
    for (const [id, before] of moveBefore.current) {
      const after = scaleAnnotationFromBounds(before, originalGroupBounds.current, targetGroupBounds);
      if (after === before) continue; // no change
      after.updatedAt = Date.now();
      replaceAnnotation(docId, pageIndex, after);
      actions.push({
        type: 'MOVE_ANNOTATION',
        docId, pageIndex, annotationId: id,
        before: structuredClone(before),
        after: structuredClone(after),
      });
    }
    
    if (actions.length === 1) {
      pushHistory(makeMoveAction(docId, actions[0].before!, actions[0].after!));
    } else if (actions.length > 1) {
      pushHistory(makeBatchAction(docId, actions));
    }
    moveBefore.current.clear();
  }

  function getTargetGroupBounds(): import('../../types/annotations').PdfRect {
    if (!originalGroupBounds.current || !resizeHandle.current || !moveAnchor.current) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const singleAnn = gestureSelectedIdsRef.current.length === 1
      ? moveBefore.current.get(gestureSelectedIdsRef.current[0])
      : undefined;
    // Single image: corner handles keep the aspect ratio unless Shift is held.
    const lockAspect = singleAnn?.type === 'image' && !shiftKeyRef.current;
    return computeResizeTargetBounds(
      originalGroupBounds.current,
      resizeHandle.current.id,
      { x: moveAnchor.current.pdfX, y: moveAnchor.current.pdfY },
      lockAspect,
    );
  }

  function cancelActiveInteraction(): boolean {
    const activeMode = mode.current;
    const hadTextEditor = textEditingRef.current;
    if (activeMode === 'idle' && !hadTextEditor) return false;

    if (activeMode === 'moving' || activeMode === 'resizing') {
      // Nothing to write to store since transient preview never modified the store!
    } else if (activeMode === 'selectDrag') {
      useSelectionStore.getState().setSelection(identity, pageIndex, selectionBefore.current);
    }

    if (hadTextEditor) {
      suppressTextBlurCommitRef.current = true;
      textEditingRef.current = false;
      editingTextIdRef.current = null;
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
    originalGroupBounds.current = null;
    gestureToolRef.current = null;
    selectionBefore.current = [];
    gestureSelectedIdsRef.current = [];
    eraserHitsRef.current.clear();
    originalEraserSnapshotRef.current = [];
    lastEraserPointRef.current = null;
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

  // Page unmounted mid-gesture (tab switch, virtualization): do not leave the
  // app believing a drawing is still in progress.
  useEffect(() => () => {
    if (mode.current !== 'idle' || textEditingRef.current) {
      useUIStore.getState().setIsDrawing(false);
    }
  }, []);

  // ── Text overlay ──────────────────────────────────────────────────────────

  function beginTextEditing(overlay: TextOverlay) {
    suppressTextBlurCommitRef.current = false;
    textEditingRef.current = true;
    editingTextIdRef.current = overlay.editingId ?? null;
    setIsDrawing(true);
    onInteractionPinChange?.(true);
    setTextOverlay(overlay);
    if (overlay.editingId) redrawAnnotationLayer();
    // Focus textarea on next tick
    setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 50);
  }

  function openTextOverlay(screenX: number, screenY: number, pdfX: number, pdfY: number) {
    const opts = toolOptions.text;
    beginTextEditing({
      x: screenX,
      y: screenY,
      pdfX,
      pdfY,
      initial: '',
      style: {
        fontFamily: opts.fontFamily,
        fontSize: opts.fontSize,
        bold: opts.bold,
        italic: opts.italic,
        underline: opts.underline,
        align: opts.align,
        color: opts.color,
        backgroundColor: opts.backgroundColor,
        borderColor: opts.borderColor ?? 'transparent',
        borderWidth: opts.borderWidth ?? 0,
        listStyle: opts.listStyle ?? 'none',
      },
    });
  }

  /** Edit an existing text annotation in place (double-click, Enter, or Text tool click). */
  function openTextEditor(annotation: TextAnnotation) {
    if (annotation.locked) return;
    useSelectionStore.getState().clearSelection(identity);
    const top = annotation.bounds.y + annotation.bounds.height;
    const screen = pdfToScreen(annotation.bounds.x, top, transform);
    beginTextEditing({
      x: screen.x,
      y: screen.y,
      pdfX: annotation.bounds.x,
      pdfY: top,
      editingId: annotation.id,
      initial: annotation.content,
      style: {
        fontFamily: annotation.fontFamily,
        fontSize: annotation.fontSize,
        bold: annotation.bold,
        italic: annotation.italic,
        underline: annotation.underline,
        align: annotation.align,
        color: annotation.color,
        backgroundColor: annotation.backgroundColor,
        borderColor: annotation.borderColor ?? 'transparent',
        borderWidth: annotation.borderWidth ?? 0,
        listStyle: annotation.listStyle ?? 'none',
      },
    });
  }

  function commitText(content: string, overlay: TextOverlay) {
    const { style } = overlay;
    const size = autoSizeTextBox({ content, fontSize: style.fontSize, listStyle: style.listStyle }, canvasMeasure(style));
    const bounds = { x: overlay.pdfX, y: overlay.pdfY - size.height, width: size.width, height: size.height };
    const now = Date.now();

    if (overlay.editingId) {
      const before = getPageAnnotations(docId, pageIndex).find((a) => a.id === overlay.editingId);
      if (!before || before.type !== 'text') return;
      if (!content.trim()) {
        // Emptied → delete (undo restores it in place).
        const index = getPageAnnotations(docId, pageIndex).findIndex((a) => a.id === before.id);
        useAnnotationStore.getState().removeAnnotation(docId, pageIndex, before.id);
        pushHistory(makeRemoveAction(docId, before, index));
        return;
      }
      if (content === before.content) return;
      const after: TextAnnotation = { ...before, content, bounds, updatedAt: now };
      replaceAnnotation(docId, pageIndex, after);
      pushHistory(makeUpdateAction(docId, before, after));
      return;
    }

    if (!content.trim()) return; // Discard empty annotations
    const ann: TextAnnotation = {
      id: nanoid(), pageIndex, type: 'text',
      bounds,
      content,
      ...style,
      opacity: 1,
      locked: false, createdAt: now, updatedAt: now,
    };
    addAnnotation(docId, ann);
    pushHistory(makeAddAction(docId, ann));
  }

  function endTextEditing() {
    textEditingRef.current = false;
    editingTextIdRef.current = null;
    setTextOverlay(null);
    setIsDrawing(false);
    onInteractionPinChange?.(false);
    redrawAnnotationLayer();
  }

  function onTextKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelActiveInteraction();
      return;
    }
    if (e.key === 'Enter' && mode.current === 'freeformDrawing') {
      e.preventDefault();
      commitFreeform();
      return;
    }
    // Ctrl/Cmd + Enter → commit
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const content = e.currentTarget.value;
      if (textOverlay) commitText(content, textOverlay);

      suppressTextBlurCommitRef.current = true;
      endTextEditing();
    }
  }

  function onTextBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    if (suppressTextBlurCommitRef.current) return;
    const content = e.currentTarget.value;
    if (textOverlay) commitText(content, textOverlay);
    endTextEditing();
  }

  // ── Drag & Drop handler ───────────────────────────────────────────────────

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const targetSnapshot: InsertTargetSnapshot = { identity, pageIndex };
    const rect = interactionRef.current!.getBoundingClientRect();
    const dropScreenX = e.clientX - rect.left;
    const dropScreenY = e.clientY - rect.top;
    const dropPdfPt = screenToPdf(dropScreenX, dropScreenY, transform);

    const validFiles: { file: File; mime: string }[] = [];
    for (const file of files) {
      const mime = file.type.toLowerCase();
      if (SUPPORTED_IMAGE_MIME_TYPES.has(mime) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
        validFiles.push({
          file,
          mime: mime || (file.name.endsWith('.png') ? 'image/png' : file.name.endsWith('.webp') ? 'image/webp' : 'image/jpeg'),
        });
      }
    }

    if (validFiles.length === 0) return;

    const createdAnnotations: ImageAnnotation[] = [];
    const historyActions: HistoryActionDraft[] = [];
    let cascadeOffset = 0;

    for (const { file, mime } of validFiles) {
      try {
        const buffer = await file.arrayBuffer();
        const asset = await normalizeAndCreateImageAsset(buffer, mime);

        // Target gone (closed/reloaded): stop, but still record history for
        // images already added so nothing is left untracked.
        if (!isInsertTargetValid(targetSnapshot)) break;

        const bounds = calculateDefaultImageBounds(
          asset.width,
          asset.height,
          transform.cropBox,
          { x: dropPdfPt.x + cascadeOffset, y: dropPdfPt.y + cascadeOffset },
        );
        cascadeOffset += 20;

        useAssetStore.getState().addAsset(identity, asset);

        const ann: ImageAnnotation = {
          id: crypto.randomUUID(),
          pageIndex,
          type: 'image',
          color: '#000000',
          opacity: 1,
          locked: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          assetId: asset.id,
        };

        useAnnotationStore.getState().addAnnotation(docId, ann);
        createdAnnotations.push(ann);

        historyActions.push({
          type: 'ADD_ANNOTATION',
          docId,
          pageIndex,
          annotationId: ann.id,
          before: null,
          after: ann,
        });
      } catch (err) {
        console.warn(`[Drop] Failed to insert file ${file.name}:`, err);
        notifyUser('error', `${file.name} could not be inserted: ${errorMessage(err)}`);
      }
    }

    if (historyActions.length === 1) {
      useHistoryStore.getState().push(makeAddAction(docId, createdAnnotations[0]));
    } else if (historyActions.length > 1) {
      useHistoryStore.getState().push(makeBatchAction(docId, historyActions));
    }

    if (createdAnnotations.length > 0) {
      useSelectionStore.getState().selectAnnotation(identity, pageIndex, createdAnnotations[createdAnnotations.length - 1].id);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        cursor: getCursor(interactionTool, mode.current),
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <canvas
        ref={highlightCanvasRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          pointerEvents: 'none',
          mixBlendMode: 'multiply',
        }}
      />
      <canvas
        ref={annotationCanvasRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={drawingCanvasRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          pointerEvents: 'none',
          opacity: (mode.current === 'moving' || mode.current === 'resizing') ? 0.7 : 1, // Visual feedback during transient moves
        }}
      />

      {textOverlay && (
        <textarea
          ref={textareaRef}
          defaultValue={textOverlay.initial}
          onKeyDown={onTextKeyDown}
          onBlur={onTextBlur}
          aria-label={textOverlay.editingId ? 'Edit text annotation' : 'New text annotation'}
          spellCheck={false}
          style={{
            position: 'absolute',
            left: textOverlay.x,
            top: textOverlay.y,
            // Grows with the content like the committed (auto-sized) box.
            fieldSizing: 'content',
            minWidth: 40,
            maxWidth: MAX_AUTO_TEXT_WIDTH * scale,
            minHeight: textOverlay.style.fontSize * LINE_HEIGHT * scale + TEXT_PADDING * 2 * scale,
            font: cssFont({ ...textOverlay.style, fontSize: textOverlay.style.fontSize * scale }),
            lineHeight: LINE_HEIGHT,
            textDecoration: textOverlay.style.underline ? 'underline' : 'none',
            textAlign: textOverlay.style.align,
            color: textOverlay.style.color,
            backgroundColor: textOverlay.style.backgroundColor || 'transparent',
            border: '1px dashed #007aff',
            boxSizing: 'border-box',
            outline: 'none',
            resize: 'none',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            padding: TEXT_PADDING * scale,
            pointerEvents: 'auto',
            zIndex: 10,
          } as React.CSSProperties}
        />
      )}

      {(() => {
        const selectedAnnotation = annotations.find(a => a.id === selectedIdsArray[0]);
        if (selectedIdsArray.length === 1 && selectedAnnotation) {
          return (
            <FloatingInspector
              annotation={selectedAnnotation}
              transform={transform}
              identity={identity}
              pageIndex={pageIndex}
              canvasRef={annotationCanvasRef}
            />
          );
        }
        return null;
      })()}

      <div
        ref={interactionRef}
        data-annotation-canvas="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={handleDrop}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          touchAction: 'none',
          pointerEvents: textEditingRef.current ? 'none' : 'auto',
          zIndex: 20,
        }}
      />
    </div>
  );
});

export default AnnotationCanvas;
