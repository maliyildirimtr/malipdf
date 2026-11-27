import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { buildAnnotationsMap, exportAnnotatedPdf, loadDefaultExportFonts } from '../pdf/annotationExporter';

import { useAssetStore } from '../store/assetStore';
import { useFormStore } from '../store/formStore';
import { removeRecoverySnapshot } from '../document/autoSave';
import { prefixForScope, useLibraryStore } from '../store/libraryStore';
import { useSyncStore } from '../store/syncStore';
import { CLOUD_CACHE_PREFIX, DOCUMENTS_PREFIX, PREVIEW_PREFIX, ensurePdfExtension, getScope, sanitizeFileName } from '../platform/ipadLibrary';
import { isTabletMode } from '../platform/touchMode';
import { isIpadApp } from '../platform/native';
import { askSaveDestination } from '../platform/ipadDialogs';
import { notifyUser } from '../utils/notify';
import { scheduleAutoSync } from '../sync/syncManager';

async function performSave(docId: string, saveAs: boolean, options?: { silent?: boolean }): Promise<boolean> {
  const { documents, updateDocument } = useDocumentStore.getState();
  const doc = documents.get(docId);
  if (!doc) return false;

  const docAnnotState = useAnnotationStore.getState().docAnnotations.get(docId);
  if (!docAnnotState) return false;

  // Capture the state ID we are attempting to save
  const targetStateId = doc.currentStateId;
  
  if (doc.saveStatus === 'saving') return false;

  updateDocument(docId, { saveStatus: 'saving', lastSaveError: null });

  try {
    const annotations = buildAnnotationsMap(docAnnotState);
    const assets = useAssetStore.getState().getAssetsForDocument({ docId, instanceId: doc.instanceId });
    const needsTextFonts = [...annotations.values()].some((list) => list.some((a) => a.type === 'text'));
    const fonts = needsTextFonts ? await loadDefaultExportFonts() : undefined;
    const exportResult = await exportAnnotatedPdf(doc.sourceData, annotations, { assets, fonts, editable: true, bookmarks: doc.bookmarks, formValues: useFormStore.getState().getValues(docId) });

    let filePath = doc.filePath;
    const isDesktopVirtualLibraryDoc = Boolean(
      !isIpadApp()
        && filePath
        && (filePath.startsWith(PREVIEW_PREFIX) || filePath.startsWith(CLOUD_CACHE_PREFIX)),
    );
    const isBrowserTabletSave = !window.electronAPI?.writeFile && (isTabletMode() || Boolean(isDesktopVirtualLibraryDoc));

    // On iPad (or Tablet UI), manual Save / Save As opens the destination picker
    // so the user can choose This Device ("Cihazım"), Cloud ("Bulut"), folders, or Files.
    if (!options?.silent && (isIpadApp() || (!window.electronAPI?.writeFile && isTabletMode()))) {
      const lib = useLibraryStore.getState();
      if (!lib.initialized) await lib.initialize();
      const freshLib = useLibraryStore.getState();
      const syncProvider = useSyncStore.getState().provider;
      const existingItem = filePath
        ? freshLib.items.find((i) => !i.trashedAt && i.filePath === filePath)
        : undefined;
      const currentScope = existingItem ? getScope(existingItem) : freshLib.storageScope;
      const cloudLabel = syncProvider === 'gdrive' ? 'Google Drive' : syncProvider === 'folder' ? 'Cloud' : 'iCloud Drive';
      const defaultFileName = ensurePdfExtension(sanitizeFileName(doc.title || 'Untitled.pdf'));
      const choice = await askSaveDestination(
        defaultFileName,
        freshLib.folders.map((f) => ({ id: f.id, name: f.name, scope: getScope(f) })),
        existingItem?.folderId ?? null,
        saveAs,
        {
          currentScope,
          cloudEnabled: syncProvider !== 'local',
          cloudLabel,
        },
      );
      if (!choice) {
        updateDocument(docId, { saveStatus: 'idle' });
        return false;
      }

      const finalName = ensurePdfExtension(sanitizeFileName(choice.fileName));

      if (choice.target === 'files') {
        if (filePath && window.electronAPI?.writeFile) {
          await window.electronAPI.writeFile(filePath, exportResult.data.buffer as ArrayBuffer);
          void useLibraryStore.getState().recordDocumentSaved(filePath, finalName, exportResult.data, doc.pageCount);
        }
        if (window.electronAPI?.sharePdf) {
          await window.electronAPI.sharePdf(finalName, exportResult.data);
        } else {
          const blob = new Blob([exportResult.data as BlobPart], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = finalName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        updateDocument(docId, {
          savedStateId: targetStateId,
          saveStatus: 'idle',
          title: finalName,
        });
        return true;
      }

      // Target = MaliPDF Library (This Device or Cloud)
      let targetFolderId = choice.folderId;
      let folderLabel = choice.scope === 'cloud' ? `Ana Klasör (${cloudLabel})` : 'Ana Klasör';
      if (choice.newFolderName) {
        const created = await useLibraryStore.getState().createFolder(choice.newFolderName, 'blue', null, choice.scope);
        targetFolderId = created.id;
        folderLabel = created.name;
      } else if (targetFolderId) {
        folderLabel = useLibraryStore.getState().folders.find((f) => f.id === targetFolderId)?.name ?? 'Klasör';
      }

      const targetPath = prefixForScope(choice.scope) + finalName;

      if (isBrowserTabletSave || choice.scope === 'cloud') {
        const saved = await useLibraryStore.getState().upsertDocument({
          title: finalName,
          filePath: targetPath,
          folderId: targetFolderId,
          scope: choice.scope,
          bytes: exportResult.data,
          pageCount: doc.pageCount,
          writeBytes: true,
        });
        filePath = saved.filePath;
      } else {
        const ok = await window.electronAPI.writeFile(targetPath, exportResult.data.buffer as ArrayBuffer);
        if (!ok) throw new Error('Failed to write PDF to disk.');
        filePath = targetPath;
        await useLibraryStore.getState().upsertDocument({
          title: finalName,
          filePath: targetPath,
          folderId: targetFolderId,
          scope: 'local',
          bytes: exportResult.data,
          pageCount: doc.pageCount,
          writeBytes: false,
        });
      }

      updateDocument(docId, {
        filePath,
        savedStateId: targetStateId,
        ephemeralImport: false,
        saveStatus: 'idle',
        title: finalName,
      });
      const latest = useDocumentStore.getState().documents.get(docId);
      if (latest && latest.currentStateId === latest.savedStateId) {
        await removeRecoverySnapshot(docId);
      }
      notifyUser('success', `${folderLabel} › ${finalName}`);
      if (choice.scope === 'cloud') {
        scheduleAutoSync();
      }
      return true;
    }

    // Desktop or silent save for virtual Library / Cloud documents
    if ((isBrowserTabletSave || (isDesktopVirtualLibraryDoc && !saveAs))) {
      const saved = await useLibraryStore.getState().upsertDocument({
        title: doc.title,
        filePath: saveAs ? undefined : filePath,
        bytes: exportResult.data,
        pageCount: doc.pageCount,
        writeBytes: true,
      });
      filePath = saved.filePath;
    } else {
      if (saveAs || !filePath) {
        const selectedPath = await window.electronAPI.saveFile(doc.title);
        if (!selectedPath) {
          updateDocument(docId, { saveStatus: 'idle' });
          return false;
        }
        filePath = selectedPath;
      }

      if (isIpadApp() && filePath.startsWith(`${DOCUMENTS_PREFIX}${CLOUD_CACHE_PREFIX}`)) {
        await useLibraryStore.getState().upsertDocument({
          title: filePath.split(/[\\/]/).pop() || doc.title,
          filePath,
          scope: 'cloud',
          bytes: exportResult.data,
          pageCount: doc.pageCount,
          writeBytes: true,
        });
      } else {
        const ok = await window.electronAPI.writeFile(filePath, exportResult.data.buffer as ArrayBuffer);
        if (!ok) throw new Error('Failed to write PDF to disk.');

        void useLibraryStore.getState().recordDocumentSaved(
          filePath,
          filePath.split(/[\\/]/).pop() || doc.title,
          exportResult.data,
          doc.pageCount,
        );
      }
    }

    updateDocument(docId, {
      filePath,
      savedStateId: targetStateId,
      ephemeralImport: false,
      saveStatus: 'idle',
      title: filePath.split(/[\\/]/).pop() || doc.title,
    });
    const latest = useDocumentStore.getState().documents.get(docId);
    if (latest && latest.currentStateId === latest.savedStateId) {
      await removeRecoverySnapshot(docId);
    }

    const savedLibraryItem = useLibraryStore.getState().items.find((i) => i.filePath === filePath);
    if (savedLibraryItem && getScope(savedLibraryItem) === 'cloud') {
      scheduleAutoSync();
    }
    return true;
  } catch (error) {
    console.error('Save failed:', error);
    updateDocument(docId, {
      saveStatus: 'error',
      lastSaveError: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function saveDocument(docId: string) {
  return performSave(docId, false);
}

export function saveDocumentAs(docId: string) {
  return performSave(docId, true);
}

export async function saveAllDocuments() {
  const { documents } = useDocumentStore.getState();
  for (const doc of documents.values()) {
    if (doc.currentStateId !== doc.savedStateId) {
      const success = await saveDocument(doc.id);
      if (!success) {
        break; // Stop remaining saves if one fails or is cancelled
      }
    }
  }
}

/**
 * Quietly saves dirty documents that already belong to a known library/disk path
 * (never prompts for Save As). Used on iPadOS when returning to the Library or
 * when the app moves to the background so annotations are never lost.
 */
export async function autoSaveDirtyTabletDocuments(): Promise<void> {
  const { documents } = useDocumentStore.getState();
  const tablet = isTabletMode() || isIpadApp();
  for (const doc of documents.values()) {
    if (doc.currentStateId === doc.savedStateId || !doc.filePath || doc.ephemeralImport || doc.saveStatus === 'saving') {
      continue;
    }
    const isManagedLibraryOrCloudDoc =
      doc.filePath.startsWith(DOCUMENTS_PREFIX)
      || doc.filePath.startsWith(PREVIEW_PREFIX)
      || doc.filePath.startsWith(CLOUD_CACHE_PREFIX);
    if (tablet || isManagedLibraryOrCloudDoc) {
      await performSave(doc.id, false, { silent: true });
    }
  }
}
