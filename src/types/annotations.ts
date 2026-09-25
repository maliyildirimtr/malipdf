/**
 * Annotation types and coordinate system.
 *
 * All annotation geometry is stored in PDF USER SPACE (points).
 * 1 PDF point = 1/72 inch.
 *
 * The rendering pipeline transforms:
 *   PDF coordinates → viewport transformation → screen coordinates
 *
 * Export serializes these stored PDF coordinates directly; screen zoom and
 * display rotation never become part of persisted annotation geometry.
 *
 * This ensures correct rendering at all zoom levels, with all page sizes,
 * rotations, and crop boxes.
 */

// ─── Coordinate primitives ────────────────────────────────────────────────────

/**
 * A point in canonical PDF user space (points).
 * Coordinates are not normalized to the CropBox origin; non-zero/negative box
 * origins are preserved exactly as returned by pdf.js convertToPdfPoint().
 */
export interface PdfPoint {
  x: number;
  y: number;
}

/** A point with optional pressure (0–1) from stylus input. */
export interface InputPoint {
  x: number; // PDF space
  y: number; // PDF space
  pressure: number; // 0–1, defaults to 0.5 for mouse
  timestamp: number;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Annotation types ─────────────────────────────────────────────────────────

export type AnnotationType =
  | 'stroke'
  | 'highlight'
  | 'text'
  | 'shape'
  | 'freeform'
  | 'image'   // future
  | 'stamp';  // future

export type ShapeKind =
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'roundedRect'
  | 'ellipse';

export type ShapeBorderStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot' | 'dash-dot-dot';

export type TextAlign = 'left' | 'center' | 'right';

// ─── Base annotation ──────────────────────────────────────────────────────────

interface BaseAnnotation {
  readonly id: string;
  readonly pageIndex: number;      // 0-based page index
  readonly type: AnnotationType;
  color: string;                   // CSS hex color
  opacity: number;                 // 0–1
  locked: boolean;
  readonly createdAt: number;      // Date.now()
  updatedAt: number;
}

// ─── Stroke annotation (pen) ──────────────────────────────────────────────────

export interface StrokeAnnotation extends BaseAnnotation {
  type: 'stroke';
  points: InputPoint[];            // In PDF user space
  width: number;                   // Stroke width in PDF points
  smooth: boolean;
  pressure: boolean;               // Whether pressure data is meaningful
}

// ─── Highlight annotation ─────────────────────────────────────────────────────

export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight';
  points: InputPoint[];            // In PDF user space
  width: number;                   // Highlight band height
}

// ─── Text annotation ──────────────────────────────────────────────────────────

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  bounds: PdfRect;                 // In PDF user space
  content: string;
  fontSize: number;                // In PDF points
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  backgroundColor: string;        // CSS color or 'transparent'
}

// ─── Shape annotation ─────────────────────────────────────────────────────────

export interface ShapeAnnotation extends BaseAnnotation {
  type: 'shape';
  shapeKind: ShapeKind;
  startPoint: PdfPoint;           // In PDF user space
  endPoint: PdfPoint;             // In PDF user space
  strokeWidth: number;            // In PDF points
  borderStyle?: ShapeBorderStyle; // Line style pattern
  fillColor: string;              // CSS color or 'transparent'
  cornerRadius?: number;          // For roundedRect
}

// ─── Freeform annotation ──────────────────────────────────────────────────────

export interface FreeformAnnotation extends BaseAnnotation {
  type: 'freeform';
  points: PdfPoint[];             // Vertices in PDF user space
  strokeWidth: number;            // In PDF points
  fillColor: string;              // CSS color or 'transparent'
}

// ─── Image annotation ─────────────────────────────────────────────────────────

export interface ImageAnnotation extends BaseAnnotation {
  type: 'image';
  x: number;                       // In PDF user space points
  y: number;                       // In PDF user space points
  width: number;                   // In PDF user space points
  height: number;                  // In PDF user space points
  assetId: string;                 // Reference to ImageAsset in AssetStore
  opacity: number;                 // 0–1
}

// ─── Union type ───────────────────────────────────────────────────────────────

export type Annotation =
  | StrokeAnnotation
  | HighlightAnnotation
  | TextAnnotation
  | ShapeAnnotation
  | FreeformAnnotation
  | ImageAnnotation;

// ─── Tool types ───────────────────────────────────────────────────────────────

export type ToolType =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'text'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'roundedRect'
  | 'ellipse'
  | 'freeform';

// ─── Tool options (shared across all instances, not per-annotation) ───────────

export interface PenOptions {
  color: string;
  width: number;          // PDF points; numerically equals CSS px at 100% zoom
  opacity: number;
  smooth: boolean;
  pressureSensitive: boolean;
}

export interface HighlighterOptions {
  color: string;
  width: number;          // PDF points
  opacity: number;
}

export interface EraserOptions {
  mode: 'stroke' | 'object';
  size: number;
}

export interface TextOptions {
  fontFamily: string;
  fontSize: number;       // PDF points
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  color: string;
  backgroundColor: string;
}

export interface ShapeOptions {
  color: string;
  strokeWidth: number;    // PDF points
  borderStyle: ShapeBorderStyle;
  fillColor: string;
  opacity: number;
}

export interface FreeformOptions {
  color: string;
  strokeWidth: number;    // PDF points
  fillColor: string;
  opacity: number;
}

export interface ToolOptions {
  pen: PenOptions;
  highlighter: HighlighterOptions;
  eraser: EraserOptions;
  text: TextOptions;
  shape: ShapeOptions;
  freeform: FreeformOptions;
}

// ─── Document state ───────────────────────────────────────────────────────────

export interface PageAnnotationState {
  pageIndex: number;
  annotations: Annotation[];
}

export interface DocumentAnnotationState {
  pages: Map<number, PageAnnotationState>;
}

export type ZoomMode = 'custom' | 'fitWidth' | 'fitPage';

export interface DocumentState {
  id: string;
  /** Runtime generation of the concrete pdf.js document instance. */
  instanceId: number;
  title: string;
  filePath: string | null;
  currentStateId: string;
  savedStateId: string | null;
  saveStatus: 'idle' | 'saving' | 'error';
  lastSaveError: string | null;

  // Raw PDF data — never mutated
  sourceData: Uint8Array;
  // Increments when sourceData changes (page insertion) to trigger reload without changing identity
  sourceRevision: number;

  // Current page navigation
  activePageIndex: number;
  pageCount: number;

  // Zoom/scroll state
  zoom: number;          // Scale factor e.g. 1.0 = 100%
  zoomMode: ZoomMode;
  scrollTop: number;
  scrollLeft: number;

  // Normalized display rotation deltas (0, 90, 180, 270).
  // effectiveRotation = intrinsic page.rotate + this display delta.
  pageRotations: Record<number, number>;
}

// ─── History (undo/redo) ──────────────────────────────────────────────────────

export type HistoryActionType =
  | 'ADD_ANNOTATION'
  | 'REMOVE_ANNOTATION'
  | 'UPDATE_ANNOTATION'
  | 'MOVE_ANNOTATION'
  | 'RESIZE_ANNOTATION'
  | 'BATCH_ACTION'
  | 'MUTATE_DOCUMENT_BYTES';

export interface HistoryAction {
  type: HistoryActionType;
  docId: string;
  pageIndex?: number;
  annotationId?: string;
  before?: Annotation | null;   // State before action
  after?: Annotation | null;    // State after action
  actions?: Omit<HistoryAction, 'beforeStateId' | 'afterStateId'>[]; // For batch actions
  
  // For MUTATE_DOCUMENT_BYTES
  beforeSourceData?: Uint8Array;
  afterSourceData?: Uint8Array;
  beforeAnnotations?: Annotation[];
  afterAnnotations?: Annotation[];
  beforePageRotations?: Record<number, number>;
  afterPageRotations?: Record<number, number>;
  beforePageCount?: number;
  afterPageCount?: number;

  beforeStateId: string;
  afterStateId: string;
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export type SidebarPanel = 'pages' | 'bookmarks' | 'outline' | 'annotations' | 'search';

// ─── Theme ────────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark' | 'system';

// ─── Viewport (rendering) ─────────────────────────────────────────────────────

/**
 * Describes how a PDF page maps to screen coordinates at a given zoom.
 * Wraps pdf.js PageViewport concept.
 */
export interface PageViewportInfo {
  pageIndex: number;
  width: number;           // Viewport width in CSS pixels (at devicePixelRatio=1)
  height: number;          // Viewport height in CSS pixels
  scale: number;           // Current scale factor
  rotation: number;        // Page rotation (0, 90, 180, 270)
}

// ─── Selection state ─────────────────────────────────────────────────────────

export interface SelectionState {
  selectedIds: Set<string>;
  isMoving: boolean;
  isResizing: boolean;
  handle: ResizeHandle | null;
}

export type ResizeHandle =
  | 'nw' | 'n' | 'ne'
  | 'w'  |       'e'
  | 'sw' | 's' | 'se';

// ─── Electron API (augment window) ───────────────────────────────────────────

declare global {
  interface Window {
    electronAPI: {
      openFile: () => Promise<Array<{ filePath: string; name: string; data: ArrayBuffer }> | null>;
      saveFile: (defaultName: string) => Promise<string | null>;
      writeFile: (filePath: string, data: ArrayBuffer) => Promise<boolean>;
      readFile: (filePath: string) => Promise<{ name: string; data: ArrayBuffer }>;
      getTempDir: () => Promise<string>;
      getVersion: () => Promise<string>;
      onCommand: (callback: (commandId: unknown, payload?: unknown) => void) => () => void;
      updateCommandStates: (states: any[]) => void;
      toggleFullScreen: () => Promise<boolean>;
      askCloseConfirm: (fileName: string) => Promise<'save' | 'discard' | 'cancel'>;
      askCloseAllConfirm: (fileNames: string[]) => Promise<'save' | 'discard' | 'cancel'>;
      confirmLifecycle: (requestId: string, allow: boolean) => void;
      openImage: () => Promise<{ name: string; mimeType: string; data: ArrayBuffer } | null>;
      captureScreen: () => Promise<{ success: boolean; data?: ArrayBuffer; mimeType?: string; width?: number; height?: number; error?: string }>;
      captureRegion: () => Promise<{ success: boolean; canceled?: boolean; data?: ArrayBuffer; mimeType?: string; width?: number; height?: number; error?: string }>;
      readClipboardImage: () => Promise<{ data: ArrayBuffer; mimeType: string } | null>;
      pptxIsAvailable: () => Promise<boolean>;
      pptxStartConversion: (jobId: string) => Promise<{ buffer: ArrayBuffer; name: string } | null>;
      pptxCancelConversion: (jobId: string) => Promise<void>;
    };
  }
}
