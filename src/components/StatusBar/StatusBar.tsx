import React from 'react';
import { ChevronLeft, ChevronRight, Columns2, Focus, Maximize2, Scan, Square, type LucideIcon } from 'lucide-react';
import type { AppCommandId } from '../../commands';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  onCommand?: (commandId: AppCommandId) => void;
  canExecute?: (commandId: AppCommandId) => boolean;
}

export function StatusBar({ onCommand, canExecute }: StatusBarProps = {}) {
  const { documents, activeDocId, setActivePage } = useDocumentStore();
  const activeDoc = activeDocId ? documents.get(activeDocId) : null;
  const splitOpen = useUIStore((s) => s.splitView !== null);
  const focusMode = useUIStore((s) => s.workspaceMode === 'focus');

  if (!activeDoc) {
    return (
      <footer className={styles.statusBar} aria-label="Application status">
        <span role="status">No document open</span>
        <span className={styles.spacer} />
        <span className={styles.brand}>MaliPDF</span>
      </footer>
    );
  }

  const { id: docId, instanceId, activePageIndex, pageCount, zoom, zoomMode, currentStateId, savedStateId } = activeDoc;
  const isDirty = currentStateId !== savedStateId;

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
      {onCommand && (
        <>
          <div className={styles.viewControls} role="group" aria-label="Page fit">
            <StatusButton commandId="view.actualSize" label="Actual Size" shortcut="⌘0" icon={Scan} onCommand={onCommand} canExecute={canExecute} />
            <StatusButton commandId="view.fitWidth" label="Fit Width" shortcut="⌘6" icon={Maximize2} onCommand={onCommand} canExecute={canExecute} pressed={zoomMode === 'fitWidth'} />
            <StatusButton commandId="view.fitPage" label="Fit Page" shortcut="⌘5" icon={Square} onCommand={onCommand} canExecute={canExecute} pressed={zoomMode === 'fitPage'} />
          </div>
          <span className={styles.separator} aria-hidden="true" />
          <div className={styles.viewControls} role="group" aria-label="Layout">
            <StatusButton commandId="view.splitView" label="Side by Side" shortcut={"⌥⌘\\"} icon={Columns2} onCommand={onCommand} canExecute={canExecute} pressed={splitOpen} />
            <StatusButton commandId="view.focusMode" label="Focus / Teaching Mode" shortcut="⌥⌘F" icon={Focus} onCommand={onCommand} canExecute={canExecute} pressed={focusMode} />
          </div>
          <span className={styles.separator} aria-hidden="true" />
        </>
      )}
      <span className={isDirty ? styles.edited : styles.saved} role="status" aria-live="polite">
        {isDirty ? 'Edited' : 'Document ready'}
      </span>
      <span className={styles.separator} aria-hidden="true" />
      <span className={styles.brand}>MaliPDF</span>
    </footer>
  );
}

function StatusButton({ commandId, label, shortcut, icon: Icon, onCommand, canExecute, pressed }: {
  commandId: AppCommandId;
  label: string;
  shortcut: string;
  icon: LucideIcon;
  onCommand: (commandId: AppCommandId) => void;
  canExecute?: (commandId: AppCommandId) => boolean;
  pressed?: boolean;
}) {
  const enabled = canExecute ? canExecute(commandId) : true;
  const title = `${label} (${shortcut})`;
  return (
    <button
      type="button"
      className={`${styles.iconButton} ${pressed ? styles.iconButtonOn : ''}`}
      onClick={() => enabled && onCommand(commandId)}
      disabled={!enabled}
      aria-label={title}
      aria-pressed={pressed === undefined ? undefined : pressed}
      title={title}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}
