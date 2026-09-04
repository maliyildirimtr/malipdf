import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import styles from './StatusBar.module.css';

export function StatusBar() {
  const { documents, activeDocId, setActivePage } = useDocumentStore();
  const activeDoc = activeDocId ? documents.get(activeDocId) : null;

  if (!activeDoc) {
    return (
      <footer className={styles.statusBar} aria-label="Application status">
        <span role="status">No document open</span>
        <span className={styles.spacer} />
        <span className={styles.brand}>MaliPDF</span>
      </footer>
    );
  }

  const { id: docId, instanceId, activePageIndex, pageCount, zoom, zoomMode, isDirty } = activeDoc;

  function goToPage(pageIndex: number) {
    const nextPage = Math.max(0, Math.min(pageCount - 1, pageIndex));
    setActivePage(docId, nextPage);
    document.querySelector(
      `[data-doc-id="${docId}"][data-instance-id="${instanceId}"][data-page-index="${nextPage}"]`,
    )?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const zoomLabel = zoomMode === 'fitWidth'
    ? `Fit Width · ${Math.round(zoom * 100)}%`
    : zoomMode === 'fitPage'
      ? `Fit Page · ${Math.round(zoom * 100)}%`
      : `${Math.round(zoom * 100)}%`;

  return (
    <footer className={styles.statusBar} aria-label="Document status">
      <div className={styles.pageNavigation} aria-label="Page navigation">
        <button
          className={styles.iconButton}
          onClick={() => goToPage(activePageIndex - 1)}
          disabled={activePageIndex === 0}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <span className={styles.pageCount} aria-live="polite">
          Page {activePageIndex + 1} of {pageCount}
        </span>
        <button
          className={styles.iconButton}
          onClick={() => goToPage(activePageIndex + 1)}
          disabled={activePageIndex === pageCount - 1}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>

      <span className={styles.separator} aria-hidden="true" />
      <span className={styles.zoomReadout}>{zoomLabel}</span>
      <span className={styles.spacer} />
      <span className={isDirty ? styles.edited : styles.saved} role="status" aria-live="polite">
        {isDirty ? 'Edited' : 'Document ready'}
      </span>
      <span className={styles.separator} aria-hidden="true" />
      <span className={styles.brand}>MaliPDF</span>
    </footer>
  );
}
