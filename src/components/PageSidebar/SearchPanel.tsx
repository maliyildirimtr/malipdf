/** Sidebar text search (⌘F): query box, count, previous/next, result list. */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useSearchStore } from '../../store/searchStore';
import { useDocumentStore } from '../../store/documentStore';
import { sameDocumentIdentity, type DocumentIdentity } from '../../types/documentSession';
import styles from './PageSidebar.module.css';

const SEARCH_DEBOUNCE_MS = 250;

export function SearchPanel({ identity }: { identity: DocumentIdentity }) {
  const query = useSearchStore((s) => s.query);
  const results = useSearchStore((s) => s.results);
  const currentIndex = useSearchStore((s) => s.currentIndex);
  const status = useSearchStore((s) => s.status);
  const searchedPages = useSearchStore((s) => s.searchedPages);
  const totalPages = useSearchStore((s) => s.totalPages);
  const searchIdentity = useSearchStore((s) => s.identity);
  const focusRequest = useSearchStore((s) => s.focusRequest);
  const { search, next, previous, select, clear } = useSearchStore.getState();

  const [draft, setDraft] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘F focuses the box (also when the panel was already open).
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  // Re-run for the active document (tab switch) and after page edits.
  const sourceRevision = useDocumentStore((s) => s.documents.get(identity.docId)?.sourceRevision);
  const firstRun = useRef(true);
  useEffect(() => {
    const identityChanged = !sameDocumentIdentity(searchIdentity, identity);
    if (draft.trim() && (identityChanged || !firstRun.current)) {
      // Give the pdf.js reload of the new bytes a moment to finish.
      const timer = setTimeout(() => void search(identity, draft), identityChanged ? 0 : 400);
      firstRun.current = false;
      return () => clearTimeout(timer);
    }
    firstRun.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.docId, identity.instanceId, sourceRevision]);

  // Debounced search while typing.
  useEffect(() => {
    if (draft === query && sameDocumentIdentity(searchIdentity, identity)) return;
    const timer = setTimeout(() => void search(identity, draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Bring the current match into view.
  useEffect(() => {
    const match = results[currentIndex];
    if (!match) return;
    useDocumentStore.getState().setActivePage(identity.docId, match.pageIndex);
    document.querySelector(
      `[data-doc-id="${identity.docId}"][data-instance-id="${identity.instanceId}"][data-page-index="${match.pageIndex}"]`,
    )?.scrollIntoView({ block: 'center' });
    // Once the page is rendered, centre the highlight itself.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        document.querySelector('[data-search-current="true"]')?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, results.length > 0 && currentIndex >= 0 ? results[currentIndex] : null]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) previous();
      else next();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft('');
      clear();
      inputRef.current?.blur();
    }
  };

  const count = results.length;
  const countLabel = !query.trim()
    ? ''
    : status === 'searching'
      ? `${count} found… (${searchedPages}/${totalPages})`
      : count === 0
        ? 'No results'
        : `${currentIndex + 1} / ${count}`;

  return (
    <div className={styles.searchPanel}>
      <div className={styles.searchBox}>
        <input
          ref={inputRef}
          type="search"
          value={draft}
          placeholder="Search text"
          aria-label="Search text in document"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          className={styles.searchInput}
        />
        {draft && (
          <button type="button" className={styles.rowButton} aria-label="Clear search" onClick={() => { setDraft(''); clear(); }}>
            <X size={13} />
          </button>
        )}
      </div>
      <div className={styles.searchNav}>
        <span className={styles.searchCount} aria-live="polite">{countLabel}</span>
        <button type="button" className={styles.rowButton} aria-label="Previous result (Shift+Enter)" disabled={count === 0} onClick={previous}>
          <ChevronUp size={14} />
        </button>
        <button type="button" className={styles.rowButton} aria-label="Next result (Enter)" disabled={count === 0} onClick={next}>
          <ChevronDown size={14} />
        </button>
      </div>
      <div className={styles.annotationList}>
        {results.map((match, index) => (
          <button
            key={index}
            type="button"
            className={`${styles.searchResult} ${index === currentIndex ? styles.searchResultActive : ''}`}
            onClick={() => select(index)}
          >
            <span className={styles.searchResultPage}>Page {match.pageIndex + 1}</span>
            <span className={styles.searchResultSnippet}>{match.snippet}</span>
          </button>
        ))}
        {query.trim() && status === 'done' && count === 0 && (
          <p className={styles.annotationHint}>
            No matches. Scanned PDFs without a text layer (no OCR) cannot be searched.
          </p>
        )}
      </div>
    </div>
  );
}
