import { MEASURE_UNITS } from '../../pdf/measure';
import type { MeasureUnit } from '../../types/annotations';
import React from 'react';
import { useSelectionStore } from '../../store/selectionStore';
import { SelectionTagButton } from '../Tags/TagPicker';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowRight,
  Check,
  Circle,
  Crop,
  Eraser,
  Focus,
  FolderOpen,
  FileText,
  Hand,
  Hexagon,
  LassoSelect,
  Ruler as RulerIcon,
  CirclePlay,
  Highlighter,
  Image as ImageIcon,
  Maximize2,
  Minus,
  Monitor,
  MoreHorizontal,
  MonitorPlay,
  Moon,
  Sigma,
  MousePointer2,
  Target as LaserIcon,
  ChevronDown,
  Eye,
  ImagePlus,
  PenLine,
  Split,
  SquareDashedMousePointer,
  Pen,
  Presentation,
  RectangleHorizontal,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scan,
  Square,
  TextSelect,
  StickyNote,
  TextCursorInput,
  Minimize2,
  Wrench,
  Hash,
  Columns2,
  Settings,
  Scissors,
  MoveHorizontal,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
  FilePlus2,
  Files,
  FileOutput,
  Printer,
  AppWindow,
  History,
  X,
  RefreshCw,
  Info,
  FileStack,
  NotebookPen,
  FileInput,
  Copy,
  Trash2,
  Bookmark,
  ScanText,
  Wand2,
  Search,
} from 'lucide-react';
import { APP_COMMANDS, type AppCommandId } from '../../commands';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import type { TextAlign, TextListStyle, ToolType } from '../../types/annotations';
import { cssForFamily, fontFamilyKey } from '../../pdf/fontFamilies';
import { requestAllScreenFonts, requestScreenFontFamily } from '../../pdf/screenFonts';
import { FontFamilyOptions } from '../Properties/FontFamilyOptions';
import { ColorWell } from './ColorWell';
import { PenPresetBar, QuickColors, ToolbarCustomizeMenu } from './ToolbarExtras';
import { SignStampMenu } from '../SignStamp/SignStampMenu';
import { useRulerStore } from '../../store/rulerStore';
import { OpacityControl } from './PropertyControls';
import { TOOL_WIDTH_CONSTRAINTS } from '../../constants/toolConstraints';
import { WidthControl } from '../Properties/WidthControl';
import { BorderStyleControl } from '../Properties/BorderStyleControl';
import styles from './MainRibbon.module.css';

const MEASURE_SCALES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000] as const;
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
  freeform: { icon: Hexagon, commandId: 'tool.freeform' },
  lasso: { icon: LassoSelect, commandId: 'tool.lasso' },
  textMarkup: { icon: TextSelect, commandId: 'tool.textMarkup' },
  laserPointer: { icon: LaserIcon, commandId: 'tool.laserPointer' },
  note: { icon: StickyNote, commandId: 'tool.note' },
  snapshot: { icon: Scissors, commandId: 'tool.snapshot' },
  measure: { icon: MoveHorizontal, commandId: 'tool.measure' },
  crop: { icon: Crop, commandId: 'tool.crop' },
  editText: { icon: TextCursorInput, commandId: 'tool.editText' },
};

const DOCUMENT_COMMANDS = new Set<AppCommandId>([
  'file.export',
  'history.undo',
  'history.redo',
  'insert.image',
  'insert.signature',
  'insert.formula',
  'insert.screenshot',
  'insert.regionScreenshot',
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
  const splitOpen = useUIStore((s) => s.splitView !== null);
  const [density, setDensity] = React.useState<'full' | 'compact' | 'tight'>('full');
  const { activeDocId, documents } = useDocumentStore();
  // Re-render when the selection changes, so selection commands enable at once.
  useSelectionStore((s) => {
    const doc = activeDocId ? documents.get(activeDocId) : undefined;
    return doc ? s.getSelection({ docId: doc.id, instanceId: doc.instanceId })?.selectedIds.length ?? 0 : 0;
  });
  const {
    activeTool,
    toolOptions,
    updatePenOptions,
    updateHighlighterOptions,
    updateTextMarkupOptions,
    updateNoteOptions,
    updateMeasureOptions,
    updateEraserOptions,
    laserOptions,
    updateLaserOptions,
    pageTheme,
    updateTextOptions,
    updateShapeOptions,
    workspaceMode,
  } = useUIStore();

  const activeDoc = activeDocId ? documents.get(activeDocId) : undefined;
  const hasDocument = Boolean(activeDoc);
  // Always the real percentage; the status bar shows which fit is on.
  const zoomLabel = `${Math.round((activeDoc?.zoom ?? 1) * 100)}%`;

  const rulerVisible = useRulerStore((s) => s.visible);
  const isEnabled = React.useCallback((commandId: AppCommandId) => {
    if (canExecute) return canExecute(commandId);
    return !DOCUMENT_COMMANDS.has(commandId) || hasDocument;
  }, [canExecute, hasDocument]);

  /** A menu entry with the command's own label and keyboard shortcut. */
  const item = (commandId: AppCommandId, icon?: LucideIcon, label?: string): ToolbarMenuItem => ({
    commandId, icon, label: label ?? APP_COMMANDS[commandId].label, shortcut: APP_COMMANDS[commandId].shortcut, enabled: isEnabled(commandId),
  });

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
        {/* Menus first, like a menu bar: each is a word, so none looks like a tool. */}
        <ToolbarGroup label="Menus">
          <ToolbarMenu
            label="File menu"
            text="File"
            icon={FolderOpen}
            onCommand={runCommand}
            items={[
              item('file.new', FilePlus2),
              item('file.open', FolderOpen, 'Open PDF…'),
              item('file.openOffice', FileInput),
              item('file.fromImages', ImageIcon),
              item('file.combine', Files),
              'separator',
              item('file.save', Save),
              item('file.saveAs', Save),
              item('file.saveAll', Save),
              item('file.export', FileOutput),
              item('file.exportWord', FileText),
              item('file.exportImages', ImageIcon),
              item('file.reduceSize', Minimize2),
              item('file.print', Printer),
              'separator',
              item('view.moveTabToNewWindow', AppWindow),
              item('file.recoveredDocuments', History),
              item('file.close', X),
              item('file.closeAll', X),
              'separator',
              item('app.settings', Settings, 'Settings…'),
              item('help.checkForUpdates', RefreshCw),
              item('help.about', Info),
            ]}
          />
          <ToolbarMenu
            label="Page menu"
            text="Page"
            icon={FileStack}
            onCommand={runCommand}
            items={[
              item('page.insertBlank', FilePlus2),
              item('page.insertNotePage', NotebookPen),
              item('page.insertFromPdf', FileInput),
              item('page.duplicate', Copy),
              item('page.delete', Trash2),
              item('page.rotateLeft', RotateCcw),
              item('page.rotateRight', RotateCw),
              'separator',
              item('page.addBookmark', Bookmark),
              item('page.exportSelected', FileOutput),
              item('page.split', Split),
              'separator',
              item('page.ocrPage', ScanText),
              item('page.ocrAll', ScanText),
              item('edit.inkToText', Wand2),
              item('edit.find', Search),
            ]}
          />
          <ToolbarMenu
            label="Insert menu"
            text="Insert"
            icon={ImagePlus}
            onCommand={runCommand}
            items={[
              item('insert.image', ImageIcon, 'Image…'),
              item('insert.formula', Sigma, 'Formula…'),
              item('insert.signature', PenLine, 'Signature & Stamps…'),
              'separator',
              item('insert.screenshot', Monitor, 'Display Screenshot'),
              item('insert.regionScreenshot', SquareDashedMousePointer, 'Capture Region'),
              'separator',
              item('insert.printoutPdf', FileText, 'Insert PDF…'),
              item('insert.printoutPptx', Presentation, 'Insert PowerPoint…'),
            ]}
          />
          <ToolbarMenu
            label="PDF tools"
            text="PDF"
            icon={Wrench}
            onCommand={runCommand}
            items={[
              item('tool.editText', TextCursorInput, 'Edit PDF Text'),
              item('insert.headerFooter', Hash),
              'separator',
              item('tool.crop', Crop, 'Crop Pages'),
              item('page.removeCrop', Crop),
              'separator',
              item('file.reduceSize', Minimize2),
              item('file.exportImages', ImageIcon),
              item('file.fromImages', ImageIcon),
              item('file.combine', Files),
              item('page.split', Split),
              'separator',
              item('file.openOffice', FileInput, 'Word / Excel / PowerPoint ▸ PDF…'),
              item('file.exportWord', FileText, 'PDF ▸ Word (coming soon)'),
              item('file.imagesToWord', ImageIcon, 'Images ▸ Word (coming soon)'),
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
          <ToolButton tool="lasso" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.lasso')} />
          <ToolButton tool="snapshot" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.snapshot')} />
        </ToolbarGroup>

        <ToolbarGroup label="Ink tools" segmented>
          <ToolButton tool="pen" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.pen')} />
          <ToolButton tool="highlighter" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.highlighter')} />
          <ToolButton tool="textMarkup" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.textMarkup')} />
          <ToolButton tool="eraser" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.eraser')} />
        </ToolbarGroup>

        <ToolbarGroup label="Annotation tools" segmented>
          <ToolButton tool="text" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.text')} />
          <ToolButton tool="note" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.note')} />
          <ShapeSplitButton activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.rectangle')} />
          <ToolButton tool="measure" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.measure')} />
          <CommandButton commandId="view.ruler" label="Ruler" shortcut="⌥⌘R" icon={RulerIcon} onCommand={runCommand} enabled={isEnabled('view.ruler')} pressed={rulerVisible} />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup label="Insert">
          <SignStampMenu enabled={isEnabled('insert.signature')} />
          <CommandButton commandId="insert.formula" label="Formula…" shortcut="⌥⌘E" icon={Sigma} onCommand={runCommand} enabled={isEnabled('insert.formula')} />
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup label="Presentation">
          <CommandButton commandId="view.presentation" label="Present" shortcut="⌥⌘P" icon={MonitorPlay} onCommand={runCommand} enabled={isEnabled('view.presentation')} />
          <ToolButton tool="laserPointer" activeTool={activeTool} onCommand={runCommand} enabled={isEnabled('tool.laserPointer')} />
          <CommandButton commandId="view.replayInk" label="Replay Ink" icon={CirclePlay} onCommand={runCommand} enabled={isEnabled('view.replayInk')} />
          <ToolbarCustomizeMenu />
        </ToolbarGroup>

        <div className={styles.primarySpacer} />

        <ToolbarGroup label="View">
          <div className={styles.zoomCluster} role="group" aria-label="Zoom">
            <CommandButton commandId="view.zoomOut" label="Zoom Out" shortcut="⌘−" icon={ZoomOut} onCommand={runCommand} enabled={isEnabled('view.zoomOut')} />
            <output className={styles.zoomValue} aria-label={`Current zoom ${zoomLabel}`}>{zoomLabel}</output>
            <CommandButton commandId="view.zoomIn" label="Zoom In" shortcut="⌘+" icon={ZoomIn} onCommand={runCommand} enabled={isEnabled('view.zoomIn')} />
          </div>
          <CommandButton commandId="view.rotateCCW" label="Rotate View Left" shortcut="⌘[" icon={RotateCcw} onCommand={runCommand} enabled={isEnabled('view.rotateCCW')} />
          <CommandButton commandId="view.rotateCW" label="Rotate View Right" shortcut="⌘]" icon={RotateCw} onCommand={runCommand} enabled={isEnabled('view.rotateCW')} />
          <CommandButton commandId="view.nightMode" label="Night Mode" shortcut="⌥⌘D" icon={Moon} onCommand={runCommand} enabled pressed={pageTheme === 'dark'} />
          <CommandButton commandId="app.settings" label="Settings" shortcut="⌘," icon={Settings} onCommand={runCommand} enabled />
        </ToolbarGroup>
      </div>

      <div className={styles.propertyShelf} data-keeps-selection role="toolbar" aria-label={`${activeCommand.shortLabel} properties`}>
        <div className={styles.toolIdentity} aria-label={`Active tool: ${activeCommand.shortLabel}`}>
          <ActiveToolIcon size={17} aria-hidden="true" />
          <strong>{activeCommand.shortLabel}</strong>
          {activeCommand.shortcut && <kbd>{activeCommand.shortcut}</kbd>}
        </div>
        <ToolbarSeparator compact />

        <div className={styles.propertyScroller}>
          {activeTool === 'select' && <PropertyHint>Select an annotation to move or resize it.</PropertyHint>}
          {(activeTool === 'lasso' || activeTool === 'select') && (
            <>
              <button type="button" className={styles.shelfButton} disabled={!isEnabled('edit.inkToText')} onClick={() => runCommand('edit.inkToText')} title="Convert Ink to Text (⌥⌘T)">
                <Wand2 size={14} aria-hidden="true" /> Ink to Text
              </button>
              <button type="button" className={styles.shelfButton} disabled={!isEnabled('edit.duplicate')} onClick={() => runCommand('edit.duplicate')} title="Duplicate (⌘D)">
                <Copy size={14} aria-hidden="true" /> Duplicate
              </button>
              <button type="button" className={styles.shelfButton} disabled={!isEnabled('edit.deleteSelected')} onClick={() => runCommand('edit.deleteSelected')} title="Delete (⌫)">
                <Trash2 size={14} aria-hidden="true" /> Delete
              </button>
              <SelectionTagButton />
              <PropertySeparator />
            </>
          )}
          {activeTool === 'lasso' && <PropertyHint>Draw around ink to select it. Shift adds to the selection. Drag the selection to move it.</PropertyHint>}
          {activeTool === 'laserPointer' && (
            <>
              <div className={styles.propertySegment} role="group" aria-label="Laser mode">
                <PropertyToggle label="Fade each line" shortLabel="Each" pressed={laserOptions.mode === 'individual'} onChange={() => updateLaserOptions({ mode: 'individual' })} />
                <PropertyToggle label="Fade all lines together" shortLabel="Together" pressed={laserOptions.mode === 'group'} onChange={() => updateLaserOptions({ mode: 'group' })} />
              </div>
              <PropertySeparator />
              <label className={styles.compactControl}>
                <span className={styles.propertyLabel}>Fade</span>
                <select className={styles.compactSelect} value={laserOptions.durationMs} aria-label="Laser fade time" onChange={(event) => updateLaserOptions({ durationMs: Number(event.target.value) })}>
                  {[1000, 1500, 2000, 3000, 5000].map((ms) => <option key={ms} value={ms}>{ms / 1000} s</option>)}
                </select>
              </label>
              <PropertySeparator />
              <ColorWell label="Color" value={laserOptions.color} onChange={(color) => updateLaserOptions({ color })} />
              <label className={styles.compactControl}>
                <span className={styles.propertyLabel}>Width</span>
                <select className={styles.compactSelect} value={laserOptions.width} aria-label="Laser width" onChange={(event) => updateLaserOptions({ width: Number(event.target.value) })}>
                  {[3, 4, 6, 8].map((w) => <option key={w} value={w}>{w} px</option>)}
                </select>
              </label>
              <PropertySeparator />
              <PropertyHint>Nothing is saved. Also used in Present (⌥⌘P).</PropertyHint>
            </>
          )}
          {activeTool === 'hand' && <PropertyHint>Hold Space to temporarily pan the document.</PropertyHint>}

          {activeTool === 'pen' && (
            <>
              <PenPresetBar tool="pen" />
              <PropertySeparator />
              <ColorWell label="Color" value={toolOptions.pen.color} onChange={(color) => updatePenOptions({ color })} />
              <QuickColors value={toolOptions.pen.color} onPick={(color) => updatePenOptions({ color })} />
              <PropertySeparator />
              <WidthControl value={toolOptions.pen.width} constraint={TOOL_WIDTH_CONSTRAINTS.pen} onChange={(width) => updatePenOptions({ width })} onCommit={(width) => updatePenOptions({ width })} />
              <PropertySeparator />
              <OpacityControl value={toolOptions.pen.opacity} onChange={(opacity) => updatePenOptions({ opacity })} />
              <PropertySeparator />
              <PropertyToggle label="Pressure" pressed={toolOptions.pen.pressureSensitive} onChange={(pressureSensitive) => updatePenOptions({ pressureSensitive })} />
              <label className={styles.compactControl} title="Smooths the line so it follows your hand, not every tremor">
                <span className={styles.propertyLabel}>Stabilizer</span>
                <select className={styles.compactSelect} value={toolOptions.pen.stabilizer ?? 'off'} aria-label="Pen stabilizer" onChange={(event) => updatePenOptions({ stabilizer: event.target.value as NonNullable<typeof toolOptions.pen.stabilizer> })}>
                  <option value="off">Off</option>
                  <option value="basic">Basic</option>
                  <option value="soft">Soft</option>
                  <option value="silky">Silky</option>
                  <option value="fluid">Fluid</option>
                </select>
              </label>
              <PropertyToggle label="Ink to Shape" shortLabel="Shapes" pressed={toolOptions.pen.inkToShape === true} onChange={(inkToShape) => updatePenOptions({ inkToShape })} />
              <PropertyOptionsMenu
                label="More pen properties"
                items={[
                  { label: 'Smooth strokes', checked: toolOptions.pen.smooth, onSelect: () => updatePenOptions({ smooth: !toolOptions.pen.smooth }) },
                  { label: 'Hold still to make a shape', checked: toolOptions.pen.holdToShape !== false, onSelect: () => updatePenOptions({ holdToShape: toolOptions.pen.holdToShape === false }) },
                ]}
              />
            </>
          )}

          {activeTool === 'highlighter' && (
            <>
              <PenPresetBar tool="highlighter" />
              <PropertySeparator />
              <ColorWell label="Color" value={toolOptions.highlighter.color} onChange={(color) => updateHighlighterOptions({ color })} />
              <QuickColors value={toolOptions.highlighter.color} onPick={(color) => updateHighlighterOptions({ color })} />
              <PropertySeparator />
              <WidthControl value={toolOptions.highlighter.width} constraint={TOOL_WIDTH_CONSTRAINTS.highlighter} onChange={(width) => updateHighlighterOptions({ width })} onCommit={(width) => updateHighlighterOptions({ width })} />
              <PropertySeparator />
              <OpacityControl value={toolOptions.highlighter.opacity} onChange={(opacity) => updateHighlighterOptions({ opacity })} />
            </>
          )}

          {activeTool === 'textMarkup' && (
            <>
              <div className={styles.propertySegment} role="group" aria-label="Text markup">
                <PropertyToggle label="Highlight" pressed={toolOptions.textMarkup.markup === 'highlight'} onChange={() => updateTextMarkupOptions({ markup: 'highlight', opacity: 0.45 })} />
                <PropertyToggle label="Underline" underline pressed={toolOptions.textMarkup.markup === 'underline'} onChange={() => updateTextMarkupOptions({ markup: 'underline', opacity: 1 })} />
                <PropertyToggle label="Strikethrough" shortLabel="Strike" pressed={toolOptions.textMarkup.markup === 'strikeout'} onChange={() => updateTextMarkupOptions({ markup: 'strikeout', opacity: 1 })} />
              </div>
              <PropertySeparator />
              <ColorWell label="Color" value={toolOptions.textMarkup.color} onChange={(color) => updateTextMarkupOptions({ color })} />
              <QuickColors value={toolOptions.textMarkup.color} onPick={(color) => updateTextMarkupOptions({ color })} />
              <PropertySeparator />
              <OpacityControl value={toolOptions.textMarkup.opacity} onChange={(opacity) => updateTextMarkupOptions({ opacity })} />
              <PropertySeparator />
              <PropertyHint>Drag across the PDF's text. Works on text PDFs, not on scans.</PropertyHint>
            </>
          )}

          {activeTool === 'measure' && (
            <>
              <div className={styles.propertySegment} role="group" aria-label="Measure">
                <PropertyToggle label="Distance" pressed={toolOptions.measure.mode === 'distance'} onChange={() => updateMeasureOptions({ mode: 'distance' })} />
                <PropertyToggle label="Area" pressed={toolOptions.measure.mode === 'area'} onChange={() => updateMeasureOptions({ mode: 'area' })} />
              </div>
              <PropertySeparator />
              <label className={styles.compactControl}>
                <span className={styles.propertyLabel}>Scale</span>
                <select className={styles.compactSelect} value={toolOptions.measure.scale} aria-label="Drawing scale" onChange={(event) => updateMeasureOptions({ scale: Number(event.target.value) })}>
                  {MEASURE_SCALES.map((s) => <option key={s} value={s}>1:{s}</option>)}
                </select>
              </label>
              <label className={styles.compactControl}>
                <span className={styles.propertyLabel}>Unit</span>
                <select className={styles.compactSelect} value={toolOptions.measure.unit} aria-label="Measurement unit" onChange={(event) => updateMeasureOptions({ unit: event.target.value as MeasureUnit })}>
                  {MEASURE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <PropertySeparator />
              <ColorWell label="Color" value={toolOptions.measure.color} onChange={(color) => updateMeasureOptions({ color })} />
              <PropertySeparator />
              <PropertyHint>{toolOptions.measure.mode === 'distance' ? 'Drag to measure. Shift keeps the line straight.' : 'Click the corners; double-click or click the first corner to finish.'}</PropertyHint>
            </>
          )}

          {activeTool === 'editText' && (
            <PropertyHint>Click a line of the PDF's text to change it. Enter saves, Esc cancels. Empty the line to delete it.</PropertyHint>
          )}

          {activeTool === 'crop' && (
            <PropertyHint>Drag around the part of the page to keep, then choose Crop This Page or Crop All Pages.</PropertyHint>
          )}

          {activeTool === 'snapshot' && (
            <PropertyHint>Drag around part of a page to copy it as a picture. Paste with ⌘V.</PropertyHint>
          )}

          {activeTool === 'note' && (
            <>
              <ColorWell label="Color" value={toolOptions.note.color} onChange={(color) => updateNoteOptions({ color })} />
              <QuickColors value={toolOptions.note.color} onPick={(color) => updateNoteOptions({ color })} />
              <PropertySeparator />
              <PropertyHint>Click the page to add a note. Double-click a note to open it.</PropertyHint>
            </>
          )}

          {activeTool === 'eraser' && (
            <>
              <div className={styles.propertySegment} role="group" aria-label="Eraser Mode">
                <PropertyToggle label="Stroke Eraser" pressed={toolOptions.eraser.mode === 'stroke'} onChange={() => updateEraserOptions({ mode: 'stroke' })} />
                <PropertyToggle label="Object Eraser" pressed={toolOptions.eraser.mode === 'object'} onChange={() => updateEraserOptions({ mode: 'object' })} />
              </div>
              <PropertySeparator />
              <WidthControl value={toolOptions.eraser.size} constraint={TOOL_WIDTH_CONSTRAINTS.highlighter} onChange={(size) => updateEraserOptions({ size })} onCommit={(size) => updateEraserOptions({ size })} />
            </>
          )}

          {activeTool === 'text' && (
            <>
              <label className={styles.compactControl}>
                <span className={styles.propertyLabel}>Font</span>
                <select className={`${styles.compactSelect} ${styles.fontSelect}`} value={cssForFamily(fontFamilyKey(toolOptions.text.fontFamily))} aria-label="Font family" onFocus={requestAllScreenFonts} onPointerDown={requestAllScreenFonts} onChange={(event) => { requestScreenFontFamily(event.target.value); updateTextOptions({ fontFamily: event.target.value }); }}>
                  <FontFamilyOptions />
                </select>
              </label>
              <label className={styles.compactControl}>
                <span className={styles.propertyLabel}>Size</span>
                <select className={`${styles.compactSelect} ${styles.fontSizeSelect}`} value={toolOptions.text.fontSize} aria-label="Font size in PDF points" onChange={(event) => updateTextOptions({ fontSize: Number(event.target.value) })}>
                  {FONT_SIZES.map((size) => <option key={size} value={size}>{size} pt</option>)}
                </select>
              </label>
              <PropertySeparator />
              <ColorWell label="Text" value={toolOptions.text.color} onChange={(color) => updateTextOptions({ color })} />
              <QuickColors value={toolOptions.text.color} onPick={(color) => updateTextOptions({ color })} />
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
                allowTransparent
                onChange={(backgroundColor) => updateTextOptions({ backgroundColor })}
              />
              <ColorWell
                label="Border"
                value={toolOptions.text.borderColor ?? 'transparent'}
                allowTransparent
                onChange={(borderColor) => updateTextOptions({
                  borderColor,
                  borderWidth: borderColor === 'transparent' ? 0 : (toolOptions.text.borderWidth || 1),
                })}
              />
              <PropertySeparator />
              <label className={styles.compactControl}>
                <span className={styles.propertyLabel}>List</span>
                <select className={styles.compactSelect} value={toolOptions.text.listStyle ?? 'none'} aria-label="List style" onChange={(event) => updateTextOptions({ listStyle: event.target.value as TextListStyle })}>
                  <option value="none">None</option>
                  <option value="bullet">• Bullets</option>
                  <option value="number">1. Numbers</option>
                </select>
              </label>
            </>
          )}

          {isShapeTool(activeTool) && (
            <>
              <ColorWell label="Stroke" value={toolOptions.shape.color} onChange={(color) => updateShapeOptions({ color })} />
              <QuickColors value={toolOptions.shape.color} onPick={(color) => updateShapeOptions({ color })} />
              {isClosedShape(activeTool) && (
                <>
                  <PropertySeparator />
                  <ColorWell
                    label="Fill"
                    value={toolOptions.shape.fillColor}
                    allowTransparent
                    onChange={(fillColor) => updateShapeOptions({ fillColor })}
                  />
                </>
              )}
              <PropertySeparator />
              <WidthControl value={toolOptions.shape.strokeWidth} constraint={TOOL_WIDTH_CONSTRAINTS.shape} onChange={(strokeWidth) => updateShapeOptions({ strokeWidth })} onCommit={(strokeWidth) => updateShapeOptions({ strokeWidth })} />
              <PropertySeparator />
              <BorderStyleControl value={toolOptions.shape.borderStyle} onChange={(borderStyle) => updateShapeOptions({ borderStyle })} onCommit={(borderStyle) => updateShapeOptions({ borderStyle })} />
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
      onClick={() => {
        if (enabled) onCommand(commandId);
      }}
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
  // Hidden via Customize Toolbar (the active tool always stays visible).
  const hiddenByUser = useUIStore((state) => state.hiddenToolbarTools.includes(tool));
  if (hiddenByUser && activeTool !== tool) return null;
  const definition = TOOL_DEFINITIONS[tool];
  const command = APP_COMMANDS[definition.commandId];
  const Icon = definition.icon;
  const selected = activeTool === tool;
  const title = command.shortcut ? `${command.shortLabel} (${command.shortcut})` : command.shortLabel;
  return (
    <button
      type="button"
      className={`${styles.commandButton} ${selected ? styles.toolButtonActive : ''} ${!enabled ? styles.commandButtonDisabled : ''}`}
      onClick={() => {
        if (enabled) onCommand(definition.commandId);
      }}
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

const RIBBON_SHAPES: readonly ToolType[] = ['line', 'arrow', 'rectangle', 'ellipse', 'freeform'];

/**
 * One button for all shapes: it draws the last shape used, and the arrow
 * next to it picks another (line, arrow, rectangle, ellipse, polygon).
 */
function ShapeSplitButton({ activeTool, onCommand, enabled }: { activeTool: ToolType; onCommand: (commandId: AppCommandId) => void; enabled: boolean }) {
  const lastShapeTool = useUIStore((state) => state.lastShapeTool);
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = React.useState(false);
  useDismissableDetails(detailsRef);
  const current: ToolType = RIBBON_SHAPES.includes(activeTool) ? activeTool : lastShapeTool;
  const definition = TOOL_DEFINITIONS[current];
  const command = APP_COMMANDS[definition.commandId];
  const Icon = definition.icon;
  const selected = RIBBON_SHAPES.includes(activeTool);
  const title = command.shortcut ? `${command.shortLabel} (${command.shortcut})` : command.shortLabel;
  return (
    <div className={styles.splitButton}>
      <button
        type="button"
        className={`${styles.commandButton} ${selected ? styles.toolButtonActive : ''} ${!enabled ? styles.commandButtonDisabled : ''}`}
        onClick={() => { if (enabled) onCommand(definition.commandId); }}
        title={title}
        aria-label={title}
        aria-pressed={selected}
        aria-disabled={!enabled}
        data-toolbar-control="true"
      >
        <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
      </button>
      <details className={styles.toolbarMenu} ref={detailsRef} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className={`${styles.commandButton} ${styles.splitChevron} ${!enabled ? styles.commandButtonDisabled : ''}`} title="Shapes" aria-label="Shapes" role="button" aria-haspopup="menu" aria-expanded={open} data-toolbar-control="true">
          <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
        </summary>
        <div className={styles.menuPopover} role="menu" aria-label="Shapes">
          {RIBBON_SHAPES.map((tool) => {
            const shape = TOOL_DEFINITIONS[tool];
            const shapeCommand = APP_COMMANDS[shape.commandId];
            const ShapeIcon = shape.icon;
            return (
              <button
                key={tool}
                type="button"
                className={`${styles.menuItem} ${!enabled ? styles.menuItemDisabled : ''}`}
                role="menuitemradio"
                aria-checked={activeTool === tool}
                onClick={() => {
                  detailsRef.current?.removeAttribute('open');
                  if (enabled) onCommand(shape.commandId);
                }}
              >
                <ShapeIcon size={15} aria-hidden="true" />
                <span>{shapeCommand.shortLabel}</span>
                {activeTool === tool && <Check size={14} className={styles.menuItemCheck} aria-label="On" />}
                {shapeCommand.shortcut && <kbd>{shapeCommand.shortcut}</kbd>}
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}

interface ToolbarMenuItem {
  commandId: AppCommandId;
  label: string;
  shortcut?: string;
  enabled: boolean;
  icon?: LucideIcon;
  /** A toggle that is on (shows a tick). */
  checked?: boolean;
}

/** A menu row, or 'separator' for a thin line between sections. */
type ToolbarMenuEntry = ToolbarMenuItem | 'separator';

function ToolbarMenu({ label, text, icon: Icon, items, onCommand, alignEnd = false, className = '' }: { label: string; /** Word shown next to the icon (menus that hold many commands). */ text?: string; icon: LucideIcon; items: readonly ToolbarMenuEntry[]; onCommand: (commandId: AppCommandId) => void; alignEnd?: boolean; className?: string }) {
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = React.useState(false);
  useDismissableDetails(detailsRef);
  return (
    <details className={`${styles.toolbarMenu} ${className}`} ref={detailsRef} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={`${styles.commandButton} ${text ? styles.textMenuButton : ''}`} title={label} aria-label={label} role="button" aria-haspopup="menu" aria-expanded={open} data-toolbar-control="true">
        {text ? (
          <>
            <span className={styles.textMenuLabel}>{text}</span>
            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
          </>
        ) : <Icon size={18} strokeWidth={1.8} aria-hidden="true" />}
      </summary>
      <div className={`${styles.menuPopover} ${alignEnd ? styles.menuPopoverEnd : ''}`} role="menu" aria-label={label}>
        {items.map((item, index) => {
          if (item === 'separator') return <div key={`separator-${index}`} className={styles.menuSeparator} role="separator" />;
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
              {item.checked && <Check size={14} className={styles.menuItemCheck} aria-label="On" />}
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
  return tool === 'line' || tool === 'arrow' || tool === 'rectangle' || tool === 'roundedRect' || tool === 'ellipse' || tool === 'freeform';
}

function isClosedShape(tool: ToolType): boolean {
  return tool === 'rectangle' || tool === 'roundedRect' || tool === 'ellipse' || tool === 'freeform';
}
