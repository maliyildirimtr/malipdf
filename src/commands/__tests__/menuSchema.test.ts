import { describe, expect, it, vi } from 'vitest';
import {
  APPLICATION_MENUS,
  APP_COMMANDS,
  collectMenuCommandIds,
  executeMenuItem,
  findMenu,
  resolveMenuItemState,
  type MenuPresentationContext,
} from '..';

const baseContext: MenuPresentationContext = {
  hasDocument: true,
  canUndo: true,
  canRedo: false,
  hasSelection: false,
  activeTool: 'pen',
  sidebarOpen: true,
  workspaceMode: 'normal',
};

describe('application menu schema', () => {
  it('defines the required desktop menu order', () => {
    expect(APPLICATION_MENUS.map((menu) => menu.id)).toEqual([
      'file', 'edit', 'tool', 'view', 'extras', 'window', 'help',
    ]);
  });

  it('only references registered command IDs', () => {
    for (const commandId of collectMenuCommandIds(APPLICATION_MENUS)) {
      expect(APP_COMMANDS).toHaveProperty(commandId);
    }
  });

  it('keeps Save and future File actions truthful', () => {
    const file = findMenu('file');
    const states = new Map(
      file.items
        .filter((item) => item.kind === 'command')
        .map((item) => [item.commandId, resolveMenuItemState(item, baseContext)]),
    );

    expect(states.get('file.open')?.enabled).toBe(true);
    expect(states.get('file.export')?.enabled).toBe(true);
    expect(states.get('file.new')?.enabled).toBe(false);
    expect(states.get('file.save')?.enabled).toBe(false);
    expect(states.get('file.saveAs')?.enabled).toBe(false);
    expect(states.get('file.combine')?.enabled).toBe(false);
    expect(states.get('file.print')?.enabled).toBe(false);
  });

  it('enables only tools backed by current interaction implementations', () => {
    const tool = findMenu('tool');
    const states = new Map(
      collectCommandItems(tool.items).map((item) => [
        item.commandId,
        resolveMenuItemState(item, baseContext),
      ]),
    );

    for (const commandId of [
      'tool.select', 'tool.hand', 'tool.pen', 'tool.highlighter', 'tool.eraser',
      'tool.text', 'tool.line', 'tool.arrow', 'tool.rectangle', 'tool.ellipse',
    ] as const) {
      expect(states.get(commandId)?.enabled, commandId).toBe(true);
    }
    for (const commandId of [
      'tool.extractText', 'tool.zoom', 'tool.stamp', 'tool.polygon',
      'tool.dimension', 'tool.lasso', 'tool.snapshot', 'tool.crop',
      'tool.measure', 'tool.formula', 'tool.laserPointer', 'tool.pointer',
    ] as const) {
      expect(states.get(commandId)?.enabled, commandId).toBe(false);
    }
  });

  it('resolves selected tools and checked view commands semantically', () => {
    const tool = findMenu('tool');
    const pen = collectCommandItems(tool.items).find((item) => item.commandId === 'tool.pen');
    const hand = collectCommandItems(tool.items).find((item) => item.commandId === 'tool.hand');
    expect(pen && resolveMenuItemState(pen, baseContext)).toMatchObject({
      checked: true,
      role: 'menuitemradio',
    });
    expect(hand && resolveMenuItemState(hand, baseContext)).toMatchObject({ checked: false });

    const view = findMenu('view');
    const sidebar = collectCommandItems(view.items).find((item) => item.commandId === 'view.sidebar');
    const focus = collectCommandItems(view.items).find((item) => item.commandId === 'view.focusMode');
    const continuous = collectCommandItems(view.items).find((item) => item.commandId === 'view.layoutContinuous');
    expect(sidebar && resolveMenuItemState(sidebar, baseContext)).toMatchObject({ checked: true, role: 'menuitemcheckbox' });
    expect(focus && resolveMenuItemState(focus, baseContext)).toMatchObject({ checked: false, role: 'menuitemcheckbox' });
    expect(continuous && resolveMenuItemState(continuous, baseContext)).toMatchObject({ checked: true, role: 'menuitemradio' });
  });

  it('routes enabled menu items through one command callback and ignores disabled ones', () => {
    const executeCommand = vi.fn();
    const executeNativeRole = vi.fn();
    const file = findMenu('file');
    const open = collectCommandItems(file.items).find((item) => item.commandId === 'file.open')!;
    const save = collectCommandItems(file.items).find((item) => item.commandId === 'file.save')!;

    expect(executeMenuItem(open, baseContext, executeCommand, executeNativeRole)).toBe(true);
    expect(executeMenuItem(save, baseContext, executeCommand, executeNativeRole)).toBe(false);
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenCalledWith('file.open');
    expect(executeNativeRole).not.toHaveBeenCalled();
  });

  it('keeps native roles out of the renderer command callback', () => {
    const executeCommand = vi.fn();
    const executeNativeRole = vi.fn();
    const windowMenu = findMenu('window');
    const minimize = windowMenu.items.find((item) => item.kind === 'nativeRole')!;

    expect(executeMenuItem(minimize, baseContext, executeCommand, executeNativeRole)).toBe(true);
    expect(executeCommand).not.toHaveBeenCalled();
    expect(executeNativeRole).toHaveBeenCalledWith('minimize');
  });
});

function collectCommandItems(items: ReturnType<typeof findMenu>['items']): Array<Extract<(typeof items)[number], { kind: 'command' }>> {
  const result: Array<any> = [];
  for (const item of items) {
    if (item.kind === 'command') result.push(item);
    if (item.kind === 'submenu') result.push(...collectCommandItems(item.items));
  }
  return result;
}
