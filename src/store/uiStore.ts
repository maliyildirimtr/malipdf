import type { NoteTemplateId } from '../document/noteTemplates';
import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import type {
  ToolType,
  ToolOptions,
  SidebarPanel,
  Theme,
  SelectionState,
} from '../types/annotations';

export type WorkspaceMode = 'normal' | 'focus';
export type FocusToolbarSide = 'left' | 'right';
export type ToolColorFamily = 'pen' | 'highlighter' | 'text' | 'shape';
export type FocusShapeTool = Extract<ToolType, 'line' | 'arrow' | 'rectangle' | 'ellipse'>;

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
  },
  highlighter: {
    color: '#FFEB3B',
    width: 20,
    opacity: 0.4,
  },
  eraser: {
    mode: 'stroke',
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

  /** Saved signatures (trimmed transparent PNG data URLs), newest first. */
  signatures: SavedSignature[];
  addSignature: (dataUrl: string) => string | null;
  removeSignature: (id: string) => void;

  /** Tool buttons the user removed from the ribbon (Customize Toolbar). */
  hiddenToolbarTools: ToolType[];
  toggleToolbarTool: (tool: ToolType) => void;

  // Sidebar
  sidebarOpen: boolean;
  activeSidebarPanel: SidebarPanel;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setActiveSidebarPanel: (panel: SidebarPanel) => void;

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

        hiddenToolbarTools: [],
        toggleToolbarTool: (tool) => set((state) => ({
          hiddenToolbarTools: state.hiddenToolbarTools.includes(tool)
            ? state.hiddenToolbarTools.filter((t) => t !== tool)
            : [...state.hiddenToolbarTools, tool],
        })),

        sidebarOpen: false,
        activeSidebarPanel: 'pages',
        setSidebarOpen: (open) => set({ sidebarOpen: open }),
        toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
        setActiveSidebarPanel: (panel) => set({ activeSidebarPanel: panel }),

        theme: 'light',
        resolvedTheme: 'light',
        setTheme: (theme) => set({ theme }),
        setResolvedTheme: (theme) => set({ resolvedTheme: theme }),


        isDrawing: false,
        setIsDrawing: (drawing) => set({ isDrawing: drawing }),

        propertiesPanelOpen: false,
        setPropertiesPanelOpen: (open) => set({ propertiesPanelOpen: open }),

        newDocumentDialogOpen: false,
        setNewDocumentDialogOpen: (open) => set({ newDocumentDialogOpen: open }),
        notePageDialogOpen: false,
        setNotePageDialogOpen: (open) => set({ notePageDialogOpen: open }),
        presentationOpen: false,
        setPresentationOpen: (open) => set({ presentationOpen: open }),

        splitView: null,
        setSplitView: (splitView) => set({ splitView }),
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

        notePageStyle: DEFAULT_NOTE_PAGE_STYLE,
        setNotePageStyle: (style) => set((state) => ({ notePageStyle: { ...state.notePageStyle, ...style } })),
      }),
      {
        name: 'malipedefe-ui',
        version: 1, // bump version for migration
        migrate: (persistedState: any, version: number) => {
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
          return { ...current, ...saved, toolOptions: toolOptions as unknown as ToolOptions };
        },
        // Only persist tool options, theme and favorite colors — not transient UI state
        partialize: (state) => ({
          toolOptions: state.toolOptions,
          theme: state.theme,
          sidebarOpen: state.sidebarOpen,
          focusToolbarSide: state.focusToolbarSide,
          lastShapeTool: state.lastShapeTool,
          favoriteColors: state.favoriteColors,
          recentColors: state.recentColors,
          penPresets: state.penPresets,
          signatures: state.signatures,
          shapeStyles: state.shapeStyles,
          hiddenToolbarTools: state.hiddenToolbarTools,
          notePageStyle: state.notePageStyle,
          laserOptions: state.laserOptions,
          pageTheme: state.pageTheme,
          formulaStyle: state.formulaStyle,
        }),
      },
    ),
  ),
);


