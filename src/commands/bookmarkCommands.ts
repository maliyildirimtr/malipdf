/** User bookmarks: add / rename / delete (each one undo step) and navigation. */
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore } from '../store/historyStore';
import type { Bookmark } from '../types/annotations';
import { nanoid } from '../utils/nanoid';

export const MAX_BOOKMARK_TITLE = 200;

function commit(docId: string, next: Bookmark[]): void {
  const doc = useDocumentStore.getState().documents.get(docId);
  if (!doc) return;
  const before = doc.bookmarks ?? [];
  const sorted = [...next].sort((a, b) => a.pageIndex - b.pageIndex);
  useDocumentStore.getState().updateDocument(docId, { bookmarks: sorted });
  useHistoryStore.getState().push({ type: 'SET_BOOKMARKS', docId, beforeBookmarks: before, afterBookmarks: sorted });
}

export function cleanTitle(title: string, fallback: string): string {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, MAX_BOOKMARK_TITLE);
  return clean || fallback;
}

/** Bookmark the active page (or a given page). Returns the new bookmark id. */
export function addBookmark(
  docId = useDocumentStore.getState().activeDocId,
  pageIndex?: number,
  title?: string,
): string | null {
  if (!docId) return null;
  const doc = useDocumentStore.getState().documents.get(docId);
  if (!doc) return null;
  const page = Math.max(0, Math.min(doc.pageCount - 1, pageIndex ?? doc.activePageIndex));
  const bookmark: Bookmark = { id: nanoid(), title: cleanTitle(title ?? '', `Page ${page + 1}`), pageIndex: page };
  commit(docId, [...(doc.bookmarks ?? []), bookmark]);
  return bookmark.id;
}

export function renameBookmark(docId: string, id: string, title: string): void {
  const doc = useDocumentStore.getState().documents.get(docId);
  const bookmark = doc?.bookmarks?.find((item) => item.id === id);
  if (!doc || !bookmark) return;
  const next = cleanTitle(title, bookmark.title);
  if (next === bookmark.title) return;
  commit(docId, doc.bookmarks!.map((item) => (item.id === id ? { ...item, title: next } : item)));
}

export function deleteBookmark(docId: string, id: string): void {
  const doc = useDocumentStore.getState().documents.get(docId);
  if (!doc?.bookmarks?.some((item) => item.id === id)) return;
  commit(docId, doc.bookmarks.filter((item) => item.id !== id));
}

/** Show a page: make it active and scroll it into view. */
export function goToPage(docId: string, pageIndex: number): void {
  const doc = useDocumentStore.getState().documents.get(docId);
  if (!doc || pageIndex < 0 || pageIndex >= doc.pageCount) return;
  useDocumentStore.getState().setActivePage(docId, pageIndex);
  document.querySelector(
    `[data-doc-id="${docId}"][data-instance-id="${doc.instanceId}"][data-page-index="${pageIndex}"]`,
  )?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
