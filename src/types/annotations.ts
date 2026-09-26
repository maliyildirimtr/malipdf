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
  | 'markup'
  | 'note'
  | 'measure'
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

export type TextListStyle = 'none' | 'bullet' | 'number';

// ─── Base annotation ──────────────────────────────────────────────────────────

interface BaseAnnotation {
  readonly id: string;
  readonly pageIndex: number;      // 0-based page index
  readonly type: AnnotationType;
  color: string;                   // CSS hex color
  opacity: number;                 // 0–1
  locked: boolean;
  /** Hidden in the view and left out of Save/Export (Annotations panel). */
  hidden?: boolean;
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
  borderColor?: string;           // CSS color or 'transparent' (default)
  borderWidth?: number;           // PDF points
  listStyle?: TextListStyle;      // default 'none'
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
  /** Set for formulas: the LaTeX source, so it can be edited again. */
  formula?: { latex: string; color: string; size: number; naturalWidth?: number };
}

// ─── Text markup (highlight / underline / strikethrough on PDF text) ─────────

export type TextMarkupKind = 'highlight' | 'underline' | 'strikeout';

export interface TextMarkupAnnotation extends BaseAnnotation {
  type: 'markup';
  markup: TextMarkupKind;
  /** One quad per text run: bottom-left, bottom-right, top-right, top-left (PDF user space). */
  quads: PdfPoint[][];
  /** The marked text, for copying and the annotations list. */
  text: string;
}

// ─── Sticky note ──────────────────────────────────────────────────────────────

/** Size of a note's icon on the page, in PDF points (it never scales). */
export const NOTE_ICON_SIZE = 20;

export interface NoteAnnotation extends BaseAnnotation {
  type: 'note';
  /** Bottom-left corner of the icon, PDF user space. */
  x: number;
  y: number;
  content: string;
}

// ─── Measurement ─────────────────────────────────────────────────────────────

export type MeasureUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'pt';

/** How paper maps to the real world: `scale` real units per paper unit (1:100 → 100). */
export interface MeasureCalibration {
  scale: number;
  unit: MeasureUnit;
}

export interface MeasureAnnotation extends BaseAnnotation {
  type: 'measure';
  kind: 'distance' | 'area';
  /** Two points for a distance, three or more for an area (PDF user space). */
  points: PdfPoint[];
  calibration: MeasureCalibration;
  strokeWidth: number;
}

// ─── Union type ───────────────────────────────────────────────────────────────

export type Annotation =
  | StrokeAnnotation
  | HighlightAnnotation
  | TextAnnotation
  | ShapeAnnotation
  | FreeformAnnotation
  | ImageAnnotation
  | TextMarkupAnnotation
  | NoteAnnotation
  | MeasureAnnotation;

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
  | 'freeform'
  | 'lasso'
  | 'textMarkup'
  | 'laserPointer'
  | 'note'
  | 'snapshot'
  | 'measure'
  | 'crop';

// ─── Tool options (shared across all instances, not per-annotation) ───────────

export interface PenOptions {
  color: string;
  width: number;          // PDF points; numerically equals CSS px at 100% zoom
  opacity: number;
  smooth: boolean;
  pressureSensitive: boolean;
  /** Ink to Shape: clean up hand-drawn lines, circles, rectangles, polygons. */
  inkToShape?: boolean;
  /** Smooths the line so it follows the hand, not every tremor (MaliPen levels). */
  stabilizer?: 'off' | 'basic' | 'soft' | 'silky' | 'fluid';
  /** Hold the pen still for a moment while drawing to turn the line into a shape. */
  holdToShape?: boolean;
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
  borderColor?: string;
  borderWidth?: number;
  listStyle?: TextListStyle;
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

export interface TextMarkupOptions {
  markup: TextMarkupKind;
  color: string;
  opacity: number;
}

export interface MeasureOptions extends MeasureCalibration {
  mode: 'distance' | 'area';
  color: string;
}

export interface NoteOptions {
  color: string;
}

export interface ToolOptions {
  textMarkup: TextMarkupOptions;
  note: NoteOptions;
  measure: MeasureOptions;
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

/** A user bookmark (written into the PDF outline on save/export). */
export interface Bookmark {
  id: string;
  title: string;
  pageIndex: number;
}

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

  /** User bookmarks, sorted by page. Undefined = none. */
  bookmarks?: Bookmark[];
}

// ─── History (undo/redo) ──────────────────────────────────────────────────────

export type HistoryActionType =
  | 'ADD_ANNOTATION'
  | 'REMOVE_ANNOTATION'
  | 'UPDATE_ANNOTATION'
  | 'MOVE_ANNOTATION'
  | 'RESIZE_ANNOTATION'
  | 'BATCH_ACTION'
  | 'MUTATE_DOCUMENT_BYTES'
  | 'SET_BOOKMARKS'
  | 'SET_FORM_VALUE';

export interface HistoryAction {
  type: HistoryActionType;
  docId: string;
  pageIndex?: number;
  annotationId?: string;
  /**
   * Array position of the annotation on its page (z-order). For REMOVE it is the
   * position it was removed from; for ADD the position it was inserted at.
   * Undo/redo re-inserts at this position so stacking order is preserved.
   * Undefined means "append" (legacy behaviour).
   */
  index?: number;
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

  // For SET_BOOKMARKS (and MUTATE_DOCUMENT_BYTES that moved pages)
  beforeBookmarks?: Bookmark[];
  afterBookmarks?: Bookmark[];

  // For SET_FORM_VALUE (undefined = the value stored in the PDF)
  fieldName?: string;
  beforeValue?: string | boolean;
  afterValue?: string | boolean;

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
      writeClipboardImage?: (png: ArrayBuffer) => Promise<boolean>;
      chooseFolder?: (title?: string) => Promise<string | null>;
      moveTabToNewWindow?: (docId: string) => Promise<boolean>;
      writeFilesToFolder?: (folder: string, files: { name: string; data: ArrayBuffer; ext?: 'pdf' | 'png' | 'jpg' }[]) => Promise<string[]>;
      recoveryWrite: (
        docId: string,
        meta: string,
        source: Uint8Array | null,
        assets: { id: string; mimeType: string; width: number; height: number; data: Uint8Array }[],
      ) => Promise<boolean>;
      recoveryRemove: (docId: string) => Promise<boolean>;
      onOpenFiles?: (callback: (files: Array<{ filePath: string; name: string; data: ArrayBuffer }>) => void) => () => void;
      readyForFiles?: () => void;
      checkForUpdates: () => Promise<boolean>;
      showAbout: () => Promise<boolean>;
      openCrashReports: () => Promise<boolean>;
      recoveryList: () => Promise<Array<{
        docId: string; title: string; filePath: string | null; savedAt: number; pageCount: number; annotationCount: number;
      }>>;
      recoveryLoad: (docId: string) => Promise<{ meta: string; source: ArrayBuffer; assets: { id: string; data: ArrayBuffer }[] }>;
      pptxIsAvailable: () => Promise<boolean>;
      pptxOpenLibreOfficeDownload?: () => Promise<boolean>;
      pptxStartConversion: (jobId: string) => Promise<{ buffer: ArrayBuffer; name: string } | null>;
      pptxConvertBytes?: (jobId: string, data: ArrayBuffer, name: string) => Promise<{ buffer: ArrayBuffer; name: string }>;
      pptxCancelConversion: (jobId: string) => Promise<void>;
      ocrIsAvailable?: () => Promise<boolean>;
      ocrRecognize?: (png: ArrayBuffer, languages?: string[]) => Promise<import('../pdf/ocr').OcrLine[]>;
    };
  }
}
