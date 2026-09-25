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

const SHAPE_TOOLS: readonly FocusShapeTool[] = ['line', 'arrow', 'rectangle', 'ellipse'];

function isFocusShapeTool(tool: ToolType): tool is FocusShapeTool {
  return (SHAPE_TOOLS as readonly ToolType[]).includes(tool);
}

// ─── Default tool options ─────────────────────────────────────────────────────

const defaultToolOptions: ToolOptions = {
  pen: {
    color: '#1a1a2e',
    width: 3,
    opacity: 1,
    smooth: true,
    pressureSensitive: true,
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
    fontFamily: 'Inter, sans-serif',
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
  updateEraserOptions: (patch: Partial<ToolOptions['eraser']>) => void;
  updateTextOptions: (patch: Partial<ToolOptions['text']>) => void;
  updateShapeOptions: (patch: Partial<ToolOptions['shape']>) => void;
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
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useUIStore = create<UIStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        activeTool: 'select',
        setActiveTool: (tool) => set((state) => ({
          activeTool: tool,
          lastShapeTool: isFocusShapeTool(tool)
            ? tool
            : state.lastShapeTool,
        })),
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
        updateEraserOptions: (patch) =>
          set((s) => ({ toolOptions: { ...s.toolOptions, eraser: { ...s.toolOptions.eraser, ...patch } } })),
        updateTextOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, text: { ...s.toolOptions.text, ...patch } },
          })),
        updateShapeOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, shape: { ...s.toolOptions.shape, ...patch } },
          })),
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
        // Only persist tool options, theme and favorite colors — not transient UI state
        partialize: (state) => ({
          toolOptions: state.toolOptions,
          theme: state.theme,
          sidebarOpen: state.sidebarOpen,
          focusToolbarSide: state.focusToolbarSide,
          lastShapeTool: state.lastShapeTool,
          favoriteColors: state.favoriteColors,
        }),
      },
    ),
  ),
);


