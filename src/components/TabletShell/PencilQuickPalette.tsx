import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
  Eraser,
  Highlighter,
  LassoSelect,
  Pen,
  Redo2,
  Shapes,
  Type,
  Undo2,
} from 'lucide-react';
import type { AppCommandId } from '../../commands/commandRegistry';
import { useUIStore } from '../../store/uiStore';
import styles from './PencilQuickPalette.module.css';

const QUICK_COLORS = [
  '#1a1a2e',
  '#154a87',
  '#2563eb',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
];

export interface PencilQuickPaletteProps {
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  onCommand: (commandId: AppCommandId) => void;
  canExecute: (commandId: AppCommandId) => boolean;
}

/**
 * Floating Apple Pencil Pro Squeeze / Long-Press Quick Tool Palette.
 * Appears right at the Pencil hover pose (or toolbar button) for instant
 * one-tap access to tools, quick ink colors, and Undo/Redo.
 */
export function PencilQuickPalette({
  anchor,
  onClose,
  onCommand,
  canExecute,
}: PencilQuickPaletteProps) {
  const activeTool = useUIStore((s) => s.activeTool);
  const toolOptions = useUIStore((s) => s.toolOptions);
  const updatePenOptions = useUIStore((s) => s.updatePenOptions);
  const updateHighlighterOptions = useUIStore((s) => s.updateHighlighterOptions);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anchor, onClose]);

  if (!anchor) return null;

  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const panelW = 318;
  const panelH = 178;
  const left = Math.max(14, Math.min(vw - panelW - 14, anchor.x - panelW / 2));
  const top = Math.max(66, Math.min(vh - panelH - 18, anchor.y - panelH / 2));

  const pickTool = (cmd: AppCommandId) => {
    onCommand(cmd);
    onClose();
  };

  const pickColor = (color: string) => {
    if (activeTool === 'highlighter') {
      updateHighlighterOptions({ color });
    } else {
      updatePenOptions({ color });
      if (activeTool !== 'pen') onCommand('tool.pen');
    }
    onClose();
  };

  const activeColor = activeTool === 'highlighter' ? toolOptions.highlighter.color : toolOptions.pen.color;

  return ReactDOM.createPortal(
    <div
      className={styles.backdrop}
      data-keeps-selection="true"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.palette}
        style={{ left, top }}
        role="dialog"
        aria-label="Quick Tool Palette"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className={styles.toolRow}>
          <button
            type="button"
            className={`${styles.toolTile} ${activeTool === 'pen' ? styles.toolTileActive : ''}`}
            onClick={() => pickTool('tool.pen')}
            aria-label="Pen"
          >
            <Pen size={19} />
            <span>Pen</span>
          </button>
          <button
            type="button"
            className={`${styles.toolTile} ${activeTool === 'highlighter' ? styles.toolTileActive : ''}`}
            onClick={() => pickTool('tool.highlighter')}
            aria-label="Highlighter"
          >
            <Highlighter size={19} />
            <span>Highlighter</span>
          </button>
          <button
            type="button"
            className={`${styles.toolTile} ${activeTool === 'eraser' ? styles.toolTileActive : ''}`}
            onClick={() => pickTool('tool.eraser')}
            aria-label="Eraser"
          >
            <Eraser size={19} />
            <span>Eraser</span>
          </button>
          <button
            type="button"
            className={`${styles.toolTile} ${activeTool === 'lasso' ? styles.toolTileActive : ''}`}
            onClick={() => pickTool('tool.lasso')}
            aria-label="Lasso"
          >
            <LassoSelect size={19} />
            <span>Lasso</span>
          </button>
          <button
            type="button"
            className={`${styles.toolTile} ${activeTool === 'text' ? styles.toolTileActive : ''}`}
            onClick={() => pickTool('tool.text')}
            aria-label="Text"
          >
            <Type size={19} />
            <span>Text</span>
          </button>
          <button
            type="button"
            className={`${styles.toolTile} ${
              activeTool === 'rectangle' || activeTool === 'ellipse' || activeTool === 'line' || activeTool === 'arrow'
                ? styles.toolTileActive
                : ''
            }`}
            onClick={() => pickTool('tool.rectangle')}
            aria-label="Shapes"
          >
            <Shapes size={19} />
            <span>Shape</span>
          </button>
        </div>

        <div className={styles.divider} />

        <div className={styles.bottomRow}>
          <div className={styles.colorRow}>
            {QUICK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.colorDot} ${activeColor.toLowerCase() === c.toLowerCase() ? styles.colorDotActive : ''}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onClick={() => pickColor(c)}
              />
            ))}
          </div>

          <div className={styles.historyRow}>
            <button
              type="button"
              className={styles.histBtn}
              disabled={!canExecute('history.undo')}
              onClick={() => onCommand('history.undo')}
              aria-label="Undo"
            >
              <Undo2 size={17} />
            </button>
            <button
              type="button"
              className={styles.histBtn}
              disabled={!canExecute('history.redo')}
              onClick={() => onCommand('history.redo')}
              aria-label="Redo"
            >
              <Redo2 size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
