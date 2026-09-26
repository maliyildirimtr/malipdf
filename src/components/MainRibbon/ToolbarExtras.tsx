/**
 * Ribbon helpers for a OneNote / PDF Annotator feel: quick colors, pen preset
 * slots and toolbar customization.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { useUIStore, type PenPreset } from '../../store/uiStore';
import type { ToolType } from '../../types/annotations';
import styles from './MainRibbon.module.css';

const FALLBACK_QUICK_COLORS = ['#000000', '#e63946', '#1d4ed8', '#16a34a', '#f59e0b', '#9333ea'];
const QUICK_COLOR_COUNT = 6;

/** One-click colors: the most recently used ones, topped up with defaults. */
export function QuickColors({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const recent = useUIStore((s) => s.recentColors);
  const colors = [...new Set([...recent, ...FALLBACK_QUICK_COLORS])].slice(0, QUICK_COLOR_COUNT);
  return (
    <div className={styles.quickColors} role="group" aria-label="Quick colors">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={`${styles.quickColor} ${value.toLowerCase() === color ? styles.quickColorActive : ''}`}
          style={{ background: color }}
          title={color}
          aria-label={`Use color ${color}`}
          onClick={() => {
            onPick(color);
            useUIStore.getState().addRecentColor(color);
          }}
        />
      ))}
    </div>
  );
}

/** Saved pen / highlighter slots. Click to use, right-click to remove, + saves the current pen. */
export function PenPresetBar({ tool }: { tool: PenPreset['tool'] }) {
  const presets = useUIStore((s) => s.penPresets).filter((p) => p.tool === tool);
  const current = useUIStore((s) => (tool === 'pen' ? s.toolOptions.pen : s.toolOptions.highlighter));
  const { applyPenPreset, removePenPreset, savePenPreset } = useUIStore.getState();

  return (
    <div className={styles.presetBar} role="group" aria-label={`Saved ${tool === 'pen' ? 'pens' : 'highlighters'}`}>
      <span className={styles.propertyLabel}>{tool === 'pen' ? 'Pens' : 'Markers'}</span>
      {presets.map((preset) => {
        const active = preset.color === current.color.toLowerCase() && preset.width === current.width && preset.opacity === current.opacity;
        // A small stroke sample (colour + thickness), so saved pens do not
        // look like a second colour palette.
        const thickness = Math.max(1.5, Math.min(7, preset.width * (tool === 'pen' ? 0.9 : 0.4)));
        return (
          <button
            key={preset.id}
            type="button"
            className={`${styles.presetSlot} ${active ? styles.presetSlotActive : ''}`}
            title={`${preset.color} · ${preset.width} pt (right-click to remove)`}
            aria-label={`Use ${tool} preset ${preset.color}, ${preset.width} points`}
            onClick={() => applyPenPreset(preset.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              removePenPreset(preset.id);
            }}
          >
            <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
              <path
                d="M3 10 C 7 2, 11 2, 13 7 S 19 12, 23 4"
                fill="none"
                stroke={preset.color}
                strokeOpacity={preset.opacity}
                strokeWidth={thickness}
                strokeLinecap={tool === 'pen' ? 'round' : 'butt'}
              />
            </svg>
          </button>
        );
      })}
      <button
        type="button"
        className={styles.presetSlot}
        title={`Save the current ${tool === 'pen' ? 'pen' : 'highlighter'} (colour + thickness)`}
        aria-label="Save the current settings as a saved pen"
        onClick={() => savePenPreset(tool)}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

const CUSTOMIZABLE_TOOLS: { tool: ToolType; label: string }[] = [
  { tool: 'hand', label: 'Hand' },
  { tool: 'lasso', label: 'Lasso Select' },
  { tool: 'pen', label: 'Pen' },
  { tool: 'highlighter', label: 'Highlighter' },
  { tool: 'eraser', label: 'Eraser' },
  { tool: 'text', label: 'Text' },
  { tool: 'line', label: 'Line' },
  { tool: 'arrow', label: 'Arrow' },
  { tool: 'rectangle', label: 'Rectangle' },
  { tool: 'ellipse', label: 'Ellipse' },
  { tool: 'freeform', label: 'Polygon' },
];

/** Show / hide tool buttons in the ribbon (tools stay available in menus and shortcuts). */
export function ToolbarCustomizeMenu() {
  const hidden = useUIStore((s) => s.hiddenToolbarTools);
  const toggle = useUIStore((s) => s.toggleToolbarTool);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className={styles.customizeRoot} ref={rootRef}>
      <button
        type="button"
        className={styles.commandButton}
        title="Customize toolbar"
        aria-label="Customize toolbar"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-toolbar-control="true"
      >
        <SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.customizePanel} role="menu" aria-label="Toolbar tools">
          <div className={styles.customizeTitle}>Show in toolbar</div>
          {CUSTOMIZABLE_TOOLS.map(({ tool, label }) => (
            <label key={tool} className={styles.customizeItem}>
              <input type="checkbox" checked={!hidden.includes(tool)} onChange={() => toggle(tool)} />
              {label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
