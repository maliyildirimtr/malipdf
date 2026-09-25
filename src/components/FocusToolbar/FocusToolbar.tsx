import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  LogOut,
  Minus,
  MousePointer2,
  PanelLeftClose,
  PanelRightClose,
  Palette,
  Pen,
  Redo2,
  SlidersHorizontal,
  Square,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { AppCommandId } from '../../commands';
import {
  useUIStore,
  type FocusShapeTool,
  type ToolColorFamily,
} from '../../store/uiStore';
import type { ToolType } from '../../types/annotations';
import { ColorWell } from '../MainRibbon/ColorWell';
import { OpacityControl } from '../MainRibbon/PropertyControls';
import { TOOL_WIDTH_CONSTRAINTS } from '../../constants/toolConstraints';
import { WidthControl } from '../Properties/WidthControl';
import styles from './FocusToolbar.module.css';

const TOOL_COMMANDS = {
  select: 'tool.select',
  hand: 'tool.hand',
  pen: 'tool.pen',
  highlighter: 'tool.highlighter',
  eraser: 'tool.eraser',
  text: 'tool.text',
  line: 'tool.line',
  arrow: 'tool.arrow',
  rectangle: 'tool.rectangle',
  ellipse: 'tool.ellipse',
} as const satisfies Partial<Record<ToolType, AppCommandId>>;

const SHAPES: ReadonlyArray<{ tool: FocusShapeTool; label: string; icon: LucideIcon }> = [
  { tool: 'line', label: 'Line', icon: Minus },
  { tool: 'arrow', label: 'Arrow', icon: ArrowRight },
  { tool: 'rectangle', label: 'Rectangle', icon: Square },
  { tool: 'ellipse', label: 'Ellipse', icon: Circle },
];



export interface FocusToolbarProps {
  onCommand: (commandId: AppCommandId) => void;
  canExecute: (commandId: AppCommandId) => boolean;
}

/** A persistent, compact command surface for teaching and presentation work. */
export function FocusToolbar({ onCommand, canExecute }: FocusToolbarProps) {
  const {
    activeTool,
    focusToolbarSide,
    focusToolbarCollapsed,
    toggleFocusToolbarCollapsed,
    workspaceMode,
    lastShapeTool,
    toolOptions,
    updatePenOptions,
    updateHighlighterOptions,
    updateTextOptions,
    updateShapeOptions,
  } = useUIStore();
  const rootRef = useRef<HTMLElement>(null);
  const [openPanel, setOpenPanel] = useState<'shape' | 'properties' | null>(null);

  useEffect(() => {
    if (!openPanel) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenPanel(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openPanel]);

  useEffect(() => {
    if (workspaceMode !== 'focus') setOpenPanel(null);
  }, [workspaceMode]);

  const shapeDefinition = SHAPES.find(({ tool }) => tool === lastShapeTool) ?? SHAPES[2];
  const ShapeIcon = shapeDefinition.icon;
  const propertySummary = useMemo(() => getPropertySummary(activeTool, toolOptions), [activeTool, toolOptions]);

  if (workspaceMode !== 'focus') return null;

  const run = (commandId: AppCommandId) => {
    if (canExecute(commandId)) onCommand(commandId);
  };

  if (focusToolbarCollapsed) {
    const ExpandIcon = focusToolbarSide === 'left' ? ChevronRight : ChevronLeft;
    return (
      <aside
        ref={rootRef}
        className={`${styles.toolbar} ${styles.collapsed} ${styles[focusToolbarSide]}`}
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Collapsed focus toolbar"
      >
        <button
          type="button"
          className={styles.focusButton}
          onClick={toggleFocusToolbarCollapsed}
          aria-label="Expand focus toolbar"
          title="Expand focus toolbar"
        >
          <ExpandIcon size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.focusButton} ${styles.exitButton}`}
          onClick={() => run('view.focusMode')}
          aria-label="Exit Focus Mode"
          title="Exit Focus Mode (Esc)"
        >
          <LogOut size={20} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      ref={rootRef}
      className={`${styles.toolbar} ${styles[focusToolbarSide]}`}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Focus mode annotation tools"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && openPanel) {
          event.preventDefault();
          event.stopPropagation();
          setOpenPanel(null);
          return;
        }
        handleArrowNavigation(event);
      }}
    >
      <FocusToolButton tool="select" label="Select" icon={MousePointer2} activeTool={activeTool} run={run} enabled={canExecute('tool.select')} />
      <FocusToolButton tool="hand" label="Hand" icon={Hand} activeTool={activeTool} run={run} enabled={canExecute('tool.hand')} />
      <Separator />
      <FocusToolButton tool="pen" label="Pen" icon={Pen} activeTool={activeTool} run={run} enabled={canExecute('tool.pen')} />
      <FocusToolButton tool="highlighter" label="Highlighter" icon={Highlighter} activeTool={activeTool} run={run} enabled={canExecute('tool.highlighter')} />
      <FocusToolButton tool="eraser" label="Eraser" icon={Eraser} activeTool={activeTool} run={run} enabled={canExecute('tool.eraser')} />
      <FocusToolButton tool="text" label="Text" icon={Type} activeTool={activeTool} run={run} enabled={canExecute('tool.text')} />

      <div className={styles.splitButton}>
        <button
          type="button"
          className={`${styles.shapeMain} ${activeTool === lastShapeTool ? styles.active : ''}`}
          onClick={() => run(TOOL_COMMANDS[lastShapeTool])}
          aria-label={shapeDefinition.label}
          aria-pressed={activeTool === lastShapeTool}
          title={`${shapeDefinition.label} (${shortcutFor(lastShapeTool)})`}
          disabled={!canExecute(TOOL_COMMANDS[lastShapeTool])}
        >
          <ShapeIcon size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.shapeDisclosure}
          onClick={() => setOpenPanel((panel) => panel === 'shape' ? null : 'shape')}
          aria-label="Choose shape tool"
          aria-haspopup="menu"
          aria-expanded={openPanel === 'shape'}
          title="Choose shape tool"
        >
          <ChevronRight size={11} aria-hidden="true" />
        </button>
        {openPanel === 'shape' && (
          <div className={`${styles.popover} ${styles.shapePopover}`} role="menu" aria-label="Shape tools">
            {SHAPES.map(({ tool, label, icon: Icon }) => (
              <button
                key={tool}
                type="button"
                role="menuitemradio"
                aria-checked={activeTool === tool}
                className={`${styles.shapeOption} ${activeTool === tool ? styles.active : ''}`}
                onClick={() => {
                  run(TOOL_COMMANDS[tool]);
                  setOpenPanel(null);
                }}
                title={`${label} (${shortcutFor(tool)})`}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Separator />
      <FocusCommandButton commandId="history.undo" label="Undo" icon={Undo2} run={run} enabled={canExecute('history.undo')} />
      <FocusCommandButton commandId="history.redo" label="Redo" icon={Redo2} run={run} enabled={canExecute('history.redo')} />
      <Separator />

      <button
        type="button"
        className={styles.focusButton}
        onClick={() => setOpenPanel((panel) => panel === 'properties' ? null : 'properties')}
        aria-label={`Tool properties, ${propertySummary.label}`}
        aria-haspopup="dialog"
        aria-expanded={openPanel === 'properties'}
        title={`Tool properties · ${propertySummary.label}`}
      >
        {propertySummary.color ? (
          <span className={styles.colorIndicator} style={{ '--focus-color': propertySummary.color } as React.CSSProperties}>
            <Palette size={19} aria-hidden="true" />
          </span>
        ) : (
          <SlidersHorizontal size={19} aria-hidden="true" />
        )}
        {propertySummary.width !== null && (
          <span className={styles.widthIndicator} aria-hidden="true">{propertySummary.width}</span>
        )}
      </button>

      {openPanel === 'properties' && (
        <div className={`${styles.popover} ${styles.propertyPopover}`} role="dialog" aria-label={`${propertySummary.toolLabel} properties`}>
          <div className={styles.popoverTitle}>{propertySummary.toolLabel}</div>
          <FocusProperties
            activeTool={activeTool}
            toolOptions={toolOptions}
            updatePenOptions={updatePenOptions}
            updateHighlighterOptions={updateHighlighterOptions}
            updateTextOptions={updateTextOptions}
            updateShapeOptions={updateShapeOptions}
          />
        </div>
      )}

      <span className={styles.flexSpacer} />
      <button type="button" className={styles.focusButton} onClick={toggleFocusToolbarCollapsed} aria-label="Collapse focus toolbar" title="Collapse focus toolbar">
        {focusToolbarSide === 'left'
          ? <PanelLeftClose size={19} aria-hidden="true" />
          : <PanelRightClose size={19} aria-hidden="true" />}
      </button>
      <button type="button" className={`${styles.focusButton} ${styles.exitButton}`} onClick={() => run('view.focusMode')} aria-label="Exit Focus Mode" title="Exit Focus Mode (Esc)">
        <LogOut size={20} aria-hidden="true" />
      </button>
    </aside>
  );
}

function FocusToolButton({ tool, label, icon: Icon, activeTool, run, enabled }: {
  tool: keyof typeof TOOL_COMMANDS;
  label: string;
  icon: LucideIcon;
  activeTool: ToolType;
  run: (commandId: AppCommandId) => void;
  enabled: boolean;
}) {
  const selected = activeTool === tool;
  return (
    <button
      type="button"
      className={`${styles.focusButton} ${selected ? styles.active : ''}`}
      onClick={() => run(TOOL_COMMANDS[tool])}
      disabled={!enabled}
      aria-label={label}
      aria-pressed={selected}
      title={`${label} (${shortcutFor(tool)})`}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}

function FocusCommandButton({ commandId, label, icon: Icon, run, enabled }: {
  commandId: AppCommandId;
  label: string;
  icon: LucideIcon;
  run: (commandId: AppCommandId) => void;
  enabled: boolean;
}) {
  return (
    <button type="button" className={styles.focusButton} onClick={() => run(commandId)} disabled={!enabled} aria-label={label} title={label}>
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}

function FocusProperties({ activeTool, toolOptions, updatePenOptions, updateHighlighterOptions, updateTextOptions, updateShapeOptions }: {
  activeTool: ToolType;
  toolOptions: ReturnType<typeof useUIStore.getState>['toolOptions'];
  updatePenOptions: ReturnType<typeof useUIStore.getState>['updatePenOptions'];
  updateHighlighterOptions: ReturnType<typeof useUIStore.getState>['updateHighlighterOptions'];
  updateTextOptions: ReturnType<typeof useUIStore.getState>['updateTextOptions'];
  updateShapeOptions: ReturnType<typeof useUIStore.getState>['updateShapeOptions'];
}) {
  if (activeTool === 'pen') {
    return <PropertyStack colorFamily="pen" color={toolOptions.pen.color} width={toolOptions.pen.width} constraint={TOOL_WIDTH_CONSTRAINTS.pen} opacity={toolOptions.pen.opacity} onColor={(color) => updatePenOptions({ color })} onWidth={(width) => updatePenOptions({ width })} onOpacity={(opacity) => updatePenOptions({ opacity })} />;
  }
  if (activeTool === 'highlighter') {
    return <PropertyStack colorFamily="highlighter" color={toolOptions.highlighter.color} width={toolOptions.highlighter.width} constraint={TOOL_WIDTH_CONSTRAINTS.highlighter} opacity={toolOptions.highlighter.opacity} onColor={(color) => updateHighlighterOptions({ color })} onWidth={(width) => updateHighlighterOptions({ width })} onOpacity={(opacity) => updateHighlighterOptions({ opacity })} />;
  }
  if (activeTool === 'text') {
    return (
      <div className={styles.propertyStack}>
        <ColorWell label="Text" value={toolOptions.text.color} onChange={(color) => updateTextOptions({ color })} />
        <label className={styles.focusField}>
          <span>Size</span>
          <input type="number" min="6" max="144" step="1" value={toolOptions.text.fontSize} onChange={(event) => updateTextOptions({ fontSize: Number(event.target.value) })} aria-label="Text size in PDF points" />
        </label>
      </div>
    );
  }
  if (isShapeLike(activeTool)) {
    return (
      <div className={styles.propertyStack}>
        <ColorWell label="Stroke" value={toolOptions.shape.color} onChange={(color) => updateShapeOptions({ color })} />
        {(activeTool === 'rectangle' || activeTool === 'roundedRect' || activeTool === 'ellipse') && (
          <ColorWell
            label="Fill"
            value={toolOptions.shape.fillColor}
            allowTransparent
            onChange={(fillColor) => updateShapeOptions({ fillColor })}
          />
        )}
        <WidthControl value={toolOptions.shape.strokeWidth} constraint={TOOL_WIDTH_CONSTRAINTS.shape} onChange={(strokeWidth) => updateShapeOptions({ strokeWidth })} onCommit={(strokeWidth) => updateShapeOptions({ strokeWidth })} />
        <OpacityControl value={toolOptions.shape.opacity} onChange={(opacity) => updateShapeOptions({ opacity })} />
      </div>
    );
  }
  if (activeTool === 'eraser') return <p className={styles.propertyHint}>Whole Stroke eraser</p>;
  if (activeTool === 'hand') return <p className={styles.propertyHint}>Hold Space for temporary Hand.</p>;
  return <p className={styles.propertyHint}>Select a drawing tool to edit its properties.</p>;
}

function PropertyStack({ colorFamily, color, width, constraint, opacity, onColor, onWidth, onOpacity }: {
  colorFamily: ToolColorFamily;
  color: string;
  width: number;
  constraint: any;
  opacity: number;
  onColor: (color: string) => void;
  onWidth: (width: number) => void;
  onOpacity: (opacity: number) => void;
}) {
  return (
    <div className={styles.propertyStack} data-color-family={colorFamily}>
      <ColorWell label="Color" value={color} onChange={onColor} />
      <WidthControl value={width} constraint={constraint} onChange={onWidth} onCommit={onWidth} />
      <OpacityControl value={opacity} onChange={onOpacity} />
    </div>
  );
}

function Separator() {
  return <span className={styles.separator} aria-hidden="true" />;
}

function isShape(tool: ToolType): tool is FocusShapeTool {
  return tool === 'line' || tool === 'arrow' || tool === 'rectangle' || tool === 'ellipse';
}

function isShapeLike(tool: ToolType): boolean {
  return isShape(tool) || tool === 'roundedRect';
}

function shortcutFor(tool: keyof typeof TOOL_COMMANDS): string {
  return ({ select: 'V', hand: 'H', pen: 'P', highlighter: 'M', eraser: 'E', text: 'T', line: 'L', arrow: 'A', rectangle: 'R', ellipse: 'C' } as const)[tool];
}

function getPropertySummary(activeTool: ToolType, options: ReturnType<typeof useUIStore.getState>['toolOptions']) {
  if (activeTool === 'pen') return { toolLabel: 'Pen', label: `${options.pen.width} pt`, color: options.pen.color, width: options.pen.width };
  if (activeTool === 'highlighter') return { toolLabel: 'Highlighter', label: `${options.highlighter.width} pt`, color: options.highlighter.color, width: options.highlighter.width };
  if (activeTool === 'text') return { toolLabel: 'Text', label: `${options.text.fontSize} pt`, color: options.text.color, width: null };
  if (isShapeLike(activeTool)) return { toolLabel: activeTool[0].toUpperCase() + activeTool.slice(1), label: `${options.shape.strokeWidth} pt`, color: options.shape.color, width: options.shape.strokeWidth };
  if (activeTool === 'eraser') return { toolLabel: 'Eraser', label: 'Whole Stroke', color: null, width: null };
  return { toolLabel: activeTool === 'hand' ? 'Hand' : 'Select', label: 'No editable properties', color: null, width: null };
}

function handleArrowNavigation(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    .filter((button) => button.offsetParent !== null);
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0 || buttons.length === 0) return;
  event.preventDefault();
  const delta = event.key === 'ArrowDown' ? 1 : -1;
  buttons[(index + delta + buttons.length) % buttons.length].focus();
}
