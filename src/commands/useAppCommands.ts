import { useCallback, useEffect } from 'react';
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore } from '../store/historyStore';
import { useUIStore } from '../store/uiStore';
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
import {
  getToolForKeyboardEvent,
  isEditableTarget,
  isImeKeyboardEvent,
  isTemporaryHandShortcut,
} from './keyboardShortcuts';
import { requestActiveInteractionCancellation } from './interactionCancellation';

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
  const { activeDocId } = useDocumentStore.getState();
  const history = useHistoryStore.getState();
  const selection = useUIStore.getState().selection;
  return {
    hasDocument: activeDocId !== null,
    canUndo: activeDocId ? history.canUndo(activeDocId) : false,
    canRedo: activeDocId ? history.canRedo(activeDocId) : false,
    hasSelection: selection.selectedIds.size > 0,
  };
}

export function useAppCommands({ onExport }: UseAppCommandsOptions): AppCommandController {
  const activeDocId = useDocumentStore((state) => state.activeDocId);
  const histories = useHistoryStore((state) => state.histories);
  const selectedIds = useUIStore((state) => state.selection.selectedIds);
  const workspaceMode = useUIStore((state) => state.workspaceMode);
  const activeTool = useUIStore((state) => state.activeTool);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);

  const canExecute = useCallback((commandId: AppCommandId) => {
    if (commandId === 'view.focusMode' && workspaceMode === 'focus') return true;
    return isCommandAvailable(commandId, {
      hasDocument: activeDocId !== null,
      canUndo: activeDocId ? (histories.get(activeDocId)?.undoStack.length ?? 0) > 0 : false,
      canRedo: activeDocId ? (histories.get(activeDocId)?.redoStack.length ?? 0) > 0 : false,
      hasSelection: selectedIds.size > 0,
    });
  }, [activeDocId, histories, selectedIds, workspaceMode]);

  const executeCommand = useCallback((commandId: AppCommandId) => {
    const ui = useUIStore.getState();
    const documents = useDocumentStore.getState();
    const docId = documents.activeDocId;
    const definition = APP_COMMANDS[commandId];

    if (!(commandId === 'view.focusMode' && ui.workspaceMode === 'focus')
      && !isCommandAvailable(commandId, currentAvailabilityContext())) {
      return;
    }

    if (definition.tool) {
      ui.setActiveTool(definition.tool);
      return;
    }

    switch (commandId) {
      case 'file.open':
        document.dispatchEvent(new CustomEvent('app:openFile'));
        return;
      case 'file.close':
        if (docId) closeDocumentById(docId);
        return;
      case 'file.closeAll':
        closeAllDocuments();
        return;
      case 'file.export':
        onExport();
        return;
      case 'file.new':
      case 'file.combine':
      case 'file.save':
      case 'file.saveAs':
      case 'file.saveTemplate':
      case 'file.saveAll':
      case 'file.documentProperties':
      case 'file.print':
      case 'edit.selectAll':
      case 'edit.deleteSelected':
      case 'tool.extractText':
      case 'tool.zoom':
      case 'tool.stamp':
      case 'tool.polygon':
      case 'tool.dimension':
      case 'tool.lasso':
      case 'tool.snapshot':
      case 'tool.crop':
      case 'tool.measure':
      case 'tool.formula':
      case 'tool.laserPointer':
      case 'tool.pointer':
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
    return window.electronAPI.onCommand((commandId: unknown) => {
      if (isAppCommandId(commandId)) executeCommand(commandId);
    });
  }, [executeCommand]);

  useEffect(() => {
    if (!window.electronAPI?.updateCommandStates) return;
    const context = {
      hasDocument: activeDocId !== null,
      canUndo: activeDocId ? (histories.get(activeDocId)?.undoStack.length ?? 0) > 0 : false,
      canRedo: activeDocId ? (histories.get(activeDocId)?.redoStack.length ?? 0) > 0 : false,
      hasSelection: selectedIds.size > 0,
      activeTool,
      sidebarOpen,
      workspaceMode,
    };
    window.electronAPI.updateCommandStates(
      (Object.keys(APP_COMMANDS) as AppCommandId[]).map((commandId) => ({
        commandId,
        enabled: isCommandAvailable(commandId, context),
        checked: isCommandChecked(commandId, context),
      })),
    );
  }, [activeDocId, histories, selectedIds, workspaceMode, activeTool, sidebarOpen]);

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

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      useUIStore.getState().setTemporaryTool(null);
    };
  }, [executeCommand]);

  return { executeCommand, canExecute };
}
