import { describe, expect, it } from 'vitest';
import {
  useUIStore,
  toggleInOrder,
  DEFAULT_FOCUS_TOOLBAR_ITEMS,
  DEFAULT_PRESENTATION_TOOLS,
  FOCUS_TOOLBAR_ITEMS,
} from '../uiStore';

describe('toolbar customization', () => {
  it('keeps the canonical order and never empties the list', () => {
    expect(toggleInOrder(['pen', 'select'], 'hand', ['select', 'hand', 'pen'])).toEqual(['select', 'hand', 'pen']);
    expect(toggleInOrder(['pen'], 'pen', ['select', 'hand', 'pen'])).toEqual(['pen']);
  });

  it('adds and removes focus toolbar items', () => {
    const store = useUIStore.getState();
    store.resetFocusToolbarItems();
    expect(useUIStore.getState().focusToolbarItems).toEqual(DEFAULT_FOCUS_TOOLBAR_ITEMS);
    store.toggleFocusToolbarItem('note');
    expect(useUIStore.getState().focusToolbarItems).toContain('note');
    store.toggleFocusToolbarItem('hand');
    expect(useUIStore.getState().focusToolbarItems).not.toContain('hand');
    const order = useUIStore.getState().focusToolbarItems.map((i) => FOCUS_TOOLBAR_ITEMS.indexOf(i));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('adds shape tools to the presentation toolbar', () => {
    const store = useUIStore.getState();
    store.resetPresentationTools();
    expect(useUIStore.getState().presentationTools).toEqual(DEFAULT_PRESENTATION_TOOLS);
    store.togglePresentationTool('rectangle');
    expect(useUIStore.getState().presentationTools).toEqual(['laser', 'pen', 'highlighter', 'eraser', 'rectangle']);
  });
});
