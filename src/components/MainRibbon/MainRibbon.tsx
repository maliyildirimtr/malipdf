import React from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  Check,
  Circle,
  Eraser,
  Focus,
  FolderOpen,
  Hand,
  Highlighter,
  Maximize2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  PanelLeft,
  Pen,
  RectangleHorizontal,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scan,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { APP_COMMANDS, type AppCommandId } from '../../commands';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import type { TextAlign, ToolType } from '../../types/annotations';
import { ColorWell } from './ColorWell';
import { OpacityControl, StrokeWidthControl } from './PropertyControls';
import styles from './MainRibbon.module.css';

const PEN_WIDTHS = [1, 2, 3, 5, 8] as const;
const HIGHLIGHTER_WIDTHS = [10, 16, 22, 30] as const;
const SHAPE_WIDTHS = [1, 2, 3, 4, 6] as const;
const FONT_FAMILIES = ['Inter, sans-serif', 'Georgia, serif', 'Courier New, monospace'] as const;
const FONT_SIZES = [10, 12, 14, 16, 18, 24, 32] as const;

interface ToolDefinition {
  icon: LucideIcon;
  commandId: AppCommandId;
}

const TOOL_DEFINITIONS: Record<ToolType, ToolDefinition> = {
  select: { icon: MousePointer2, commandId: 'tool.select' },
  hand: { icon: Hand, commandId: 'tool.hand' },
  pen: { icon: Pen, commandId: 'tool.pen' },
  highlighter: { icon: Highlighter, commandId: 'tool.highlighter' },
  eraser: { icon: Eraser, commandId: 'tool.eraser' },
  text: { icon: Type, commandId: 'tool.text' },
  line: { icon: Minus, commandId: 'tool.line' },
  arrow: { icon: ArrowRight, commandId: 'tool.arrow' },
  rectangle: { icon: Square, commandId: 'tool.rectangle' },
  roundedRect: { icon: RectangleHorizontal, commandId: 'tool.rectangle' },
  ellipse: { icon: Circle, commandId: 'tool.ellipse' },
};

const DOCUMENT_COMMANDS = new Set<AppCommandId>([
  'file.export',
  'history.undo',
  'history.redo',
  'view.zoomIn',
  'view.zoomOut',
  'view.actualSize',
  'view.fitWidth',
  'view.fitPage',
  'view.rotateCCW',
  'view.rotateCW',
]);

export interface MainRibbonProps {
  onCommand: (commandId: AppCommandId) => void;
  canExecute?: (commandId: AppCommandId) => boolean;
}

/**
 * MaliPDF's normal-mode command surface. Command execution deliberately lives
 * outside this component so toolbar, keyboard and native-menu actions all use
 * the same application handlers.
 */
export function MainRibbon({ onCommand, canExecute }: MainRibbonProps) {
  const ribbonRef = React.useRef<HTMLElement>(null);
  const [density, setDensity] = React.useState<'full' | 'compact' | 'tight'>('full');
  const { activeDocId, documents } = useDocumentStore();
  const {
    activeTool,
    toolOptions,
    updatePenOptions,
    updateHighlighterOptions,
    updateTextOptions,
    updateShapeOptions,
    recentColorsByFamily,
    rememberColor,
    sidebarOpen,
    workspaceMode,
  } = useUIStore();

  const activeDoc = activeDocId ? documents.get(activeDocId) : undefined;
  const hasDocument = Boolean(activeDoc);
  const zoomLabel = activeDoc?.zoomMode === 'fitWidth'
    ? 'FIT W'
    : activeDoc?.zoomMode === 'fitPage'
      ? 'FIT P'
      : `${Math.round((activeDoc?.zoom ?? 1) * 100)}%`;

  const isEnabled = React.useCallback((commandId: AppCommandId) => {
    if (canExecute) return canExecute(commandId);
    return !DOCUMENT_COMMANDS.has(commandId) || hasDocument;
  }, [canExecute, hasDocument]);

  const runCommand = React.useCallback((commandId: AppCommandId) => {
    if (isEnabled(commandId)) onCommand(commandId);
  }, [isEnabled, onCommand]);

  const activeDefinition = TOOL_DEFINITIONS[activeTool];
  const activeCommand = APP_COMMANDS[activeDefinition.commandId];
  const ActiveToolIcon = activeDefinition.icon;

  React.useLayoutEffect(() => {
    const ribbon = ribbonRef.current;
    if (!ribbon) return;
    const updateDensity = (width: number) => {
      setDensity(width >= 1200 ? 'full' : width >= 1000 ? 'compact' : 'tight');
    };
    updateDensity(ribbon.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => updateDensity(entry.contentRect.width));
    observer.observe(ribbon);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ribbonRef} className={styles.ribbon} data-density={density} aria-label="MaliPDF tools">
      <div
        className={styles.primaryRow}
        role="toolbar"
        aria-label="Document and annotation tools"
        onKeyDown={handleToolbarArrowNavigation}
      >
        <ToolbarGroup label="File">
          <ToolbarMenu
            label="File menu"
            icon={FolderOpen}
            onCommand={runCommand}
            items={[
              { commandId: 'file.new', label: 'New Document…', shortcut: '⌘N', enabled: isEnabled('file.new') },
              { commandId: 'file.open', label: 'Open PDF…', shortcut: '⌘O', enabled: isEnabled('file.open') },
              { commandId: 'file.save', label: 'Save', shortcut: '⌘S', enabled: isEnabled('file.save') },
              { commandId: 'file.saveAs', label: 'Save As…', shortcut: '⇧⌘S', enabled: isEnabled('file.saveAs') },
              { commandId: 'file.export', label: 'Export PDF…', shortcut: '⌘E', enabled: isEnabled('file.export') },
              { commandId: 'file.close', label: 'Close', shortcut: '⌘W', enabled: isEnabled('file.close') },
            ]}
          />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup label="History">
          <CommandButton commandId="history.undo" label="Undo" shortcut="⌘Z" icon={Undo2} onCommand={runCommand} enabled={isEnabled('history.undo')} />
          <CommandButton commandId="history.redo" label="Redo" shortcut="⇧⌘Z" icon={Redo2} onCommand={runCommand} enabled={isEnabled('history.redo')} />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup label="Navigation tools" segmented>
          <ToolButton tool="select" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.select')} />
          <ToolButton tool="hand" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.hand')} />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup label="Ink tools" segmented>
          <ToolButton tool="pen" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.pen')} />
          <ToolButton tool="highlighter" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.highlighter')} />
          <ToolButton tool="eraser" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.eraser')} />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup label="Annotation tools" segmented>
          <ToolButton tool="text" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.text')} />
          <ToolButton tool="line" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.line')} />
          <ToolButton tool="arrow" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.arrow')} />
          <ToolButton tool="rectangle" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.rectangle')} />
          <ToolButton tool="ellipse" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.ellipse')} />
        </ToolbarGroup>

        <div className={styles.primarySpacer} />

        <ToolbarGroup label="View">
          <div className={styles.zoomCluster} role="group" aria-label="Zoom">
            <CommandButton commandId="view.zoomOut" label="Zoom Out" shortcut="⌘−" icon={ZoomOut} onCommand={runCommand} enabled={isEnabled('view.zoomOut')} />
            <output className={styles.zoomValue} aria-label={`Current zoom ${zoomLabel}`}>{zoomLabel}</output>
            <CommandButton commandId="view.zoomIn" label="Zoom In" shortcut="⌘+" icon={ZoomIn} onCommand={runCommand} enabled={isEnabled('view.zoomIn')} />
          </div>
          <ToolbarMenu
            label="Page fit"
            icon={Maximize2}
            onCommand={runCommand}
            items={[
              { commandId: 'view.actualSize', label: 'Actual Size', shortcut: '⌘0', enabled: isEnabled('view.actualSize'), icon: Scan },
              { commandId: 'view.fitWidth', label: 'Fit Width', shortcut: '⌘6', enabled: isEnabled('view.fitWidth'), icon: Maximize2 },
              { commandId: 'view.fitPage', label: 'Fit Page', shortcut: '⌘5', enabled: isEnabled('view.fitPage'), icon: Square },
            ]}
            alignEnd
          />
          <span className={styles.wideViewControls}>
            <CommandButton commandId="view.rotateCCW" label="Rotate View Left" shortcut="⌘[" icon={RotateCcw} onCommand={runCommand} enabled={isEnabled('view.rotateCCW')} />
            <CommandButton commandId="view.rotateCW" label="Rotate View Right" shortcut="⌘]" icon={RotateCw} onCommand={runCommand} enabled={isEnabled('view.rotateCW')} />
          </span>
          <ToolbarMenu
            label="More view actions"
            icon={MoreHorizontal}
            onCommand={runCommand}
            className={styles.compactViewMenu}
            alignEnd
            items={[
              { commandId: 'view.rotateCCW', label: 'Rotate View Left', shortcut: '⌘[', enabled: isEnabled('view.rotateCCW'), icon: RotateCcw },
              { commandId: 'view.rotateCW', label: 'Rotate View Right', shortcut: '⌘]', enabled: isEnabled('view.rotateCW'), icon: RotateCw },
            ]}
          />
          <CommandButton
            commandId="view.focusMode"
            label="Focus / Teaching Mode"
            shortcut="⌥⌘F"
            icon={Focus}
            onCommand={runCommand}
            enabled={isEnabled('view.focusMode')}
            pressed={workspaceMode === 'focus'}
          />
        </ToolbarGroup>
      </div>

      <div className={styles.propertyShelf} role="toolbar" aria-label={`${activeCommand.shortLabel} properties`}>
        <CommandButton
          commandId="view.sidebar"
          label={sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
          shortcut="⌘B"
          icon={PanelLeft}
          onCommand={runCommand}
          enabled={isEnabled('view.sidebar')}
          pressed={sidebarOpen}
        />
        <ToolbarSeparator compact />
        <div className={styles.toolIdentity} aria-label={`Active tool: ${activeCommand.shortLabel}`}>
          <ActiveToolIcon size={17} aria-hidden="true" />
          <strong>{activeCommand.shortLabel}</strong>
          {activeCommand.shortcut && <kbd>{activeCommand.shortcut}</kbd>}
        </div>
        <ToolbarSeparator compact />

        <div className={styles.propertyScroller}>
          {activeTool === 'select' && <PropertyHint>Select an annotation to move or resize it.</PropertyHint>}
          {activeTool === 'hand' && <PropertyHint>Hold Space to temporarily pan the document.</PropertyHint>}

          {activeTool === 'pen' && (
            <>
              <ColorWell label="Color" value={toolOptions.pen.color} colors={recentColorsByFamily.pen} onChange={(color) => updatePenOptions({ color })} />
              <PropertySeparator />
              <StrokeWidthControl value={toolOptions.pen.width} options={PEN_WIDTHS} onChange={(width) => updatePenOptions({ width })} />
              <PropertySeparator />
              <OpacityControl value={toolOptions.pen.opacity} onChange={(opacity) => updatePenOptions({ opacity })} />
              <PropertySeparator />
              <PropertyToggle label="Pressure" pressed={toolOptions.pen.pressureSensitive} onChange={(pressureSensitive) => updatePenOptions({ pressureSensitive })} />
              <PropertyOptionsMenu
                label="More pen properties"
                items={[{ label: 'Smooth strokes', checked: toolOptions.pen.smooth, onSelect: () => updatePenOptions({ smooth: !toolOptions.pen.smooth }) }]}
              />
            </>
          )}

          {activeTool === 'highlighter' && (
            <>
              <ColorWell label="Color" value={toolOptions.highlighter.color} colors={recentColorsByFamily.highlighter} onChange={(color) => updateHighlighterOptions({ color })} />
              <PropertySeparator />
              <StrokeWidthControl value={toolOptions.highlighter.width} options={HIGHLIGHTER_WIDTHS} onChange={(width) => updateHighlighterOptions({ width })} />
              <PropertySeparator />
              <OpacityControl value={toolOptions.highlighter.opacity} onChange={(opacity) => updateHighlighterOptions({ opacity })} />
            </>
          )}

          {activeTool === 'eraser' && (
            <span className={styles.truthfulStatus} aria-label="Eraser mode: whole stroke">
              <Check size={14} aria-hidden="true" />
              Whole Stroke
            </span>
          )}

          {activeTool === 'text' && (
            <>
              <label className={styles.compactControl}>
                <span className={styles.propertyLabel}>Font</span>
                <select className={`${styles.compactSelect} ${styles.fontSelect}`} value={toolOptions.text.fontFamily} aria-label="Font family" onChange={(event) => updateTextOptions({ fontFamily: event.target.value })}>
                  {FONT_FAMILIES.map((font) => <option key={font} value={font}>{font.split(',')[0]}</option>)}
                </select>
              </label>
              <label className={styles.compactControl}>
                <span className={styles.propertyLabel}>Size</span>
                <select className={`${styles.compactSelect} ${styles.fontSizeSelect}`} value={toolOptions.text.fontSize} aria-label="Font size in PDF points" onChange={(event) => updateTextOptions({ fontSize: Number(event.target.value) })}>
                  {FONT_SIZES.map((size) => <option key={size} value={size}>{size} pt</option>)}
                </select>
              </label>
              <PropertySeparator />
              <ColorWell label="Text" value={toolOptions.text.color} colors={recentColorsByFamily.text} onChange={(color) => updateTextOptions({ color })} />
              <PropertySeparator />
              <div className={styles.propertySegment} role="group" aria-label="Text style">
                <PropertyToggle label="Bold" shortLabel="B" pressed={toolOptions.text.bold} onChange={(bold) => updateTextOptions({ bold })} bold />
                <PropertyToggle label="Italic" shortLabel="I" pressed={toolOptions.text.italic} onChange={(italic) => updateTextOptions({ italic })} italic />
                <PropertyToggle label="Underline" shortLabel="U" pressed={toolOptions.text.underline} onChange={(underline) => updateTextOptions({ underline })} underline />
              </div>
              <div className={styles.propertySegment} role="group" aria-label="Text alignment">
                <AlignmentButton alignment="left" value={toolOptions.text.align} onChange={(align) => updateTextOptions({ align })} icon={AlignLeft} />
                <AlignmentButton alignment="center" value={toolOptions.text.align} onChange={(align) => updateTextOptions({ align })} icon={AlignCenter} />
                <AlignmentButton alignment="right" value={toolOptions.text.align} onChange={(align) => updateTextOptions({ align })} icon={AlignRight} />
              </div>
              <PropertySeparator />
              <ColorWell
                label="Background"
                value={toolOptions.text.backgroundColor}
                colors={recentColorsByFamily.text}
                allowTransparent
                onChange={(backgroundColor) => {
                  updateTextOptions({ backgroundColor });
                  if (backgroundColor !== 'transparent') rememberColor('text', backgroundColor);
                }}
              />
            </>
          )}

          {isShapeTool(activeTool) && (
            <>
              <ColorWell label="Stroke" value={toolOptions.shape.color} colors={recentColorsByFamily.shape} onChange={(color) => updateShapeOptions({ color })} />
              {isClosedShape(activeTool) && (
                <>
                  <PropertySeparator />
                  <ColorWell
                    label="Fill"
                    value={toolOptions.shape.fillColor}
                    colors={recentColorsByFamily.shape}
                    allowTransparent
                    onChange={(fillColor) => {
                      updateShapeOptions({ fillColor });
                      if (fillColor !== 'transparent') rememberColor('shape', fillColor);
                    }}
                  />
                </>
              )}
              <PropertySeparator />
              <StrokeWidthControl value={toolOptions.shape.strokeWidth} options={SHAPE_WIDTHS} onChange={(strokeWidth) => updateShapeOptions({ strokeWidth })} />
              <PropertySeparator />
              <OpacityControl value={toolOptions.shape.opacity} onChange={(opacity) => updateShapeOptions({ opacity })} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ToolbarGroup({ label, segmented = false, children }: { label: string; segmented?: boolean; children: React.ReactNode }) {
  return <div className={`${styles.toolbarGroup} ${segmented ? styles.segmentedGroup : ''}`} role="group" aria-label={label}>{children}</div>;
}

function ToolbarSeparator({ compact = false }: { compact?: boolean }) {
  return <span className={compact ? styles.compactSeparator : styles.toolbarSeparator} aria-hidden="true" />;
}

interface CommandButtonProps {
  commandId: AppCommandId;
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  enabled: boolean;
  onCommand: (commandId: AppCommandId) => void;
  pressed?: boolean;
  className?: string;
}

function CommandButton({ commandId, label, shortcut, icon: Icon, enabled, onCommand, pressed, className = '' }: CommandButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className={`${styles.commandButton} ${pressed ? styles.commandButtonPressed : ''} ${!enabled ? styles.commandButtonDisabled : ''} ${className}`}
      onClick={() => enabled && onCommand(commandId)}
      title={title}
      aria-label={title}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-disabled={!enabled}
      data-toolbar-control="true"
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

function ToolButton({ tool, activeTool, onCommand, enabled }: { tool: ToolType; activeTool: ToolType; onCommand: (commandId: AppCommandId) => void; enabled: boolean }) {
  const definition = TOOL_DEFINITIONS[tool];
  const command = APP_COMMANDS[definition.commandId];
  const Icon = definition.icon;
  const selected = activeTool === tool;
  const title = command.shortcut ? `${command.shortLabel} (${command.shortcut})` : command.shortLabel;
  return (
    <button
      type="button"
      className={`${styles.commandButton} ${selected ? styles.toolButtonActive : ''} ${!enabled ? styles.commandButtonDisabled : ''}`}
      onClick={() => enabled && onCommand(definition.commandId)}
      title={title}
      aria-label={title}
      aria-pressed={selected}
      aria-disabled={!enabled}
      data-toolbar-control="true"
    >
      <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}

interface ToolbarMenuItem {
  commandId: AppCommandId;
  label: string;
  shortcut?: string;
  enabled: boolean;
  icon?: LucideIcon;
}

function ToolbarMenu({ label, icon: Icon, items, onCommand, alignEnd = false, className = '' }: { label: string; icon: LucideIcon; items: readonly ToolbarMenuItem[]; onCommand: (commandId: AppCommandId) => void; alignEnd?: boolean; className?: string }) {
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = React.useState(false);
  useDismissableDetails(detailsRef);
  return (
    <details className={`${styles.toolbarMenu} ${className}`} ref={detailsRef} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={styles.commandButton} title={label} aria-label={label} role="button" aria-haspopup="menu" aria-expanded={open} data-toolbar-control="true">
        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      </summary>
      <div className={`${styles.menuPopover} ${alignEnd ? styles.menuPopoverEnd : ''}`} role="menu" aria-label={label}>
        {items.map((item) => {
          const ItemIcon = item.icon;
          return (
            <button
              key={item.commandId}
              type="button"
              className={`${styles.menuItem} ${!item.enabled ? styles.menuItemDisabled : ''}`}
              role="menuitem"
              aria-disabled={!item.enabled}
              title={!item.enabled ? `${item.label} is not available yet` : undefined}
              onClick={() => {
                if (!item.enabled) return;
                detailsRef.current?.removeAttribute('open');
                onCommand(item.commandId);
              }}
            >
              {ItemIcon ? <ItemIcon size={15} aria-hidden="true" /> : <span className={styles.menuItemIcon} />}
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          );
        })}
      </div>
    </details>
  );
}

function PropertyHint({ children }: { children: React.ReactNode }) {
  return <span className={styles.propertyHint}>{children}</span>;
}

function PropertySeparator() {
  return <span className={styles.propertySeparator} aria-hidden="true" />;
}

function PropertyToggle({ label, shortLabel, pressed, onChange, bold, italic, underline }: { label: string; shortLabel?: string; pressed: boolean; onChange: (pressed: boolean) => void; bold?: boolean; italic?: boolean; underline?: boolean }) {
  return (
    <button
      type="button"
      className={`${styles.propertyToggle} ${pressed ? styles.propertyToggleActive : ''}`}
      onClick={() => onChange(!pressed)}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      style={{ fontWeight: bold ? 700 : undefined, fontStyle: italic ? 'italic' : undefined, textDecoration: underline ? 'underline' : undefined }}
    >
      {shortLabel ?? label}
    </button>
  );
}

function AlignmentButton({ alignment, value, onChange, icon: Icon }: { alignment: TextAlign; value: TextAlign; onChange: (alignment: TextAlign) => void; icon: LucideIcon }) {
  return (
    <button
      type="button"
      className={`${styles.propertyIconButton} ${value === alignment ? styles.propertyToggleActive : ''}`}
      onClick={() => onChange(alignment)}
      aria-label={`Align ${alignment}`}
      aria-pressed={value === alignment}
      title={`Align ${alignment}`}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}

function PropertyOptionsMenu({ label, items }: { label: string; items: readonly { label: string; checked: boolean; onSelect: () => void }[] }) {
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = React.useState(false);
  useDismissableDetails(detailsRef);
  return (
    <details className={styles.propertyMenu} ref={detailsRef} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={styles.propertyIconButton} title={label} aria-label={label} role="button" aria-haspopup="menu" aria-expanded={open}>
        <MoreHorizontal size={15} aria-hidden="true" />
      </summary>
      <div className={`${styles.menuPopover} ${styles.propertyMenuPopover}`} role="menu" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={styles.menuItem}
            role="menuitemcheckbox"
            aria-checked={item.checked}
            onClick={() => {
              item.onSelect();
              detailsRef.current?.removeAttribute('open');
            }}
          >
            <span className={styles.menuItemIcon}>{item.checked && <Check size={14} aria-hidden="true" />}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

function handleToolbarArrowNavigation(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-toolbar-control="true"]'))
    .filter((control) => control.getAttribute('aria-disabled') !== 'true' && control.offsetParent !== null);
  if (controls.length === 0) return;
  const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
  let nextIndex: number;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = controls.length - 1;
  else {
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : controls.length - 1) : (currentIndex + direction + controls.length) % controls.length;
  }
  event.preventDefault();
  controls[nextIndex]?.focus();
}

function useDismissableDetails(ref: React.RefObject<HTMLDetailsElement>) {
  React.useEffect(() => {
    const closeWhenOutside = (event: PointerEvent) => {
      const details = ref.current;
      if (details?.open && !details.contains(event.target as Node)) details.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const details = ref.current;
      if (!details?.open || event.key !== 'Escape') return;
      details.open = false;
      details.querySelector<HTMLElement>('summary')?.focus();
      event.stopPropagation();
    };
    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [ref]);
}

function isShapeTool(tool: ToolType): boolean {
  return tool === 'line' || tool === 'arrow' || tool === 'rectangle' || tool === 'roundedRect' || tool === 'ellipse';
}

function isClosedShape(tool: ToolType): boolean {
  return tool === 'rectangle' || tool === 'roundedRect' || tool === 'ellipse';
}
