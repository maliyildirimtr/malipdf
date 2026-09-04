import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectNativeMenuCommandIds,
  createNativeMenuSchema,
  type NativeMenuNode,
} from '../../../electron/nativeMenuSchema';

const schema = createNativeMenuSchema(true, false);

describe('native macOS menu schema', () => {
  it('uses the required native top-level order and MaliPDF app name', () => {
    expect(schema.map((menu) => menu.label)).toEqual([
      'MaliPDF', 'File', 'Edit', 'Tools', 'View', 'Extras', 'Window', 'Help',
    ]);
  });

  it('keeps Save distinct from Export and truthfully disables unfinished file commands', () => {
    const file = findTopMenu('File');
    expect(findCommand(file.items, 'file.save')).toMatchObject({ label: 'Save', enabled: false });
    expect(findCommand(file.items, 'file.saveAs')).toMatchObject({ label: 'Save As…', enabled: false });
    expect(findCommand(file.items, 'file.export')).toMatchObject({ label: 'Export PDF…', enabled: false });
    expect(findCommand(file.items, 'file.open')).toMatchObject({ label: 'Open…' });
  });

  it('keeps native text editing roles in the Edit menu', () => {
    const roles = findTopMenu('Edit').items
      .filter((item): item is Extract<NativeMenuNode, { kind: 'role' }> => item.kind === 'role')
      .map((item) => item.role);
    expect(roles).toEqual(['cut', 'copy', 'paste', 'selectAll']);
  });

  it('exposes implemented tools and disables planned tools', () => {
    const tools = findTopMenu('Tools');
    for (const id of [
      'tool.select', 'tool.hand', 'tool.pen', 'tool.highlighter', 'tool.eraser',
      'tool.text', 'tool.line', 'tool.arrow', 'tool.rectangle', 'tool.ellipse',
    ]) {
      expect(findCommand(tools.items, id)?.enabled).not.toBe(false);
    }
    for (const id of [
      'tool.extractText', 'tool.zoom', 'tool.stamp', 'tool.polygon', 'tool.dimension',
      'tool.lasso', 'tool.snapshot', 'tool.crop', 'tool.measure', 'tool.formula',
      'tool.laserPointer', 'tool.pointer',
    ]) {
      expect(findCommand(tools.items, id)?.enabled, id).toBe(false);
    }
  });

  it('uses view-only rotation labels', () => {
    const view = findTopMenu('View');
    expect(findCommand(view.items, 'view.rotateCCW')?.label).toBe('Rotate View Left');
    expect(findCommand(view.items, 'view.rotateCW')?.label).toBe('Rotate View Right');
  });

  it('keeps sidebar panels truthful', () => {
    const view = findTopMenu('View');
    expect(findCommand(view.items, 'view.sidebarPages')).toMatchObject({ label: 'Pages', enabled: false });
    for (const id of ['view.sidebarBookmarks', 'view.sidebarOutline', 'view.sidebarAnnotations', 'view.sidebarSearch']) {
      expect(findCommand(view.items, id)?.enabled, id).toBe(false);
    }
  });

  it('contains native macOS application roles', () => {
    const roles = findTopMenu('MaliPDF').items
      .filter((item): item is Extract<NativeMenuNode, { kind: 'role' }> => item.kind === 'role')
      .map((item) => item.role);
    expect(roles).toEqual(['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit']);
  });

  it('adds developer-only View roles only in development', () => {
    const productionRoles = flatten(findTopMenu('View').items).filter((item) => item.kind === 'role');
    const development = createNativeMenuSchema(true, true).find((menu) => menu.label === 'View')!;
    const developmentRoles = flatten(development.items)
      .filter((item): item is Extract<NativeMenuNode, { kind: 'role' }> => item.kind === 'role')
      .map((item) => item.role);
    expect(productionRoles).toEqual([]);
    expect(developmentRoles).toEqual(['reload', 'forceReload', 'toggleDevTools']);
  });

  it('has unique native menu command IDs', () => {
    const ids = collectNativeMenuCommandIds(schema);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not mount a renderer-owned application menu row', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    expect(appSource).not.toContain('ApplicationMenu');
    expect(tokens).not.toContain('application-menu-height');
  });
});

function findTopMenu(label: string) {
  const menu = schema.find((candidate) => candidate.label === label);
  if (!menu) throw new Error(`Missing native menu: ${label}`);
  return menu;
}

function flatten(items: readonly NativeMenuNode[]): NativeMenuNode[] {
  return items.flatMap((item) => item.kind === 'submenu' ? [item, ...flatten(item.items)] : [item]);
}

function findCommand(items: readonly NativeMenuNode[], commandId: string) {
  return flatten(items).find(
    (item): item is Extract<NativeMenuNode, { kind: 'command' }> =>
      item.kind === 'command' && item.commandId === commandId,
  );
}
