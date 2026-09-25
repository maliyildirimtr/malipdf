import { useCallback, useEffect } from 'react';
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore, makeRemoveAction, makeBatchAction } from '../store/historyStore';
import { useUIStore } from '../store/uiStore';
import { useSelectionStore } from '../store/selectionStore';
import { useDocumentSessionStore, documentSessionStore } from '../store/documentSessionStore';
import { useAnnotationStore } from '../store/annotationStore';
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
      case 'file.documentProperties':
      case 'file.print':
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
        
        const actions: import('../store/historyStore').HistoryActionDraft[] = [];
        for (const id of sel.selectedIds) {
          const ann = annotations.find(a => a.id === id);
          if (ann) {
            annotationsStore.removeAnnotation(docId, sel.pageIndex, id);
            actions.push({
              type: 'REMOVE_ANNOTATION',
              docId,
              pageIndex: sel.pageIndex,
              annotationId: id,
              before: ann,
              after: null,
            });
          }
        }
        
        if (actions.length === 1) {
          historyStore.push(makeRemoveAction(docId, actions[0].before!));
        } else if (actions.length > 1) {
          historyStore.push(makeBatchAction(docId, actions));
        }
        
        selectionStore.clearSelection(activeIdentity);
        return;
      }
      case 'tool.extractText':
      case 'tool.zoom':
      case 'tool.stamp':
      case 'tool.dimension':
      case 'tool.lasso':
      case 'tool.snapshot':
      case 'tool.crop':
      case 'tool.measure':
      case 'tool.formula':
      case 'tool.laserPointer':
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
      case 'insert.screenshot':
        void captureScreenToImage();
        return;
      case 'insert.regionScreenshot':
        void captureRegionToImage();
        return;
      case 'view.sidebarBookmarks':
      case 'view.sidebarOutline':
      case 'view.sidebarAnnotations':
      case 'view.sidebarSearch':
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
        if (docId) executeUndo(docId);
        return;
      case 'history.redo':
        if (docId) executeRedo(docId);
        return;
      case 'view.sidebar':
        ui.toggleSidebar();
        return;
      case 'view.sidebarPages':
        ui.setActiveSidebarPanel('pages');
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
    
    // We must subscribe to the documents list explicitly to detect dirty state changes.
    // The previous implementation missed this subscription.
    const unsubscribe = useDocumentStore.subscribe((docState) => {
      let hasAnyDirtyDocument = false;
      let activeDocIsDirty = false;
      const activeDocId = docState.activeDocId;
      
      for (const doc of docState.documents.values()) {
        const dirty = doc.currentStateId !== doc.savedStateId;
        if (dirty) hasAnyDirtyDocument = true;
        if (dirty && doc.id === activeDocId) activeDocIsDirty = true;
      }
      
      const activeIdentity = documentSessionStore.getState().activeIdentity;
      let hasSelection = false;
      if (activeIdentity) {
        const sel = useSelectionStore.getState().getSelection(activeIdentity);
        if (sel && sel.selectedIds.length > 0) hasSelection = true;
      }
      
      const context = {
        hasDocument: activeDocId !== null,
        canUndo: activeDocId ? (useHistoryStore.getState().histories.get(activeDocId)?.undoStack.length ?? 0) > 0 : false,
        canRedo: activeDocId ? (useHistoryStore.getState().histories.get(activeDocId)?.redoStack.length ?? 0) > 0 : false,
        hasSelection,
        activeTool: useUIStore.getState().activeTool,
        sidebarOpen: useUIStore.getState().sidebarOpen,
        workspaceMode: useUIStore.getState().workspaceMode,
        isDirty: activeDocIsDirty,
        hasAnyDirtyDocument,
      };
      
      window.electronAPI.updateCommandStates(
        (Object.keys(APP_COMMANDS) as AppCommandId[]).map((commandId) => ({
          commandId,
          enabled: isCommandAvailable(commandId, context),
          checked: isCommandChecked(commandId, context),
        })),
      );
    });
    
    // Also subscribe to history and UI stores so that undo/redo and selection trigger menu updates
    const unsubscribeHistory = useHistoryStore.subscribe(() => {
       // Since the updater logic is complex, we just trigger a dummy document update to re-run the menu sync
       useDocumentStore.setState(s => ({ ...s }));
    });
    const unsubscribeUI = useUIStore.subscribe(() => {
       useDocumentStore.setState(s => ({ ...s }));
    });
    const unsubscribeSelection = useSelectionStore.subscribe(() => {
       useDocumentStore.setState(s => ({ ...s }));
    });
    
    // Initial sync
    useDocumentStore.setState(s => ({ ...s }));
    
    return () => {
      unsubscribe();
      unsubscribeHistory();
      unsubscribeUI();
      unsubscribeSelection();
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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        if (!isEditableTarget(event.target)) {
          if (window.electronAPI?.readClipboardImage) {
            void window.electronAPI.readClipboardImage().then((clip) => {
              if (clip && clip.data && clip.data.byteLength > 0) {
                void insertImageFromBytes(clip.data, clip.mimeType || 'image/png');
              }
            });
          }
        }
      }

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

    async function onPaste(event: ClipboardEvent) {
      if (isEditableTarget(event.target)) {
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
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('paste', onPaste);
      useUIStore.getState().setTemporaryTool(null);
    };
  }, [executeCommand]);

  return { executeCommand, canExecute };
}

