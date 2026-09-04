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
      recentColorsByFamily: {
        pen: [],
        highlighter: [],
        text: [],
        shape: [],
      },
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

  it('applies temporary Hand without replacing the selected tool or selection', () => {
    useUIStore.getState().setActiveTool('pen');
    useUIStore.getState().setSelection(['annotation-1']);

    useUIStore.getState().setTemporaryTool('hand');
    expect(useUIStore.getState().activeTool).toBe('pen');
    expect(useUIStore.getState().temporaryTool).toBe('hand');
    expect([...useUIStore.getState().selection.selectedIds]).toEqual(['annotation-1']);

    useUIStore.getState().setTemporaryTool(null);
    expect(useUIStore.getState().activeTool).toBe('pen');
    expect([...useUIStore.getState().selection.selectedIds]).toEqual(['annotation-1']);
  });

  it('keeps recent colors isolated by family, unique and bounded to six', () => {
    const colors = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'];
    for (const color of colors) useUIStore.getState().rememberColor('pen', color);
    useUIStore.getState().rememberColor('pen', '#555555');

    expect(useUIStore.getState().recentColorsByFamily.pen).toEqual([
      '#555555', '#777777', '#666666', '#444444', '#333333', '#222222',
    ]);
    expect(useUIStore.getState().recentColorsByFamily.shape).toEqual([]);
  });
});
