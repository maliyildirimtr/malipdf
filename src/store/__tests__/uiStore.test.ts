import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from '../uiStore';

describe('uiStore workspace chrome', () => {
  beforeEach(() => {
    useUIStore.setState({
      workspaceMode: 'normal',
      sidebarOpen: true,
      focusToolbarSide: 'left',
      focusToolbarCollapsed: false,
      temporaryTool: null,
    lastShapeTool: 'rectangle',
      favoriteColors: [],
    });
  });

  it('toggles focus mode without mutating the saved sidebar preference', () => {
    useUIStore.getState().toggleFocusMode();
    expect(useUIStore.getState().workspaceMode).toBe('focus');
    expect(useUIStore.getState().sidebarOpen).toBe(true);

    useUIStore.getState().toggleFocusMode();
    expect(useUIStore.getState().workspaceMode).toBe('normal');
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('tracks the last selected shape without changing non-shape selections', () => {
    useUIStore.getState().setActiveTool('arrow');
    expect(useUIStore.getState().lastShapeTool).toBe('arrow');

    useUIStore.getState().setActiveTool('pen');
    expect(useUIStore.getState().lastShapeTool).toBe('arrow');
  });

  it('applies temporary Hand without replacing the selected tool', () => {
    useUIStore.getState().setActiveTool('pen');

    useUIStore.getState().setTemporaryTool('hand');
    expect(useUIStore.getState().temporaryTool).toBe('hand');
    expect(useUIStore.getState().activeTool).toBe('pen');

    useUIStore.getState().setTemporaryTool(null);
    expect(useUIStore.getState().temporaryTool).toBe(null);
    expect(useUIStore.getState().activeTool).toBe('pen');
  });

  it('keeps favorite colors unique and normalized', () => {
    useUIStore.getState().addFavoriteColor('#111111');
    useUIStore.getState().addFavoriteColor('#111111'); // duplicate
    useUIStore.getState().addFavoriteColor('#ffffff');
    useUIStore.getState().addFavoriteColor('white'); // duplicate normalized

    expect(useUIStore.getState().favoriteColors).toEqual(['#111111', '#ffffff']);
  });
});
