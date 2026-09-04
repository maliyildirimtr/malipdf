/**
 * TopBar
 *
 * The macOS title / document tab bar. Document tabs use a roving tab stop,
 * remain reachable through an overflow menu, and preserve the Phase 2
 * document/session cleanup order when closed.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Check, FileText, MoreHorizontal, X } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { closeDocumentById } from '../../commands';
import styles from './TopBar.module.css';

const OVERFLOW_MEASUREMENT_TOLERANCE = 1;

export function TopBar() {
  const { documents, activeDocId, tabOrder, setActiveDocument } = useDocumentStore();

  const topBarRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const overflowItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const [hasOverflow, setHasOverflow] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const focusTab = useCallback((docId: string) => {
    requestAnimationFrame(() => {
      tabRefs.current.get(docId)?.focus();
    });
  }, []);

  const activateTab = useCallback((docId: string, moveFocus = false) => {
    setActiveDocument(docId);
    setOverflowOpen(false);
    if (moveFocus) focusTab(docId);
  }, [focusTab, setActiveDocument]);

  const measureOverflow = useCallback(() => {
    const topBar = topBarRef.current;
    const tabs = tabsRef.current;
    if (!topBar || !tabs) return;

    const computedStyle = window.getComputedStyle(topBar);
    const contentWidth = topBar.clientWidth
      - (Number.parseFloat(computedStyle.paddingLeft) || 0)
      - (Number.parseFloat(computedStyle.paddingRight) || 0);

    setHasOverflow(
      tabs.scrollWidth > contentWidth + OVERFLOW_MEASUREMENT_TOLERANCE,
    );
  }, []);

  useLayoutEffect(() => {
    measureOverflow();

    const topBar = topBarRef.current;
    const tabs = tabsRef.current;
    if (!topBar || !tabs || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(topBar);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [documents, measureOverflow, tabOrder]);

  useEffect(() => {
    if (!activeDocId) return;
    tabRefs.current.get(activeDocId)?.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeDocId, hasOverflow]);

  useEffect(() => {
    if (!hasOverflow) setOverflowOpen(false);
  }, [hasOverflow]);

  useEffect(() => {
    if (!overflowOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!overflowRef.current?.contains(event.target as Node)) {
        setOverflowOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOverflowOpen(false);
      overflowButtonRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [overflowOpen]);

  useEffect(() => {
    if (!overflowOpen) return;
    requestAnimationFrame(() => {
      const targetId = activeDocId ?? tabOrder[0];
      if (targetId) overflowItemRefs.current.get(targetId)?.focus();
    });
  }, [activeDocId, overflowOpen, tabOrder]);

  function handleClose(docId: string, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    closeDocumentById(docId);
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, docId: string) {
    const currentIndex = tabOrder.indexOf(docId);
    if (currentIndex < 0 || tabOrder.length === 0) return;

    let targetIndex: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        targetIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
        break;
      case 'ArrowRight':
        targetIndex = (currentIndex + 1) % tabOrder.length;
        break;
      case 'Home':
        targetIndex = 0;
        break;
      case 'End':
        targetIndex = tabOrder.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    activateTab(tabOrder[targetIndex], true);
  }

  function handleOverflowMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const availableDocIds = tabOrder.filter((docId) => documents.has(docId));
    if (availableDocIds.length === 0) return;

    const currentIndex = availableDocIds.findIndex(
      (docId) => overflowItemRefs.current.get(docId) === document.activeElement,
    );
    let targetIndex = currentIndex;

    if (event.key === 'ArrowDown') {
      targetIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % availableDocIds.length;
    } else if (event.key === 'ArrowUp') {
      targetIndex = currentIndex < 0
        ? availableDocIds.length - 1
        : (currentIndex - 1 + availableDocIds.length) % availableDocIds.length;
    } else if (event.key === 'Home') {
      targetIndex = 0;
    } else if (event.key === 'End') {
      targetIndex = availableDocIds.length - 1;
    }

    event.preventDefault();
    overflowItemRefs.current.get(availableDocIds[targetIndex])?.focus();
  }

  return (
    <div className={styles.topBar} ref={topBarRef}>
      <div className={styles.tabs} ref={tabsRef} role="tablist" aria-label="Open documents">
        {tabOrder.map((docId) => {
          const doc = documents.get(docId);
          if (!doc) return null;
          const isActive = docId === activeDocId;

          return (
            <div
              key={docId}
              className={`${styles.tabItem} ${isActive ? styles.tabItemActive : ''}`}
              role="presentation"
            >
              <button
                ref={(element) => {
                  if (element) tabRefs.current.set(docId, element);
                  else tabRefs.current.delete(docId);
                }}
                className={styles.tab}
                onClick={() => activateTab(docId)}
                onKeyDown={(event) => handleTabKeyDown(event, docId)}
                role="tab"
                id={`document-tab-${docId}`}
                aria-controls="document-workspace"
                aria-selected={isActive}
                aria-label={`${doc.title}${doc.isDirty ? ', modified' : ''}`}
                tabIndex={isActive ? 0 : -1}
                title={doc.filePath ?? doc.title}
                type="button"
              >
                <FileText size={13} className={styles.tabIcon} aria-hidden="true" />
                {doc.isDirty && <span className={styles.dirtyIndicator} aria-hidden="true" />}
                <span className={styles.tabTitle}>{doc.title}</span>
              </button>
              <button
                className={styles.tabClose}
                onClick={(event) => handleClose(docId, event)}
                aria-label={`Close ${doc.title}`}
                title={`Close ${doc.title}`}
                type="button"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      {hasOverflow && (
        <div className={styles.overflow} ref={overflowRef}>
          <button
            ref={overflowButtonRef}
            type="button"
            className={styles.overflowButton}
            aria-label={`Show all open documents (${tabOrder.length})`}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            title="Show all open documents"
            onClick={() => setOverflowOpen((open) => !open)}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>

          {overflowOpen && (
            <div
              className={styles.overflowMenu}
              role="menu"
              aria-label="Open documents"
              onKeyDown={handleOverflowMenuKeyDown}
            >
              {tabOrder.map((docId) => {
                const doc = documents.get(docId);
                if (!doc) return null;
                const isActive = docId === activeDocId;

                return (
                  <button
                    key={docId}
                    ref={(element) => {
                      if (element) overflowItemRefs.current.set(docId, element);
                      else overflowItemRefs.current.delete(docId);
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    aria-label={`${doc.title}${doc.isDirty ? ', modified' : ''}`}
                    tabIndex={isActive ? 0 : -1}
                    className={`${styles.overflowItem} ${isActive ? styles.overflowItemActive : ''}`}
                    onClick={() => activateTab(docId, true)}
                    title={doc.filePath ?? doc.title}
                  >
                    <span className={styles.overflowItemCheck} aria-hidden="true">
                      {isActive && <Check size={13} />}
                    </span>
                    <FileText size={14} aria-hidden="true" />
                    {doc.isDirty && <span className={styles.dirtyIndicator} aria-hidden="true" />}
                    <span className={styles.overflowItemTitle}>{doc.title}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
