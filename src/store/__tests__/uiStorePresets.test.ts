import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore, DEFAULT_PEN_PRESETS, RECENT_COLORS_MAX } from '../uiStore';

describe('toolbar polish state', () => {
  beforeEach(() => useUIStore.setState({ recentColors: [], penPresets: DEFAULT_PEN_PRESETS, hiddenToolbarTools: [] }));

  it('keeps recent colors unique, newest first, capped, ignoring transparent', () => {
    const { addRecentColor } = useUIStore.getState();
    addRecentColor('#FF0000');
    addRecentColor('transparent');
    addRecentColor('#00ff00');
    addRecentColor('#ff0000');
    expect(useUIStore.getState().recentColors).toEqual(['#ff0000', '#00ff00']);
    for (let i = 0; i < 20; i++) addRecentColor(`#0000${(10 + i).toString(16).padStart(2, '0')}`);
    expect(useUIStore.getState().recentColors).toHaveLength(RECENT_COLORS_MAX);
  });

  it('saves, applies and removes pen presets', () => {
    const store = useUIStore.getState();
    store.updatePenOptions({ color: '#123456', width: 7, opacity: 0.8 });
    useUIStore.getState().savePenPreset('pen');
    const saved = useUIStore.getState().penPresets.at(-1)!;
    expect(saved).toMatchObject({ tool: 'pen', color: '#123456', width: 7, opacity: 0.8 });
    useUIStore.getState().savePenPreset('pen'); // duplicate ignored
    expect(useUIStore.getState().penPresets.filter((p) => p.color === '#123456')).toHaveLength(1);

    useUIStore.getState().applyPenPreset('default-yellow-hl');
    expect(useUIStore.getState().activeTool).toBe('highlighter');
    expect(useUIStore.getState().toolOptions.highlighter).toMatchObject({ color: '#ffe066', width: 16 });

    useUIStore.getState().removePenPreset(saved.id);
    expect(useUIStore.getState().penPresets.some((p) => p.id === saved.id)).toBe(false);
  });

  it('toggles tools hidden from the ribbon', () => {
    useUIStore.getState().toggleToolbarTool('arrow');
    expect(useUIStore.getState().hiddenToolbarTools).toEqual(['arrow']);
    useUIStore.getState().toggleToolbarTool('arrow');
    expect(useUIStore.getState().hiddenToolbarTools).toEqual([]);
  });
});
