/** Your own bookmarks. Saved into the PDF's table of contents. */
import React, { useState } from 'react';
import { BookmarkPlus, Pencil, Trash2 } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { addBookmark, deleteBookmark, goToPage, renameBookmark } from '../../commands/bookmarkCommands';
import type { Bookmark } from '../../types/annotations';
import styles from './PageSidebar.module.css';

const NO_BOOKMARKS: Bookmark[] = [];

export function BookmarksPanel({ docId }: { docId: string }) {
  const bookmarks = useDocumentStore((state) => state.documents.get(docId)?.bookmarks ?? NO_BOOKMARKS);
  const activePage = useDocumentStore((state) => state.documents.get(docId)?.activePageIndex ?? 0);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className={styles.annotationsPanel}>
      <div className={styles.pageToolbar}>
        <button
          type="button"
          className={styles.bookmarkAdd}
          onClick={() => setEditingId(addBookmark(docId))}
          title="Add a bookmark for the current page (⌥⌘B)"
        >
          <BookmarkPlus size={14} /> {`Add Bookmark for Page ${activePage + 1}`}
        </button>
      </div>
      <div className={styles.annotationList}>
        {bookmarks.length === 0 && (
          <div className={styles.emptyPanel}>
            <span>No bookmarks yet</span>
            <span className={styles.emptyHint}>Bookmarks are saved into the PDF, so other PDF apps show them too.</span>
          </div>
        )}
        {bookmarks.map((bookmark) => (
          <div
            key={bookmark.id}
            className={`${styles.annotationRow} ${bookmark.pageIndex === activePage ? styles.bookmarkCurrent : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => editingId !== bookmark.id && goToPage(docId, bookmark.pageIndex)}
            onKeyDown={(event) => {
              if (editingId === bookmark.id) return;
              if (event.key === 'Enter') goToPage(docId, bookmark.pageIndex);
              if (event.key === 'F2') setEditingId(bookmark.id);
              if (event.key === 'Delete' || event.key === 'Backspace') deleteBookmark(docId, bookmark.id);
            }}
            onDoubleClick={() => setEditingId(bookmark.id)}
          >
            {editingId === bookmark.id ? (
              <input
                className={styles.bookmarkInput}
                defaultValue={bookmark.title}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.stopPropagation()}
                onBlur={(event) => {
                  renameBookmark(docId, bookmark.id, event.currentTarget.value);
                  setEditingId(null);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    event.currentTarget.value = bookmark.title;
                    event.currentTarget.blur();
                  }
                }}
                aria-label="Bookmark name"
                maxLength={200}
              />
            ) : (
              <span className={styles.annotationLabel} data-no-translate>{bookmark.title}</span>
            )}
            <span className={styles.outlinePage}>{bookmark.pageIndex + 1}</span>
            <button
              type="button"
              className={styles.rowButton}
              title="Rename"
              aria-label="Rename"
              onClick={(event) => {
                event.stopPropagation();
                setEditingId(bookmark.id);
              }}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              className={styles.rowButton}
              title="Delete"
              aria-label="Delete"
              onClick={(event) => {
                event.stopPropagation();
                deleteBookmark(docId, bookmark.id);
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
