import { describe, expect, it, vi } from 'vitest';
import {
  APP_COMMANDS,
  TOOL_SHORTCUTS,
  getToolForKeyboardEvent,
  isAppCommandId,
  isCommandAvailable,
  isEditableTarget,
  isTemporaryHandShortcut,
  requestActiveInteractionCancellation,
  shouldIgnoreSingleKeyShortcut,
  type ShortcutKeyboardEvent,
} from '..';

function keyboardEvent(
  overrides: Partial<ShortcutKeyboardEvent> = {},
): ShortcutKeyboardEvent {
  return {
    key: 'v',
    target: null,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    keyCode: 0,
    ...overrides,
  };
}

function target(value: object): EventTarget {
  return value as EventTarget;
}

describe('command registry', () => {
  it('defines exactly one canonical shortcut for every primary tool', () => {
    expect(TOOL_SHORTCUTS.map(({ key, tool }) => [key, tool])).toEqual([
      ['V', 'select'],
      ['H', 'hand'],
      ['P', 'pen'],
      ['M', 'highlighter'],
      ['E', 'eraser'],
      ['T', 'text'],
      ['L', 'line'],
      ['A', 'arrow'],
      ['R', 'rectangle'],
      ['C', 'ellipse'],
    ]);

    expect(new Set(TOOL_SHORTCUTS.map(({ key }) => key)).size).toBe(10);
    expect(new Set(TOOL_SHORTCUTS.map(({ tool }) => tool)).size).toBe(10);
  });

  it.each(TOOL_SHORTCUTS)(
    'maps $key to $tool case-insensitively',
    ({ key, tool }) => {
      expect(getToolForKeyboardEvent(keyboardEvent({ key }))).toBe(tool);
      expect(getToolForKeyboardEvent(keyboardEvent({ key: key.toLowerCase() }))).toBe(tool);
    },
  );

  it('does not run single-key tools with command modifiers', () => {
    expect(getToolForKeyboardEvent(keyboardEvent({ metaKey: true }))).toBeNull();
    expect(getToolForKeyboardEvent(keyboardEvent({ ctrlKey: true }))).toBeNull();
    expect(getToolForKeyboardEvent(keyboardEvent({ altKey: true }))).toBeNull();
    expect(getToolForKeyboardEvent(keyboardEvent({ shiftKey: true }))).toBeNull();
  });

  it('recognizes editable targets, including nested contenteditable content', () => {
    expect(isEditableTarget(target({ tagName: 'INPUT' }))).toBe(true);
    expect(isEditableTarget(target({ tagName: 'textarea' }))).toBe(true);
    expect(isEditableTarget(target({ tagName: 'SELECT' }))).toBe(true);
    expect(isEditableTarget(target({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
    expect(
      isEditableTarget(
        target({
          tagName: 'SPAN',
          parentElement: {
            tagName: 'DIV',
            getAttribute: (name: string) => name === 'contenteditable' ? '' : null,
          },
        }),
      ),
    ).toBe(true);
    expect(isEditableTarget(target({ tagName: 'CANVAS' }))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('guards editable targets and IME composition', () => {
    expect(
      shouldIgnoreSingleKeyShortcut(
        keyboardEvent({ target: target({ tagName: 'INPUT' }) }),
      ),
    ).toBe(true);
    expect(shouldIgnoreSingleKeyShortcut(keyboardEvent({ isComposing: true }))).toBe(true);
    expect(shouldIgnoreSingleKeyShortcut(keyboardEvent({ keyCode: 229 }))).toBe(true);
    expect(shouldIgnoreSingleKeyShortcut(keyboardEvent({ defaultPrevented: true }))).toBe(true);
    expect(shouldIgnoreSingleKeyShortcut(keyboardEvent({ target: target({ tagName: 'BUTTON' }) }))).toBe(true);
    expect(shouldIgnoreSingleKeyShortcut(keyboardEvent({ target: target({ tagName: 'DIV', getAttribute: (name: string) => name === 'role' ? 'slider' : null }) }))).toBe(true);
    expect(shouldIgnoreSingleKeyShortcut(keyboardEvent())).toBe(false);
  });

  it('recognizes Space as the temporary Hand shortcut with the same guards', () => {
    expect(isTemporaryHandShortcut(keyboardEvent({ key: ' ' }))).toBe(true);
    expect(isTemporaryHandShortcut(keyboardEvent({ key: 'Spacebar' }))).toBe(true);
    expect(isTemporaryHandShortcut(keyboardEvent({ key: ' ', metaKey: true }))).toBe(false);
    expect(
      isTemporaryHandShortcut(
        keyboardEvent({ key: ' ', target: target({ tagName: 'TEXTAREA' }) }),
      ),
    ).toBe(false);
    expect(isTemporaryHandShortcut(keyboardEvent({ key: ' ', target: target({ tagName: 'BUTTON' }) }))).toBe(false);
  });

  it('lets an active page interaction consume Escape before Focus Mode exits', () => {
    const idleTarget = new EventTarget();
    expect(requestActiveInteractionCancellation(idleTarget)).toBe(false);

    const activeTarget = new EventTarget();
    activeTarget.addEventListener('malipdf:cancel-active-interaction', (event) => {
      event.preventDefault();
    });
    expect(requestActiveInteractionCancellation(activeTarget)).toBe(true);
  });

  it('marks in-place Save available conditionally', () => {
    expect(APP_COMMANDS['file.save'].availability).toBe('save');
    expect(isCommandAvailable('file.save', { isDirty: false })).toBe(false);
    expect(isCommandAvailable('file.save', { isDirty: true })).toBe(true);

    expect(APP_COMMANDS['file.saveAs'].availability).toBe('document');
    expect(APP_COMMANDS['file.saveTemplate'].availability).toBe('unavailable');
    
    expect(APP_COMMANDS['file.saveAll'].availability).toBe('saveAll');
    expect(isCommandAvailable('file.saveAll', { hasAnyDirtyDocument: false })).toBe(false);
    expect(isCommandAvailable('file.saveAll', { hasAnyDirtyDocument: true })).toBe(true);
    expect(isCommandAvailable('file.export', { hasDocument: false })).toBe(false);
    expect(isCommandAvailable('file.export', { hasDocument: true })).toBe(true);
    expect(isCommandAvailable('edit.selectAll', { hasDocument: true })).toBe(false);
    expect(isCommandAvailable('edit.deleteSelected', { hasDocument: true, hasSelection: false })).toBe(false);
    expect(isCommandAvailable('edit.deleteSelected', { hasDocument: true, hasSelection: true })).toBe(true);
    expect(isCommandAvailable('history.undo', { hasDocument: true, canUndo: false })).toBe(false);
    expect(isCommandAvailable('history.undo', { hasDocument: true, canUndo: true })).toBe(true);
  });

  it('keeps tools disabled without a document so users do not get confused in empty state', () => {
    for (const { tool } of TOOL_SHORTCUTS) {
      expect(isCommandAvailable(`tool.${tool}`, { hasDocument: false })).toBe(false);
    }
  });

  it('accepts only registered command IDs from external bridges', () => {
    expect(isAppCommandId('tool.pen')).toBe(true);
    expect(isAppCommandId('view.nativeFullscreen')).toBe(true);
    expect(isAppCommandId('menu:tool')).toBe(false);
    expect(isAppCommandId('tool.roundedRect')).toBe(false);
    expect(isAppCommandId({ commandId: 'tool.pen' })).toBe(false);
  });
});
