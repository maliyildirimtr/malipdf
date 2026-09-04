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

export type RecentColorsByFamily = Record<ToolColorFamily, string[]>;

const MAX_RECENT_COLORS = 6;

const defaultRecentColors: RecentColorsByFamily = {
  pen: ['#1a1a2e', '#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#ffffff'],
  highlighter: ['#FFEB3B', '#8ecae6', '#f4a261', '#e63946', '#2a9d8f'],
  text: ['#1a1a2e', '#e63946', '#457b9d', '#2a9d8f', '#ffffff'],
  shape: ['#e63946', '#1a1a2e', '#457b9d', '#2a9d8f', '#f4a261', '#ffffff'],
};

const SHAPE_TOOLS: readonly FocusShapeTool[] = ['line', 'arrow', 'rectangle', 'ellipse'];

function isFocusShapeTool(tool: ToolType): tool is FocusShapeTool {
  return (SHAPE_TOOLS as readonly ToolType[]).includes(tool);
}

function withRecentColor(colors: string[], color: string): string[] {
  return [color, ...colors.filter((candidate) => candidate.toLowerCase() !== color.toLowerCase())]
    .slice(0, MAX_RECENT_COLORS);
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
  recentColorsByFamily: RecentColorsByFamily;
  rememberColor: (family: ToolColorFamily, color: string) => void;

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

  // Selection state
  selection: SelectionState;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;

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
          selection: emptySelection(),
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
            recentColorsByFamily: patch.color
              ? { ...s.recentColorsByFamily, pen: withRecentColor(s.recentColorsByFamily.pen, patch.color) }
              : s.recentColorsByFamily,
          })),
        updateHighlighterOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, highlighter: { ...s.toolOptions.highlighter, ...patch } },
            recentColorsByFamily: patch.color
              ? { ...s.recentColorsByFamily, highlighter: withRecentColor(s.recentColorsByFamily.highlighter, patch.color) }
              : s.recentColorsByFamily,
          })),
        updateEraserOptions: (patch) =>
          set((s) => ({ toolOptions: { ...s.toolOptions, eraser: { ...s.toolOptions.eraser, ...patch } } })),
        updateTextOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, text: { ...s.toolOptions.text, ...patch } },
            recentColorsByFamily: patch.color
              ? { ...s.recentColorsByFamily, text: withRecentColor(s.recentColorsByFamily.text, patch.color) }
              : s.recentColorsByFamily,
          })),
        updateShapeOptions: (patch) =>
          set((s) => ({
            toolOptions: { ...s.toolOptions, shape: { ...s.toolOptions.shape, ...patch } },
            recentColorsByFamily: patch.color
              ? { ...s.recentColorsByFamily, shape: withRecentColor(s.recentColorsByFamily.shape, patch.color) }
              : s.recentColorsByFamily,
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
        recentColorsByFamily: defaultRecentColors,
        rememberColor: (family, color) => set((state) => ({
          recentColorsByFamily: {
            ...state.recentColorsByFamily,
            [family]: withRecentColor(state.recentColorsByFamily[family], color),
          },
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

        selection: emptySelection(),
        setSelection: (ids) =>
          set({ selection: { selectedIds: new Set(ids), isMoving: false, isResizing: false, handle: null } }),
        clearSelection: () => set({ selection: emptySelection() }),
        addToSelection: (id) =>
          set((s) => ({
            selection: { ...s.selection, selectedIds: new Set([...s.selection.selectedIds, id]) },
          })),
        removeFromSelection: (id) =>
          set((s) => {
            const ids = new Set(s.selection.selectedIds);
            ids.delete(id);
            return { selection: { ...s.selection, selectedIds: ids } };
          }),

        isDrawing: false,
        setIsDrawing: (drawing) => set({ isDrawing: drawing }),

        propertiesPanelOpen: false,
        setPropertiesPanelOpen: (open) => set({ propertiesPanelOpen: open }),

        newDocumentDialogOpen: false,
        setNewDocumentDialogOpen: (open) => set({ newDocumentDialogOpen: open }),
      }),
      {
        name: 'malipedefe-ui',
        // Only persist tool options and theme — not transient UI state
        partialize: (state) => ({
          toolOptions: state.toolOptions,
          theme: state.theme,
          sidebarOpen: state.sidebarOpen,
          focusToolbarSide: state.focusToolbarSide,
          lastShapeTool: state.lastShapeTool,
          recentColorsByFamily: state.recentColorsByFamily,
        }),
      },
    ),
  ),
);

function emptySelection(): SelectionState {
  return { selectedIds: new Set(), isMoving: false, isResizing: false, handle: null };
}
