/**
 * App root component.
 *
 * Layout:
 *   TopBar (document tabs)
 *   MainRibbon (commands + contextual tool properties)
 *   MainLayout
 *     PageSidebar (thumbnail strip + panels)
 *     DocumentArea (scrollable PDF canvas)
 *   StatusBar (page nav, zoom, undo/redo)
 *
 * Also manages:
 * - Theme application (data-theme attribute on document element)
 * - System theme detection
 * - One shared command path for toolbar, keyboard and Electron menu actions
 * - Export status toast notifications
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar/TopBar';
import { MainRibbon } from './components/MainRibbon/MainRibbon';
import { PageSidebar } from './components/PageSidebar/PageSidebar';
import { DocumentArea } from './components/DocumentArea/DocumentArea';
import { StatusBar } from './components/StatusBar/StatusBar';
import { FocusToolbar } from './components/FocusToolbar/FocusToolbar';
import { useUIStore } from './store/uiStore';
import { useDocumentStore } from './store/documentStore';
import { useAnnotationStore } from './store/annotationStore';
import { useAssetStore } from './store/assetStore';
import { useImportJobStore } from './store/importJobStore';
import { exportAndSave, loadDefaultExportFonts } from './pdf/annotationExporter';
import { useAppCommands } from './commands';
import { NewDocumentDialog } from './components/NewDocumentDialog/NewDocumentDialog';

// ─── Export toast ─────────────────────────────────────────────────────────────

type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let toastCounter = 0;

// ─── Import Job Overlay ───────────────────────────────────────────────────────

function ImportJobOverlay() {
  const { job, cancelJob, clearJob } = useImportJobStore();

  if (!job) return null;

  return (
    <div style={styles.importOverlay}>
      <div style={styles.importBox}>
        <div style={styles.importHeader}>
          <strong>{job.status === 'failed' ? 'Printout Import' : 'Importing Printout…'}</strong>
          {job.status === 'failed' ? (
            <span style={{ color: '#fca5a5' }}>Failed</span>
          ) : job.status === 'cancelled' ? (
            <span style={{ color: '#fca5a5' }}>Cancelled</span>
          ) : job.status === 'converting' ? (
            <span>Converting...</span>
          ) : job.status === 'committing' ? (
            <span style={{ color: '#6ee7b7' }}>Committing...</span>
          ) : job.status === 'completed' ? (
            <span style={{ color: '#6ee7b7' }}>Completed</span>
          ) : (
            <span>
              {job.completedPages} / {job.totalPages || '?'}
            </span>
          )}
        </div>
        {job.errorMessage && (
          <div style={{ color: '#fca5a5', marginTop: 4, fontSize: 12 }}>
            {job.errorMessage}
          </div>
        )}
        {(job.status === 'loading' || job.status === 'converting' || job.status === 'preparing' || job.status === 'rendering') && (
          <button style={styles.cancelButton} onClick={cancelJob}>
            Cancel
          </button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled' || job.status === 'completed') && (
          <button style={styles.cancelButton} onClick={clearJob}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

// ─── App component ────────────────────────────────────────────────────────────

export default function App() {
  const { theme, resolvedTheme, setResolvedTheme, workspaceMode } = useUIStore();
  const { documents, activeDocId } = useDocumentStore();
  const { docAnnotations } = useAnnotationStore();

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const exportingRef = useRef(false); // prevent double-trigger from menu

  // ── Toast helpers ──────────────────────────────────────────────────────

  const showToast = useCallback((kind: ToastKind, message: string) => {
    const id = ++toastCounter;
    setToasts(t => [...t, { id, kind, message }]);
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, 4000);
  }, []);

  // ── Theme management ───────────────────────────────────────────────────

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme() {
      let resolved: 'light' | 'dark';
      if (theme === 'system') {
        resolved = mediaQuery.matches ? 'dark' : 'light';
      } else {
        resolved = theme;
      }
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    }

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [theme, setResolvedTheme]);

  // ── Save error surfacing ───────────────────────────────────────────────
  // saveCommands records failures on the document; show each new one once.

  useEffect(() => {
    return useDocumentStore.subscribe((state, previous) => {
      for (const doc of state.documents.values()) {
        if (doc.saveStatus !== 'error') continue;
        const before = previous.documents.get(doc.id);
        if (before?.saveStatus === 'error' && before.lastSaveError === doc.lastSaveError) continue;
        showToast('error', `Save failed (${doc.title}): ${doc.lastSaveError ?? 'Unknown error'}`);
      }
    });
  }, [showToast]);

  // ── Export PDF handler ────────────────────────────────────────────────

  const handleExportPdf = useCallback(async () => {
    if (exportingRef.current) return;
    if (!activeDocId) {
      showToast('error', 'No document open to export.');
      return;
    }

    const activeDoc = documents.get(activeDocId);
    if (!activeDoc) {
      showToast('error', 'Document not found.');
      return;
    }

    const docAnnotState = docAnnotations.get(activeDocId);
    if (!docAnnotState) {
      showToast('error', 'Annotation data not found.');
      return;
    }

    exportingRef.current = true;
    setIsExporting(true);
    showToast('info', 'Preparing export…');

    try {
      const baseName = activeDoc.title.replace(/\.pdf$/i, '') + '_annotated.pdf';
      const assets = useAssetStore.getState().getAssetsForDocument({ docId: activeDoc.id, instanceId: activeDoc.instanceId });
      const hasText = [...docAnnotState.pages.values()].some((page) => page.annotations.some((a) => a.type === 'text'));
      const fonts = hasText ? await loadDefaultExportFonts() : undefined;
      const saved = await exportAndSave(activeDoc.sourceData, docAnnotState, baseName, { assets, fonts });
      if (saved) {
        showToast('success', 'PDF exported successfully.');
      }
      // If not saved, user cancelled — no message needed
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('error', `Export failed: ${message}`);
    } finally {
      exportingRef.current = false;
      setIsExporting(false);
    }
  }, [activeDocId, documents, docAnnotations, showToast]);

  const { executeCommand, canExecute } = useAppCommands({ onExport: handleExportPdf });

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="app-root" data-theme={resolvedTheme} data-workspace-mode={workspaceMode}>
      <div className="app-top-chrome">
        <TopBar />
        <MainRibbon onCommand={executeCommand} canExecute={canExecute} />
      </div>
      <div
        className="main-layout"
        id="document-workspace"
        role="tabpanel"
        aria-labelledby={activeDocId ? `document-tab-${activeDocId}` : undefined}
        aria-label={activeDocId ? undefined : 'MaliPDF document workspace'}
      >
        <div className="app-sidebar-chrome">
          <PageSidebar />
        </div>
        <DocumentArea />
      </div>
      <div className="app-status-chrome">
        <StatusBar />
      </div>
      <FocusToolbar onCommand={executeCommand} canExecute={canExecute} />
      
      <NewDocumentDialog />

      {/* Export toasts */}
      <div style={styles.toastContainer}>
        {toasts.map(toast => (
          <div key={toast.id} style={{ ...styles.toast, ...styles[toast.kind] }}>
            {toast.kind === 'info' && isExporting && (
              <span style={styles.spinner} />
            )}
            {toast.message}
          </div>
        ))}
      </div>
      <ImportJobOverlay />
    </div>
  );
}

// ─── Inline toast styles ──────────────────────────────────────────────────────

const styles = {
  toastContainer: {
    position: 'fixed' as const,
    bottom: 40,
    right: 24,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    zIndex: 9999,
    pointerEvents: 'none' as const,
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: 'var(--font-sans, system-ui)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    animation: 'fadeIn 0.15s ease',
    maxWidth: 340,
    lineHeight: 1.4,
  },
  info: {
    background: 'rgba(30,30,40,0.95)',
    color: '#e0e0f0',
    border: '1px solid rgba(100,100,140,0.3)',
  },
  success: {
    background: 'rgba(20,40,30,0.97)',
    color: '#6ee7b7',
    border: '1px solid rgba(52,211,153,0.3)',
  },
  error: {
    background: 'rgba(40,15,15,0.97)',
    color: '#fca5a5',
    border: '1px solid rgba(252,165,165,0.3)',
  },
  spinner: {
    display: 'inline-block',
    width: 12,
    height: 12,
    borderRadius: '50%',
    border: '2px solid rgba(160,160,200,0.3)',
    borderTopColor: '#a0a0c8',
    animation: 'spin 0.7s linear infinite',
    flexShrink: 0,
  },
  importOverlay: {
    position: 'fixed' as const,
    top: 60,
    right: 24,
    zIndex: 9999,
  },
  importBox: {
    background: 'rgba(30,30,40,0.95)',
    color: '#e0e0f0',
    border: '1px solid rgba(100,100,140,0.3)',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: 'var(--font-sans, system-ui)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    minWidth: 200,
  },
  importHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  cancelButton: {
    background: 'transparent',
    border: '1px solid rgba(252,165,165,0.5)',
    color: '#fca5a5',
    padding: '4px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    alignSelf: 'flex-end',
  }
} as const;

