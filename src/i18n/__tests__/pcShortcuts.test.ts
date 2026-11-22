import { describe, expect, it } from 'vitest';
import { toPcShortcuts } from '../pcShortcuts';

describe('Windows / Linux shortcut labels', () => {
  it.each([
    ['Copy (⌘C)', 'Copy (Ctrl+C)'],
    ['Save As… (⇧⌘S)', 'Save As… (Ctrl+Shift+S)'],
    ['Focus / Teaching Mode (⌥⌘F)', 'Focus / Teaching Mode (Ctrl+Alt+F)'],
    ['Actual Size (⌘0)', 'Actual Size (Ctrl+0)'],
    ['Drag over text to select it; ⌘C copies it.', 'Drag over text to select it; Ctrl+C copies it.'],
    ['Delete (⌫)', 'Delete (⌫)'],
    ['⌘-click adds to the selection', 'Ctrl-click adds to the selection'],
    ['No shortcut here', 'No shortcut here'],
  ])('%s → %s', (mac, pc) => {
    expect(toPcShortcuts(mac)).toBe(pc);
  });
});
