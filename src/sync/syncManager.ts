/**
 * Sync Manager — coordinates bidirectional sync and seamless cloud migration
 * across iCloud Drive, Google Drive, and Desktop Cloud Folders (Mac / Windows / iPad / iPhone).
 */

import { useLibraryStore } from '../store/libraryStore';
import { useSyncStore } from '../store/syncStore';
import {
  DOCUMENTS_PREFIX,
  PREVIEW_PREFIX,
  saveLibraryMeta,
  writeLibraryPdfBytes,
  type LibraryDocument,
} from '../platform/ipadLibrary';
import { isIpadApp } from '../platform/native';
import { buildSyncPlan } from './syncMerge';
import {
  fingerprintPdfBytes,
  remoteNameForDocument,
  type SyncAdapter,
  type SyncItemRecord,
  type SyncManifest,
  type SyncProviderId,
} from './syncTypes';
import { FolderSyncAdapter } from './adapters/folderSyncAdapter';
import { ICloudSyncAdapter } from './adapters/icloudSyncAdapter';
import { GoogleDriveSyncAdapter } from './adapters/googleDriveSyncAdapter';

const adapters: Record<Exclude<SyncProviderId, 'local'>, SyncAdapter> = {
  folder: new FolderSyncAdapter(),
  icloud: new ICloudSyncAdapter(),
  gdrive: new GoogleDriveSyncAdapter(),
};

let activeSyncPromise: Promise<boolean> | null = null;

export function getSyncAdapter(provider: SyncProviderId): SyncAdapter | null {
  if (provider === 'local') return null;
  return adapters[provider] ?? null;
}

/**
 * Runs a full conflict-safe bidirectional sync against the currently active
 * cloud provider (iCloud Drive, Google Drive, or Desktop Cloud Folder).
 */
export async function syncNow(): Promise<boolean> {
  if (activeSyncPromise) return activeSyncPromise;
  const syncStore = useSyncStore.getState();
  const adapter = getSyncAdapter(syncStore.provider);
  if (!adapter) return true;

  activeSyncPromise = (async () => {
    try {
      if (!(await adapter.isConnected())) {
        syncStore.setStatus('idle', null);
        return false;
      }

      syncStore.setStatus('syncing', null);

      const lib = useLibraryStore.getState();
      if (!lib.initialized) await lib.initialize();
      const freshLib = useLibraryStore.getState();

      // Build local sync records with live content fingerprints
      const localItems: SyncItemRecord[] = [];
      const localBytesById = new Map<string, Uint8Array>();

      for (const item of freshLib.items) {
        const bytes = item.trashedAt ? null : await freshLib.readDocumentBytes(item.id).catch(() => null);
        if (bytes) localBytesById.set(item.id, bytes);
        localItems.push({
          id: item.id,
          title: item.title,
          remoteName: remoteNameForDocument(item),
          kind: item.kind,
          folderId: item.folderId,
          coverTheme: item.coverTheme,
          favorite: item.favorite,
          pageCount: item.pageCount,
          sizeBytes: bytes ? bytes.byteLength : item.sizeBytes,
          contentHash: bytes ? fingerprintPdfBytes(bytes) : undefined,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          lastOpenedAt: item.lastOpenedAt,
          trashedAt: item.trashedAt,
        });
      }

      const [remoteManifest, remoteFiles] = await Promise.all([
        adapter.readManifest(),
        adapter.listRemotePdfs(),
      ]);

      const plan = buildSyncPlan({
        localFolders: freshLib.folders,
        localItems,
        remoteManifest,
        remoteFiles,
        lastSyncedAt: syncStore.lastSyncedAt,
      });

      let uploaded = 0;
      let downloaded = 0;
      const conflicts = plan.conflictCopies.length;

      // 1. Preserve remote conflict copies locally before uploading local winners
      const prefix = isIpadApp() ? DOCUMENTS_PREFIX : PREVIEW_PREFIX;
      for (const { sourceRemoteName, conflictItem } of plan.conflictCopies) {
        const remoteBytes = await adapter.readPdf(sourceRemoteName);
        if (remoteBytes) {
          await writeLibraryPdfBytes(prefix + conflictItem.remoteName, remoteBytes);
          await adapter.writePdf(conflictItem.remoteName, remoteBytes);
          downloaded++;
        }
      }

      // 2. Upload new / updated local PDFs
      for (const item of plan.toUpload) {
        const bytes = localBytesById.get(item.id);
        if (!bytes) continue;
        await adapter.writePdf(item.remoteName, bytes);
        uploaded++;
      }

      // 3. Download new / updated remote PDFs
      for (const item of plan.toDownload) {
        const bytes = await adapter.readPdf(item.remoteName);
        if (!bytes) continue;
        const targetPath = prefix + item.remoteName;
        await writeLibraryPdfBytes(targetPath, bytes);
        item.sizeBytes = bytes.byteLength;
        item.contentHash = fingerprintPdfBytes(bytes);
        downloaded++;
      }

      // 4. Clean up remote trashed PDFs
      for (const remoteName of plan.toDeleteRemote) {
        await adapter.deletePdf(remoteName).catch(() => undefined);
      }

      // 5. Commit merged folders & items into local Library store
      const existingById = new Map(freshLib.items.map((i) => [i.id, i]));
      const mergedDocs: LibraryDocument[] = plan.mergedItems.map((rec) => {
        const prev = existingById.get(rec.id);
        return {
          id: rec.id,
          title: rec.title,
          filePath: prev?.filePath || prefix + rec.remoteName,
          kind: rec.kind,
          folderId: rec.folderId,
          coverTheme: rec.coverTheme,
          thumbnail: prev?.thumbnail,
          favorite: rec.favorite,
          pageCount: rec.pageCount,
          sizeBytes: rec.sizeBytes,
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt,
          lastOpenedAt: rec.lastOpenedAt,
          trashedAt: rec.trashedAt,
        };
      });

      useLibraryStore.setState({ folders: plan.mergedFolders, items: mergedDocs });
      await saveLibraryMeta({ version: 1, folders: plan.mergedFolders, items: mergedDocs });

      // 6. Write updated shared manifest to the cloud provider
      const nextManifest: SyncManifest = {
        version: 1,
        updatedAt: Date.now(),
        deviceId: syncStore.deviceId,
        folders: plan.mergedFolders,
        items: plan.mergedItems,
      };
      await adapter.writeManifest(nextManifest);

      useSyncStore.getState().recordSyncSuccess({ uploaded, downloaded, conflicts });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useSyncStore.getState().setStatus('error', msg);
      return false;
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}

/**
 * Switches the active sync provider (e.g. Local -> iCloud Drive -> Google Drive
 * -> Desktop Folder) and optionally migrates all existing MaliPDF documents and
 * folders directly into the new cloud destination in one step.
 */
export async function switchSyncProvider(
  nextProvider: SyncProviderId,
  options?: {
    migrateExisting?: boolean;
    folderPath?: string;
    accessToken?: string;
    clientId?: string;
  },
): Promise<boolean> {
  const store = useSyncStore.getState();

  if (nextProvider === 'local') {
    store.setProvider('local');
    store.setStatus('idle', null);
    return true;
  }

  const adapter = getSyncAdapter(nextProvider);
  if (!adapter) return false;

  try {
    store.setStatus('syncing', null);
    const connected = await adapter.connect(options);
    if (!connected) {
      store.setStatus('idle', null);
      return false;
    }

    store.setProvider(nextProvider);
    // Reset lastSyncedAt when migrating to a fresh provider so all local docs upload cleanly
    if (options?.migrateExisting) {
      useSyncStore.setState({ lastSyncedAt: null });
    }
    return await syncNow();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.setStatus('error', msg);
    return false;
  }
}

let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;

/** Triggers a quiet background sync after saving or returning to foreground (if autoSync is enabled). */
export function scheduleAutoSync(delayMs = 300): void {
  const { provider, autoSync } = useSyncStore.getState();
  if (provider === 'local' || !autoSync) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    void syncNow();
  }, Math.max(0, delayMs));
}
