/**
 * Shortcuts are written the Mac way in the interface (⌘S, ⇧⌘S, ⌥⌘F).
 * On Windows and Linux they are shown as Ctrl+S, Ctrl+Shift+S, Ctrl+Alt+F.
 */
const MODIFIERS: Record<string, string> = { '⌃': 'Ctrl', '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' };
const ORDER = ['Ctrl', 'Alt', 'Shift'];
const KEYS: Record<string, string> = { '⌫': 'Backspace', '⌦': 'Delete', '↩': 'Enter', '⎋': 'Esc' };

export function toPcShortcuts(text: string): string {
  if (!/[⌃⌥⇧⌘]/.test(text)) return text;
  return text.replace(/([⌃⌥⇧⌘]+)([^\s),;·/]*)/g, (_match, mods: string, key: string) => {
    const used = new Set([...mods].map((m) => MODIFIERS[m]));
    const modifiers = ORDER.filter((m) => used.has(m)).join('+');
    const keyName = [...key].map((c) => KEYS[c] ?? c).join('');
    if (!keyName) return modifiers;
    // "⌘-click" → "Ctrl-click"
    return keyName.startsWith('-') ? modifiers + keyName : `${modifiers}+${keyName}`;
  });
}
