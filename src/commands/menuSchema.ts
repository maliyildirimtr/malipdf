import type { NativeRole } from '../../electron/commandBridge';
import type { SidebarPanel } from '../types/annotations';
import {
  APP_COMMANDS,
  isCommandAvailable,
  isCommandChecked,
  type AppCommandId,
  type CommandPresentationContext,
} from './commandRegistry';

export type ApplicationMenuId = 'file' | 'edit' | 'tool' | 'view' | 'extras' | 'window' | 'help';
export type MenuItemRole = 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';

export interface CommandMenuItem {
  readonly kind: 'command';
  readonly commandId: AppCommandId;
  readonly checked?: boolean;
}
export interface NativeRoleMenuItem {
  readonly kind: 'nativeRole';
  readonly role: NativeRole;
  readonly label: string;
  readonly shortcut?: string;
  readonly enabled?: boolean;
}
export interface SubmenuItem {
  readonly kind: 'submenu';
  readonly id: string;
  readonly label: string;
  readonly items: readonly MenuNode[];
}
export interface MenuSeparator { readonly kind: 'separator' }
export type MenuNode = CommandMenuItem | NativeRoleMenuItem | SubmenuItem | MenuSeparator;

export interface ApplicationMenuDefinition {
  readonly id: ApplicationMenuId;
  readonly label: string;
  readonly items: readonly MenuNode[];
}

export interface MenuPresentationContext extends CommandPresentationContext {
  readonly activeSidebarPanel?: SidebarPanel;
}

const commandItem = (commandId: AppCommandId, checked?: boolean): CommandMenuItem => ({ kind: 'command', commandId, checked });
const separator = (): MenuSeparator => ({ kind: 'separator' });
const submenu = (id: string, label: string, items: readonly MenuNode[]): SubmenuItem => ({ kind: 'submenu', id, label, items });
const nativeRole = (role: NativeRole, label: string, shortcut?: string): NativeRoleMenuItem => ({ kind: 'nativeRole', role, label, shortcut });

export const APPLICATION_MENUS: readonly ApplicationMenuDefinition[] = [
  {
    id: 'file', label: 'File', items: [
      commandItem('file.new'), commandItem('file.combine'), commandItem('file.open'), separator(),
      commandItem('file.save'), commandItem('file.saveAs'), commandItem('file.saveTemplate'),
      commandItem('file.saveAll'), commandItem('file.export'), separator(),
      commandItem('file.close'), commandItem('file.closeAll'), separator(),
      commandItem('file.documentProperties'), commandItem('file.print'),
    ],
  },
  {
    id: 'edit', label: 'Edit', items: [
      commandItem('history.undo'), commandItem('history.redo'), separator(),
      nativeRole('cut', 'Cut', '⌘X'), nativeRole('copy', 'Copy', '⌘C'), nativeRole('paste', 'Paste', '⌘V'),
      separator(), commandItem('edit.selectAll'), commandItem('edit.deleteSelected'),
    ],
  },
  {
    id: 'tool', label: 'Tool', items: [
      commandItem('tool.select'), commandItem('tool.extractText'), commandItem('tool.hand'), commandItem('tool.zoom'), separator(),
      commandItem('tool.pen'), commandItem('tool.highlighter'), commandItem('tool.text'), commandItem('tool.stamp'), separator(),
      commandItem('tool.line'), commandItem('tool.arrow'), commandItem('tool.rectangle'), commandItem('tool.ellipse'),
      commandItem('tool.polygon'), commandItem('tool.dimension'), separator(),
      commandItem('tool.eraser'), commandItem('tool.lasso'), separator(),
      commandItem('tool.snapshot'), commandItem('tool.crop'), commandItem('tool.measure'), commandItem('tool.formula'), separator(),
      commandItem('tool.laserPointer'), commandItem('tool.pointer'), separator(),
      submenu('tool-favorites', 'Favorites', [commandItem('extras.favorites')]),
      submenu('tool-styles', 'Tool Styles', [commandItem('extras.toolStyles')]),
    ],
  },
  {
    id: 'view', label: 'View', items: [
      commandItem('view.zoomIn'), commandItem('view.zoomOut'), commandItem('view.actualSize'), separator(),
      commandItem('view.fitWidth'), commandItem('view.fitPage'), separator(),
      submenu('page-layout', 'Page Layout', [
        commandItem('view.layoutContinuous'), commandItem('view.layoutSingle'), commandItem('view.layoutTwoPage'),
      ]), separator(),
      commandItem('view.rotateCCW'), commandItem('view.rotateCW'), separator(),
      commandItem('view.annotations'),
      submenu('sidebar', 'Sidebar', [
        commandItem('view.sidebar'), separator(), commandItem('view.sidebarPages'),
        commandItem('view.sidebarBookmarks'), commandItem('view.sidebarOutline'),
        commandItem('view.sidebarAnnotations'), commandItem('view.sidebarSearch'),
      ]),
      submenu('toolbars', 'Toolbars', [
        commandItem('view.primaryToolbar', true), commandItem('view.propertyShelf', true), commandItem('view.statusBar', true),
      ]), separator(),
      commandItem('view.nativeFullscreen'), commandItem('view.focusMode'),
    ],
  },
  { id: 'extras', label: 'Extras', items: [commandItem('extras.toolStyles')] },
  {
    id: 'window', label: 'Window', items: [
      nativeRole('minimize', 'Minimize', '⌘M'), nativeRole('zoom', 'Zoom'), separator(),
      nativeRole('bringAllToFront', 'Bring All to Front'),
    ],
  },
  { id: 'help', label: 'Help', items: [commandItem('help.open')] },
] as const;

export interface ResolvedMenuItemState {
  enabled: boolean;
  checked: boolean;
  role: MenuItemRole;
}

export function resolveMenuItemState(item: CommandMenuItem, context: MenuPresentationContext): ResolvedMenuItemState {
  const definition = APP_COMMANDS[item.commandId];
  let checked = item.checked ?? isCommandChecked(item.commandId, context);
  if (item.commandId === 'view.sidebarPages') checked = context.sidebarOpen === true && context.activeSidebarPanel === 'pages';
  return {
    enabled: isCommandAvailable(item.commandId, context),
    checked,
    role: definition.kind === 'tool' || definition.kind === 'radio'
      ? 'menuitemradio'
      : definition.kind === 'toggle'
        ? 'menuitemcheckbox'
        : 'menuitem',
  };
}

export function executeMenuItem(
  item: CommandMenuItem | NativeRoleMenuItem,
  context: MenuPresentationContext,
  executeCommand: (commandId: AppCommandId) => void,
  executeNativeRole: (role: NativeRole) => void,
): boolean {
  if (item.kind === 'nativeRole') {
    if (item.enabled === false) return false;
    executeNativeRole(item.role);
    return true;
  }
  if (!resolveMenuItemState(item, context).enabled) return false;
  executeCommand(item.commandId);
  return true;
}

export function findMenu(id: ApplicationMenuId): ApplicationMenuDefinition {
  const menu = APPLICATION_MENUS.find((candidate) => candidate.id === id);
  if (!menu) throw new Error(`Unknown application menu: ${id}`);
  return menu;
}

export function collectMenuCommandIds(menus: readonly ApplicationMenuDefinition[]): AppCommandId[] {
  const result: AppCommandId[] = [];
  const visit = (items: readonly MenuNode[]) => {
    for (const item of items) {
      if (item.kind === 'command') result.push(item.commandId);
      else if (item.kind === 'submenu') visit(item.items);
    }
  };
  for (const menu of menus) visit(menu.items);
  return result;
}

export function getMenuNodeLabel(item: Exclude<MenuNode, MenuSeparator>): string {
  return item.kind === 'command' ? APP_COMMANDS[item.commandId].label : item.label;
}
