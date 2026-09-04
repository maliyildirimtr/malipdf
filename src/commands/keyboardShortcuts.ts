import type { CanonicalTool } from './commandRegistry';
import { getToolShortcut } from './commandRegistry';

/** Minimal shape accepted from both DOM KeyboardEvent and unit-test adapters. */
export interface ShortcutKeyboardEvent {
  readonly key: string;
  readonly target: EventTarget | null;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented?: boolean;
  readonly isComposing?: boolean;
  /** Safari/Electron compatibility signal for an IME-owned keyboard event. */
  readonly keyCode?: number;
  readonly code?: string;
}

interface EditableTargetLike {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly parentElement?: EditableTargetLike | null;
  getAttribute?: (name: string) => string | null;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'radio',
  'slider',
  'switch',
  'tab',
]);

/**
 * Returns true for native form fields and any node inside an editable subtree.
 * It deliberately avoids `instanceof HTMLElement`, so it also works across
 * iframe realms and remains straightforward to test in Vitest's Node runtime.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  let current = target as EditableTargetLike | null;

  while (current) {
    if (current.isContentEditable === true) return true;

    const tagName = current.tagName?.toUpperCase();
    if (tagName && EDITABLE_TAGS.has(tagName)) return true;

    const contentEditable = current.getAttribute?.('contenteditable');
    if (contentEditable !== undefined && contentEditable !== null) {
      // An explicit false creates a non-editable island, so do not inherit an
      // editable state from a more distant ancestor.
      return contentEditable.toLowerCase() !== 'false';
    }

    const role = current.getAttribute?.('role')?.toLowerCase();
    if (role && EDITABLE_ROLES.has(role)) return true;

    current = current.parentElement ?? null;
  }

  return false;
}

export function isImeKeyboardEvent(
  event: Pick<ShortcutKeyboardEvent, 'isComposing' | 'keyCode'>,
): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  let current = target as EditableTargetLike | null;
  while (current) {
    const tagName = current.tagName?.toUpperCase();
    if (tagName && INTERACTIVE_TAGS.has(tagName)) return true;
    const role = current.getAttribute?.('role')?.toLowerCase();
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    current = current.parentElement ?? null;
  }
  return false;
}

/** Shared gate for modifier-free tool and temporary-Hand shortcuts. */
export function shouldIgnoreSingleKeyShortcut(event: ShortcutKeyboardEvent): boolean {
  return (
    event.defaultPrevented === true
    || isImeKeyboardEvent(event)
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || isEditableTarget(event.target)
    || isInteractiveShortcutTarget(event.target)
  );
}

export function getToolForKeyboardEvent(event: ShortcutKeyboardEvent): CanonicalTool | null {
  if (shouldIgnoreSingleKeyShortcut(event)) return null;
  return getToolShortcut(event.key)?.tool ?? null;
}

export const TEMPORARY_HAND_SHORTCUT = {
  key: 'Space',
  tool: 'hand',
  label: 'Temporary Hand',
} as const;

export function isTemporaryHandShortcut(event: ShortcutKeyboardEvent): boolean {
  if (shouldIgnoreSingleKeyShortcut(event)) return false;
  return event.key === ' ' || event.key === 'Spacebar' || event.key === 'Space';
}
