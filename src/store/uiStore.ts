import type { NoteTemplateId } from '../document/noteTemplates';
import { create } from 'zustand';
import { isLanguage, languageFromLocale, type Language } from '../../electron/i18n';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import type {
  ToolType,
  ToolOptions,
  LassoOptions,
  SidebarPanel,
  Theme,
  SelectionState,
  PenStyle,
} from '../types/annotations';

export type TabletFavoriteToolKind =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'text'
  | 'note'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'freeform'
  | 'laserPointer';

export interface TabletFavoriteTool {
  id: string;
  tool: TabletFavoriteToolKind;
  color: string;
  size: number;
  opacity?: number;
  penStyle?: PenStyle;
  eraserMode?: 'object' | 'stroke';
}

const TABLET_FAVORITES_MAX = 10;

export type WorkspaceMode = 'normal' | 'focus';
export type FocusToolbarSide = 'left' | 'right';
export type ToolColorFamily = 'pen' | 'highlighter' | 'text' | 'shape';
export type FocusShapeTool = Extract<ToolType, 'line' | 'arrow' | 'rectangle' | 'ellipse'>;
/** Buttons the user can show or hide in the Focus Mode toolbar ('shapes' is the shape split button). */
export type FocusToolbarItem = 'select' | 'hand' | 'lasso' | 'laserPointer' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'note' | 'shapes';
export const FOCUS_TOOLBAR_ITEMS: readonly FocusToolbarItem[] = ['select', 'hand', 'lasso', 'laserPointer', 'pen', 'highlighter', 'eraser', 'text', 'note', 'shapes'];
export const DEFAULT_FOCUS_TOOLBAR_ITEMS: readonly FocusToolbarItem[] = ['select', 'hand', 'pen', 'highlighter', 'eraser', 'text', 'shapes'];
/** Buttons of the presentation (slide show) toolbar ('shapes' opens the shape menu). */
export type PresentationTool = 'select' | 'laser' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'shapes';
export const PRESENTATION_TOOLS: readonly PresentationTool[] = ['select', 'laser', 'pen', 'highlighter', 'eraser', 'text', 'shapes'];
export const DEFAULT_PRESENTATION_TOOLS: readonly PresentationTool[] = ['select', 'laser', 'pen', 'highlighter', 'eraser', 'shapes'];

/** Toggle `item` in a list kept in the canonical order of `all`; at least one item stays. */
export function toggleInOrder<T>(list: readonly T[], item: T, all: readonly T[]): T[] {
  const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  if (next.length === 0) return [...list];
  return all.filter((x) => next.includes(x));
}

import { normalizeColor } from '../constants/palette';
import { DEFAULT_LASER_OPTIONS, type LaserOptions } from '../components/Laser/laserTrail';

const SHAPE_TOOLS: readonly FocusShapeTool[] = ['line', 'arrow', 'rectangle', 'ellipse'];

function isFocusShapeTool(tool: ToolType): tool is FocusShapeTool {
  return (SHAPE_TOOLS as readonly ToolType[]).includes(tool);
}

/** An open sticky-note popup. `isNew`: just placed, not in the undo history yet. */
export interface OpenNoteState { docId: string; pageIndex: number; annotationId: string; isNew?: boolean }

// ─── Default tool options ─────────────────────────────────────────────────────

export const DEFAULT_TEXT_MARKUP_OPTIONS = { markup: 'highlight', color: '#FFEB3B', opacity: 0.45 } as const;

const defaultToolOptions: ToolOptions = {
  textMarkup: { ...DEFAULT_TEXT_MARKUP_OPTIONS },
  note: { color: '#F5C400' },
  measure: { mode: 'distance', scale: 1, unit: 'cm', color: '#d9480f' },
  pen: {
    color: '#1a1a2e',
    width: 3,
    opacity: 1,
    smooth: true,
    pressureSensitive: true,
    stabilizer: 'basic',
    holdToShape: true,
    holdToShapeDelay: 'default',
    scribbleToErase: true,
  },
  highlighter: {
    color: '#FFEB3B',
    width: 20,
    opacity: 0.4,
  },
  eraser: {
    // One touch removes the whole stroke (as in presentations); "Stroke
    // Eraser" in the ribbon still cuts through a line.
    mode: 'object',
    size: 20,
  },
  text: {
    fontFamily: 'Arial, "Liberation Sans", Helvetica, sans-serif',
    fontSize: 14,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    color: '#1a1a2e',
    backgroundColor: 'transparent',
  },
  shape: {
    color: '#e63946',
    strokeWidth: 2,
    borderStyle: 'solid',
    fillColor: 'transparent',
    opacity: 1,
  },
  freeform: {
    color: '#4caf50',
    strokeWidth: 2,
    fillColor: 'transparent',
    opacity: 1,
  },
};

// ─── Store interface ──────────────────────────────────────────────────────────

interface UIStore {
  // Active tool
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  temporaryTool: ToolType | null;
  setTemporaryTool: (tool: ToolType | null) => void;

  // Tool options
  toolOptions: ToolOptions;
  updatePenOptions: (patch: Partial<ToolOptions['pen']>) => void;
  updateHighlighterOptions: (patch: Partial<ToolOptions['highlighter']>) => void;
  updateTextMarkupOptions: (patch: Partial<ToolOptions['textMarkup']>) => void;
  updateNoteOptions: (patch: Partial<ToolOptions['note']>) => void;
  /** Settings ▸ Reset: every tool back to its default style. */
  resetToolDefaults: () => void;
  settingsOpen: boolean;
  headerFooterOpen: boolean;
  compressOpen: boolean;
  imagesToPdfOpen: boolean;
  /** What the pictures dialog makes. */
  imagesDialogTarget: 'pdf' | 'word';
  setImagesDialogTarget: (target: 'pdf' | 'word') => void;
  exportWordOpen: boolean;
  /** Problem report dialog (Help ▸ Report a Problem, or after a crash). */
  problemReport: { afterCrash: boolean } | null;
  setProblemReport: (value: { afterCrash: boolean } | null) => void;
  setExportWordOpen: (open: boolean) => void;
  setImagesToPdfOpen: (open: boolean) => void;
  exportImagesOpen: boolean;
  setExportImagesOpen: (open: boolean) => void;
  setCompressOpen: (open: boolean) => void;
  setHeaderFooterOpen: (open: boolean) => void;
  /** Side-by-side view: the document shown in the right pane. */
  splitView: { docId: string } | null;
  setSplitView: (split: { docId: string } | null) => void;
  setSettingsOpen: (open: boolean) => void;
  updateMeasureOptions: (patch: Partial<ToolOptions['measure']>) => void;
  updateEraserOptions: (patch: Partial<ToolOptions['eraser']>) => void;
  updateTextOptions: (patch: Partial<ToolOptions['text']>) => void;
  updateShapeOptions: (patch: Partial<ToolOptions['shape']>) => void;
  /** Saved style per shape tool (see shapeStyleKey). */
  shapeStyles: Partial<Record<ShapeStyleKey, ToolOptions['shape']>>;
  updateFreeformOptions: (patch: Partial<ToolOptions['freeform']>) => void;

  // Workspace chrome
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  toggleFocusMode: () => void;
  focusToolbarSide: FocusToolbarSide;
  /** iPad: only Apple Pencil draws; a finger scrolls and zooms. */
  pencilOnly: boolean;
  setPencilOnly: (on: boolean) => void;
  /**
   * Tablet mode (touch-screen Windows PCs; always on for iPad): bigger
   * buttons, the pen draws and a finger scrolls and pinch-zooms.
   */
  tabletMode: boolean;
  setTabletMode: (on: boolean) => void;
  setFocusToolbarSide: (side: FocusToolbarSide) => void;
  focusToolbarCollapsed: boolean;
  setFocusToolbarCollapsed: (collapsed: boolean) => void;
  toggleFocusToolbarCollapsed: () => void;
  lastShapeTool: FocusShapeTool;
  favoriteColors: string[];
  addFavoriteColor: (color: string) => void;
  removeFavoriteColor: (color: string) => void;

  /** Most recently chosen colors, newest first (max RECENT_COLORS_MAX). */
  recentColors: string[];
  addRecentColor: (color: string) => void;

  /** Saved pen / highlighter slots (color + width + opacity). */
  penPresets: PenPreset[];
  savePenPreset: (tool: PenPreset['tool']) => void;
  removePenPreset: (id: string) => void;
  applyPenPreset: (id: string) => void;

  /** Right-edge quick favorite tool shortcuts for Tablet / iPadOS workspace. */
  tabletFavoriteTools: TabletFavoriteTool[];
  addTabletFavoriteTool: (tool: TabletFavoriteToolKind) => void;
  removeTabletFavoriteTool: (id: string) => void;
  applyTabletFavoriteTool: (id: string) => void;

  /** Lasso tool mode (freehand / rectangle) and annotation-type filters. */
  lassoOptions: LassoOptions;
  updateLassoOptions: (patch: Partial<LassoOptions>) => void;

  /** Subtle paper writing texture sound while drawing. */
  writingSoundEnabled: boolean;
  setWritingSoundEnabled: (on: boolean) => void;
  /** Subtle tactile chimes for Hold-to-Shape snap and eraser actions. */
  soundEffectsEnabled: boolean;
  setSoundEffectsEnabled: (on: boolean) => void;

  /** Saved signatures (trimmed transparent PNG data URLs), newest first. */
  signatures: SavedSignature[];
  addSignature: (dataUrl: string) => string | null;
  removeSignature: (id: string) => void;

  /** Tool buttons the user removed from the ribbon (Customize Toolbar). */
  hiddenToolbarTools: ToolType[];
  toggleToolbarTool: (tool: ToolType) => void;
  /** Buttons shown in the Focus Mode toolbar (customizable). */
  focusToolbarItems: FocusToolbarItem[];
  /** The four colours at the bottom of the Focus Mode toolbar (double-click to change). */
  focusColors: string[];
  setFocusColor: (index: number, color: string) => void;
  toggleFocusToolbarItem: (item: FocusToolbarItem) => void;
  resetFocusToolbarItems: () => void;
  /** Tools shown in the presentation toolbar (customizable). */
  presentationTools: PresentationTool[];
  togglePresentationTool: (tool: PresentationTool) => void;
  resetPresentationTools: () => void;

  // Sidebar
  sidebarOpen: boolean;
  activeSidebarPanel: SidebarPanel;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setActiveSidebarPanel: (panel: SidebarPanel) => void;
  /** Tablet / iPadOS: collapses the left icon rail completely down to an edge notch. */
  tabletRailHidden: boolean;
  setTabletRailHidden: (hidden: boolean) => void;

  // Theme
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  setResolvedTheme: (theme: 'light' | 'dark') => void;



  // UI state
  isDrawing: boolean;
  setIsDrawing: (drawing: boolean) => void;

  // Properties panel
  propertiesPanelOpen: boolean;
  setPropertiesPanelOpen: (open: boolean) => void;

  // Dialogs
  desktopLibraryOpen: boolean;
  setDesktopLibraryOpen: (open: boolean) => void;
  newDocumentDialogOpen: boolean;
  setNewDocumentDialogOpen: (open: boolean) => void;
  notePageDialogOpen: boolean;
  splitDialogOpen: boolean;
  setSplitDialogOpen: (open: boolean) => void;
  setNotePageDialogOpen: (open: boolean) => void;
  presentationOpen: boolean;
  setPresentationOpen: (open: boolean) => void;

  /** The sticky note whose popup is open (one at a time). */
  openNote: OpenNoteState | null;
  setOpenNote: (note: OpenNoteState | null) => void;

  /** Formula dialog: null = closed; with `edit` it changes an existing formula. */
  formulaDialog: FormulaDialogState | null;
  setFormulaDialog: (state: FormulaDialogState | null) => void;
  /** Last formula colour and size. */
  formulaStyle: { color: string; size: number };
  setFormulaStyle: (style: { color: string; size: number }) => void;

  /** How pages are shown: as printed, dark (night mode) or sepia. View only. */
  pageTheme: PageTheme;
  setPageTheme: (theme: PageTheme) => void;

  /** Laser pointer look and fade (MaliPen style). */
  laserOptions: LaserOptions;
  updateLaserOptions: (patch: Partial<LaserOptions>) => void;

  /** Last choice in Insert Note Page (background, line spacing, page size). */
  notePageStyle: NotePageStyle;
  setNotePageStyle: (style: Partial<NotePageStyle>) => void;

  /** Interface language (Settings ▸ Appearance). */
  language: Language;
  setLanguage: (language: Language) => void;
}

export type PageTheme = 'normal' | 'dark' | 'sepia';

export interface FormulaDialogState {
  edit?: { docId: string; annotationId: string; pageIndex: number; latex: string; color: string; size: number };
}

export interface NotePageStyle {
  type: 'blank' | 'lined' | 'grid' | 'dotted' | 'millimetric';
  spacingMm: 5 | 8 | 10;
  size: 'like' | 'a4';
  /** A ready-made template instead of plain paper. */
  template?: NoteTemplateId | null;
}

export const DEFAULT_NOTE_PAGE_STYLE: NotePageStyle = { type: 'lined', spacingMm: 8, size: 'like' };

// ─── Store implementation ─────────────────────────────────────────────────────

export interface PenPreset {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  opacity: number;
}

export const RECENT_COLORS_MAX = 8;
export const PEN_PRESETS_MAX = 10;

export const DEFAULT_PEN_PRESETS: PenPreset[] = [
  { id: 'default-black', tool: 'pen', color: '#000000', width: 2, opacity: 1 },
  { id: 'default-red', tool: 'pen', color: '#e63946', width: 2, opacity: 1 },
  { id: 'default-blue', tool: 'pen', color: '#1d4ed8', width: 2, opacity: 1 },
  { id: 'default-yellow-hl', tool: 'highlighter', color: '#ffe066', width: 16, opacity: 0.5 },
  { id: 'default-green-hl', tool: 'highlighter', color: '#7bed9f', width: 16, opacity: 0.5 },
];

export interface SavedSignature {
  id: string;
  dataUrl: string;
  createdAt: number;
}
export const SIGNATURES_MAX = 6;
/** ~750 KB per signature is far more than a trimmed signature ever needs. */
export const SIGNATURE_MAX_CHARS = 1_000_000;

export type ShapeStyleKey = 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'freeform';
const DEFAULT_SHAPE_OPTIONS: ToolOptions['shape'] = { ...defaultToolOptions.shape };

/** Which saved shape style a tool uses (rounded rectangles share the rectangle's). */
export function shapeStyleKey(tool: ToolType): ShapeStyleKey | null {
  switch (tool) {
    case 'line':
    case 'arrow':
    case 'rectangle':
    case 'ellipse':
    case 'freeform':
      return tool;
    case 'roundedRect':
      return 'rectangle';
    default:
      return null;
  }
}

/** Black, red, blue, green. */
export const DEFAULT_FOCUS_COLORS: readonly string[] = ['#000000', '#e63946', '#1d4ed8', '#16a34a'];

export const useUIStore = create<UIStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        activeTool: 'select',
        setActiveTool: (tool) => set((state) => {
          // Each shape tool keeps its own style (line, arrow, rectangle, …):
          // switching tools swaps the style shown in the toolbar.
          const key = shapeStyleKey(tool);
          const shape = key ? { ...DEFAULT_SHAPE_OPTIONS, ...state.shapeStyles[key] } : state.toolOptions.shape;
          return {
            activeTool: tool,
            lastShapeTool: isFocusShapeTool(tool)
              ? tool
              : state.lastShapeTool,
            toolOptions: key ? { ...state.toolOptions, shape } : state.toolOptions,
          };
        }),
        temporaryTool: null,
        setTemporaryTool: (tool) => set({ temporaryTool: tool }),

        toolOptions: defaultToolOptions,
        updatePenOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, pen: { ...s.toolOptions.pen, ...patch } },
          })),
        updateHighlighterOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, highlighter: { ...s.toolOptions.highlighter, ...patch } },
          })),
        updateTextMarkupOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, textMarkup: { ...s.toolOptions.textMarkup, ...patch } },
          })),
        updateMeasureOptions: (patch) =>
          set((s) => ({ toolOptions: { ...s.toolOptions, measure: { ...s.toolOptions.measure, ...patch } } })),
        updateNoteOptions: (patch) =>
          set((s) => ({ toolOptions: { ...s.toolOptions, note: { ...s.toolOptions.note, ...patch } } })),
        updateEraserOptions: (patch) =>
          set((s) => ({ toolOptions: { ...s.toolOptions, eraser: { ...s.toolOptions.eraser, ...patch } } })),
        updateTextOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, text: { ...s.toolOptions.text, ...patch } },
          })),
        updateShapeOptions: (patch) =>
          set((s) => {
            const shape = { ...s.toolOptions.shape, ...patch };
            const key = shapeStyleKey(s.activeTool);
            return {
              toolOptions: { ...s.toolOptions, shape },
              shapeStyles: key ? { ...s.shapeStyles, [key]: shape } : s.shapeStyles,
            };
          }),
        shapeStyles: {},
        updateFreeformOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, freeform: { ...s.toolOptions.freeform, ...patch } },
          })),

        workspaceMode: 'normal',
        setWorkspaceMode: (mode) => set({ workspaceMode: mode }),
        toggleFocusMode: () => set((state) => ({
          workspaceMode: state.workspaceMode === 'focus' ? 'normal' : 'focus',
        })),
        focusToolbarSide: 'left',
        setFocusToolbarSide: (side) => set({ focusToolbarSide: side }),
        pencilOnly: true,
        setPencilOnly: (on) => set({ pencilOnly: on }),
        tabletMode: false,
        setTabletMode: (on) => set({ tabletMode: on }),
        focusToolbarCollapsed: false,
        setFocusToolbarCollapsed: (collapsed) => set({ focusToolbarCollapsed: collapsed }),
        toggleFocusToolbarCollapsed: () => set((state) => ({
          focusToolbarCollapsed: !state.focusToolbarCollapsed,
        })),
        lastShapeTool: 'rectangle',
        
        favoriteColors: [],
        addFavoriteColor: (color) => set((state) => {
          const norm = normalizeColor(color);
          if (state.favoriteColors.includes(norm)) return state;
          return { favoriteColors: [...state.favoriteColors, norm] };
        }),
        removeFavoriteColor: (color) => set((state) => {
          const norm = normalizeColor(color);
          return { favoriteColors: state.favoriteColors.filter(c => c !== norm) };
        }),

        recentColors: [],
        addRecentColor: (color) => set((state) => {
          const norm = normalizeColor(color);
          if (norm === 'transparent' || !/^#[0-9a-f]{6}$/.test(norm)) return state;
          if (state.recentColors[0] === norm) return state;
          return { recentColors: [norm, ...state.recentColors.filter((c) => c !== norm)].slice(0, RECENT_COLORS_MAX) };
        }),

        signatures: [],
        addSignature: (dataUrl) => {
          if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > SIGNATURE_MAX_CHARS) return null;
          const id = `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          set((state) => ({ signatures: [{ id, dataUrl, createdAt: Date.now() }, ...state.signatures].slice(0, SIGNATURES_MAX) }));
          return id;
        },
        removeSignature: (id) => set((state) => ({ signatures: state.signatures.filter((s) => s.id !== id) })),

        penPresets: DEFAULT_PEN_PRESETS,
        savePenPreset: (tool) => set((state) => {
          const options = tool === 'pen' ? state.toolOptions.pen : state.toolOptions.highlighter;
          const preset: PenPreset = {
            id: `preset-${Date.now().toString(36)}`,
            tool,
            color: normalizeColor(options.color),
            width: options.width,
            opacity: options.opacity,
          };
          const duplicate = state.penPresets.some((p) => p.tool === tool && p.color === preset.color
            && p.width === preset.width && p.opacity === preset.opacity);
          if (duplicate) return state;
          return { penPresets: [...state.penPresets, preset].slice(-PEN_PRESETS_MAX) };
        }),
        removePenPreset: (id) => set((state) => ({ penPresets: state.penPresets.filter((p) => p.id !== id) })),
        applyPenPreset: (id) => set((state) => {
          const preset = state.penPresets.find((p) => p.id === id);
          if (!preset) return state;
          const toolOptions = preset.tool === 'pen'
            ? { ...state.toolOptions, pen: { ...state.toolOptions.pen, color: preset.color, width: preset.width, opacity: preset.opacity } }
            : { ...state.toolOptions, highlighter: { ...state.toolOptions.highlighter, color: preset.color, width: preset.width, opacity: preset.opacity } };
          return { toolOptions, activeTool: preset.tool };
        }),

        tabletFavoriteTools: [],
        addTabletFavoriteTool: (tool) => set((state) => {
          let entry: Omit<TabletFavoriteTool, 'id'>;
          if (tool === 'pen') {
            entry = {
              tool,
              color: normalizeColor(state.toolOptions.pen.color),
              size: state.toolOptions.pen.width,
              opacity: state.toolOptions.pen.opacity,
              penStyle: state.toolOptions.pen.penStyle ?? 'ballpoint',
            };
          } else if (tool === 'highlighter') {
            entry = {
              tool,
              color: normalizeColor(state.toolOptions.highlighter.color),
              size: state.toolOptions.highlighter.width,
              opacity: state.toolOptions.highlighter.opacity,
            };
          } else if (tool === 'eraser') {
            entry = {
              tool,
              color: '#64748b',
              size: state.toolOptions.eraser.size,
              eraserMode: state.toolOptions.eraser.mode,
            };
          } else if (tool === 'text') {
            entry = {
              tool,
              color: normalizeColor(state.toolOptions.text.color),
              size: state.toolOptions.text.fontSize,
            };
          } else if (tool === 'note') {
            entry = {
              tool,
              color: normalizeColor(state.toolOptions.note.color),
              size: 1,
            };
          } else if (tool === 'laserPointer') {
            entry = {
              tool,
              color: normalizeColor(state.laserOptions.color),
              size: state.laserOptions.width,
            };
          } else {
            entry = {
              tool,
              color: normalizeColor(state.toolOptions.shape.color),
              size: state.toolOptions.shape.strokeWidth,
              opacity: state.toolOptions.shape.opacity,
            };
          }

          const duplicate = state.tabletFavoriteTools.some(
            (f) =>
              f.tool === entry.tool &&
              f.color === entry.color &&
              f.size === entry.size &&
              f.penStyle === entry.penStyle &&
              f.eraserMode === entry.eraserMode,
          );
          if (duplicate) return state;

          const created: TabletFavoriteTool = {
            ...entry,
            id: `tfav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          };
          return {
            tabletFavoriteTools: [...state.tabletFavoriteTools, created].slice(-TABLET_FAVORITES_MAX),
          };
        }),
        removeTabletFavoriteTool: (id) => set((state) => ({
          tabletFavoriteTools: state.tabletFavoriteTools.filter((f) => f.id !== id),
        })),
        applyTabletFavoriteTool: (id) => set((state) => {
          const fav = state.tabletFavoriteTools.find((f) => f.id === id);
          if (!fav) return state;
          if (fav.tool === 'pen') {
            return {
              activeTool: 'pen',
              toolOptions: {
                ...state.toolOptions,
                pen: {
                  ...state.toolOptions.pen,
                  color: fav.color,
                  width: fav.size,
                  opacity: fav.opacity ?? state.toolOptions.pen.opacity,
                  penStyle: fav.penStyle ?? 'ballpoint',
                },
              },
            };
          }
          if (fav.tool === 'highlighter') {
            return {
              activeTool: 'highlighter',
              toolOptions: {
                ...state.toolOptions,
                highlighter: {
                  ...state.toolOptions.highlighter,
                  color: fav.color,
                  width: fav.size,
                  opacity: fav.opacity ?? state.toolOptions.highlighter.opacity,
                },
              },
            };
          }
          if (fav.tool === 'eraser') {
            return {
              activeTool: 'eraser',
              toolOptions: {
                ...state.toolOptions,
                eraser: {
                  ...state.toolOptions.eraser,
                  size: fav.size,
                  mode: fav.eraserMode ?? state.toolOptions.eraser.mode,
                },
              },
            };
          }
          if (fav.tool === 'text') {
            return {
              activeTool: 'text',
              toolOptions: {
                ...state.toolOptions,
                text: { ...state.toolOptions.text, color: fav.color, fontSize: fav.size },
              },
            };
          }
          if (fav.tool === 'note') {
            return {
              activeTool: 'note',
              toolOptions: { ...state.toolOptions, note: { ...state.toolOptions.note, color: fav.color } },
            };
          }
          if (fav.tool === 'laserPointer') {
            return {
              activeTool: 'laserPointer',
              laserOptions: { ...state.laserOptions, color: fav.color, width: fav.size },
            };
          }
          return {
            activeTool: fav.tool,
            toolOptions: {
              ...state.toolOptions,
              shape: {
                ...state.toolOptions.shape,
                color: fav.color,
                strokeWidth: fav.size,
                opacity: fav.opacity ?? state.toolOptions.shape.opacity,
              },
            },
          };
        }),

        hiddenToolbarTools: [],
        focusToolbarItems: [...DEFAULT_FOCUS_TOOLBAR_ITEMS],
        focusColors: [...DEFAULT_FOCUS_COLORS],
        setFocusColor: (index, color) => set((state) => {
          if (index < 0 || index >= state.focusColors.length || !/^#[0-9a-f]{6}$/i.test(color)) return {};
          const focusColors = [...state.focusColors];
          focusColors[index] = color.toLowerCase();
          return { focusColors };
        }),
        toggleFocusToolbarItem: (item) => set((state) => ({
          focusToolbarItems: toggleInOrder(state.focusToolbarItems, item, FOCUS_TOOLBAR_ITEMS),
        })),
        resetFocusToolbarItems: () => set({ focusToolbarItems: [...DEFAULT_FOCUS_TOOLBAR_ITEMS] }),
        presentationTools: [...DEFAULT_PRESENTATION_TOOLS],
        togglePresentationTool: (tool) => set((state) => ({
          presentationTools: toggleInOrder(state.presentationTools, tool, PRESENTATION_TOOLS),
        })),
        resetPresentationTools: () => set({ presentationTools: [...DEFAULT_PRESENTATION_TOOLS] }),
        toggleToolbarTool: (tool) => set((state) => ({
          hiddenToolbarTools: state.hiddenToolbarTools.includes(tool)
            ? state.hiddenToolbarTools.filter((t) => t !== tool)
            : [...state.hiddenToolbarTools, tool],
        })),

        sidebarOpen: false,
        activeSidebarPanel: 'pages',
        setSidebarOpen: (open) => set((s) => ({
          sidebarOpen: open,
          tabletRailHidden: open ? false : s.tabletRailHidden,
        })),
        toggleSidebar: () => set((s) => ({
          sidebarOpen: !s.sidebarOpen,
          tabletRailHidden: !s.sidebarOpen ? false : s.tabletRailHidden,
        })),
        setActiveSidebarPanel: (panel) => set({ activeSidebarPanel: panel, tabletRailHidden: false }),
        tabletRailHidden: false,
        setTabletRailHidden: (hidden) => set((s) => ({
          tabletRailHidden: hidden,
          sidebarOpen: hidden ? false : s.sidebarOpen,
        })),

        theme: 'light',
        resolvedTheme: 'light',
        setTheme: (theme) => set({ theme }),
        setResolvedTheme: (theme) => set({ resolvedTheme: theme }),


        isDrawing: false,
        setIsDrawing: (drawing) => set({ isDrawing: drawing }),

        propertiesPanelOpen: false,
        setPropertiesPanelOpen: (open) => set({ propertiesPanelOpen: open }),

        desktopLibraryOpen: false,
        setDesktopLibraryOpen: (desktopLibraryOpen) => set({ desktopLibraryOpen }),
        newDocumentDialogOpen: false,
        setNewDocumentDialogOpen: (open) => set({ newDocumentDialogOpen: open }),
        notePageDialogOpen: false,
        setNotePageDialogOpen: (open) => set({ notePageDialogOpen: open }),
        presentationOpen: false,
        setPresentationOpen: (open) => set({ presentationOpen: open }),

        splitView: null,
        setSplitView: (splitView) => set({ splitView }),
        exportImagesOpen: false,
        setExportImagesOpen: (exportImagesOpen) => set({ exportImagesOpen }),
        imagesToPdfOpen: false,
        imagesDialogTarget: 'pdf',
        setImagesDialogTarget: (imagesDialogTarget) => set({ imagesDialogTarget }),
        exportWordOpen: false,
        problemReport: null,
        setProblemReport: (problemReport) => set({ problemReport }),
        setExportWordOpen: (exportWordOpen) => set({ exportWordOpen }),
        setImagesToPdfOpen: (imagesToPdfOpen) => set({ imagesToPdfOpen }),
        compressOpen: false,
        setCompressOpen: (compressOpen) => set({ compressOpen }),
        headerFooterOpen: false,
        setHeaderFooterOpen: (headerFooterOpen) => set({ headerFooterOpen }),
        settingsOpen: false,
        setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
        resetToolDefaults: () => set({ toolOptions: defaultToolOptions, laserOptions: { ...DEFAULT_LASER_OPTIONS }, shapeStyles: {} }),
        splitDialogOpen: false,
        setSplitDialogOpen: (splitDialogOpen) => set({ splitDialogOpen }),
        openNote: null,
        setOpenNote: (openNote) => set({ openNote }),
        formulaDialog: null,
        setFormulaDialog: (formulaDialog) => set({ formulaDialog }),
        formulaStyle: { color: '#1a1a2e', size: 16 },
        setFormulaStyle: (formulaStyle) => set({ formulaStyle }),

        pageTheme: 'normal',
        setPageTheme: (pageTheme) => set({ pageTheme }),

        laserOptions: DEFAULT_LASER_OPTIONS,
        updateLaserOptions: (patch) => set((state) => ({ laserOptions: { ...state.laserOptions, ...patch } })),

        lassoOptions: {
          mode: 'freehand',
          selectStrokes: true,
          selectHighlights: true,
          selectBoxes: true,
        },
        updateLassoOptions: (patch) => set((state) => ({ lassoOptions: { ...state.lassoOptions, ...patch } })),

        writingSoundEnabled: false,
        setWritingSoundEnabled: (writingSoundEnabled) => set({ writingSoundEnabled }),
        soundEffectsEnabled: true,
        setSoundEffectsEnabled: (soundEffectsEnabled) => set({ soundEffectsEnabled }),

        notePageStyle: DEFAULT_NOTE_PAGE_STYLE,
        setNotePageStyle: (style) => set((state) => ({ notePageStyle: { ...state.notePageStyle, ...style } })),

        language: languageFromLocale(typeof navigator === 'undefined' ? undefined : navigator.language),
        setLanguage: (language) => set({ language: isLanguage(language) ? language : 'en' }),
      }),
      {
        name: 'malipedefe-ui',
        version: 3, // bump version for migration
        migrate: (persistedState: any, version: number) => {
          // v3: the presentation toolbar gained Select.
          if (version < 3 && Array.isArray(persistedState?.presentationTools) && !persistedState.presentationTools.includes('select')) {
            persistedState.presentationTools = ['select', ...persistedState.presentationTools];
          }
          // v2: the eraser removes whole strokes by default.
          if (version < 2 && persistedState?.toolOptions?.eraser) {
            persistedState.toolOptions.eraser.mode = 'object';
          }
          if (version === 0) {
            // Migrate recentColorsByFamily to favoriteColors
            const state = persistedState as any;
            const oldRecents = state.recentColorsByFamily;
            const newFavorites = new Set<string>();
            if (oldRecents) {
              for (const family of Object.values(oldRecents)) {
                if (Array.isArray(family)) {
                  family.forEach((color: string) => newFavorites.add(normalizeColor(color)));
                }
              }
            }
            state.favoriteColors = Array.from(newFavorites).slice(0, 18); // keep some reasonable max if it's huge
            delete state.recentColorsByFamily;
            return state;
          }
          return persistedState;
        },
        // Tool options added in a later version get their defaults.
        merge: (persisted, current) => {
          const saved = (persisted ?? {}) as Partial<UIStore>;
          const toolOptions = { ...current.toolOptions } as Record<string, unknown>;
          for (const [key, value] of Object.entries(saved.toolOptions ?? {})) {
            const base = toolOptions[key];
            toolOptions[key] = base && typeof base === 'object' && value && typeof value === 'object' ? { ...base, ...value } : value;
          }
          const language = isLanguage(saved.language) ? saved.language : current.language;
          const pick = <T,>(value: unknown, all: readonly T[], fallback: T[]): T[] => {
            if (!Array.isArray(value)) return fallback;
            const list = all.filter((x) => value.includes(x));
            return list.length ? list : fallback;
          };
          const focusToolbarItems = pick(saved.focusToolbarItems, FOCUS_TOOLBAR_ITEMS, current.focusToolbarItems);
          const presentationTools = pick(saved.presentationTools, PRESENTATION_TOOLS, current.presentationTools);
          const focusColors = Array.isArray(saved.focusColors) && saved.focusColors.length === DEFAULT_FOCUS_COLORS.length
            && saved.focusColors.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
            ? saved.focusColors
            : current.focusColors;
          return { ...current, ...saved, language, focusToolbarItems, presentationTools, focusColors, toolOptions: toolOptions as unknown as ToolOptions };
        },
        // Only persist tool options, theme and favorite colors — not transient UI state
        partialize: (state) => ({
          toolOptions: state.toolOptions,
          theme: state.theme,
          sidebarOpen: state.sidebarOpen,
          tabletRailHidden: state.tabletRailHidden,
          focusToolbarSide: state.focusToolbarSide,
          pencilOnly: state.pencilOnly,
          tabletMode: state.tabletMode,
          lastShapeTool: state.lastShapeTool,
          favoriteColors: state.favoriteColors,
          recentColors: state.recentColors,
          penPresets: state.penPresets,
          tabletFavoriteTools: state.tabletFavoriteTools,
          signatures: state.signatures,
          shapeStyles: state.shapeStyles,
          hiddenToolbarTools: state.hiddenToolbarTools,
          focusToolbarItems: state.focusToolbarItems,
          focusColors: state.focusColors,
          presentationTools: state.presentationTools,
          notePageStyle: state.notePageStyle,
          laserOptions: state.laserOptions,
          lassoOptions: state.lassoOptions,
          writingSoundEnabled: state.writingSoundEnabled,
          soundEffectsEnabled: state.soundEffectsEnabled,
          pageTheme: state.pageTheme,
          formulaStyle: state.formulaStyle,
          language: state.language,
        }),
      },
    ),
  ),
);


