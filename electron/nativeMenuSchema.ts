import type { MenuItemConstructorOptions } from 'electron';

export type NativeMenuRole = NonNullable<MenuItemConstructorOptions['role']>;

export type NativeMenuNode =
  | {
      readonly kind: 'command';
      readonly commandId: string;
      readonly label: string;
      readonly accelerator?: string;
      readonly enabled?: boolean;
      readonly type?: 'normal' | 'checkbox' | 'radio';
      readonly registerAccelerator?: boolean;
    }
  | { readonly kind: 'role'; readonly role: NativeMenuRole }
  | { readonly kind: 'label'; readonly label: string; readonly enabled: false }
  | { readonly kind: 'separator' }
  | { readonly kind: 'submenu'; readonly label: string; readonly enabled?: boolean; readonly items: readonly NativeMenuNode[] };

export interface NativeTopLevelMenu {
  readonly label: string;
  readonly role?: NativeMenuRole;
  readonly items: readonly NativeMenuNode[];
}

const command = (
  commandId: string,
  label: string,
  options: Omit<Extract<NativeMenuNode, { kind: 'command' }>, 'kind' | 'commandId' | 'label'> = {},
): NativeMenuNode => ({ kind: 'command', commandId, label, ...options });
const role = (value: NativeMenuRole): NativeMenuNode => ({ kind: 'role', role: value });
const disabledLabel = (label: string): NativeMenuNode => ({ kind: 'label', label, enabled: false });
const separator = (): NativeMenuNode => ({ kind: 'separator' });
const submenu = (label: string, items: readonly NativeMenuNode[], enabled = true): NativeMenuNode => ({ kind: 'submenu', label, items, enabled });
const tool = (id: string, label: string, accelerator?: string, enabled = true): NativeMenuNode =>
  command(id, label, { accelerator, enabled, type: 'checkbox', registerAccelerator: false });

/**
 * Authoritative native desktop menu structure. Renderer chrome intentionally does
 * not consume this schema: macOS owns the application menu bar.
 */
export function createNativeMenuSchema(isMac: boolean, isDev: boolean): readonly NativeTopLevelMenu[] {
  const menus: NativeTopLevelMenu[] = [];

  if (isMac) {
    menus.push({
      label: 'MaliPDF',
      items: [
        role('about'), separator(), role('services'), separator(),
        role('hide'), role('hideOthers'), role('unhide'), separator(), role('quit'),
      ],
    });
  }

  menus.push(
    {
      label: 'File',
      items: [
        command('file.new', 'New Document…', { accelerator: 'CmdOrCtrl+N', enabled: true }),
        command('file.combine', 'Combine Files…', { enabled: false }),
        command('file.open', 'Open…', { accelerator: 'CmdOrCtrl+O' }),
        separator(),
        command('file.save', 'Save', { accelerator: 'CmdOrCtrl+S', enabled: false }),
        command('file.saveAs', 'Save As…', { accelerator: 'CmdOrCtrl+Shift+S', enabled: false }),
        command('file.saveTemplate', 'Save as Template…', { enabled: false }),
        command('file.saveAll', 'Save All', { enabled: false }),
        separator(),
        command('file.export', 'Export PDF…', { accelerator: 'CmdOrCtrl+E', enabled: false }),
        separator(),
        command('file.close', 'Close', { accelerator: 'CmdOrCtrl+W', enabled: false }),
        command('file.closeAll', 'Close All', { accelerator: 'Alt+CmdOrCtrl+W', enabled: false }),
        separator(),
        command('file.documentProperties', 'Document Properties…', { enabled: false }),
        command('file.print', 'Print…', { accelerator: 'CmdOrCtrl+P', enabled: false }),
        ...(!isMac ? [separator(), role('quit')] : []),
      ],
    },
    {
      label: 'Edit',
      items: [
        command('history.undo', 'Undo', { accelerator: 'CmdOrCtrl+Z', enabled: false }),
        command('history.redo', 'Redo', { accelerator: 'CmdOrCtrl+Shift+Z', enabled: false }),
        separator(), role('cut'), role('copy'), role('paste'), role('selectAll'), separator(),
        command('edit.selectAll', 'Select All Annotations', { enabled: false }),
        command('edit.deleteSelected', 'Delete Selected', { accelerator: 'Delete', enabled: false }),
        separator(),
        command('insert.image', 'Insert Image…', { accelerator: 'CmdOrCtrl+I', enabled: false }),
        command('insert.screenshot', 'Capture Screen', { enabled: false }),
        command('insert.regionScreenshot', 'Capture Region', { enabled: false }),
        separator(),
        command('insert.printoutPdf', 'Insert PDF Printout…', { enabled: false }),
        command('insert.printoutPptx', 'Insert PowerPoint Printout…', { enabled: false }),
      ],
    },
    {
      label: 'Tools',
      items: [
        tool('tool.select', 'Select', 'V'), tool('tool.extractText', 'Extract Text', undefined, false),
        tool('tool.hand', 'Hand / Pan', 'H'), tool('tool.zoom', 'Zoom Tool', undefined, false), separator(),
        tool('tool.pen', 'Pen', 'P'), tool('tool.highlighter', 'Highlighter', 'M'),
        tool('tool.text', 'Text', 'T'), tool('tool.stamp', 'Stamp', undefined, false), separator(),
        tool('tool.line', 'Line', 'L'), tool('tool.arrow', 'Arrow', 'A'),
        tool('tool.rectangle', 'Rectangle', 'R'), tool('tool.ellipse', 'Ellipse', 'C'),
        tool('tool.polygon', 'Polygon', undefined, false), tool('tool.dimension', 'Dimension', undefined, false), separator(),
        tool('tool.eraser', 'Eraser', 'E'), tool('tool.lasso', 'Lasso Select', undefined, false), separator(),
        tool('tool.snapshot', 'Snapshot', undefined, false), tool('tool.crop', 'Crop', undefined, false),
        tool('tool.measure', 'Measure', undefined, false), tool('tool.formula', 'Formula', undefined, false), separator(),
        tool('tool.laserPointer', 'Laser Pointer', undefined, false), tool('tool.pointer', 'Pointer', undefined, false), separator(),
        submenu('Favorites', [command('extras.favorites', 'No Favorites Yet', { enabled: false })], false),
        submenu('Tool Styles', [disabledLabel('Tool Styles Coming Later')], false),
      ],
    },
    {
      label: 'View',
      items: [
        command('view.zoomIn', 'Zoom In', { accelerator: 'CmdOrCtrl+Equal', enabled: false }),
        command('view.zoomOut', 'Zoom Out', { accelerator: 'CmdOrCtrl+Minus', enabled: false }),
        command('view.actualSize', 'Actual Size', { accelerator: 'CmdOrCtrl+0', enabled: false }),
        command('view.fitWidth', 'Fit Width', { accelerator: 'CmdOrCtrl+6', enabled: false }),
        command('view.fitPage', 'Fit Page', { accelerator: 'CmdOrCtrl+5', enabled: false }), separator(),
        command('view.rotateCCW', 'Rotate View Left', { accelerator: 'CmdOrCtrl+[', enabled: false }),
        command('view.rotateCW', 'Rotate View Right', { accelerator: 'CmdOrCtrl+]', enabled: false }), separator(),
        command('view.annotations', 'Hide Annotations', { enabled: false }),
        submenu('Sidebar', [
          command('view.sidebarPages', 'Pages', { enabled: false }),
          command('view.sidebarBookmarks', 'Bookmarks', { enabled: false }),
          command('view.sidebarOutline', 'Outline', { enabled: false }),
          command('view.sidebarAnnotations', 'Annotations', { enabled: false }),
          command('view.sidebarSearch', 'Search', { enabled: false }),
        ]), separator(),
        command('view.nativeFullscreen', 'Enter Native Full Screen', {
          accelerator: isMac ? 'Ctrl+Command+F' : 'F11',
        }),
        command('view.focusMode', 'Focus / Teaching Mode', {
          accelerator: 'Alt+CmdOrCtrl+F', enabled: false, type: 'checkbox',
        }),
        ...(isDev ? [separator(), role('reload'), role('forceReload'), role('toggleDevTools')] : []),
      ],
    },
    {
      label: 'Extras',
      items: [command('extras.toolStyles', 'Tool Styles…', { enabled: false })],
    },
    {
      label: 'Window',
      items: [role('minimize'), role('zoom'), separator(), role('front')],
    },
    {
      label: 'Help',
      role: 'help',
      items: [command('help.open', 'MaliPDF Help', { enabled: false })],
    },
  );

  return menus;
}

export function collectNativeMenuCommandIds(menus: readonly NativeTopLevelMenu[]): string[] {
  const result: string[] = [];
  const visit = (items: readonly NativeMenuNode[]) => {
    for (const item of items) {
      if (item.kind === 'command') result.push(item.commandId);
      else if (item.kind === 'submenu') visit(item.items);
    }
  };
  for (const menu of menus) visit(menu.items);
  return result;
}
