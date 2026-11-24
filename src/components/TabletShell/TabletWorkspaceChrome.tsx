/**
 * iPadOS Document Workspace Chrome — Single Ultra-Clean Top Bar.
 *
 * Layout:
 * - Left:   < (Library), ≡ (Sidebar), Undo, Redo
 * - Center: Core annotation tools (1 tap = select, 2nd/double tap = visual tool sheet)
 * - Right:  + (Insert popover), Share/Save popover, Open Tabs popover
 *
 * Secondary tools & document panels live in the collapsible left rail, and
 * favorited tool+color+size shortcuts stack vertically on the right edge.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PencilQuickPalette } from './PencilQuickPalette';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  Bold,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardPaste,
  Crop,
  Eraser,
  FileInput,
  FileOutput,
  FilePlus,
  FileText,
  Files,
  Hexagon,
  Highlighter,
  Image as ImageIcon,
  Images,
  Italic,
  LassoSelect,
  Menu,
  Minimize2,
  Minus,
  MousePointer2,
  NotebookPen,
  Pen,
  PenLine,
  Plus,
  PlusCircle,
  Redo2,
  Save,
  Scissors,
  Share,
  Sigma,
  Square,
  Stamp,
  Star,
  StickyNote,
  Target,
  Type,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { closeDocumentById, type AppCommandId } from '../../commands';
import { hasClipboardAnnotations, pasteAnnotations } from '../../commands/clipboardCommands';
import { autoSaveDirtyTabletDocuments } from '../../commands/saveCommands';
import { insertImageFromCamera, pasteImageFromClipboard } from '../../commands/imageCommands';
import { SignatureDialog } from '../SignStamp/SignatureDialog';
import { insertSignature, insertStamp } from '../SignStamp/signStampActions';
import { STAMP_PRESETS, todayLabel } from '../../pdf/stamps';
import { useDocumentStore } from '../../store/documentStore';
import {
  useUIStore,
  type TabletFavoriteTool,
  type TabletFavoriteToolKind,
} from '../../store/uiStore';
import { useLibraryStore } from '../../store/libraryStore';
import { isIpadApp } from '../../platform/native';
import { displayDocName } from '../../platform/ipadLibrary';
import { PEN_STYLES } from '../../pdf/penStyles';
import type { PenStyle, TextAlign, ToolType } from '../../types/annotations';
import styles from './TabletWorkspaceChrome.module.css';

const TRAY_COLORS = [
  '#1a1a2e', '#475569', '#154a87', '#1d5d9f', '#2563eb', '#06b6d4',
  '#10b981', '#22c55e', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#db2777',
];

const HIGHLIGHTER_COLORS = [
  '#FFEB3B', '#A7F3D0', '#93C5FD', '#F9A8D4', '#FDBA74', '#DDD6FE',
  '#FDE047', '#4ADE80', '#38BDF8', '#FB7185', '#FB923C', '#C084FC', '#F8FAFC',
];

const NOTE_COLORS = [
  '#F5C400', '#34D399', '#60A5FA', '#FB7185', '#A78BFA', '#FB923C',
];

const LASER_COLORS = [
  '#ff2d2d', '#2563eb', '#10b981', '#f59e0b', '#d946ef', '#06b6d4',
];

const STABILIZER_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'basic', label: 'Basic' },
  { value: 'soft', label: 'Soft' },
  { value: 'silky', label: 'Silky' },
  { value: 'fluid', label: 'Fluid' },
] as const;

const HOLD_SHAPE_DELAYS = [
  { value: 'off', label: 'Off' },
  { value: 'short', label: 'Short' },
  { value: 'default', label: 'Default' },
  { value: 'long', label: 'Long' },
] as const;

const SHAPE_TOOLS: ReadonlyArray<{ tool: ToolType; command: AppCommandId; label: string; icon: LucideIcon }> = [
  { tool: 'line', command: 'tool.line', label: 'Line', icon: Minus },
  { tool: 'arrow', command: 'tool.arrow', label: 'Arrow', icon: ArrowRight },
  { tool: 'rectangle', command: 'tool.rectangle', label: 'Rectangle', icon: Square },
  { tool: 'ellipse', command: 'tool.ellipse', label: 'Ellipse', icon: Circle },
  { tool: 'freeform', command: 'tool.freeform', label: 'Polygon', icon: Hexagon },
];

type ToolPopoverKind = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'text' | 'note' | 'shapes' | 'laserPointer';
type ActionPopoverKind = 'insert' | 'share' | 'tabs' | 'signatures';
type PopoverKind = ToolPopoverKind | ActionPopoverKind;

interface OpenPopover {
  kind: PopoverKind;
  x: number;
  y: number;
}

/** Contrast helper so light colors (yellow/white) use dark icons on favorite buttons. */
function isLightHex(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 170;
}

/** Stylized wave preview SVG tailored to each MaliPDF pen nib style. */
function PenStyleWave({ style, color }: { style: PenStyle; color: string }) {
  if (style === 'calligraphy') {
    return (
      <svg width="74" height="36" viewBox="0 0 74 36" aria-hidden="true">
        <path
          d="M 8 24 C 20 4, 30 6, 40 20 C 48 31, 58 29, 66 12"
          fill="none"
          stroke={color}
          strokeWidth="5.5"
          strokeLinecap="butt"
        />
        <path
          d="M 8 24 C 20 4, 30 6, 40 20 C 48 31, 58 29, 66 12"
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="1.2"
        />
      </svg>
    );
  }
  if (style === 'fountain') {
    return (
      <svg width="74" height="36" viewBox="0 0 74 36" aria-hidden="true">
        <path
          d="M 8 24 C 19 5, 29 5, 39 19 C 49 32, 58 28, 66 13"
          fill="none"
          stroke={color}
          strokeWidth="4.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (style === 'pencil') {
    return (
      <svg width="74" height="36" viewBox="0 0 74 36" aria-hidden="true">
        <path
          d="M 8 24 C 19 6, 29 6, 39 19 C 49 31, 58 28, 66 13"
          fill="none"
          stroke={color}
          strokeOpacity={0.62}
          strokeWidth="3.2"
          strokeDasharray="1.5 1.2"
          strokeLinecap="round"
        />
        <path
          d="M 8 24 C 19 6, 29 6, 39 19 C 49 31, 58 28, 66 13"
          fill="none"
          stroke={color}
          strokeOpacity={0.45}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (style === 'marker') {
    return (
      <svg width="74" height="36" viewBox="0 0 74 36" aria-hidden="true">
        <path
          d="M 8 24 C 19 6, 29 6, 39 19 C 49 31, 58 28, 66 13"
          fill="none"
          stroke={color}
          strokeOpacity={0.85}
          strokeWidth="7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="74" height="36" viewBox="0 0 74 36" aria-hidden="true">
      <path
        d="M 8 24 C 19 6, 29 6, 39 19 C 49 31, 58 28, 66 13"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface TabletWorkspaceChromeProps {
  onCommand: (commandId: AppCommandId) => void;
  canExecute: (commandId: AppCommandId) => boolean;
}

export function TabletWorkspaceTopChrome({ onCommand, canExecute }: TabletWorkspaceChromeProps) {
  const { documents, activeDocId, tabOrder, setActiveDocument } = useDocumentStore();
  const {
    activeTool,
    toolOptions,
    laserOptions,
    lassoOptions,
    writingSoundEnabled,
    soundEffectsEnabled,
    sidebarOpen,
    tabletRailHidden,
    setTabletRailHidden,
    lastShapeTool,
    updatePenOptions,
    updateHighlighterOptions,
    updateEraserOptions,
    updateTextOptions,
    updateNoteOptions,
    updateShapeOptions,
    updateLaserOptions,
    updateLassoOptions,
    setWritingSoundEnabled,
    setSoundEffectsEnabled,
    addTabletFavoriteTool,
    signatures,
    removeSignature,
  } = useUIStore();
  const setActiveView = useLibraryStore((s) => s.setActiveView);

  const [popover, setPopover] = useState<OpenPopover | null>(null);
  const [penTab, setPenTab] = useState<'basic' | 'advanced'>('basic');
  const [justAddedFav, setJustAddedFav] = useState(false);
  const [drawingSignature, setDrawingSignature] = useState(false);
  const [quickPaletteAnchor, setQuickPaletteAnchor] = useState<{ x: number; y: number } | null>(null);

  const lastInkToolRef = useRef<'pen' | 'highlighter'>('pen');
  const penTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const penLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const penLongPressFiredRef = useRef(false);

  useEffect(() => {
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      lastInkToolRef.current = activeTool;
    }
  }, [activeTool]);

  const togglePenAndEraser = useCallback(() => {
    setPopover(null);
    setQuickPaletteAnchor(null);
    const current = useUIStore.getState().activeTool;
    if (current === 'eraser') {
      onCommand(lastInkToolRef.current === 'highlighter' ? 'tool.highlighter' : 'tool.pen');
    } else {
      onCommand('tool.eraser');
    }
  }, [onCommand]);

  // Native Apple Pencil 2nd Gen / Pro gestures (dispatched from iOS UIPencilInteraction):
  // - Double-Tap barrel: Pen <-> Eraser
  // - Apple Pencil Pro Squeeze: toggle floating Quick Tool Palette at hover pose
  useEffect(() => {
    const onPencilDoubleTap = () => {
      togglePenAndEraser();
    };
    const onPencilSqueeze = (event: Event) => {
      const detail = (event as CustomEvent<{ x?: number; y?: number }>).detail;
      setPopover(null);
      setQuickPaletteAnchor((prev) => {
        if (prev) return null;
        const vw = window.visualViewport?.width ?? window.innerWidth;
        const vh = window.visualViewport?.height ?? window.innerHeight;
        const x = typeof detail?.x === 'number' && Number.isFinite(detail.x) && detail.x > 0 ? detail.x : vw / 2;
        const y = typeof detail?.y === 'number' && Number.isFinite(detail.y) && detail.y > 0 ? detail.y : vh / 2;
        return { x, y };
      });
    };
    window.addEventListener('malipdf:pencil-double-tap', onPencilDoubleTap);
    window.addEventListener('malipdf:pencil-squeeze', onPencilSqueeze);
    return () => {
      window.removeEventListener('malipdf:pencil-double-tap', onPencilDoubleTap);
      window.removeEventListener('malipdf:pencil-squeeze', onPencilSqueeze);
      if (penTapTimerRef.current) clearTimeout(penTapTimerRef.current);
      if (penLongPressTimerRef.current) clearTimeout(penLongPressTimerRef.current);
    };
  }, [togglePenAndEraser]);

  const returnToLibrary = () => {
    setPopover(null);
    void autoSaveDirtyTabletDocuments();
    setActiveView('library');
  };

  const activeDoc = activeDocId ? documents.get(activeDocId) ?? null : null;
  const isDirty = activeDoc ? activeDoc.currentStateId !== activeDoc.savedStateId : false;

  useEffect(() => {
    if (!popover) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-tw-popover="true"]')) return;
      setPopover(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopover(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  const isActionPopover = (kind: PopoverKind): kind is ActionPopoverKind =>
    kind === 'insert' || kind === 'share' || kind === 'tabs' || kind === 'signatures';

  const openPopoverAt = (kind: PopoverKind, anchor: HTMLElement) => {
    setJustAddedFav(false);
    const rect = anchor.getBoundingClientRect();
    const popoverWidth = kind === 'signatures' ? 320 : isActionPopover(kind) ? 260 : 348;
    const x = Math.min(window.innerWidth - popoverWidth - 12, Math.max(12, rect.left + rect.width / 2 - popoverWidth / 2));
    const y = Math.min(window.innerHeight - 420, rect.bottom + 8);
    setPopover({ kind, x, y: Math.max(56, y) });
  };

  const togglePopover = (kind: PopoverKind, event: React.MouseEvent<HTMLButtonElement>) => {
    if (popover?.kind === kind) {
      setPopover(null);
      return;
    }
    openPopoverAt(kind, event.currentTarget);
  };

  const isShapeActive = SHAPE_TOOLS.some((s) => s.tool === activeTool);
  const currentShapeDef = SHAPE_TOOLS.find((s) => s.tool === (isShapeActive ? activeTool : lastShapeTool)) ?? SHAPE_TOOLS[2];
  const CurrentShapeIcon = currentShapeDef.icon;

  const handleToolTap = (
    kind: ToolPopoverKind,
    command: AppCommandId,
    isCurrentlyActive: boolean,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (isCurrentlyActive) {
      togglePopover(kind, event);
    } else {
      setPopover(null);
      onCommand(command);
    }
  };

  const handleToolDoubleTap = (
    kind: ToolPopoverKind,
    command: AppCommandId,
    isCurrentlyActive: boolean,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (!isCurrentlyActive) onCommand(command);
    openPopoverAt(kind, event.currentTarget);
  };

  const handleAddFavorite = (toolKind: TabletFavoriteToolKind) => {
    addTabletFavoriteTool(toolKind);
    setJustAddedFav(true);
    setTimeout(() => setJustAddedFav(false), 1200);
  };

  const handleCloseTab = (docId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    void closeDocumentById(docId).then(() => {
      if (useDocumentStore.getState().tabOrder.length === 0) {
        setPopover(null);
        setActiveView('library');
      }
    });
  };

  const sheetTitle = (() => {
    if (!popover || isActionPopover(popover.kind)) return '';
    switch (popover.kind) {
      case 'pen': return 'Pen';
      case 'highlighter': return 'Highlighter';
      case 'eraser': return 'Eraser';
      case 'lasso': return 'Lasso Select';
      case 'text': return 'Text';
      case 'note': return 'Sticky Note';
      case 'shapes': return 'Shapes';
      case 'laserPointer': return 'Laser Pointer';
    }
  })();

  const favoriteTargetForPopover = (): TabletFavoriteToolKind => {
    if (!popover || isActionPopover(popover.kind) || popover.kind === 'lasso') return 'pen';
    if (popover.kind === 'shapes') return currentShapeDef.tool as TabletFavoriteToolKind;
    return popover.kind;
  };

  return (
    <>
      {/* ── Single Unified Ultra-Clean Top Bar (52px) ── */}
      <header className={styles.topChrome}>
        <div className={styles.navBar}>
          {/* Left: < (Library), ≡ (Sidebar), Undo, Redo */}
          <div className={styles.navLeft}>
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.accentIconBtn}`}
              aria-label="Back to Library"
              title="Back to Library"
              onClick={returnToLibrary}
            >
              <ChevronLeft size={23} strokeWidth={2.2} />
            </button>

            <button
              type="button"
              className={`${styles.iconBtn} ${styles.accentIconBtn} ${sidebarOpen ? styles.iconBtnActive : ''}`}
              aria-label="Pages & Sidebar"
              title="Pages & Sidebar"
              onClick={() => {
                if (tabletRailHidden) setTabletRailHidden(false);
                else onCommand('view.sidebar');
              }}
            >
              <Menu size={21} strokeWidth={2} />
            </button>

            <button
              type="button"
              className={`${styles.iconBtn} ${styles.accentIconBtn}`}
              aria-label="Undo"
              title="Undo"
              disabled={!canExecute('history.undo')}
              onClick={() => onCommand('history.undo')}
            >
              <Undo2 size={20} />
            </button>

            <button
              type="button"
              className={`${styles.iconBtn} ${styles.accentIconBtn}`}
              aria-label="Redo"
              title="Redo"
              disabled={!canExecute('history.redo')}
              onClick={() => onCommand('history.redo')}
            >
              <Redo2 size={20} />
            </button>
          </div>

          {/* Center: Clean Core Drawing & Annotation Tools */}
          <div className={styles.navCenter}>
            <div className={styles.toolDock} role="toolbar" aria-label="Annotation tools">
              <button
                type="button"
                className={`${styles.toolBtn} ${activeTool === 'select' ? styles.toolBtnActive : ''}`}
                aria-label="Select"
                title="Select"
                onClick={() => { setPopover(null); onCommand('tool.select'); }}
              >
                <MousePointer2 size={20} />
              </button>

              <button
                type="button"
                className={`${styles.toolBtn} ${activeTool === 'pen' ? styles.toolBtnActive : ''}`}
                aria-label="Pen"
                title="Pen — double-tap to switch Eraser, long-press for Quick Tool Palette"
                data-tw-popover="true"
                onPointerDown={(e) => {
                  penLongPressFiredRef.current = false;
                  if (penLongPressTimerRef.current) clearTimeout(penLongPressTimerRef.current);
                  const rect = e.currentTarget.getBoundingClientRect();
                  penLongPressTimerRef.current = setTimeout(() => {
                    penLongPressTimerRef.current = null;
                    penLongPressFiredRef.current = true;
                    if (penTapTimerRef.current) {
                      clearTimeout(penTapTimerRef.current);
                      penTapTimerRef.current = null;
                    }
                    setPopover(null);
                    setQuickPaletteAnchor({ x: rect.left + rect.width / 2, y: rect.bottom + 98 });
                  }, 420);
                }}
                onPointerUp={() => {
                  if (penLongPressTimerRef.current) {
                    clearTimeout(penLongPressTimerRef.current);
                    penLongPressTimerRef.current = null;
                  }
                }}
                onPointerLeave={() => {
                  if (penLongPressTimerRef.current) {
                    clearTimeout(penLongPressTimerRef.current);
                    penLongPressTimerRef.current = null;
                  }
                }}
                onPointerCancel={() => {
                  if (penLongPressTimerRef.current) {
                    clearTimeout(penLongPressTimerRef.current);
                    penLongPressTimerRef.current = null;
                  }
                }}
                onClick={(e) => {
                  if (penLongPressFiredRef.current) {
                    penLongPressFiredRef.current = false;
                    return;
                  }
                  if (activeTool === 'pen') {
                    const target = e.currentTarget;
                    if (penTapTimerRef.current) {
                      clearTimeout(penTapTimerRef.current);
                      penTapTimerRef.current = null;
                      togglePenAndEraser();
                      return;
                    }
                    penTapTimerRef.current = setTimeout(() => {
                      penTapTimerRef.current = null;
                      if (popover?.kind === 'pen') setPopover(null);
                      else openPopoverAt('pen', target);
                    }, 240);
                  } else {
                    setPopover(null);
                    onCommand('tool.pen');
                  }
                }}
                onDoubleClick={() => {
                  if (penTapTimerRef.current) {
                    clearTimeout(penTapTimerRef.current);
                    penTapTimerRef.current = null;
                  }
                  togglePenAndEraser();
                }}
              >
                <Pen size={20} />
                <span className={styles.toolColorBar} style={{ background: toolOptions.pen.color }} />
                {activeTool === 'pen' && <ChevronDown size={10} className={styles.toolOptionsCue} />}
              </button>

              <button
                type="button"
                className={`${styles.toolBtn} ${activeTool === 'highlighter' ? styles.toolBtnActive : ''}`}
                aria-label="Highlighter"
                title="Highlighter — tap again for options"
                data-tw-popover="true"
                onClick={(e) => handleToolTap('highlighter', 'tool.highlighter', activeTool === 'highlighter', e)}
                onDoubleClick={(e) => handleToolDoubleTap('highlighter', 'tool.highlighter', activeTool === 'highlighter', e)}
              >
                <Highlighter size={20} />
                <span className={styles.toolColorBar} style={{ background: toolOptions.highlighter.color }} />
                {activeTool === 'highlighter' && <ChevronDown size={10} className={styles.toolOptionsCue} />}
              </button>

              <button
                type="button"
                className={`${styles.toolBtn} ${activeTool === 'eraser' ? styles.toolBtnActive : ''}`}
                aria-label="Eraser"
                title="Eraser — tap again for options, double-tap for Pen"
                data-tw-popover="true"
                onClick={(e) => handleToolTap('eraser', 'tool.eraser', activeTool === 'eraser', e)}
                onDoubleClick={() => togglePenAndEraser()}
              >
                <Eraser size={20} />
                {activeTool === 'eraser' && <ChevronDown size={10} className={styles.toolOptionsCue} />}
              </button>

              <button
                type="button"
                className={`${styles.toolBtn} ${activeTool === 'lasso' ? styles.toolBtnActive : ''}`}
                aria-label="Lasso Select"
                title="Lasso Select — tap again for options"
                data-tw-popover="true"
                onClick={(e) => handleToolTap('lasso', 'tool.lasso', activeTool === 'lasso', e)}
                onDoubleClick={(e) => handleToolDoubleTap('lasso', 'tool.lasso', activeTool === 'lasso', e)}
              >
                <LassoSelect size={20} />
                {activeTool === 'lasso' && <ChevronDown size={10} className={styles.toolOptionsCue} />}
              </button>

              <button
                type="button"
                className={`${styles.toolBtn} ${activeTool === 'text' ? styles.toolBtnActive : ''}`}
                aria-label="Text"
                title="Text — tap again for options"
                data-tw-popover="true"
                onClick={(e) => handleToolTap('text', 'tool.text', activeTool === 'text', e)}
                onDoubleClick={(e) => handleToolDoubleTap('text', 'tool.text', activeTool === 'text', e)}
              >
                <Type size={20} />
                <span className={styles.toolColorBar} style={{ background: toolOptions.text.color }} />
                {activeTool === 'text' && <ChevronDown size={10} className={styles.toolOptionsCue} />}
              </button>

              <button
                type="button"
                className={`${styles.toolBtn} ${activeTool === 'note' ? styles.toolBtnActive : ''}`}
                aria-label="Sticky Note"
                title="Sticky Note — tap again for options"
                data-tw-popover="true"
                onClick={(e) => handleToolTap('note', 'tool.note', activeTool === 'note', e)}
                onDoubleClick={(e) => handleToolDoubleTap('note', 'tool.note', activeTool === 'note', e)}
              >
                <StickyNote size={20} />
                <span className={styles.toolColorBar} style={{ background: toolOptions.note.color }} />
                {activeTool === 'note' && <ChevronDown size={10} className={styles.toolOptionsCue} />}
              </button>

              <button
                type="button"
                className={`${styles.toolBtn} ${isShapeActive ? styles.toolBtnActive : ''}`}
                aria-label="Shapes"
                title="Shapes — tap again for options"
                data-tw-popover="true"
                onClick={(e) => handleToolTap('shapes', currentShapeDef.command, isShapeActive, e)}
                onDoubleClick={(e) => handleToolDoubleTap('shapes', currentShapeDef.command, isShapeActive, e)}
              >
                <CurrentShapeIcon size={20} />
                <span className={styles.toolColorBar} style={{ background: toolOptions.shape.color }} />
                {isShapeActive && <ChevronDown size={10} className={styles.toolOptionsCue} />}
              </button>

              <button
                type="button"
                className={`${styles.toolBtn} ${activeTool === 'laserPointer' ? styles.toolBtnActive : ''}`}
                aria-label="Laser Pointer"
                title="Laser Pointer — tap again for options"
                data-tw-popover="true"
                onClick={(e) => handleToolTap('laserPointer', 'tool.laserPointer', activeTool === 'laserPointer', e)}
                onDoubleClick={(e) => handleToolDoubleTap('laserPointer', 'tool.laserPointer', activeTool === 'laserPointer', e)}
              >
                <Target size={20} />
                <span className={styles.toolColorBar} style={{ background: laserOptions.color }} />
                {activeTool === 'laserPointer' && <ChevronDown size={10} className={styles.toolOptionsCue} />}
              </button>
            </div>
          </div>

          {/* Right: + (Insert), ↑ (Save/Share), ❐ (Open Tabs) */}
          <div className={styles.navRight}>
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.accentIconBtn} ${popover?.kind === 'insert' ? styles.iconBtnActive : ''}`}
              aria-label="Insert"
              title="Insert"
              disabled={!activeDoc}
              data-tw-popover="true"
              onClick={(e) => togglePopover('insert', e)}
            >
              <PlusCircle size={21} strokeWidth={1.9} />
            </button>

            <button
              type="button"
              className={`${styles.iconBtn} ${styles.accentIconBtn} ${isDirty ? styles.saveDirtyDot : ''} ${popover?.kind === 'share' ? styles.iconBtnActive : ''}`}
              aria-label="Save or Share"
              title="Save or Share"
              disabled={!activeDoc}
              data-tw-popover="true"
              onClick={(e) => togglePopover('share', e)}
            >
              <Share size={20} strokeWidth={1.9} />
            </button>

            <button
              type="button"
              className={`${styles.iconBtn} ${styles.accentIconBtn} ${popover?.kind === 'tabs' ? styles.iconBtnActive : ''}`}
              aria-label="Open documents"
              title={activeDoc ? displayDocName(activeDoc.title) : 'Open documents'}
              data-tw-popover="true"
              onClick={(e) => togglePopover('tabs', e)}
            >
              <Files size={20} strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Right-Side Action Popovers (+ Insert / Share & Save / Open Tabs) ── */}
      {popover && isActionPopover(popover.kind) && (
        <div
          className={styles.popover}
          style={{ left: popover.x, top: popover.y }}
          data-tw-popover="true"
          role="menu"
        >
          {popover.kind === 'insert' && (
            <>
              {hasClipboardAnnotations() && (
                <>
                  <button
                    type="button"
                    className={styles.popoverItem}
                    onClick={() => { setPopover(null); pasteAnnotations(); }}
                  >
                    <ClipboardPaste size={17} />
                    <span>Paste Selection</span>
                  </button>
                  <div className={styles.popoverDivider} />
                </>
              )}
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('insert.image'); }}
              >
                <ImageIcon size={17} />
                <span>Insert Image…</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); void insertImageFromCamera(); }}
              >
                <Camera size={17} />
                <span>Take Photo</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); void pasteImageFromClipboard(); }}
              >
                <ClipboardPaste size={17} />
                <span>Paste Image</span>
              </button>
              <div className={styles.popoverDivider} />
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => setPopover({ kind: 'signatures', x: Math.max(12, popover.x - 40), y: popover.y })}
              >
                <Stamp size={17} />
                <span>Signature & Stamps…</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('insert.formula'); }}
              >
                <Sigma size={17} />
                <span>Insert Formula…</span>
              </button>
              <div className={styles.popoverDivider} />
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('page.insertNotePage'); }}
              >
                <NotebookPen size={17} />
                <span>Insert Note Page…</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('page.insertBlank'); }}
              >
                <FilePlus size={17} />
                <span>Insert Blank Page</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('page.insertFromPdf'); }}
              >
                <FileInput size={17} />
                <span>Insert Pages from PDF…</span>
              </button>
            </>
          )}

          {popover.kind === 'signatures' && (
            <>
              <div className={styles.popoverHeader}>
                <span className={styles.popoverTitle}>Signature & Stamps</span>
                <button
                  type="button"
                  className={styles.pillBtn}
                  onClick={() => setPopover(null)}
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </div>
              <div className={styles.popoverSectionLabel}>Signatures</div>
              <div className={styles.chipRow}>
                {signatures.map((sig) => (
                  <div key={sig.id} style={{ position: 'relative', display: 'inline-flex' }}>
                    <button
                      type="button"
                      className={styles.chipBtn}
                      style={{ height: 42, padding: '4px 10px', background: '#ffffff' }}
                      onClick={() => {
                        setPopover(null);
                        void insertSignature(sig.dataUrl);
                      }}
                    >
                      <img src={sig.dataUrl} alt="Saved signature" style={{ height: 28, maxWidth: 86, objectFit: 'contain' }} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSignature(sig.id)}
                      aria-label="Delete signature"
                      style={{
                        position: 'absolute',
                        top: -5,
                        right: -5,
                        width: 18,
                        height: 18,
                        borderRadius: 999,
                        border: 'none',
                        background: '#334155',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={`${styles.chipBtn} ${styles.chipBtnActive}`}
                  onClick={() => {
                    setPopover(null);
                    setDrawingSignature(true);
                  }}
                >
                  <Plus size={14} />
                  <span>New Signature…</span>
                </button>
              </div>

              <div className={styles.popoverDivider} />
              <div className={styles.popoverSectionLabel}>Stamps</div>
              <div className={styles.chipRow}>
                {STAMP_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={styles.chipBtn}
                    style={{ color: preset.color, borderColor: preset.color }}
                    onClick={() => {
                      setPopover(null);
                      void insertStamp({ text: preset.text, color: preset.color, subtext: todayLabel() });
                    }}
                  >
                    {preset.text}
                  </button>
                ))}
              </div>
            </>
          )}

          {popover.kind === 'share' && (
            <>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('file.save'); }}
              >
                <Save size={17} />
                <span>Save</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('file.saveAs'); }}
              >
                <Save size={17} />
                <span>Save As…</span>
              </button>
              <div className={styles.popoverDivider} />
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand(isIpadApp() ? 'file.print' : 'file.export'); }}
              >
                <Share size={17} />
                <span>Share or Export</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('file.export'); }}
              >
                <FileOutput size={17} />
                <span>Export PDF…</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('file.exportImages'); }}
              >
                <Images size={17} />
                <span>Export Pages as Images…</span>
              </button>
              <div className={styles.popoverDivider} />
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('page.split'); }}
              >
                <Scissors size={17} />
                <span>Split PDF…</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('tool.crop'); }}
              >
                <Crop size={17} />
                <span>Crop Pages</span>
              </button>
              <button
                type="button"
                className={styles.popoverItem}
                onClick={() => { setPopover(null); onCommand('file.reduceSize'); }}
              >
                <Minimize2 size={17} />
                <span>Reduce File Size…</span>
              </button>
            </>
          )}

          {popover.kind === 'tabs' && (
            <>
              <div className={styles.popoverSectionLabel}>Open documents</div>
              {tabOrder.map((docId) => {
                const doc = documents.get(docId);
                if (!doc) return null;
                const isActive = docId === activeDocId;
                const docDirty = doc.currentStateId !== doc.savedStateId;
                return (
                  <div
                    key={docId}
                    className={`${styles.popoverItem} ${isActive ? styles.popoverItemActive : ''}`}
                    role="menuitem"
                    onClick={() => {
                      setActiveDocument(docId);
                      setPopover(null);
                    }}
                    style={{ justifyContent: 'space-between' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                      <FileText size={16} style={{ flexShrink: 0 }} />
                      {docDirty && <span className={styles.tabDot} />}
                      <span className={styles.tabLabel} data-no-translate>{displayDocName(doc.title)}</span>
                    </span>
                    <button
                      type="button"
                      className={styles.tabCloseBtn}
                      aria-label={`Close ${doc.title}`}
                      onClick={(e) => handleCloseTab(docId, e)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
              <div className={styles.popoverDivider} />
              <button
                type="button"
                className={styles.popoverItem}
                onClick={returnToLibrary}
              >
                <ChevronLeft size={16} />
                <span>Back to Library</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Upgraded Visual Tool Settings Sheet (Sapphire Banner + Visual Cards + Favorites) ── */}
      {popover && !isActionPopover(popover.kind) && (
        <div
          className={styles.toolSheet}
          style={{ left: popover.x, top: popover.y }}
          data-tw-popover="true"
          role="dialog"
          aria-label="Tool options"
        >
          <div className={styles.sheetBanner}>
            <span className={styles.sheetBannerTitle}>{sheetTitle}</span>
            <button
              type="button"
              className={styles.sheetDoneBtn}
              onClick={() => setPopover(null)}
            >
              Done
            </button>
          </div>

          <div className={styles.sheetBody}>
            {popover.kind === 'pen' && (
              <>
                <div className={styles.sheetTabs} role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={penTab === 'basic'}
                    className={`${styles.sheetTabBtn} ${penTab === 'basic' ? styles.sheetTabBtnActive : ''}`}
                    onClick={() => setPenTab('basic')}
                  >
                    Basic
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={penTab === 'advanced'}
                    className={`${styles.sheetTabBtn} ${penTab === 'advanced' ? styles.sheetTabBtnActive : ''}`}
                    onClick={() => setPenTab('advanced')}
                  >
                    Advanced Settings
                  </button>
                </div>

                {penTab === 'basic' ? (
                  <>
                    <div className={styles.penStyleGrid}>
                      {PEN_STYLES.map(({ value, label }) => {
                        const currentStyle: PenStyle = toolOptions.pen.penStyle ?? 'ballpoint';
                        const active = currentStyle === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            className={`${styles.penStyleCard} ${active ? styles.penStyleCardActive : ''}`}
                            aria-pressed={active}
                            onClick={() => updatePenOptions({ penStyle: value })}
                          >
                            <div className={styles.penStyleStroke}>
                              <PenStyleWave style={value} color={toolOptions.pen.color} />
                            </div>
                            <div className={styles.penStyleFooter}>{label}</div>
                          </button>
                        );
                      })}
                    </div>

                    <div className={styles.colorTray}>
                      <div className={styles.colorTrayGrid}>
                        <label className={styles.rainbowColorBtn} title="Custom color">
                          <Plus size={15} strokeWidth={3} />
                          <input
                            type="color"
                            className={styles.rainbowColorInput}
                            value={toolOptions.pen.color}
                            onChange={(e) => updatePenOptions({ color: e.target.value })}
                          />
                        </label>
                        {TRAY_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`${styles.swatchCircle} ${toolOptions.pen.color.toLowerCase() === color.toLowerCase() ? styles.swatchCircleActive : ''}`}
                            style={{ background: color }}
                            onClick={() => updatePenOptions({ color })}
                          />
                        ))}
                      </div>
                    </div>

                    <div className={styles.sliderCard}>
                      <div className={styles.sliderCardRow}>
                        <span className={styles.sliderCardLabel}>Thickness:</span>
                        <input
                          type="range"
                          min={0.5}
                          max={16}
                          step={0.5}
                          value={toolOptions.pen.width}
                          onChange={(e) => updatePenOptions({ width: Number(e.target.value) })}
                        />
                        <span className={styles.sliderVal}>{toolOptions.pen.width}pt</span>
                      </div>
                      <div className={styles.sliderCardRow}>
                        <span className={styles.sliderCardLabel}>Opacity:</span>
                        <input
                          type="range"
                          min={20}
                          max={100}
                          value={Math.round(toolOptions.pen.opacity * 100)}
                          onChange={(e) => updatePenOptions({ opacity: Number(e.target.value) / 100 })}
                        />
                        <span className={styles.sliderVal}>{Math.round(toolOptions.pen.opacity * 100)}%</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.advSection}>
                      <div className={styles.advHeader}>Hold to Draw Shape</div>
                      <div className={styles.advSubtext}>Wait duration before snapping to a shape</div>
                      <div className={styles.segmentedTrack}>
                        {HOLD_SHAPE_DELAYS.map(({ value, label }) => {
                          const currentDelay = toolOptions.pen.holdToShapeDelay ?? (toolOptions.pen.holdToShape === false ? 'off' : 'default');
                          const active = currentDelay === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              className={`${styles.segmentedBtn} ${active ? styles.segmentedBtnActive : ''}`}
                              onClick={() => updatePenOptions({ holdToShape: value !== 'off', holdToShapeDelay: value })}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className={styles.advSection}>
                      <div className={styles.advHeader}>Stabilizer</div>
                      <div className={styles.advSubtext}>Stabilizes finger and Apple Pencil strokes for smooth handwriting</div>
                      <div className={styles.segmentedTrack}>
                        {STABILIZER_LEVELS.map(({ value, label }) => {
                          const active = (toolOptions.pen.stabilizer ?? 'basic') === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              className={`${styles.segmentedBtn} ${active ? styles.segmentedBtnActive : ''}`}
                              onClick={() => updatePenOptions({ stabilizer: value })}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className={styles.sliderCard}>
                      <button
                        type="button"
                        className={styles.toggleRow}
                        onClick={() => updatePenOptions({ scribbleToErase: toolOptions.pen.scribbleToErase === false })}
                      >
                        <div className={styles.lassoToggleInfo}>
                          <span>Scribble to Erase</span>
                          <span className={styles.lassoToggleDesc}>Scratch over ink back and forth to erase</span>
                        </div>
                        <span className={`${styles.togglePill} ${toolOptions.pen.scribbleToErase !== false ? styles.togglePillOn : ''}`}>
                          <span className={styles.toggleKnob} />
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.toggleRow}
                        onClick={() => updatePenOptions({ pressureSensitive: !toolOptions.pen.pressureSensitive })}
                      >
                        <span>Pressure Sensitivity</span>
                        <span className={`${styles.togglePill} ${toolOptions.pen.pressureSensitive ? styles.togglePillOn : ''}`}>
                          <span className={styles.toggleKnob} />
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.toggleRow}
                        onClick={() => updatePenOptions({ endlessPage: !toolOptions.pen.endlessPage })}
                      >
                        <span>Endless Page</span>
                        <span className={`${styles.togglePill} ${toolOptions.pen.endlessPage ? styles.togglePillOn : ''}`}>
                          <span className={styles.toggleKnob} />
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.toggleRow}
                        onClick={() => setWritingSoundEnabled(!writingSoundEnabled)}
                      >
                        <div className={styles.lassoToggleInfo}>
                          <span>Play Writing Sound</span>
                          <span className={styles.lassoToggleDesc}>Sounds like writing on paper</span>
                        </div>
                        <span className={`${styles.togglePill} ${writingSoundEnabled ? styles.togglePillOn : ''}`}>
                          <span className={styles.toggleKnob} />
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.toggleRow}
                        onClick={() => setSoundEffectsEnabled(!soundEffectsEnabled)}
                      >
                        <div className={styles.lassoToggleInfo}>
                          <span>Play Sound Effects</span>
                          <span className={styles.lassoToggleDesc}>Subtle sounds for shape snap and eraser</span>
                        </div>
                        <span className={`${styles.togglePill} ${soundEffectsEnabled ? styles.togglePillOn : ''}`}>
                          <span className={styles.toggleKnob} />
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {popover.kind === 'lasso' && (
              <>
                <div className={styles.lassoModeGrid}>
                  <button
                    type="button"
                    className={`${styles.lassoModeCard} ${lassoOptions.mode === 'rectangle' ? styles.lassoModeCardActive : ''}`}
                    onClick={() => updateLassoOptions({ mode: 'rectangle' })}
                  >
                    <svg width="56" height="36" viewBox="0 0 56 36" aria-hidden="true">
                      <rect
                        x="6" y="5" width="44" height="26" rx="4"
                        fill="rgba(45, 120, 196, 0.14)"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeDasharray="4 3"
                      />
                    </svg>
                    <span>Rectangle</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.lassoModeCard} ${lassoOptions.mode === 'freehand' ? styles.lassoModeCardActive : ''}`}
                    onClick={() => updateLassoOptions({ mode: 'freehand' })}
                  >
                    <svg width="56" height="36" viewBox="0 0 56 36" aria-hidden="true">
                      <path
                        d="M12 10 C22 3, 38 6, 46 13 C52 19, 46 30, 32 31 C18 32, 6 24, 12 10 Z"
                        fill="rgba(245, 198, 120, 0.28)"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeDasharray="4 3"
                      />
                    </svg>
                    <span>Freehand</span>
                  </button>
                </div>

                <div className={styles.sliderCard}>
                  <button
                    type="button"
                    className={styles.toggleRow}
                    onClick={() => updateLassoOptions({ selectStrokes: !lassoOptions.selectStrokes })}
                  >
                    <div className={styles.lassoToggleInfo}>
                      <span>Select Pen Strokes</span>
                      <span className={styles.lassoToggleDesc}>Selects pen, pencil, marker and shape strokes</span>
                    </div>
                    <span className={`${styles.togglePill} ${lassoOptions.selectStrokes ? styles.togglePillOn : ''}`}>
                      <span className={styles.toggleKnob} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.toggleRow}
                    onClick={() => updateLassoOptions({ selectHighlights: !lassoOptions.selectHighlights })}
                  >
                    <div className={styles.lassoToggleInfo}>
                      <span>Select Highlighter Strokes</span>
                      <span className={styles.lassoToggleDesc}>Selects highlighter lines and text markups</span>
                    </div>
                    <span className={`${styles.togglePill} ${lassoOptions.selectHighlights ? styles.togglePillOn : ''}`}>
                      <span className={styles.toggleKnob} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.toggleRow}
                    onClick={() => updateLassoOptions({ selectBoxes: !lassoOptions.selectBoxes })}
                  >
                    <div className={styles.lassoToggleInfo}>
                      <span>Select Boxes</span>
                      <span className={styles.lassoToggleDesc}>Selects text boxes, images and sticky notes</span>
                    </div>
                    <span className={`${styles.togglePill} ${lassoOptions.selectBoxes ? styles.togglePillOn : ''}`}>
                      <span className={styles.toggleKnob} />
                    </span>
                  </button>
                </div>
              </>
            )}

            {popover.kind === 'highlighter' && (
              <>
                <div className={styles.strokePreviewBox}>
                  <svg width="260" height="36" viewBox="0 0 260 36" aria-hidden="true">
                    <line
                      x1="22"
                      y1="18"
                      x2="238"
                      y2="18"
                      stroke={toolOptions.highlighter.color}
                      strokeOpacity={toolOptions.highlighter.opacity}
                      strokeWidth={Math.max(6, Math.min(28, toolOptions.highlighter.width * 0.75))}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>

                <div className={styles.colorTray}>
                  <div className={styles.colorTrayGrid}>
                    <label className={styles.rainbowColorBtn} title="Custom color">
                      <Plus size={15} strokeWidth={3} />
                      <input
                        type="color"
                        className={styles.rainbowColorInput}
                        value={toolOptions.highlighter.color}
                        onChange={(e) => updateHighlighterOptions({ color: e.target.value })}
                      />
                    </label>
                    {HIGHLIGHTER_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`${styles.swatchCircle} ${toolOptions.highlighter.color.toLowerCase() === color.toLowerCase() ? styles.swatchCircleActive : ''}`}
                        style={{ background: color }}
                        onClick={() => updateHighlighterOptions({ color })}
                      />
                    ))}
                  </div>
                </div>

                <div className={styles.sliderCard}>
                  <div className={styles.sliderCardRow}>
                    <span className={styles.sliderCardLabel}>Thickness:</span>
                    <input
                      type="range"
                      min={8}
                      max={48}
                      value={toolOptions.highlighter.width}
                      onChange={(e) => updateHighlighterOptions({ width: Number(e.target.value) })}
                    />
                    <span className={styles.sliderVal}>{Math.round(toolOptions.highlighter.width)}pt</span>
                  </div>
                  <div className={styles.sliderCardRow}>
                    <span className={styles.sliderCardLabel}>Opacity:</span>
                    <input
                      type="range"
                      min={15}
                      max={80}
                      value={Math.round(toolOptions.highlighter.opacity * 100)}
                      onChange={(e) => updateHighlighterOptions({ opacity: Number(e.target.value) / 100 })}
                    />
                    <span className={styles.sliderVal}>{Math.round(toolOptions.highlighter.opacity * 100)}%</span>
                  </div>
                </div>
              </>
            )}

            {popover.kind === 'eraser' && (
              <>
                <div className={styles.strokePreviewBox}>
                  <span
                    style={{
                      width: Math.max(12, Math.min(34, toolOptions.eraser.size * 0.65)),
                      height: Math.max(12, Math.min(34, toolOptions.eraser.size * 0.65)),
                      borderRadius: '999px',
                      border: '2px solid var(--tw-accent)',
                      background: 'var(--tw-accent-bg)',
                    }}
                  />
                </div>
                <div className={styles.chipRow}>
                  <button
                    type="button"
                    className={`${styles.chipBtn} ${toolOptions.eraser.mode === 'object' ? styles.chipBtnActive : ''}`}
                    onClick={() => updateEraserOptions({ mode: 'object' })}
                  >
                    Object Eraser
                  </button>
                  <button
                    type="button"
                    className={`${styles.chipBtn} ${toolOptions.eraser.mode === 'stroke' ? styles.chipBtnActive : ''}`}
                    onClick={() => updateEraserOptions({ mode: 'stroke' })}
                  >
                    Stroke Eraser
                  </button>
                </div>
                <div className={styles.sliderCard}>
                  <div className={styles.sliderCardRow}>
                    <span className={styles.sliderCardLabel}>Thickness:</span>
                    <input
                      type="range"
                      min={6}
                      max={64}
                      value={toolOptions.eraser.size}
                      onChange={(e) => updateEraserOptions({ size: Number(e.target.value) })}
                    />
                    <span className={styles.sliderVal}>{Math.round(toolOptions.eraser.size)}pt</span>
                  </div>
                </div>
              </>
            )}

            {popover.kind === 'text' && (
              <>
                <div className={styles.chipRow}>
                  <button
                    type="button"
                    className={`${styles.chipBtn} ${toolOptions.text.bold ? styles.chipBtnActive : ''}`}
                    aria-label="Bold"
                    onClick={() => updateTextOptions({ bold: !toolOptions.text.bold })}
                  >
                    <Bold size={15} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.chipBtn} ${toolOptions.text.italic ? styles.chipBtnActive : ''}`}
                    aria-label="Italic"
                    onClick={() => updateTextOptions({ italic: !toolOptions.text.italic })}
                  >
                    <Italic size={15} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.chipBtn} ${toolOptions.text.underline ? styles.chipBtnActive : ''}`}
                    aria-label="Underline"
                    onClick={() => updateTextOptions({ underline: !toolOptions.text.underline })}
                  >
                    <Underline size={15} />
                  </button>
                  {(['left', 'center', 'right'] as TextAlign[]).map((align) => {
                    const Icon = align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight;
                    return (
                      <button
                        key={align}
                        type="button"
                        className={`${styles.chipBtn} ${toolOptions.text.align === align ? styles.chipBtnActive : ''}`}
                        onClick={() => updateTextOptions({ align })}
                      >
                        <Icon size={15} />
                      </button>
                    );
                  })}
                </div>

                <div className={styles.colorTray}>
                  <div className={styles.colorTrayGrid}>
                    <label className={styles.rainbowColorBtn} title="Custom color">
                      <Plus size={15} strokeWidth={3} />
                      <input
                        type="color"
                        className={styles.rainbowColorInput}
                        value={toolOptions.text.color}
                        onChange={(e) => updateTextOptions({ color: e.target.value })}
                      />
                    </label>
                    {TRAY_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`${styles.swatchCircle} ${toolOptions.text.color.toLowerCase() === color.toLowerCase() ? styles.swatchCircleActive : ''}`}
                        style={{ background: color }}
                        onClick={() => updateTextOptions({ color })}
                      />
                    ))}
                  </div>
                </div>

                <div className={styles.sliderCard}>
                  <div className={styles.sliderCardRow}>
                    <span className={styles.sliderCardLabel}>Font Size:</span>
                    <input
                      type="range"
                      min={10}
                      max={48}
                      value={toolOptions.text.fontSize}
                      onChange={(e) => updateTextOptions({ fontSize: Number(e.target.value) })}
                    />
                    <span className={styles.sliderVal}>{Math.round(toolOptions.text.fontSize)}px</span>
                  </div>
                </div>
              </>
            )}

            {popover.kind === 'note' && (
              <div className={styles.colorTray}>
                <div className={styles.colorTrayGrid}>
                  <label className={styles.rainbowColorBtn} title="Custom color">
                    <Plus size={15} strokeWidth={3} />
                    <input
                      type="color"
                      className={styles.rainbowColorInput}
                      value={toolOptions.note.color}
                      onChange={(e) => updateNoteOptions({ color: e.target.value })}
                    />
                  </label>
                  {NOTE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`${styles.swatchCircle} ${toolOptions.note.color.toLowerCase() === color.toLowerCase() ? styles.swatchCircleActive : ''}`}
                      style={{ background: color }}
                      onClick={() => updateNoteOptions({ color })}
                    />
                  ))}
                </div>
              </div>
            )}

            {popover.kind === 'shapes' && (
              <>
                <div className={styles.shapeGrid}>
                  {SHAPE_TOOLS.map(({ tool, command, label, icon: Icon }) => (
                    <button
                      key={tool}
                      type="button"
                      className={`${styles.toolBtn} ${activeTool === tool ? styles.toolBtnActive : ''}`}
                      title={label}
                      aria-label={label}
                      onClick={() => onCommand(command)}
                    >
                      <Icon size={20} />
                    </button>
                  ))}
                </div>

                <div className={styles.chipRow}>
                  {(['solid', 'dashed', 'dotted'] as const).map((borderStyle) => (
                    <button
                      key={borderStyle}
                      type="button"
                      className={`${styles.chipBtn} ${toolOptions.shape.borderStyle === borderStyle ? styles.chipBtnActive : ''}`}
                      onClick={() => updateShapeOptions({ borderStyle })}
                    >
                      {borderStyle === 'solid' ? 'Solid' : borderStyle === 'dashed' ? 'Dashed' : 'Dotted'}
                    </button>
                  ))}
                </div>

                <div className={styles.colorTray}>
                  <div className={styles.colorTrayGrid}>
                    <label className={styles.rainbowColorBtn} title="Custom color">
                      <Plus size={15} strokeWidth={3} />
                      <input
                        type="color"
                        className={styles.rainbowColorInput}
                        value={toolOptions.shape.color}
                        onChange={(e) => updateShapeOptions({ color: e.target.value })}
                      />
                    </label>
                    {TRAY_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`${styles.swatchCircle} ${toolOptions.shape.color.toLowerCase() === color.toLowerCase() ? styles.swatchCircleActive : ''}`}
                        style={{ background: color }}
                        onClick={() => updateShapeOptions({ color })}
                      />
                    ))}
                  </div>
                </div>

                <div className={styles.sliderCard}>
                  <div className={styles.sliderCardRow}>
                    <span className={styles.sliderCardLabel}>Thickness:</span>
                    <input
                      type="range"
                      min={1}
                      max={16}
                      value={toolOptions.shape.strokeWidth}
                      onChange={(e) => updateShapeOptions({ strokeWidth: Number(e.target.value) })}
                    />
                    <span className={styles.sliderVal}>{Math.round(toolOptions.shape.strokeWidth)}pt</span>
                  </div>
                </div>
              </>
            )}

            {popover.kind === 'laserPointer' && (
              <>
                <div className={styles.chipRow}>
                  <button
                    type="button"
                    className={`${styles.chipBtn} ${laserOptions.mode === 'individual' ? styles.chipBtnActive : ''}`}
                    onClick={() => updateLaserOptions({ mode: 'individual' })}
                  >
                    Fade Each
                  </button>
                  <button
                    type="button"
                    className={`${styles.chipBtn} ${laserOptions.mode === 'group' ? styles.chipBtnActive : ''}`}
                    onClick={() => updateLaserOptions({ mode: 'group' })}
                  >
                    Fade Together
                  </button>
                </div>

                <div className={styles.colorTray}>
                  <div className={styles.colorTrayGrid}>
                    <label className={styles.rainbowColorBtn} title="Custom color">
                      <Plus size={15} strokeWidth={3} />
                      <input
                        type="color"
                        className={styles.rainbowColorInput}
                        value={laserOptions.color}
                        onChange={(e) => updateLaserOptions({ color: e.target.value })}
                      />
                    </label>
                    {LASER_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`${styles.swatchCircle} ${laserOptions.color.toLowerCase() === color.toLowerCase() ? styles.swatchCircleActive : ''}`}
                        style={{ background: color }}
                        onClick={() => updateLaserOptions({ color })}
                      />
                    ))}
                  </div>
                </div>

                <div className={styles.sliderCard}>
                  <div className={styles.sliderCardRow}>
                    <span className={styles.sliderCardLabel}>Thickness:</span>
                    <input
                      type="range"
                      min={2}
                      max={12}
                      value={laserOptions.width}
                      onChange={(e) => updateLaserOptions({ width: Number(e.target.value) })}
                    />
                    <span className={styles.sliderVal}>{Math.round(laserOptions.width)}pt</span>
                  </div>
                </div>
              </>
            )}

            {popover.kind !== 'lasso' && (
              <button
                type="button"
                className={styles.favAddBtn}
                onClick={() => handleAddFavorite(favoriteTargetForPopover())}
              >
                <span className={styles.favStarBadge}>
                  {justAddedFav ? <Check size={13} strokeWidth={3} /> : <Star size={13} fill="currentColor" />}
                </span>
                <span>{justAddedFav ? 'Added to Favorites' : 'Add to Favorites'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      <PencilQuickPalette
        anchor={quickPaletteAnchor}
        onClose={() => setQuickPaletteAnchor(null)}
        onCommand={onCommand}
        canExecute={canExecute}
      />

      {drawingSignature && (
        <SignatureDialog
          onClose={() => setDrawingSignature(false)}
          onSaved={(dataUrl) => {
            setDrawingSignature(false);
            void insertSignature(dataUrl);
          }}
        />
      )}
    </>
  );
}

// ── Top-Right Floating Favorite Tools Vertical Rail ─────────────────────────

function iconForFavoriteTool(tool: TabletFavoriteToolKind): LucideIcon {
  switch (tool) {
    case 'pen': return PenLine;
    case 'highlighter': return Highlighter;
    case 'eraser': return Eraser;
    case 'text': return Type;
    case 'note': return StickyNote;
    case 'line': return Minus;
    case 'arrow': return ArrowRight;
    case 'rectangle': return Square;
    case 'ellipse': return Circle;
    case 'freeform': return Hexagon;
    case 'laserPointer': return Target;
  }
}

function isFavoriteCurrentlyActive(
  fav: TabletFavoriteTool,
  activeTool: ToolType,
  toolOptions: ReturnType<typeof useUIStore.getState>['toolOptions'],
  laserOptions: ReturnType<typeof useUIStore.getState>['laserOptions'],
): boolean {
  if (activeTool !== fav.tool) return false;
  if (fav.tool === 'pen') {
    return (
      toolOptions.pen.color.toLowerCase() === fav.color.toLowerCase() &&
      toolOptions.pen.width === fav.size &&
      (toolOptions.pen.penStyle ?? 'ballpoint') === (fav.penStyle ?? 'ballpoint')
    );
  }
  if (fav.tool === 'highlighter') {
    return (
      toolOptions.highlighter.color.toLowerCase() === fav.color.toLowerCase() &&
      toolOptions.highlighter.width === fav.size
    );
  }
  if (fav.tool === 'eraser') {
    return toolOptions.eraser.size === fav.size && toolOptions.eraser.mode === (fav.eraserMode ?? toolOptions.eraser.mode);
  }
  if (fav.tool === 'text') {
    return toolOptions.text.color.toLowerCase() === fav.color.toLowerCase() && toolOptions.text.fontSize === fav.size;
  }
  if (fav.tool === 'note') {
    return toolOptions.note.color.toLowerCase() === fav.color.toLowerCase();
  }
  if (fav.tool === 'laserPointer') {
    return laserOptions.color.toLowerCase() === fav.color.toLowerCase() && laserOptions.width === fav.size;
  }
  return toolOptions.shape.color.toLowerCase() === fav.color.toLowerCase() && toolOptions.shape.strokeWidth === fav.size;
}

export function TabletFavoritesRail() {
  const {
    tabletFavoriteTools,
    applyTabletFavoriteTool,
    removeTabletFavoriteTool,
    activeTool,
    toolOptions,
    laserOptions,
    workspaceMode,
  } = useUIStore();
  const [editing, setEditing] = useState(false);

  if (tabletFavoriteTools.length === 0) return null;

  return (
    <div
      className={`${styles.favoritesRail} ${workspaceMode === 'focus' ? styles.favoritesRailFocus : ''}`}
      role="toolbar"
      aria-label="Favorite tools"
    >
      {tabletFavoriteTools.map((fav) => {
        const Icon = iconForFavoriteTool(fav.tool);
        const light = isLightHex(fav.color);
        const fg = light ? '#0f172a' : '#ffffff';
        const isActive = isFavoriteCurrentlyActive(fav, activeTool, toolOptions, laserOptions);
        const sizeDisplay = fav.tool === 'note' ? '' : String(Number(fav.size.toFixed(1)));

        return (
          <div key={fav.id} className={styles.favShortcutWrap}>
            <button
              type="button"
              className={`${styles.favShortcutBtn} ${isActive ? styles.favShortcutBtnActive : ''}`}
              style={{ background: fav.color, color: fg }}
              title={`${fav.tool} · ${sizeDisplay}`}
              aria-label={`Favorite ${fav.tool} ${sizeDisplay}`}
              aria-pressed={isActive}
              onClick={() => applyTabletFavoriteTool(fav.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                removeTabletFavoriteTool(fav.id);
              }}
            >
              <Icon size={20} strokeWidth={2.2} />
              {sizeDisplay && <span className={styles.favShortcutSize}>{sizeDisplay}</span>}
            </button>
            <button
              type="button"
              className={`${styles.favRemoveBtn} ${editing ? styles.favRemoveBtnVisible : ''}`}
              aria-label="Remove favorite"
              title="Remove"
              onClick={(e) => {
                e.stopPropagation();
                removeTabletFavoriteTool(fav.id);
              }}
            >
              <X size={11} strokeWidth={3} />
            </button>
          </div>
        );
      })}

      {tabletFavoriteTools.length > 0 && (
        <button
          type="button"
          className={`${styles.favEditToggleBtn} ${editing ? styles.favEditToggleBtnActive : ''}`}
          aria-label="Manage favorites"
          title={editing ? 'Done' : 'Remove favorites'}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? <Check size={14} /> : <X size={14} />}
        </button>
      )}
    </div>
  );
}

/** Minimal floating page & zoom pill at the bottom of the iPadOS canvas. */
export function TabletBottomPagePill({ onCommand }: { onCommand: (commandId: AppCommandId) => void }) {
  const { documents, activeDocId, setActivePage } = useDocumentStore();
  const activeDoc = activeDocId ? documents.get(activeDocId) ?? null : null;
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Hide the floating bottom pill while typing in a text box/input so it never
  // collides with iPadOS's on-screen keyboard shortcut bar.
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isEditable(e.target)) setKeyboardOpen(true);
    };
    const onFocusOut = () => {
      setTimeout(() => {
        setKeyboardOpen(isEditable(document.activeElement));
      }, 60);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  if (!activeDoc || keyboardOpen) return null;

  const pageNumber = activeDoc.activePageIndex + 1;
  const pageCount = activeDoc.pageCount;
  const zoomPct = Math.round(activeDoc.zoom * 100);

  const goToPage = (targetIndex: number) => {
    const clamped = Math.max(0, Math.min(pageCount - 1, targetIndex));
    setActivePage(activeDoc.id, clamped);
    document
      .querySelector(`[data-doc-id="${activeDoc.id}"][data-instance-id="${activeDoc.instanceId}"][data-page-index="${clamped}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={styles.bottomPill} role="region" aria-label="Page and zoom controls">
      <button
        type="button"
        className={styles.pillBtn}
        aria-label="Previous page"
        disabled={pageNumber <= 1}
        onClick={() => goToPage(activeDoc.activePageIndex - 1)}
      >
        <ChevronLeft size={17} />
      </button>
      <span className={styles.pillPageText} data-no-translate>
        {pageNumber} / {pageCount}
      </span>
      <button
        type="button"
        className={styles.pillBtn}
        aria-label="Next page"
        disabled={pageNumber >= pageCount}
        onClick={() => goToPage(activeDoc.activePageIndex + 1)}
      >
        <ChevronRight size={17} />
      </button>

      <div className={styles.pillDivider} />

      <button
        type="button"
        className={styles.pillBtn}
        aria-label="Zoom out"
        onClick={() => onCommand('view.zoomOut')}
      >
        <ZoomOut size={16} />
      </button>
      <button
        type="button"
        className={styles.pillBtn}
        title="Fit Page"
        onClick={() => onCommand(activeDoc.zoomMode === 'fitPage' ? 'view.fitWidth' : 'view.fitPage')}
      >
        {zoomPct}%
      </button>
      <button
        type="button"
        className={styles.pillBtn}
        aria-label="Zoom in"
        onClick={() => onCommand('view.zoomIn')}
      >
        <ZoomIn size={16} />
      </button>
    </div>
  );
}
