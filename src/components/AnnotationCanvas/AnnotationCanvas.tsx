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
  isMultiplyAnnotation,
} from '../../pdf/annotationRenderer';
import { simplifyInkPoints, stabilizePoints } from '../../pdf/inkGeometry';
import { annotationsInLasso } from '../../pdf/lassoSelect';
import { recognizeShape, type RecognizedShape } from '../../pdf/shapeRecognizer';
import { penButtonTool } from '../../utils/penButtons';
import { computeLayerRegion, regionOutputScale, type LayerRegion } from '../../pdf/layerRegion';
import { projectOntoEdge, snapEdgeFor, useRulerStore, type EdgeLine } from '../../store/rulerStore';
import { buildReplayPlan, replayFrame, type ReplayItem } from '../../pdf/inkReplay';
import { REPLAY_INK_EVENT, type ReplayInkDetail } from './replayEvents';
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
import { loadPageTextLayout, peekPageTextLayout } from '../../pdf/pageTextLayout';
import { addLaserPoint, endLaserTrail, startLaserTrail } from '../Laser/laserTrail';
import { ERASER_CURSOR, HIGHLIGHTER_CURSOR, LASER_CURSOR, PEN_CURSOR } from './toolCursors';
import { selectText, type TextSelection } from '../../pdf/textSelection';
import type { TextMarkupAnnotation } from '../../types/annotations';
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
  | 'lassoDrag'     // free-form lasso selection
  | 'markupDrag'    // text highlight / underline / strikethrough selection
  | 'laser'         // laser pointer (not saved)
  | 'shapeHold'     // pen held still: the stroke became a shape that follows the pen
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
    case 'lasso':       return 'crosshair';
    case 'pen':         return PEN_CURSOR;
    case 'highlighter': return HIGHLIGHTER_CURSOR;
    case 'eraser':      return ERASER_CURSOR;
    case 'text':        return 'text';
    case 'textMarkup':  return 'text';
    case 'laserPointer': return LASER_CURSOR;
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

/** Ink to Shape: the recognised clean shape for a pen stroke, or null. */
function shapeFromInk(stroke: Extract<Annotation, { type: 'stroke' }>): Annotation | null {
  const shape = recognizeShape(stroke.points);
  if (!shape) return null;
  const common = {
    id: stroke.id, pageIndex: stroke.pageIndex, color: stroke.color, opacity: stroke.opacity,
    locked: false, createdAt: stroke.createdAt, updatedAt: stroke.updatedAt,
  };
  if (shape.kind === 'polygon') {
    return { ...common, type: 'freeform', points: shape.points, strokeWidth: stroke.width, fillColor: 'transparent' };
  }
  const [startPoint, endPoint] = shape.kind === 'line' || shape.kind === 'arrow'
    ? [shape.start, shape.end]
    : [{ x: shape.x, y: shape.y }, { x: shape.x + shape.width, y: shape.y + shape.height }];
  return {
    ...common, type: 'shape', shapeKind: shape.kind,
    startPoint, endPoint, strokeWidth: stroke.width, fillColor: 'transparent',
  };
}

/** Pen held still this long (while drawing) turns the stroke into a shape. */
const HOLD_TO_SHAPE_MS = 420;
/** Moving more than this (screen px) restarts the hold timer. */
const HOLD_TO_SHAPE_SLOP_PX = 10;

/**
 * Hold-to-shape: the recognized shape stretches with the pen until it lifts.
 * Lines and arrows move their end, rectangles and ellipses their far corner,
 * polygons scale around their centre.
 */
function stretchShape(shape: RecognizedShape, snapAt: PdfPoint, pointer: PdfPoint): RecognizedShape {
  if (shape.kind === 'line' || shape.kind === 'arrow') return { ...shape, end: { ...pointer } };
  if (shape.kind === 'rectangle' || shape.kind === 'ellipse') {
    // Keep the corner farthest from where the pen was when the shape appeared.
    const corners = [
      { x: shape.x, y: shape.y }, { x: shape.x + shape.width, y: shape.y },
      { x: shape.x, y: shape.y + shape.height }, { x: shape.x + shape.width, y: shape.y + shape.height },
    ];
    const anchor = corners.reduce((a, b) => (Math.hypot(b.x - snapAt.x, b.y - snapAt.y) > Math.hypot(a.x - snapAt.x, a.y - snapAt.y) ? b : a));
    return {
      ...shape,
      x: Math.min(anchor.x, pointer.x), y: Math.min(anchor.y, pointer.y),
      width: Math.abs(pointer.x - anchor.x), height: Math.abs(pointer.y - anchor.y),
    };
  }
  const cx = shape.points.reduce((a, p) => a + p.x, 0) / shape.points.length;
  const cy = shape.points.reduce((a, p) => a + p.y, 0) / shape.points.length;
  const k = Math.max(0.2, Math.hypot(pointer.x - cx, pointer.y - cy) / (Math.hypot(snapAt.x - cx, snapAt.y - cy) || 1));
  return { kind: 'polygon', points: shape.points.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k })) };
}

function annotationFromShape(
  shape: RecognizedShape,
  base: { id: string; pageIndex: number; color: string; opacity: number; width: number; createdAt: number },
): Annotation {
  const common = {
    id: base.id, pageIndex: base.pageIndex, color: base.color, opacity: base.opacity,
    locked: false, createdAt: base.createdAt, updatedAt: base.createdAt,
  };
  if (shape.kind === 'polygon') {
    return { ...common, type: 'freeform', points: shape.points, strokeWidth: base.width, fillColor: 'transparent' };
  }
  const [startPoint, endPoint] = shape.kind === 'line' || shape.kind === 'arrow'
    ? [{ x: shape.start.x, y: shape.start.y }, { x: shape.end.x, y: shape.end.y }]
    : [{ x: shape.x, y: shape.y }, { x: shape.x + shape.width, y: shape.y + shape.height }];
  return { ...common, type: 'shape', shapeKind: shape.kind, startPoint, endPoint, strokeWidth: base.width, fillColor: 'transparent' };
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
  const holdTimer        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdAnchor       = useRef<{ x: number; y: number } | null>(null);
  const holdShape        = useRef<{ base: RecognizedShape; current: RecognizedShape; snapAt: PdfPoint } | null>(null);
  const markupDrag       = useRef<{ from: PdfPoint; to: PdfPoint; selection: TextSelection | null } | null>(null);
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
  const penButtonSelectionRef = useRef(false);
  const rulerSnapRef = useRef<{ edge: EdgeLine; offset: number } | null>(null);
  const replayRef = useRef<{ plan: ReplayItem[]; startedAt: number; painted: number; raf: number | null } | null>(null);
  const [replaying, setReplaying] = useState(false);
  const layerRedrawId = useRef<number | null>(null);
  const pendingRedrawRegion = useRef<PdfRect | null>(null);
  const lastLayerDraw = useRef<{
    list: Annotation[]; transform: PageTransform; dpr: number; overlay: boolean; width: number; height: number;
    region: LayerRegion;
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
  const selectedTool = interactionTool; // before per-gesture pen-button overrides
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

  // The text highlight tool needs the page's text positions: load them early.
  useEffect(() => {
    if (selectedTool === 'textMarkup') void loadPageTextLayout(identity, pageIndex);
  }, [selectedTool, identity, pageIndex]);

  const selectionState = useSelectionStore(state => state.getSelection(identity));
  // Same stability rule for the ids array
  const selectedIdsArray = (selectionState?.pageIndex === pageIndex)
    ? selectionState.selectedIds
    : EMPTY_IDS;

  // A selection belongs to the Select tool. Switching to another persistent
  // tool clears it; the temporary Space/Hand gesture does not.
  // A lasso made with the pen's barrel button keeps working with the pen
  // tool (tap inside to drag it) until the tool changes.
  useEffect(() => {
    penButtonSelectionRef.current = false;
  }, [activeTool]);
  useEffect(() => {
    if (activeTool !== 'select' && activeTool !== 'lasso' && selectedIdsArray.length > 0
      && !penButtonSelectionRef.current) {
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

  // ── Layer region ──────────────────────────────────────────────────────────
  // The ink canvases cover only the visible part of the page (plus a margin),
  // not the whole page. That keeps them at full screen sharpness (Retina) at
  // any zoom instead of being scaled down to fit a memory budget.
  const [layerRegion, setLayerRegion] = useState<LayerRegion>(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const layerRegionRef = useRef(layerRegion);
  layerRegionRef.current = layerRegion;
  const dpr = regionOutputScale(layerRegion.w, layerRegion.h);
  const dprRef = useRef(dpr);
  dprRef.current = dpr;

  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const element = interactionRef.current;
      if (!element) return;
      const next = computeLayerRegion(element.getBoundingClientRect(), width, height, layerRegionRef.current);
      if (next !== layerRegionRef.current) setLayerRegion(next);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [width, height]);

  /** 2D context whose drawing coordinates are page-local CSS px × dpr. */
  function layerContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
    const ctx = canvas?.getContext('2d') ?? null;
    if (!ctx) return null;
    const region = layerRegionRef.current;
    const scaleOut = dprRef.current;
    ctx.setTransform(1, 0, 0, 1, -region.x * scaleOut, -region.y * scaleOut);
    return ctx;
  }

  function clearLayer(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // ── Canvas sizing ─────────────────────────────────────────────────────────

  function sizeCanvas(canvas: HTMLCanvasElement | null) {
    if (!canvas) return;
    canvas.width  = Math.round(layerRegion.w * dpr);
    canvas.height = Math.round(layerRegion.h * dpr);
    canvas.style.left = `${layerRegion.x}px`;
    canvas.style.top = `${layerRegion.y}px`;
    canvas.style.width  = `${layerRegion.w}px`;
    canvas.style.height = `${layerRegion.h}px`;
  }

  // Switching tools ends the current gesture (a stroke in progress is kept).
  useEffect(() => {
    if (!finishInkIfDrawing()) cancelActiveInteraction();
  }, [interactionTool]);

  useEffect(() => {
    sizeCanvas(highlightCanvasRef.current);
    sizeCanvas(annotationCanvasRef.current);
    sizeCanvas(drawingCanvasRef.current);
    lastLayerDraw.current = null;
    redrawAnnotationLayer();
    if (mode.current !== 'idle') renderPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerRegion, dpr]);

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
    const ctx = layerContext(canvas);
    if (!ctx) return;
    const highlightCanvas = highlightCanvasRef.current;
    const highlightCtx = layerContext(highlightCanvas);

    const isActiveGesture = mode.current === 'moving' || mode.current === 'resizing';
    const activeIds = isActiveGesture ? gestureSelectedIdsRef.current : [];
    
    const selectionState = useSelectionStore.getState().getSelection(identity);
    const transientStyle = selectionState?.pageIndex === pageIndex ? selectionState.transientStyle : undefined;
    const currentSelectedIds = selectionState?.pageIndex === pageIndex ? selectionState.selectedIds : [];
    const currentAnnotations = replayRef.current ? [] : getPageAnnotations(docId, pageIndex);

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
    const surfaceRegion = layerRegionRef.current;
    const sameSurface = previous !== null && previous.transform === transform && previous.dpr === dpr
      && previous.width === canvas.width && previous.height === canvas.height && previous.region === surfaceRegion;

    const paint = (list: Annotation[]) => {
      if (highlightCtx) {
        renderAnnotations(highlightCtx, list.filter(isMultiplyAnnotation), transform, dpr, identity);
        renderAnnotations(ctx, list.filter((a) => !isMultiplyAnnotation(a)), transform, dpr, identity, () => redrawAnnotationLayer());
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
      lastLayerDraw.current = { list: committedAnnotations, transform, dpr, overlay: false, width: canvas.width, height: canvas.height, region: surfaceRegion };
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
    if (replayRef.current) replayRef.current.painted = 0; // the replay repaints what it had shown
    clearLayer(ctx, canvas);
    if (highlightCanvas && highlightCtx) clearLayer(highlightCtx, highlightCanvas);
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
      list: committedAnnotations, transform, dpr, overlay: showOverlay, width: canvas.width, height: canvas.height, region: surfaceRegion,
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
    const ctx = layerContext(canvas);
    if (ctx) clearLayer(ctx, canvas);
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
    const ctx = layerContext(canvas);
    if (!ctx) return;
    clearLayer(ctx, canvas);

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
    } else if (m === 'shapeHold') {
      const ann = holdShapeAnnotation('preview');
      if (ann) renderAnnotations(ctx, [ann], transform, dpr);
    } else if (m === 'markupDrag') {
      const selection = markupDrag.current?.selection;
      if (selection) renderAnnotations(ctx, [markupFromSelection(selection, 'preview')], transform, dpr);
    } else if (m === 'selectDrag' && selectionStart.current) {
      const { screenX: sx, screenY: sy } = selectionStart.current;
      const { screenX: ex, screenY: ey } = currentEnd.current;
      renderSelectionRect(ctx, sx, sy, ex, ey, dpr);
    } else if (m === 'lassoDrag') {
      const pts = activePoints.current;
      if (pts.length > 1) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 122, 255, 0.08)';
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = '#007aff';
        ctx.stroke();
        ctx.restore();
      }
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
    const stabilized = isHighlight ? screenPts : stabilizePoints(screenPts, toolOptions.pen.stabilizer);
    let pdfPts = screenPointsToPdf(stabilized, transform);
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

  /** Window point → page-local point, following the ruler edge when snapped. */
  function toLocalInkPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = interactionRef.current!.getBoundingClientRect();
    const snap = rulerSnapRef.current;
    const p = snap ? projectOntoEdge(snap.edge, clientX, clientY, snap.offset) : { x: clientX, y: clientY };
    return { x: p.x - rect.left, y: p.y - rect.top };
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

  // ── Ink Replay ────────────────────────────────────────────────────────────

  function stopReplay() {
    const replay = replayRef.current;
    if (!replay) return;
    if (replay.raf !== null) cancelAnimationFrame(replay.raf);
    replayRef.current = null;
    setReplaying(false);
    clearDrawingCanvas();
    lastLayerDraw.current = null; // the layers hold replay drawing: repaint everything
    redrawAnnotationLayer();
  }

  function startReplay() {
    stopReplay();
    cancelActiveInteraction();
    const plan = buildReplayPlan(getPageAnnotations(docId, pageIndex));
    if (plan.length === 0) return;
    replayRef.current = { plan, startedAt: performance.now(), painted: 0, raf: null };
    setReplaying(true);
    redrawAnnotationLayer(); // empty page to start from
    const tick = () => {
      const replay = replayRef.current;
      if (!replay) return;
      const frame = replayFrame(replay.plan, performance.now() - replay.startedAt);
      // Finished items go onto the normal layers once; the growing stroke is
      // drawn on the preview layer.
      const newlyDone = frame.done.slice(replay.painted);
      if (newlyDone.length) {
        const ink = layerContext(annotationCanvasRef.current);
        const marker = layerContext(highlightCanvasRef.current);
        if (ink) renderAnnotations(ink, newlyDone.filter((a) => !isMultiplyAnnotation(a)), transform, dpr, identity);
        if (marker) renderAnnotations(marker, newlyDone.filter(isMultiplyAnnotation), transform, dpr, identity);
        replay.painted = frame.done.length;
      }
      const canvas = drawingCanvasRef.current;
      const ctx = layerContext(canvas);
      if (canvas && ctx) {
        clearLayer(ctx, canvas);
        canvas.style.mixBlendMode = frame.partial?.type === 'highlight' ? 'multiply' : 'normal';
        if (frame.partial) renderAnnotations(ctx, [frame.partial], transform, dpr, identity);
      }
      if (frame.finished) {
        stopReplay();
        return;
      }
      replay.raf = requestAnimationFrame(tick);
    };
    replayRef.current.raf = requestAnimationFrame(tick);
  }

  useEffect(() => {
    const onReplay = (event: Event) => {
      const detail = (event as CustomEvent<ReplayInkDetail>).detail;
      if (detail?.docId === docId && detail.pageIndex === pageIndex) startReplay();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && replayRef.current) stopReplay();
    };
    window.addEventListener(REPLAY_INK_EVENT, onReplay);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(REPLAY_INK_EVENT, onReplay);
      window.removeEventListener('keydown', onKey);
    };
  });

  // Stop a running replay when the page goes away.
  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    const replay = replayRef.current;
    if (replay?.raf != null) cancelAnimationFrame(replay.raf);
    replayRef.current = null;
  }, []);

  // ── Hold to shape ───────────────────────────────────────────────────────

  function clearHoldTimer() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  /** (Re)start the hold timer when the pen has moved away from where it rested. */
  function armHoldToShape(x: number, y: number, force = false) {
    if (gestureToolRef.current !== 'pen' || toolOptions.pen.holdToShape === false) return;
    const anchor = holdAnchor.current;
    if (!force && anchor && Math.hypot(x - anchor.x, y - anchor.y) <= HOLD_TO_SHAPE_SLOP_PX) return;
    holdAnchor.current = { x, y };
    clearHoldTimer();
    holdTimer.current = setTimeout(snapHeldStroke, HOLD_TO_SHAPE_MS);
  }

  function snapHeldStroke() {
    holdTimer.current = null;
    if (mode.current !== 'drawing' || gestureToolRef.current !== 'pen') return;
    const pts = activePoints.current;
    if (pts.length < 5) return;
    const ink = buildInkAnnotation(pts, 'pen');
    if (!ink || ink.type !== 'stroke') return;
    const shape = recognizeShape(ink.points);
    if (!shape) return;
    const last = pts[pts.length - 1];
    holdShape.current = { base: shape, current: shape, snapAt: screenToPdfPoint(last.x, last.y) };
    mode.current = 'shapeHold';
    rulerSnapRef.current = null;
    schedulePreviewRender();
  }

  function holdShapeAnnotation(id: string): Annotation | null {
    const held = holdShape.current;
    if (!held) return null;
    const options = toolOptions.pen;
    return annotationFromShape(held.current, { id, pageIndex, color: options.color, opacity: options.opacity, width: options.width, createdAt: Date.now() });
  }

  function commitHeldShape() {
    const ann = holdShapeAnnotation(nanoid());
    holdShape.current = null;
    if (!ann) return;
    addAnnotation(docId, ann);
    pushHistory(makeAddAction(docId, ann));
  }

  // ── Text markup ─────────────────────────────────────────────────────────

  function updateMarkupSelection() {
    const drag = markupDrag.current;
    if (!drag) return;
    const layout = peekPageTextLayout(identity, pageIndex);
    drag.selection = layout ? selectText(layout, drag.from, drag.to) : null;
    if (!layout) {
      // Still loading: select as soon as the text arrives.
      void loadPageTextLayout(identity, pageIndex).then(() => {
        if (markupDrag.current === drag && mode.current === 'markupDrag') {
          updateMarkupSelection();
          schedulePreviewRender();
        }
      });
    }
  }

  function markupFromSelection(selection: TextSelection, id: string): TextMarkupAnnotation {
    const now = Date.now();
    const options = toolOptions.textMarkup;
    return {
      id, pageIndex, type: 'markup',
      markup: options.markup,
      quads: selection.quads.map((q) => q.map((p) => ({ x: p.x, y: p.y }))),
      text: selection.text,
      color: options.color, opacity: options.opacity,
      locked: false, createdAt: now, updatedAt: now,
    };
  }

  function commitMarkup() {
    const drag = markupDrag.current;
    markupDrag.current = null;
    if (!drag) return;
    if (!drag.selection) {
      const layout = peekPageTextLayout(identity, pageIndex);
      if (layout && layout.glyphs.length === 0) {
        notifyUser('info', 'This page has no selectable text (it may be a scan). Use the Highlighter instead.');
      }
      return;
    }
    const ann = markupFromSelection(drag.selection, nanoid());
    addAnnotation(docId, ann);
    pushHistory(makeAddAction(docId, ann));
  }

  /** Double-click a formula (Select tool) to edit its LaTeX. */
  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (selectedTool !== 'select' || e.metaKey || e.shiftKey) return;
    const rect = interactionRef.current!.getBoundingClientRect();
    const p = screenToPdfPoint(e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitTestAnnotations(p, getPageAnnotations(docId, pageIndex), transform, []);
    if (!hit || hit.type !== 'image' || !hit.formula || hit.locked) return;
    e.preventDefault();
    cancelActiveInteraction();
    useUIStore.getState().setFormulaDialog({
      edit: { docId, annotationId: hit.id, pageIndex, latex: hit.formula.latex, color: hit.formula.color, size: hit.formula.size },
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (replayRef.current) {
      // Any click ends the replay.
      e.preventDefault();
      stopReplay();
      return;
    }
    // A stroke whose pointerup never arrived: keep it before starting anew.
    if ((mode.current === 'drawing' || mode.current === 'shapeHold') && e.pointerType !== 'touch') finishInkIfDrawing();
    // Pen hardware: the eraser end erases, the barrel button lassoes.
    const penButton = penButtonTool(e);
    if (e.button !== 0 && !penButton) return; // left button (or pen tip) only
    if (isForeignPointer(e)) return;
    let interactionTool: ToolType = penButton ?? selectedTool;

    // A pen-button selection: drag it from inside, otherwise drop it and draw.
    if (!penButton && penButtonSelectionRef.current && interactionTool !== 'select' && interactionTool !== 'lasso') {
      const current = useSelectionStore.getState().getSelection(identity);
      const selected = current?.pageIndex === pageIndex
        ? getPageAnnotations(docId, pageIndex).filter((a) => current.selectedIds.includes(a.id))
        : [];
      const bounds = selected.length ? getGroupBounds(selected) : null;
      const { screenX: sx, screenY: sy } = getPagePoint(e);
      const p = screenToPdfPoint(sx, sy);
      if (bounds && p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height) {
        interactionTool = 'lasso';
      } else {
        penButtonSelectionRef.current = false;
        useSelectionStore.getState().clearSelection(identity);
      }
    }
    
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
      // Starting next to the ruler: the whole stroke follows its edge.
      const edge = snapEdgeFor(useRulerStore.getState(), e.clientX, e.clientY);
      const inkWidth = (interactionTool === 'pen' ? toolOptions.pen.width : toolOptions.highlighter.width) * scale;
      rulerSnapRef.current = edge ? { edge, offset: inkWidth / 2 } : null;
      const start = toLocalInkPoint(e.clientX, e.clientY);
      activePoints.current = [{ x: start.x, y: start.y, pressure: e.pressure > 0 ? e.pressure : 0.5, timestamp: e.timeStamp }];
      holdShape.current = null;
      armHoldToShape(start.x, start.y, true);
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

    // ── Laser pointer ──
    if (interactionTool === 'laserPointer') {
      mode.current = 'laser';
      startLaserTrail(e.clientX, e.clientY, e.timeStamp);
      return;
    }

    // ── Text highlight / underline / strikethrough ──
    if (interactionTool === 'textMarkup') {
      mode.current = 'markupDrag';
      markupDrag.current = { from: pdfPt, to: pdfPt, selection: null };
      if (drawingCanvasRef.current) {
        drawingCanvasRef.current.style.mixBlendMode = toolOptions.textMarkup.markup === 'highlight' ? 'multiply' : 'normal';
      }
      updateMarkupSelection();
      schedulePreviewRender();
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

    // ── Select / Lasso ──
    if (interactionTool === 'select' || interactionTool === 'lasso') {
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

      // Lasso: drag inside the current selection moves it; anywhere else
      // starts a new loop (even on top of ink, unlike the Select tool).
      if (interactionTool === 'lasso') {
        const groupBounds = selectedAnns.length > 0 ? getGroupBounds(selectedAnns) : null;
        const insideSelection = groupBounds
          && pdfPt.x >= groupBounds.x && pdfPt.x <= groupBounds.x + groupBounds.width
          && pdfPt.y >= groupBounds.y && pdfPt.y <= groupBounds.y + groupBounds.height;
        if (insideSelection && !(e.shiftKey || e.metaKey)) {
          mode.current = 'moving';
          shapeStart.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
          moveAnchor.current = { screenX, screenY, pdfX: pdfPt.x, pdfY: pdfPt.y };
          gestureSelectedIdsRef.current = [...activeIds];
          moveBefore.current = new Map(selectedAnns.map((ann) => [ann.id, structuredClone(ann)]));
          redrawAnnotationLayer();
          schedulePreviewRender();
          return;
        }
        selectionBefore.current = [...activeIds];
        if (!(e.shiftKey || e.metaKey)) useSelectionStore.getState().clearSelection(identity);
        mode.current = 'lassoDrag';
        activePoints.current = [{ x: screenX, y: screenY, pressure: 0.5, timestamp: e.timeStamp }];
        schedulePreviewRender();
        return;
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

    if (m === 'laser') {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events) addLaserPoint(ev.clientX, ev.clientY, ev.timeStamp);
      return;
    }

    if (m === 'markupDrag') {
      if (markupDrag.current) {
        markupDrag.current.to = pdfPt;
        updateMarkupSelection();
        schedulePreviewRender();
      }
      return;
    }

    if (m === 'drawing') {
      // Use coalesced events for stylus fidelity
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events) {
        const local = toLocalInkPoint(ev.clientX, ev.clientY);
        activePoints.current.push({
          x: local.x,
          y: local.y,
          pressure: ev.pressure > 0 ? ev.pressure : 0.5,
          timestamp: ev.timeStamp,
        });
      }
      // Predicted points shorten the visible lag; they are preview-only.
      predictedPoints.current = (e.nativeEvent.getPredictedEvents?.() ?? []).slice(0, 2).map((ev) => {
        const local = toLocalInkPoint(ev.clientX, ev.clientY);
        return { x: local.x, y: local.y, pressure: ev.pressure > 0 ? ev.pressure : 0.5, timestamp: ev.timeStamp };
      });
      const lastPoint = activePoints.current[activePoints.current.length - 1];
      armHoldToShape(lastPoint.x, lastPoint.y);
      schedulePreviewRender();
      return;
    }

    if (m === 'shapeHold') {
      const held = holdShape.current;
      if (held) {
        held.current = stretchShape(held.base, held.snapAt, pdfPt);
        schedulePreviewRender();
      }
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

    if (m === 'lassoDrag') {
      const rect = interactionRef.current!.getBoundingClientRect();
      for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) {
        activePoints.current.push({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, pressure: 0.5, timestamp: ev.timeStamp });
      }
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
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
      // Some tablet drivers report the pen lift with another pointer id
      // (e.g. as the mouse). Still end the stroke instead of losing it.
      if ((mode.current !== 'drawing' && mode.current !== 'shapeHold') || e.pointerType === 'touch') return;
      finishInkIfDrawing();
      return;
    }
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

    clearHoldTimer();
    if (m === 'drawing') {
      commitStroke();
    } else if (m === 'shapeHold') {
      commitHeldShape();
    } else if (m === 'erasing') {
      commitEraser();
    } else if (m === 'shapeDrawing') {
      commitShape();
    } else if (m === 'selectDrag') {
      commitRubberBand(e);
    } else if (m === 'lassoDrag') {
      commitLasso(e);
    } else if (m === 'markupDrag') {
      commitMarkup();
    } else if (m === 'laser') {
      endLaserTrail(e.timeStamp);
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

  /**
   * Keep what was written: a pen/highlighter stroke in progress is committed
   * (not thrown away) when the gesture ends in an unusual way — pointercancel,
   * lost capture, a missing pointerup, or a tool switch.
   */
  function finishInkIfDrawing(): boolean {
    clearHoldTimer();
    if (mode.current === 'shapeHold') {
      const pointerId = activePointerIdRef.current;
      if (pointerId !== null && interactionRef.current?.hasPointerCapture(pointerId)) {
        interactionRef.current.releasePointerCapture(pointerId);
      }
      activePointerIdRef.current = null;
      clearDrawingCanvas();
      commitHeldShape();
      mode.current = 'idle';
      activePoints.current = [];
      gestureToolRef.current = null;
      setIsDrawing(textEditingRef.current);
      if (!textEditingRef.current) onInteractionPinChange?.(false);
      redrawAnnotationLayer();
      return true;
    }
    if (mode.current !== 'drawing' || activePoints.current.length === 0) return false;
    const pointerId = activePointerIdRef.current;
    if (pointerId !== null && interactionRef.current?.hasPointerCapture(pointerId)) {
      interactionRef.current.releasePointerCapture(pointerId);
    }
    activePointerIdRef.current = null;
    predictedPoints.current = [];
    clearDrawingCanvas();
    commitStroke();
    mode.current = 'idle';
    activePoints.current = [];
    gestureToolRef.current = null;
    rulerSnapRef.current = null;
    setIsDrawing(textEditingRef.current);
    if (!textEditingRef.current) onInteractionPinChange?.(false);
    redrawAnnotationLayer();
    return true;
  }

  function onPointerCancel() {
    if (!finishInkIfDrawing()) cancelActiveInteraction();
  }

  // Capture lost without a pointerup/pointercancel (OS focus change, window
  // hidden for a screenshot, …): keep ink, abandon other gestures.
  function onLostPointerCapture(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== e.pointerId) return;
    if (mode.current === 'idle' || mode.current === 'freeformDrawing') return;
    if (!finishInkIfDrawing()) cancelActiveInteraction();
  }

  // ── Stroke commit ─────────────────────────────────────────────────────────

  function commitStroke() {
    // A single tap with the pen leaves a dot; the highlighter needs a drag.
    const ann = buildInkAnnotation(activePoints.current, gestureToolRef.current, true);
    if (!ann) return;
    if (ann.type === 'stroke' && toolOptions.pen.inkToShape) {
      const shape = shapeFromInk(ann);
      if (shape) {
        addAnnotation(docId, shape);
        pushHistory(makeAddAction(docId, shape));
        return;
      }
    }
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
    if (toolOptions.eraser.mode === 'object' || originalEraserSnapshotRef.current.some((a) => a.type === 'markup')) {
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
      } else if (ann.type === 'markup') {
        // Text markup has no stroke to split: the stroke eraser removes it whole.
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

  function commitLasso(e: React.PointerEvent<HTMLDivElement>) {
    const additive = e.shiftKey || e.metaKey;
    const pts = activePoints.current;
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (pts.length < 3 || length < 12) {
      // A click, not a loop: keep the previous selection when adding.
      if (additive) useSelectionStore.getState().setSelection(identity, pageIndex, selectionBefore.current);
      return;
    }
    const polygon = screenPointsToPdf(pts, transform);
    const annotations = getPageAnnotations(docId, pageIndex);
    const inside = new Set(annotationsInLasso(annotations, polygon));
    if (additive) for (const id of selectionBefore.current) inside.add(id);
    // Made with the barrel button while another tool is active?
    penButtonSelectionRef.current = selectedTool !== 'select' && selectedTool !== 'lasso' && inside.size > 0;
    useSelectionStore.getState().setSelection(
      identity,
      pageIndex,
      annotations.filter((a) => inside.has(a.id)).map((a) => a.id),
    );
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
    } else if (activeMode === 'selectDrag' || activeMode === 'lassoDrag') {
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
    if (mode.current === 'laser') endLaserTrail();
    clearHoldTimer();
    holdShape.current = null;
    mode.current = 'idle';
    markupDrag.current = null;
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

      {replaying && (
        <div
          role="status"
          style={{
            position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
            padding: '4px 10px', borderRadius: 999, fontSize: 12, pointerEvents: 'none',
            background: 'rgba(20, 20, 30, 0.8)', color: '#fff',
          }}
        >
          Replaying ink… click or press Esc to stop
        </div>
      )}

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
              canvasRef={interactionRef}
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
        onDoubleClick={onDoubleClick}
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
