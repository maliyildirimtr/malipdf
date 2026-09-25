import { beforeEach, describe, expect, it, vi } from 'vitest';

const pages = [
  ['Merhaba dünya'],
  ['Hiçbir şey'],
  ['DÜNYA ve dünya'],
];
vi.mock('../../pdf/documentManager', () => ({
  getLoadedRevision: () => 1,
  getDocumentProxy: () => ({
    numPages: pages.length,
    getPage: async (n: number) => ({
      getTextContent: async () => ({
        items: pages[n - 1].map((str) => ({ str, transform: [10, 0, 0, 10, 0, 0], width: str.length * 5, height: 10, hasEOL: false })),
      }),
    }),
  }),
}));

import { useSearchStore, pageSearchHighlights } from '../searchStore';

const identity = { docId: 'S', instanceId: 1 };

describe('search store', () => {
  beforeEach(() => useSearchStore.getState().clear());

  it('finds every match across pages and steps through them with wrap-around', async () => {
    await useSearchStore.getState().search(identity, 'dunya');
    const state = useSearchStore.getState();
    expect(state.status).toBe('done');
    expect(state.results.map((r) => r.pageIndex)).toEqual([0, 2, 2]);
    expect(state.currentIndex).toBe(0);

    state.next(); state.next();
    expect(useSearchStore.getState().currentIndex).toBe(2);
    useSearchStore.getState().next();
    expect(useSearchStore.getState().currentIndex).toBe(0);
    useSearchStore.getState().previous();
    expect(useSearchStore.getState().currentIndex).toBe(2);

    const onPage2 = pageSearchHighlights(useSearchStore.getState(), identity, 2);
    expect(onPage2.matches).toHaveLength(2);
    expect(onPage2.current).toBe(onPage2.matches[1]);
    expect(pageSearchHighlights(useSearchStore.getState(), { docId: 'other', instanceId: 1 }, 2).matches).toEqual([]);
  });

  it('a newer query supersedes a running one', async () => {
    const first = useSearchStore.getState().search(identity, 'dunya');
    const second = useSearchStore.getState().search(identity, 'hicbir');
    await Promise.all([first, second]);
    expect(useSearchStore.getState().query).toBe('hicbir');
    expect(useSearchStore.getState().results.map((r) => r.pageIndex)).toEqual([1]);
  });
});
