import type { ToolType } from '../types/annotations';
import type { WorkspaceMode } from '../store/uiStore';

export type CanonicalTool = Extract<ToolType,
  'select' | 'hand' | 'pen' | 'highlighter' | 'eraser' | 'text' |
  'line' | 'arrow' | 'rectangle' | 'ellipse' | 'freeform' | 'lasso' | 'textMarkup' | 'laserPointer' | 'note' | 'snapshot' | 'measure'>;

export type ToolCommandId = `tool.${CanonicalTool}`;

export type AppCommandId =
  | 'file.new' | 'file.combine' | 'file.open' | 'file.save' | 'file.saveAs'
  | 'file.saveTemplate' | 'file.saveAll' | 'file.export' | 'file.close'
  | 'file.closeAll' | 'file.documentProperties' | 'file.print'
  | 'history.undo' | 'history.redo' | 'edit.selectAll' | 'edit.deleteSelected' | 'edit.duplicate' | 'edit.find'
  | ToolCommandId | 'tool.polygon' | 'tool.extractText' | 'tool.zoom' | 'tool.stamp'
  | 'tool.dimension' | 'tool.lasso' | 'tool.snapshot'
  | 'tool.crop' | 'tool.measure' | 'tool.formula' | 'tool.laserPointer'
  | 'tool.pointer' | 'insert.image' | 'insert.screenshot' | 'insert.regionScreenshot' | 'insert.printoutPdf' | 'insert.printoutPptx' | 'insert.signature' | 'insert.formula' | 'view.sidebar' | 'view.sidebarPages'
  | 'view.sidebarBookmarks' | 'view.sidebarOutline' | 'view.sidebarAnnotations'
  | 'view.sidebarSearch' | 'view.zoomIn' | 'view.zoomOut' | 'view.actualSize'
  | 'view.fitWidth' | 'view.fitPage' | 'view.layoutContinuous'
  | 'view.layoutSingle' | 'view.layoutTwoPage' | 'view.rotateCCW'
  | 'view.rotateCW' | 'view.annotations' | 'view.primaryToolbar'
  | 'view.propertyShelf' | 'view.statusBar' | 'view.nativeFullscreen'
  | 'view.focusMode' | 'extras.favorites' | 'extras.toolStyles' | 'help.open'
  | 'app.requestQuit' | 'app.requestCloseWindow' | 'app.settings' | 'view.splitView' | 'view.moveTabToNewWindow' | 'insert.headerFooter'
  | 'file.recoveredDocuments' | 'help.checkForUpdates' | 'help.about' | 'help.crashReports'
  | 'page.insertBlank' | 'page.insertNotePage' | 'page.duplicate' | 'page.delete' | 'page.rotateLeft' | 'page.rotateRight'
  | 'page.insertFromPdf' | 'page.exportSelected' | 'page.addBookmark'
  | 'view.ruler' | 'view.replayInk' | 'view.presentation' | 'view.nightMode'
  | 'page.ocrPage' | 'page.ocrAll' | 'edit.inkToText' | 'page.split';

export type CommandGroup = 'file' | 'history' | 'edit' | 'tool' | 'view' | 'insert' | 'page' | 'extras' | 'help';
export type CommandKind = 'action' | 'tool' | 'toggle' | 'radio';
export type CommandAvailability = 'always' | 'document' | 'undo' | 'redo' | 'selection' | 'save' | 'saveAll' | 'unavailable';
export type CommandIconId =
  | 'newDocument' | 'combine' | 'open' | 'save' | 'saveAs' | 'template'
  | 'saveAll' | 'export' | 'close' | 'closeAll' | 'properties' | 'print'
  | 'undo' | 'redo' | 'selectAll' | 'delete' | 'select' | 'extractText'
  | 'hand' | 'zoom' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'stamp'
  | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'freeform' | 'dimension'
  | 'lasso' | 'snapshot' | 'crop' | 'measure' | 'formula' | 'laserPointer' | 'note'
  | 'pointer' | 'image' | 'screenshot' | 'regionScreenshot' | 'sidebar' | 'zoomIn' | 'zoomOut' | 'actualSize' | 'fitWidth'
  | 'fitPage' | 'layout' | 'rotateLeft' | 'rotateRight' | 'annotations'
  | 'toolbar' | 'fullscreen' | 'focus' | 'favorites' | 'toolStyles' | 'help';
export type CommandCheckedState = 'activeTool' | 'sidebarOpen' | 'focusMode' | 'continuousLayout' | 'nightMode';

export interface AppCommandDefinition {
  readonly id: AppCommandId;
  readonly label: string;
  readonly shortLabel: string;
  readonly group: CommandGroup;
  readonly kind: CommandKind;
  readonly availability: CommandAvailability;
  readonly icon: CommandIconId;
  readonly shortcut?: string;
  readonly tool?: CanonicalTool;
  readonly checkedState?: CommandCheckedState;
  readonly menuPlacements?: readonly string[];
  readonly toolbarPlacements?: readonly string[];
}

interface CommandOptions {
  shortLabel?: string;
  icon: CommandIconId;
  shortcut?: string;
  checkedState?: CommandCheckedState;
  menuPlacements?: readonly string[];
  toolbarPlacements?: readonly string[];
}

/** Shared command metadata for menus, toolbars, shortcuts, and Electron. */
export const APP_COMMANDS = {
  'file.new': command('file.new', 'New Document…', 'file', 'action', 'always', { icon: 'newDocument', shortcut: '⌘N', menuPlacements: ['file'] }),
  'file.combine': command('file.combine', 'Combine Files…', 'file', 'action', 'always', { icon: 'combine', menuPlacements: ['file'] }),
  'file.open': command('file.open', 'Open…', 'file', 'action', 'always', { icon: 'open', shortcut: '⌘O', menuPlacements: ['file'], toolbarPlacements: ['primary.file'] }),
  'file.save': command('file.save', 'Save', 'file', 'action', 'save', { icon: 'save', shortcut: '⌘S', menuPlacements: ['file'], toolbarPlacements: ['primary.file'] }),
  'file.saveAs': command('file.saveAs', 'Save As…', 'file', 'action', 'document', { icon: 'saveAs', shortcut: '⇧⌘S', menuPlacements: ['file'] }),
  'file.saveTemplate': command('file.saveTemplate', 'Save as Template…', 'file', 'action', 'unavailable', { icon: 'template', menuPlacements: ['file'] }),
  'file.saveAll': command('file.saveAll', 'Save All', 'file', 'action', 'saveAll', { icon: 'saveAll', menuPlacements: ['file'] }),
  'file.export': command('file.export', 'Export PDF…', 'file', 'action', 'document', { icon: 'export', shortcut: '⌘E', menuPlacements: ['file'], toolbarPlacements: ['primary.file.more'] }),
  'file.close': command('file.close', 'Close', 'file', 'action', 'document', { icon: 'close', shortcut: '⌘W', menuPlacements: ['file'] }),
  'file.closeAll': command('file.closeAll', 'Close All', 'file', 'action', 'document', { icon: 'closeAll', shortcut: '⌥⌘W', menuPlacements: ['file'] }),
  'file.documentProperties': command('file.documentProperties', 'Document Properties…', 'file', 'action', 'unavailable', { icon: 'properties', menuPlacements: ['file'] }),
  'file.print': command('file.print', 'Print…', 'file', 'action', 'document', { icon: 'print', shortcut: '⌘P', menuPlacements: ['file'] }),
  'history.undo': command('history.undo', 'Undo', 'history', 'action', 'undo', { icon: 'undo', shortcut: '⌘Z', menuPlacements: ['edit'], toolbarPlacements: ['primary.history'] }),
  'history.redo': command('history.redo', 'Redo', 'history', 'action', 'redo', { icon: 'redo', shortcut: '⇧⌘Z', menuPlacements: ['edit'], toolbarPlacements: ['primary.history'] }),
  'edit.selectAll': command('edit.selectAll', 'Select All Annotations', 'edit', 'action', 'unavailable', { icon: 'selectAll', shortcut: '⌘A', menuPlacements: ['edit'] }),
  'edit.deleteSelected': command('edit.deleteSelected', 'Delete Selected', 'edit', 'action', 'selection', { icon: 'delete', shortcut: '⌫', menuPlacements: ['edit'] }),
  'edit.find': command('edit.find', 'Find…', 'edit', 'action', 'document', { icon: 'zoom', shortcut: '⌘F', menuPlacements: ['edit'] }),
  'edit.duplicate': command('edit.duplicate', 'Duplicate', 'edit', 'action', 'selection', { icon: 'selectAll', shortcut: '⌘D', menuPlacements: ['edit'] }),
  'tool.select': toolCommand('select', 'Select', 'V', 'select'),
  'tool.hand': toolCommand('hand', 'Hand / Pan', 'H', 'hand'),
  'tool.pen': toolCommand('pen', 'Pen', 'P', 'pen'),
  'tool.highlighter': toolCommand('highlighter', 'Highlighter', 'M', 'highlighter'),
  'tool.eraser': toolCommand('eraser', 'Eraser', 'E', 'eraser'),
  'tool.text': toolCommand('text', 'Text', 'T', 'text'),
  'tool.line': toolCommand('line', 'Line', 'L', 'line'),
  'tool.arrow': toolCommand('arrow', 'Arrow', 'A', 'arrow'),
  'tool.rectangle': toolCommand('rectangle', 'Rectangle', 'R', 'rectangle'),
  'tool.ellipse': toolCommand('ellipse', 'Ellipse', 'C', 'ellipse'),
  'tool.freeform': toolCommand('freeform', 'Polygon', 'F', 'freeform'),
  'tool.polygon': toolCommand('freeform', 'Polygon', 'F', 'freeform'),
  'tool.extractText': unavailableTool('tool.extractText', 'Extract Text', 'extractText'),
  'tool.zoom': unavailableTool('tool.zoom', 'Zoom Tool', 'zoom'),
  'tool.stamp': unavailableTool('tool.stamp', 'Stamp', 'stamp'),
  'tool.dimension': unavailableTool('tool.dimension', 'Dimension', 'dimension'),
  'tool.lasso': toolCommand('lasso', 'Lasso Select', 'S', 'lasso'),
  'tool.textMarkup': toolCommand('textMarkup', 'Text Highlight', 'U', 'highlighter'),
  'tool.snapshot': toolCommand('snapshot', 'Snapshot', undefined, 'snapshot'),
  'tool.crop': unavailableTool('tool.crop', 'Crop', 'crop'),
  'tool.measure': toolCommand('measure', 'Measure', undefined, 'measure'),
  'tool.formula': unavailableTool('tool.formula', 'Formula', 'formula'),
  'tool.laserPointer': toolCommand('laserPointer', 'Laser Pointer', undefined, 'laserPointer'),
  'tool.note': toolCommand('note', 'Sticky Note', 'N', 'note'),
  'tool.pointer': unavailableTool('tool.pointer', 'Pointer', 'pointer'),
  'insert.image': command('insert.image', 'Insert Image…', 'insert', 'action', 'document', { icon: 'image', menuPlacements: ['edit'], toolbarPlacements: ['primary.insert'] }),
  'insert.formula': command('insert.formula', 'Insert Formula…', 'insert', 'action', 'document', { icon: 'formula', shortcut: '⌥⌘E', menuPlacements: ['edit'], toolbarPlacements: ['primary.insert'] }),
  'insert.signature': command('insert.signature', 'Signature & Stamps…', 'insert', 'action', 'document', { icon: 'pen', shortcut: '⌥⌘S', menuPlacements: ['edit'], toolbarPlacements: ['primary.insert'] }),
  'insert.screenshot': command('insert.screenshot', 'Capture Screen', 'insert', 'action', 'document', { icon: 'screenshot', menuPlacements: ['edit'], toolbarPlacements: ['primary.insert'] }),
  'insert.regionScreenshot': command('insert.regionScreenshot', 'Capture Region', 'insert', 'action', 'document', { icon: 'regionScreenshot', menuPlacements: ['edit'], toolbarPlacements: ['primary.insert'] }),
  'insert.printoutPdf': command('insert.printoutPdf', 'Insert PDF Printout…', 'insert', 'action', 'document', { icon: 'newDocument', menuPlacements: ['edit'], toolbarPlacements: ['primary.insert'] }),
  'insert.printoutPptx': command('insert.printoutPptx', 'Insert PowerPoint Printout…', 'insert', 'action', 'document', { icon: 'newDocument', menuPlacements: ['edit'], toolbarPlacements: ['primary.insert'] }),
  'view.sidebar': command('view.sidebar', 'Show Sidebar', 'view', 'toggle', 'document', { icon: 'sidebar', shortcut: '⌘B', checkedState: 'sidebarOpen', menuPlacements: ['view.sidebar'], toolbarPlacements: ['primary.view'] }),
  'view.sidebarPages': command('view.sidebarPages', 'Pages', 'view', 'radio', 'document', { icon: 'sidebar', menuPlacements: ['view.sidebar'] }),
  'view.sidebarBookmarks': command('view.sidebarBookmarks', 'Bookmarks', 'view', 'radio', 'document', { icon: 'sidebar', menuPlacements: ['view.sidebar'] }),
  'view.sidebarOutline': command('view.sidebarOutline', 'Outline', 'view', 'radio', 'document', { icon: 'sidebar', menuPlacements: ['view.sidebar'] }),
  'view.sidebarAnnotations': command('view.sidebarAnnotations', 'Annotations', 'view', 'radio', 'document', { icon: 'annotations', menuPlacements: ['view.sidebar'] }),
  'view.sidebarSearch': command('view.sidebarSearch', 'Search', 'view', 'radio', 'document', { icon: 'zoom', menuPlacements: ['view.sidebar'] }),
  'view.zoomIn': command('view.zoomIn', 'Zoom In', 'view', 'action', 'document', { icon: 'zoomIn', shortcut: '⌘+', menuPlacements: ['view'], toolbarPlacements: ['primary.view'] }),
  'view.zoomOut': command('view.zoomOut', 'Zoom Out', 'view', 'action', 'document', { icon: 'zoomOut', shortcut: '⌘−', menuPlacements: ['view'], toolbarPlacements: ['primary.view'] }),
  'view.actualSize': command('view.actualSize', 'Actual Size', 'view', 'action', 'document', { icon: 'actualSize', shortcut: '⌘0', menuPlacements: ['view'] }),
  'view.fitWidth': command('view.fitWidth', 'Fit Width', 'view', 'action', 'document', { icon: 'fitWidth', shortcut: '⌘6', menuPlacements: ['view'], toolbarPlacements: ['primary.view.more'] }),
  'view.fitPage': command('view.fitPage', 'Fit Page', 'view', 'action', 'document', { icon: 'fitPage', shortcut: '⌘5', menuPlacements: ['view'], toolbarPlacements: ['primary.view.more'] }),
  'view.layoutContinuous': command('view.layoutContinuous', 'Continuous Single Page', 'view', 'radio', 'document', { icon: 'layout', checkedState: 'continuousLayout', menuPlacements: ['view.layout'] }),
  'view.layoutSingle': command('view.layoutSingle', 'Single Page', 'view', 'radio', 'unavailable', { icon: 'layout', menuPlacements: ['view.layout'] }),
  'view.layoutTwoPage': command('view.layoutTwoPage', 'Two Page', 'view', 'radio', 'unavailable', { icon: 'layout', menuPlacements: ['view.layout'] }),
  'view.rotateCCW': command('view.rotateCCW', 'Rotate View Left', 'view', 'action', 'document', { icon: 'rotateLeft', shortcut: '⌘[', menuPlacements: ['view'], toolbarPlacements: ['primary.view.more'] }),
  'view.rotateCW': command('view.rotateCW', 'Rotate View Right', 'view', 'action', 'document', { icon: 'rotateRight', shortcut: '⌘]', menuPlacements: ['view'], toolbarPlacements: ['primary.view.more'] }),
  'view.annotations': command('view.annotations', 'Hide Annotations', 'view', 'toggle', 'unavailable', { icon: 'annotations', menuPlacements: ['view'] }),
  'view.primaryToolbar': command('view.primaryToolbar', 'Primary Toolbar', 'view', 'toggle', 'unavailable', { icon: 'toolbar', menuPlacements: ['view.toolbars'] }),
  'view.propertyShelf': command('view.propertyShelf', 'Properties', 'view', 'toggle', 'unavailable', { icon: 'properties', menuPlacements: ['view.toolbars'] }),
  'view.statusBar': command('view.statusBar', 'Status Bar', 'view', 'toggle', 'unavailable', { icon: 'toolbar', menuPlacements: ['view.toolbars'] }),
  'view.nativeFullscreen': command('view.nativeFullscreen', 'Enter Native Full Screen', 'view', 'action', 'always', { icon: 'fullscreen', shortcut: '⌃⌘F', menuPlacements: ['view'] }),
  'view.focusMode': command('view.focusMode', 'Focus / Teaching Mode', 'view', 'toggle', 'document', { icon: 'focus', shortcut: '⌥⌘F', checkedState: 'focusMode', menuPlacements: ['view'], toolbarPlacements: ['primary.view'] }),
  'extras.favorites': command('extras.favorites', 'No Favorites Yet', 'extras', 'action', 'unavailable', { icon: 'favorites', menuPlacements: ['tool.favorites'] }),
  'extras.toolStyles': command('extras.toolStyles', 'Tool Styles Coming Later', 'extras', 'action', 'unavailable', { icon: 'toolStyles', menuPlacements: ['tool.styles', 'extras'] }),
  'help.open': command('help.open', 'MaliPDF Help', 'help', 'action', 'unavailable', { icon: 'help', menuPlacements: ['help'] }),
  'page.insertBlank': command('page.insertBlank', 'Insert Blank Page', 'page', 'action', 'document', { icon: 'newDocument', shortcut: '⇧⌘N', menuPlacements: ['page'] }),
  'page.insertNotePage': command('page.insertNotePage', 'Insert Note Page…', 'page', 'action', 'document', { icon: 'newDocument', shortcut: '⌥⌘N', menuPlacements: ['page'] }),
  'page.duplicate': command('page.duplicate', 'Duplicate Page', 'page', 'action', 'document', { icon: 'selectAll', menuPlacements: ['page'] }),
  'page.delete': command('page.delete', 'Delete Page', 'page', 'action', 'document', { icon: 'delete', menuPlacements: ['page'] }),
  'page.rotateLeft': command('page.rotateLeft', 'Rotate Page Left', 'page', 'action', 'document', { icon: 'rotateLeft', shortcut: '⇧⌘[', menuPlacements: ['page'] }),
  'page.rotateRight': command('page.rotateRight', 'Rotate Page Right', 'page', 'action', 'document', { icon: 'rotateRight', shortcut: '⇧⌘]', menuPlacements: ['page'] }),
  'page.insertFromPdf': command('page.insertFromPdf', 'Insert Pages from PDF…', 'page', 'action', 'document', { icon: 'open', menuPlacements: ['page'] }),
  'view.ruler': command('view.ruler', 'Ruler', 'view', 'action', 'document', { icon: 'measure', shortcut: '⌥⌘R', menuPlacements: ['view'] }),
  'page.ocrPage': command('page.ocrPage', 'Recognize Text on This Page', 'page', 'action', 'document', { icon: 'extractText', menuPlacements: ['page'] }),
  'page.ocrAll': command('page.ocrAll', 'Recognize Text in Document (OCR)', 'page', 'action', 'document', { icon: 'extractText', menuPlacements: ['page'] }),
  'edit.inkToText': command('edit.inkToText', 'Convert Ink to Text', 'edit', 'action', 'selection', { icon: 'text', shortcut: '⌥⌘T', menuPlacements: ['edit'] }),
  'view.nightMode': command('view.nightMode', 'Night Mode', 'view', 'toggle', 'always', { icon: 'focus', shortcut: '⌥⌘D', checkedState: 'nightMode', menuPlacements: ['view'] }),
  'view.presentation': command('view.presentation', 'Present', 'view', 'action', 'document', { icon: 'fullscreen', shortcut: '⌥⌘P', menuPlacements: ['view'] }),
  'view.replayInk': command('view.replayInk', 'Replay Ink on This Page', 'view', 'action', 'document', { icon: 'annotations', menuPlacements: ['view'] }),
  'page.addBookmark': command('page.addBookmark', 'Add Bookmark', 'page', 'action', 'document', { icon: 'favorites', shortcut: '⌥⌘B', menuPlacements: ['page'] }),
  'view.splitView': command('view.splitView', 'Side by Side', 'view', 'toggle', 'document', { icon: 'layout', shortcut: '⌥⌘\\', menuPlacements: ['view'] }),
  'view.moveTabToNewWindow': command('view.moveTabToNewWindow', 'Move Tab to New Window', 'view', 'action', 'document', { icon: 'layout', menuPlacements: ['view'] }),
  'insert.headerFooter': command('insert.headerFooter', 'Header, Footer & Page Numbers…', 'insert', 'action', 'document', { icon: 'text', menuPlacements: ['edit'], toolbarPlacements: ['primary.insert'] }),
  'app.settings': command('app.settings', 'Settings…', 'extras', 'action', 'always', { icon: 'toolStyles', shortcut: '⌘,', menuPlacements: ['app'] }),
  'page.split': command('page.split', 'Split Document…', 'page', 'action', 'document', { icon: 'export', menuPlacements: ['page'] }),
  'page.exportSelected': command('page.exportSelected', 'Export Selected Pages…', 'page', 'action', 'document', { icon: 'export', menuPlacements: ['page'] }),
  'file.recoveredDocuments': command('file.recoveredDocuments', 'Recovered Documents…', 'file', 'action', 'always', { icon: 'open', menuPlacements: ['file'] }),
  'help.checkForUpdates': command('help.checkForUpdates', 'Check for Updates…', 'help', 'action', 'always', { icon: 'help', menuPlacements: ['help'] }),
  'help.about': command('help.about', 'About MaliPDF', 'help', 'action', 'always', { icon: 'help', menuPlacements: ['help'] }),
  'help.crashReports': command('help.crashReports', 'Show Crash Reports', 'help', 'action', 'always', { icon: 'help', menuPlacements: ['help'] }),
  'app.requestQuit': command('app.requestQuit', 'Quit MaliPDF', 'file', 'action', 'always', { icon: 'close', menuPlacements: [] }),
  'app.requestCloseWindow': command('app.requestCloseWindow', 'Close Window', 'file', 'action', 'always', { icon: 'close', menuPlacements: [] }),
} as const satisfies Record<AppCommandId, AppCommandDefinition>;

export interface CommandAvailabilityContext {
  readonly hasDocument?: boolean;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly hasSelection?: boolean;
  readonly isDirty?: boolean;
  readonly hasAnyDirtyDocument?: boolean;
}
export interface CommandPresentationContext extends CommandAvailabilityContext {
  readonly activeTool?: ToolType;
  readonly sidebarOpen?: boolean;
  readonly workspaceMode?: WorkspaceMode;
  readonly nightMode?: boolean;
}

export function isCommandAvailable(commandId: AppCommandId, context: CommandAvailabilityContext): boolean {
  switch (APP_COMMANDS[commandId].availability) {
    case 'always': return true;
    case 'document': return context.hasDocument === true;
    case 'undo': return context.hasDocument === true && context.canUndo === true;
    case 'redo': return context.hasDocument === true && context.canRedo === true;
    case 'selection': return context.hasDocument === true && context.hasSelection === true;
    case 'save': return context.isDirty === true;
    case 'saveAll': return context.hasAnyDirtyDocument === true;
    case 'unavailable': return false;
    default: return false;
  }
}

export function isCommandChecked(commandId: AppCommandId, context: CommandPresentationContext): boolean {
  const definition = APP_COMMANDS[commandId];
  if (definition.checkedState === 'activeTool') return definition.tool === context.activeTool;
  if (definition.checkedState === 'sidebarOpen') return context.sidebarOpen === true;
  if (definition.checkedState === 'focusMode') return context.workspaceMode === 'focus';
  if (definition.checkedState === 'continuousLayout') return true;
  if (definition.checkedState === 'nightMode') return context.nightMode === true;
  return false;
}

export function isAppCommandId(value: unknown): value is AppCommandId {
  return typeof value === 'string' && Object.hasOwn(APP_COMMANDS, value);
}

function command(id: AppCommandId, label: string, group: CommandGroup, kind: CommandKind, availability: CommandAvailability, options: CommandOptions): AppCommandDefinition {
  return { id, label, shortLabel: options.shortLabel ?? label.replace(/…$/, ''), group, kind, availability, ...options };
}
function toolCommand(tool: CanonicalTool, label: string, shortcut: string | undefined, icon: CommandIconId): AppCommandDefinition {
  return { id: `tool.${tool}`, label, shortLabel: label, group: 'tool', kind: 'tool', availability: 'document', icon, shortcut, tool, checkedState: 'activeTool', menuPlacements: ['tool'], toolbarPlacements: ['primary.tools'] };
}
function unavailableTool(id: AppCommandId, label: string, icon: CommandIconId): AppCommandDefinition {
  return command(id, label, 'tool', 'tool', 'unavailable', { icon, menuPlacements: ['tool'] });
}

export interface ToolShortcutDefinition {
  readonly commandId: ToolCommandId;
  readonly tool: CanonicalTool;
  readonly key: 'V' | 'H' | 'P' | 'M' | 'E' | 'T' | 'L' | 'A' | 'R' | 'C' | 'S' | 'U' | 'N';
  readonly label: string;
}
export const TOOL_SHORTCUTS = [
  toolShortcut('V', 'select'), toolShortcut('H', 'hand'), toolShortcut('P', 'pen'),
  toolShortcut('M', 'highlighter'), toolShortcut('E', 'eraser'), toolShortcut('T', 'text'),
  toolShortcut('L', 'line'), toolShortcut('A', 'arrow'), toolShortcut('R', 'rectangle'),
  toolShortcut('C', 'ellipse'), toolShortcut('S', 'lasso'), toolShortcut('U', 'textMarkup'), toolShortcut('N', 'note'),
] as const satisfies readonly ToolShortcutDefinition[];
const TOOL_SHORTCUT_BY_KEY = new Map<string, ToolShortcutDefinition>(TOOL_SHORTCUTS.map((shortcut) => [shortcut.key.toLowerCase(), shortcut]));
const TOOL_COMMAND_BY_TOOL = new Map<CanonicalTool, ToolCommandId>(TOOL_SHORTCUTS.map(({ tool, commandId }) => [tool, commandId]));
export function getToolShortcut(key: string): ToolShortcutDefinition | null { return TOOL_SHORTCUT_BY_KEY.get(key.toLowerCase()) ?? null; }
export function getToolCommandId(value: unknown): ToolCommandId | null {
  if (typeof value !== 'string') return null;
  return TOOL_COMMAND_BY_TOOL.get(value as CanonicalTool) ?? null;
}
function toolShortcut(key: ToolShortcutDefinition['key'], tool: CanonicalTool): ToolShortcutDefinition {
  return { commandId: `tool.${tool}`, tool, key, label: APP_COMMANDS[`tool.${tool}`].label };
}
