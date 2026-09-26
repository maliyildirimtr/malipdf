import { useCallback, useEffect } from 'react';
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore, makeRemoveAction, makeBatchAction } from '../store/historyStore';
import { useUIStore } from '../store/uiStore';
import { useSelectionStore } from '../store/selectionStore';
import { useDocumentSessionStore, documentSessionStore } from '../store/documentSessionStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useSearchStore } from '../store/searchStore';
import {
  APP_COMMANDS,
  isAppCommandId,
  isCommandAvailable,
  isCommandChecked,
  type AppCommandId,
  type CommandAvailabilityContext,
} from './commandRegistry';
import { executeRedo, executeUndo } from './historyCommands';
import { closeAllDocuments, closeDocumentById } from './documentCommands';
import { saveDocument, saveDocumentAs, saveAllDocuments } from './saveCommands';
import {
  getToolForKeyboardEvent,
  isEditableTarget,
  isImeKeyboardEvent,
  isTemporaryHandShortcut,
} from './keyboardShortcuts';
import { requestActiveInteractionCancellation } from './interactionCancellation';
import {
  copySelection,
  cutSelection,
  duplicateSelection,
  getActiveSelection,
  isOwnClipboardMarker,
  pasteAnnotations,
} from './clipboardCommands';
import { SHOW_RECOVERY_EVENT } from '../components/RecoveryDialog/recoveryEvents';
import { OPEN_SIGN_MENU_EVENT } from '../components/SignStamp/signStampEvents';

/** Custom clipboard type that carries the annotation marker next to plain text. */
const ANNOTATION_CLIPBOARD_TYPE = 'application/x-malipdf-annotations';
import { REPLAY_INK_EVENT } from '../components/AnnotationCanvas/replayEvents';
import {
  insertImageFromFile,
  captureScreenToImage,
  captureRegionToImage,
  insertImageFromBytes,
} from './imageCommands';

export const DOCUMENT_VIEW_COMMAND_EVENT = 'malipdf:document-view-command';

export type DocumentViewCommandId = 'view.fitWidth' | 'view.fitPage';

interface UseAppCommandsOptions {
  onExport: () => void;
}

export interface AppCommandController {
  executeCommand: (commandId: AppCommandId) => void;
  canExecute: (commandId: AppCommandId) => boolean;
}

function currentAvailabilityContext(): CommandAvailabilityContext {
  const documents = useDocumentStore.getState();
  const history = useHistoryStore.getState();
  const sessions = documentSessionStore.getState();
  const selections = useSelectionStore.getState();
  
  const activeDocId = documents.activeDocId;
  const activeDoc = activeDocId ? documents.documents.get(activeDocId) : undefined;
  const activeIdentity = sessions.activeIdentity;
  
  let hasSelection = false;
  if (activeIdentity) {
    const sel = selections.getSelection(activeIdentity);
    if (sel && sel.selectedIds.length > 0) hasSelection = true;
  }
  
  let hasAnyDirtyDocument = false;
  for (const doc of documents.documents.values()) {
    if (doc.currentStateId !== doc.savedStateId) {
      hasAnyDirtyDocument = true;
      break;
    }
  }

  return {
    hasDocument: activeDocId !== null,
    canUndo: activeDocId ? history.canUndo(activeDocId) : false,
    canRedo: activeDocId ? history.canRedo(activeDocId) : false,
    hasSelection,
    isDirty: activeDoc ? activeDoc.currentStateId !== activeDoc.savedStateId : false,
    hasAnyDirtyDocument,
  };
}

export function useAppCommands({ onExport }: UseAppCommandsOptions): AppCommandController {
  const activeDocId = useDocumentStore((state) => state.activeDocId);
  const histories = useHistoryStore((state) => state.histories);
  const workspaceMode = useUIStore((state) => state.workspaceMode);
  const activeTool = useUIStore((state) => state.activeTool);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);

  const canExecute = useCallback((commandId: AppCommandId) => {
    if (commandId === 'view.focusMode' && workspaceMode === 'focus') return true;
    return isCommandAvailable(commandId, currentAvailabilityContext());
  }, [workspaceMode]);

  const executeCommand = useCallback((commandId: AppCommandId, payload?: unknown) => {
    const ui = useUIStore.getState();
    const documents = useDocumentStore.getState();
    const docId = documents.activeDocId;
    const definition = APP_COMMANDS[commandId];

    if (!(commandId === 'view.focusMode' && ui.workspaceMode === 'focus')
      && !isCommandAvailable(commandId, currentAvailabilityContext())) {
      return;
    }

    if (definition.tool) {
      if (definition.tool !== ui.activeTool) {
        const activeIdentity = documentSessionStore.getState().activeIdentity;
        if (activeIdentity) useSelectionStore.getState().clearSelection(activeIdentity);
      }
      ui.setActiveTool(definition.tool);
      return;
    }

    switch (commandId) {
      case 'file.open':
        document.dispatchEvent(new CustomEvent('app:openFile'));
        return;
      case 'file.recoveredDocuments':
        window.dispatchEvent(new CustomEvent(SHOW_RECOVERY_EVENT));
        return;
      case 'help.checkForUpdates':
        void window.electronAPI?.checkForUpdates?.();
        return;
      case 'help.about':
        void window.electronAPI?.showAbout?.();
        return;
      case 'help.crashReports':
        void window.electronAPI?.openCrashReports?.();
        return;
      case 'file.close':
        if (docId) void closeDocumentById(docId);
        return;
      case 'file.closeAll':
        void closeAllDocuments();
        return;
      case 'app.requestQuit':
        if (typeof payload !== 'string') return;
        void closeAllDocuments().then((closed) => {
          if (useDocumentStore.getState().tabOrder.length === 0) {
            window.electronAPI.confirmLifecycle(payload, true);
          } else {
            window.electronAPI.confirmLifecycle(payload, false);
          }
        });
        return;
      case 'app.requestCloseWindow':
        if (typeof payload !== 'string') return;
        void closeAllDocuments().then((closed) => {
          if (useDocumentStore.getState().tabOrder.length === 0) {
            window.electronAPI.confirmLifecycle(payload, true);
          } else {
            window.electronAPI.confirmLifecycle(payload, false);
          }
        });
        return;
      case 'file.export':
        onExport();
        return;
      case 'file.new':
        ui.setNewDocumentDialogOpen(true);
        return;
      case 'file.combine':
        void import('./combineSplitCommands').then((m) => m.combineFiles());
        return;
      case 'page.split':
        ui.setSplitDialogOpen(true);
        return;
      case 'app.settings':
        ui.setSettingsOpen(true);
        return;
      case 'file.save':
        if (docId) void saveDocument(docId);
        return;
      case 'file.saveAs':
        if (docId) void saveDocumentAs(docId);
        return;
      case 'file.saveTemplate':
        return;
      case 'file.saveAll':
        void saveAllDocuments();
        return;
      case 'file.print':
        void import('./printCommands').then(({ printDocument }) => printDocument());
        return;
      case 'file.documentProperties':
      case 'edit.selectAll':
        return;
      case 'edit.deleteSelected': {
        const session = documentSessionStore.getState();
        const selectionStore = useSelectionStore.getState();
        const activeIdentity = session.activeIdentity;
        if (!activeIdentity || !docId) return;
        
        const sel = selectionStore.getSelection(activeIdentity);
        if (!sel || sel.selectedIds.length === 0 || sel.pageIndex === null) return;
        
        const annotationsStore = useAnnotationStore.getState();
        const historyStore = useHistoryStore.getState();
        const annotations = annotationsStore.getPageAnnotations(docId, sel.pageIndex);
        const selected = new Set(sel.selectedIds);

        // Remove in z-order and record each position against the list as it
        // is at that moment, so undo re-inserts every annotation exactly.
        const remaining: typeof annotations = [];
        const actions: import('../store/historyStore').HistoryActionDraft[] = [];
        for (const ann of annotations) {
          if (!selected.has(ann.id)) {
            remaining.push(ann);
            continue;
          }
          actions.push(makeRemoveAction(docId, ann, remaining.length));
        }

        if (actions.length > 0) {
          annotationsStore.setPageAnnotations(docId, sel.pageIndex, remaining);
          historyStore.push(actions.length === 1 ? actions[0] : makeBatchAction(docId, actions));
        }

        selectionStore.clearSelection(activeIdentity);
        return;
      }
      case 'page.insertBlank':
        void import('./pageCommands').then((m) => m.insertBlankPage());
        return;
      case 'page.insertNotePage':
        ui.setNotePageDialogOpen(true);
        return;
      case 'page.duplicate':
        void import('./pageCommands').then((m) => m.duplicatePages());
        return;
      case 'page.delete':
        void import('./pageCommands').then((m) => m.deletePages());
        return;
      case 'page.rotateLeft':
        void import('./pageCommands').then((m) => m.rotatePages(-90));
        return;
      case 'page.rotateRight':
        void import('./pageCommands').then((m) => m.rotatePages(90));
        return;
      case 'page.insertFromPdf':
        void import('./pageCommands').then((m) => m.insertPagesFromPdf());
        return;
      case 'page.exportSelected':
        void import('./pageCommands').then((m) => m.exportSelectedPages());
        return;
      case 'edit.find':
      case 'view.sidebarSearch':
        ui.setActiveSidebarPanel('search');
        ui.setSidebarOpen(true);
        useSearchStore.getState().requestFocus();
        return;
      case 'edit.duplicate':
        duplicateSelection();
        return;
      case 'tool.extractText':
      case 'tool.zoom':
      case 'tool.stamp':
      case 'tool.dimension':
      case 'tool.snapshot':
      case 'tool.crop':
      case 'tool.measure':
      case 'tool.formula':
      case 'tool.pointer':
        return;
      case 'insert.image':
        void insertImageFromFile();
        return;
      case 'insert.printoutPdf':
        import('./printoutCommands').then(m => m.insertPrintoutFromFile());
        return;
      case 'insert.printoutPptx':
        import('./printoutCommands').then(m => m.insertPptxPrintoutFromFile());
        return;
      case 'insert.formula':
        ui.setFormulaDialog({});
        return;
      case 'insert.signature':
        window.dispatchEvent(new CustomEvent(OPEN_SIGN_MENU_EVENT));
        return;
      case 'insert.screenshot':
        void captureScreenToImage();
        return;
      case 'insert.regionScreenshot':
        void captureRegionToImage();
        return;
      case 'view.sidebarBookmarks':
      case 'view.sidebarOutline':
        ui.setActiveSidebarPanel(commandId === 'view.sidebarBookmarks' ? 'bookmarks' : 'outline');
        ui.setSidebarOpen(true);
        return;
      case 'view.ruler':
        void import('../store/rulerStore').then(({ useRulerStore }) => useRulerStore.getState().toggle());
        return;
      case 'page.ocrPage':
        void import('./ocrCommands').then((m) => m.recognizeText('page'));
        return;
      case 'page.ocrAll':
        void import('./ocrCommands').then((m) => m.recognizeText('all'));
        return;
      case 'edit.inkToText':
        void import('./ocrCommands').then((m) => m.convertInkToText());
        return;
      case 'view.nightMode':
        ui.setPageTheme(ui.pageTheme === 'dark' ? 'normal' : 'dark');
        return;
      case 'view.presentation':
        ui.setPresentationOpen(true);
        return;
      case 'view.replayInk': {
        const doc = docId ? documents.documents.get(docId) : null;
        if (doc) {
          window.dispatchEvent(new CustomEvent(REPLAY_INK_EVENT, { detail: { docId: doc.id, pageIndex: doc.activePageIndex } }));
        }
        return;
      }
      case 'page.addBookmark':
        if (docId) {
          void import('./bookmarkCommands').then(({ addBookmark }) => {
            addBookmark(docId);
            ui.setActiveSidebarPanel('bookmarks');
            ui.setSidebarOpen(true);
          });
        }
        return;
      case 'view.layoutSingle':
      case 'view.layoutTwoPage':
      case 'view.annotations':
      case 'view.primaryToolbar':
      case 'view.propertyShelf':
      case 'view.statusBar':
      case 'extras.favorites':
      case 'extras.toolStyles':
      case 'help.open':
        return;
      case 'history.undo':
      case 'history.redo': {
        // ⌘Z inside a text field edits that field, not the document history.
        if (isEditableTarget(document.activeElement)) {
          document.execCommand(commandId === 'history.undo' ? 'undo' : 'redo');
          return;
        }
        // Never rewrite history under an in-progress gesture (drag, erase, …).
        if (ui.isDrawing) return;
        if (!docId) return;
        if (commandId === 'history.undo') executeUndo(docId);
        else executeRedo(docId);
        return;
      }
      case 'view.sidebar':
        ui.toggleSidebar();
        return;
      case 'view.sidebarPages':
        ui.setActiveSidebarPanel('pages');
        ui.setSidebarOpen(true);
        return;
      case 'view.sidebarAnnotations':
        ui.setActiveSidebarPanel('annotations');
        ui.setSidebarOpen(true);
        return;
      case 'view.zoomIn': {
        const doc = docId ? documents.documents.get(docId) : null;
        if (doc) documents.setZoom(doc.id, Math.min(8, doc.zoom * 1.2));
        return;
      }
      case 'view.zoomOut': {
        const doc = docId ? documents.documents.get(docId) : null;
        if (doc) documents.setZoom(doc.id, Math.max(0.1, doc.zoom / 1.2));
        return;
      }
      case 'view.actualSize':
        if (docId) documents.setZoom(docId, 1);
        return;
      case 'view.layoutContinuous':
        // Continuous single-page layout is the current and only layout mode.
        return;
      case 'view.fitWidth':
      case 'view.fitPage':
        document.dispatchEvent(new CustomEvent<DocumentViewCommandId>(
          DOCUMENT_VIEW_COMMAND_EVENT,
          { detail: commandId },
        ));
        return;
      case 'view.rotateCCW': {
        const doc = docId ? documents.documents.get(docId) : null;
        if (doc) documents.rotatePage(doc.id, doc.activePageIndex, -1);
        return;
      }
      case 'view.rotateCW': {
        const doc = docId ? documents.documents.get(docId) : null;
        if (doc) documents.rotatePage(doc.id, doc.activePageIndex, 1);
        return;
      }
      case 'view.focusMode':
        ui.toggleFocusMode();
        return;
      case 'view.nativeFullscreen':
        void window.electronAPI?.toggleFullScreen();
        return;
    }
  }, [onExport]);

  useEffect(() => {
    if (!window.electronAPI?.onCommand) return;
    return window.electronAPI.onCommand((commandId: unknown, payload?: unknown) => {
      if (isAppCommandId(commandId)) executeCommand(commandId, payload);
    });
  }, [executeCommand]);

  useEffect(() => {
    if (!window.electronAPI?.updateCommandStates) return;

    // Native menu enabled/checked state is derived from four stores. Recompute
    // on any of their changes, but only cross IPC when something actually
    // changed (scrolling alone updates documentStore on every frame).
    let lastSent = '';
    const syncMenuState = () => {
      const context = {
        ...currentAvailabilityContext(),
        activeTool: useUIStore.getState().activeTool,
        sidebarOpen: useUIStore.getState().sidebarOpen,
        workspaceMode: useUIStore.getState().workspaceMode,
        nightMode: useUIStore.getState().pageTheme === 'dark',
      };
      const states = (Object.keys(APP_COMMANDS) as AppCommandId[]).map((commandId) => ({
        commandId,
        enabled: isCommandAvailable(commandId, context),
        checked: isCommandChecked(commandId, context),
      }));
      const serialized = JSON.stringify(states);
      if (serialized === lastSent) return;
      lastSent = serialized;
      window.electronAPI.updateCommandStates(states);
    };

    const unsubscribers = [
      useDocumentStore.subscribe(syncMenuState),
      useHistoryStore.subscribe(syncMenuState),
      useUIStore.subscribe(syncMenuState),
      useSelectionStore.subscribe(syncMenuState),
      documentSessionStore.subscribe(syncMenuState),
    ];
    syncMenuState();

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || isImeKeyboardEvent(event)) return;

      if (isTemporaryHandShortcut(event)) {
        const ui = useUIStore.getState();
        if (!ui.isDrawing && ui.activeTool !== 'hand') {
          ui.setTemporaryTool('hand');
        }
        event.preventDefault();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === ',' && !event.altKey && !event.shiftKey) {
        executeCommand('app.settings');
        event.preventDefault();
        return;
      }

      const tool = getToolForKeyboardEvent(event);
      if (tool) {
        executeCommand(`tool.${tool}`);
        event.preventDefault();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!isEditableTarget(event.target)) {
          executeCommand('edit.deleteSelected');
          event.preventDefault();
          return;
        }
      }

      // ⌘V is handled only by the 'paste' listener below (the native Edit ▸
      // Paste role fires it). Handling the keydown too inserted images twice.

      if (event.key === 'Escape'
        && !isEditableTarget(event.target)
        && useUIStore.getState().workspaceMode === 'focus') {
        if (requestActiveInteractionCancellation(document)) {
          event.preventDefault();
          return;
        }
        executeCommand('view.focusMode');
        event.preventDefault();
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (!(event.key === ' ' || event.key === 'Spacebar' || event.key === 'Space')) return;
      const ui = useUIStore.getState();
      if (ui.temporaryTool === null) return;
      ui.setTemporaryTool(null);
      event.preventDefault();
    }

    function onWindowBlur() {
      useUIStore.getState().setTemporaryTool(null);
    }

    // ⌘C / ⌘X arrive as DOM copy/cut events (native Edit menu roles), so text
    // fields keep their normal behaviour and annotations use the same keys.
    function onCopyOrCut(event: ClipboardEvent) {
      const selection = getActiveSelection();
      if (isEditableTarget(event.target) || !selection) return;
      // Copying text highlights puts their text on the clipboard for other apps.
      const markedText = selection.annotations.every((a) => a.type === 'markup')
        ? selection.annotations.map((a) => (a.type === 'markup' ? a.text : '')).filter(Boolean).join('\n')
        : '';
      const marker = event.type === 'cut' ? cutSelection() : copySelection();
      if (!marker) return;
      event.clipboardData?.setData('text/plain', markedText || marker);
      event.clipboardData?.setData(ANNOTATION_CLIPBOARD_TYPE, marker);
      event.preventDefault();
    }

    async function onPaste(event: ClipboardEvent) {
      if (isEditableTarget(event.target)) {
        return;
      }

      // Annotations copied in MaliPDF (the system clipboard still holds our marker).
      if (isOwnClipboardMarker(event.clipboardData?.getData(ANNOTATION_CLIPBOARD_TYPE))
        || isOwnClipboardMarker(event.clipboardData?.getData('text/plain'))) {
        event.preventDefault();
        useUIStore.getState().setActiveTool('select');
        pasteAnnotations();
        return;
      }

      if (event.clipboardData && event.clipboardData.items) {
        for (let i = 0; i < event.clipboardData.items.length; i++) {
          const item = event.clipboardData.items[i];
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              const buffer = await file.arrayBuffer();
              void insertImageFromBytes(buffer, file.type || item.type);
              return;
            }
          }
        }
      }

      if (window.electronAPI?.readClipboardImage) {
        const clip = await window.electronAPI.readClipboardImage();
        if (clip && clip.data && clip.data.byteLength > 0) {
          event.preventDefault();
          void insertImageFromBytes(clip.data, clip.mimeType || 'image/png');
          return;
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('paste', onPaste);
    window.addEventListener('copy', onCopyOrCut);
    window.addEventListener('cut', onCopyOrCut);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('copy', onCopyOrCut);
      window.removeEventListener('cut', onCopyOrCut);
      useUIStore.getState().setTemporaryTool(null);
    };
  }, [executeCommand]);

  return { executeCommand, canExecute };
}

