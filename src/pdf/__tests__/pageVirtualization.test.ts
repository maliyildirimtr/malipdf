import { describe, expect, it } from 'vitest';
import {
  computePageWindows,
  getPageSlotSize,
  selectPageLoadCandidates,
  selectRetainedPageIndexes,
} from '../pageVirtualization';
import type { PageLayout } from '../../types/documentSession';

describe('page virtualization policy', () => {
  it('uses visible ±1 for rendering and visible ±2 for preload at normal zoom', () => {
    const windows = computePageWindows({
      pageCount: 20,
      activePageIndex: 5,
      visiblePages: new Set([5]),
      lastVisiblePages: new Set(),
      pinnedPages: new Set(),
      zoom: 2,
    });

    expect([...windows.renderPages]).toEqual([4, 5, 6]);
    expect([...windows.preloadPages]).toEqual([3, 4, 5, 6, 7]);
  });

  it('turns render overscan off and reduces preload to ±1 above zoom 2', () => {
    const windows = computePageWindows({
      pageCount: 20,
      activePageIndex: 5,
      visiblePages: new Set([5]),
      lastVisiblePages: new Set(),
      pinnedPages: new Set(),
      zoom: 2.01,
    });

    expect([...windows.renderPages]).toEqual([5]);
    expect([...windows.preloadPages]).toEqual([4, 5, 6]);
  });

  it('clips windows at document boundaries and retains pinned pages', () => {
    const windows = computePageWindows({
      pageCount: 3,
      activePageIndex: 0,
      visiblePages: new Set([0]),
      lastVisiblePages: new Set(),
      pinnedPages: new Set([2]),
      zoom: 1,
    });

    expect([...windows.renderPages]).toEqual([0, 1, 2]);
    expect([...windows.preloadPages]).toEqual([0, 1, 2]);
  });

  it('falls back to the previous visible page during an empty observer batch', () => {
    const windows = computePageWindows({
      pageCount: 20,
      activePageIndex: 0,
      visiblePages: new Set(),
      lastVisiblePages: new Set([8]),
      pinnedPages: new Set(),
      zoom: 1,
    });

    expect([...windows.renderPages]).toEqual([7, 8, 9]);
  });

  it('enforces the retained cache limit while never dropping protected pages', () => {
    const retained = selectRetainedPageIndexes({
      renderPages: new Set([10, 11, 12]),
      preloadPages: new Set(Array.from({ length: 20 }, (_, i) => i)),
      pinnedPages: new Set([18]),
      entries: Array.from({ length: 20 }, (_, pageIndex) => ({ pageIndex, lastAccess: pageIndex })),
      maxRetainedPages: 12,
    });

    expect(retained.size).toBe(12);
    expect(retained.has(10)).toBe(true);
    expect(retained.has(11)).toBe(true);
    expect(retained.has(12)).toBe(true);
    expect(retained.has(18)).toBe(true);
  });

  it('keeps measured slot geometry across zoom and display rotation', () => {
    const layout: PageLayout = {
      pageIndex: 0,
      intrinsicWidth: 600,
      intrinsicHeight: 800,
      intrinsicRotation: 0,
      measured: true,
    };

    expect(getPageSlotSize(layout, null, 2, 0)).toEqual({ width: 1200, height: 1600 });
    expect(getPageSlotSize(layout, null, 2, 90)).toEqual({ width: 1600, height: 1200 });
    expect(getPageSlotSize(layout, null, 2, 270)).toEqual({ width: 1600, height: 1200 });
  });

  it('limits a page-load batch and prioritizes visible pages', () => {
    expect(selectPageLoadCandidates({
      visiblePages: new Set([8, 9]),
      renderPages: new Set([7, 8, 9, 10]),
      preloadPages: new Set([6, 7, 8, 9, 10, 11]),
      pendingPages: new Set([8]),
      loadedPages: new Set([7]),
      capacity: 3,
    })).toEqual([9, 10, 6]);
  });
});
