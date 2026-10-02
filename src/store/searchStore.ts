/**
 * PDF text search state (⌘F). Searches the active document page by page,
 * publishing results as they arrive; a newer query or document cancels the
 * running search. Page text is cached per document byte revision.
 */
import { create } from 'zustand';
import type { DocumentIdentity } from '../types/documentSession';
import { documentIdentityKey, sameDocumentIdentity } from '../types/documentSession';
import { getDocumentProxy, getLoadedRevision } from '../pdf/documentManager';
import { applyTextEdits, buildPageTextIndex, findMatchesInPage, type PageMatch, type PageTextIndex, type SearchTextEdit } from '../pdf/textSearch';
import { useAnnotationStore } from './annotationStore';

export type SearchStatus = 'idle' | 'searching' | 'done' | 'error';

interface SearchStore {
  query: string;
  identity: DocumentIdentity | null;
  results: PageMatch[];
  currentIndex: number;
  status: SearchStatus;
  searchedPages: number;
  totalPages: number;
  /** Pages searched so far that have no text layer (scans). */
  textlessPages: number;
  /** Bumped to ask the search input to take focus (⌘F). */
  focusRequest: number;

  requestFocus: () => void;
  search: (identity: DocumentIdentity, query: string) => Promise<void>;
  select: (index: number) => void;
  next: () => void;
  previous: () => void;
  clear: () => void;
}

const textCache = new Map<string, PageTextIndex>();
const textless = new Set<string>();
let runToken = 0;

const pageKey = (identity: DocumentIdentity, pageIndex: number) => `${documentIdentityKey(identity)}@${getLoadedRevision(identity)}:${pageIndex}`;

/** Edited PDF lines on the page (they change what the page says). */
function pageEdits(identity: DocumentIdentity, pageIndex: number): SearchTextEdit[] {
  return useAnnotationStore.getState().getPageAnnotations(identity.docId, pageIndex)
    .flatMap((a) => (a.type === 'textEdit' && !a.hidden ? [a] : []));
}

async function pageText(identity: DocumentIdentity, pageIndex: number): Promise<PageTextIndex | null> {
  const edits = pageEdits(identity, pageIndex);
  const editKey = edits.map((e) => `${e.origin.x},${e.origin.y}:${e.text}`).join('|');
  const key = `${pageKey(identity, pageIndex)}${editKey ? `#${editKey}` : ''}`;
  const cached = textCache.get(key);
  if (cached) return cached;
  const proxy = getDocumentProxy(identity);
  if (!proxy) return null;
  const page = await proxy.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  const items = content.items.flatMap((item) => ('str' in item ? [{
    str: item.str,
    transform: item.transform as number[],
    width: item.width,
    height: item.height,
    hasEOL: item.hasEOL,
  }] : []));
  const index = buildPageTextIndex(applyTextEdits(items, edits));
  if (!items.some((item) => /\S/.test(item.str))) textless.add(pageKey(identity, pageIndex));
  textCache.set(key, index);
  return index;
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  query: '',
  identity: null,
  results: [],
  currentIndex: -1,
  status: 'idle',
  searchedPages: 0,
  totalPages: 0,
  textlessPages: 0,
  focusRequest: 0,

  requestFocus: () => set((state) => ({ focusRequest: state.focusRequest + 1 })),

  search: async (identity, query) => {
    const token = ++runToken;
    const trimmed = query.trim();
    if (!trimmed) {
      set({ query, identity, results: [], currentIndex: -1, status: 'idle', searchedPages: 0, totalPages: 0 });
      return;
    }
    const proxy = getDocumentProxy(identity);
    const totalPages = proxy?.numPages ?? 0;
    set({ query, identity, results: [], currentIndex: -1, status: 'searching', searchedPages: 0, totalPages, textlessPages: 0 });
    try {
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        const index = await pageText(identity, pageIndex);
        if (token !== runToken) return; // superseded
        const matches = index ? findMatchesInPage(index, trimmed, pageIndex) : [];
        set((state) => ({
          results: matches.length > 0 ? [...state.results, ...matches] : state.results,
          currentIndex: state.currentIndex < 0 && matches.length > 0 ? 0 : state.currentIndex,
          searchedPages: pageIndex + 1,
          textlessPages: state.textlessPages + (textless.has(pageKey(identity, pageIndex)) ? 1 : 0),
        }));
      }
      if (token === runToken) set({ status: 'done' });
    } catch (error) {
      if (token === runToken) set({ status: 'error' });
      console.warn('[Search] failed:', error);
    }
  },

  select: (index) => {
    const { results } = get();
    if (results.length === 0) return;
    set({ currentIndex: ((index % results.length) + results.length) % results.length });
  },
  next: () => get().select(get().currentIndex + 1),
  previous: () => get().select(get().currentIndex - 1),

  clear: () => {
    runToken++;
    set({ query: '', results: [], currentIndex: -1, status: 'idle', searchedPages: 0, totalPages: 0 });
  },
}));

/** Matches on one page of `identity`, with the index of the current match (or -1). */
export function pageSearchHighlights(
  state: Pick<SearchStore, 'identity' | 'results' | 'currentIndex'>,
  identity: DocumentIdentity,
  pageIndex: number,
): { matches: PageMatch[]; current: PageMatch | null } {
  if (!sameDocumentIdentity(state.identity, identity)) return { matches: [], current: null };
  const matches = state.results.filter((m) => m.pageIndex === pageIndex);
  const current = state.results[state.currentIndex];
  return { matches, current: current && current.pageIndex === pageIndex ? current : null };
}
