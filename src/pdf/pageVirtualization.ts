import { CANVAS_MEMORY_POLICY } from './canvasMemory';
import type { PageLayout } from '../types/documentSession';

export const PAGE_VIRTUALIZATION_POLICY = Object.freeze({
  highZoomThreshold: 2,
  normalRenderRadius: 1,
  normalPreloadRadius: 2,
  highZoomRenderRadius: 0,
  highZoomPreloadRadius: 1,
});

interface PageWindowOptions {
  pageCount: number;
  activePageIndex: number;
  visiblePages: Set<number>;
  lastVisiblePages: Set<number>;
  pinnedPages: Set<number>;
  zoom: number;
}

export interface PageWindows {
  renderPages: Set<number>;
  preloadPages: Set<number>;
}

function sortedSet(values: Iterable<number>): Set<number> {
  return new Set([...values].sort((a, b) => a - b));
}

function validPage(pageIndex: number, pageCount: number): boolean {
  return Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < pageCount;
}

function expandPages(source: Iterable<number>, radius: number, pageCount: number): Set<number> {
  const result = new Set<number>();
  for (const pageIndex of source) {
    for (let candidate = pageIndex - radius; candidate <= pageIndex + radius; candidate++) {
      if (validPage(candidate, pageCount)) result.add(candidate);
    }
  }
  return result;
}

export function computePageWindows(options: PageWindowOptions): PageWindows {
  const {
    pageCount,
    activePageIndex,
    visiblePages,
    lastVisiblePages,
    pinnedPages,
    zoom,
  } = options;
  const basePages = visiblePages.size > 0
    ? visiblePages
    : lastVisiblePages.size > 0
      ? lastVisiblePages
      : new Set([Math.max(0, Math.min(activePageIndex, Math.max(0, pageCount - 1)))]);
  const highZoom = zoom > PAGE_VIRTUALIZATION_POLICY.highZoomThreshold;
  const renderRadius = highZoom
    ? PAGE_VIRTUALIZATION_POLICY.highZoomRenderRadius
    : PAGE_VIRTUALIZATION_POLICY.normalRenderRadius;
  const preloadRadius = highZoom
    ? PAGE_VIRTUALIZATION_POLICY.highZoomPreloadRadius
    : PAGE_VIRTUALIZATION_POLICY.normalPreloadRadius;
  const renderPages = expandPages(basePages, renderRadius, pageCount);
  const preloadPages = expandPages(basePages, preloadRadius, pageCount);

  for (const pageIndex of pinnedPages) {
    if (!validPage(pageIndex, pageCount)) continue;
    renderPages.add(pageIndex);
    preloadPages.add(pageIndex);
  }

  return {
    renderPages: sortedSet(renderPages),
    preloadPages: sortedSet(preloadPages),
  };
}

interface RetainedPageOptions {
  renderPages: Set<number>;
  preloadPages: Set<number>;
  pinnedPages: Set<number>;
  entries: Array<{ pageIndex: number; lastAccess: number }>;
  maxRetainedPages?: number;
}

export function selectRetainedPageIndexes(options: RetainedPageOptions): Set<number> {
  const maxRetainedPages = options.maxRetainedPages
    ?? CANVAS_MEMORY_POLICY.maxRetainedPages;
  const protectedPages = new Set([...options.renderPages, ...options.pinnedPages]);
  const retained = new Set(protectedPages);
  const candidates = options.entries
    .filter(({ pageIndex }) => options.preloadPages.has(pageIndex) && !retained.has(pageIndex))
    .sort((left, right) => right.lastAccess - left.lastAccess);

  for (const { pageIndex } of candidates) {
    if (retained.size >= maxRetainedPages) break;
    retained.add(pageIndex);
  }
  return sortedSet(retained);
}

interface PageLoadCandidateOptions {
  visiblePages: Set<number>;
  renderPages: Set<number>;
  preloadPages: Set<number>;
  pendingPages: ReadonlySet<number>;
  loadedPages: ReadonlySet<number>;
  capacity: number;
}

/** Selects a bounded load batch in visible → render → preload priority order. */
export function selectPageLoadCandidates(options: PageLoadCandidateOptions): number[] {
  if (options.capacity <= 0) return [];
  const priority = [
    ...options.visiblePages,
    ...options.renderPages,
    ...options.preloadPages,
  ];
  return [...new Set(priority)]
    .filter((pageIndex) => (
      !options.pendingPages.has(pageIndex) && !options.loadedPages.has(pageIndex)
    ))
    .slice(0, options.capacity);
}

export function getPageSlotSize(
  layout: PageLayout | null,
  fallback: PageLayout | null,
  scale: number,
  displayRotation: number,
): { width: number; height: number } {
  const source = layout ?? fallback;
  let width = source?.intrinsicWidth ?? 612;
  let height = source?.intrinsicHeight ?? 792;
  const normalizedDisplayRotation = ((displayRotation % 360) + 360) % 360;
  if (normalizedDisplayRotation === 90 || normalizedDisplayRotation === 270) {
    [width, height] = [height, width];
  }
  return { width: width * scale, height: height * scale };
}
