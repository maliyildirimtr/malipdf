/**
 * MaliPDF Selective Cross-Platform Cloud Sync Coordinator.
 *
 * Strictly syncs ONLY `scope === 'cloud'` folders and documents with the active
 * `SyncAdapter` (iCloud Drive, Google Drive, or Desktop Cloud Folder), leaving
 * all `scope === 'local'` ("This Device" / "Cihazım") files strictly on the
 * device unless the user explicitly moves/copies/saves a file into Cloud mode.
 */

import {
  getScope,
  renderPdfCoverThumbnail,
  saveLibraryMeta,
  writeLibraryPdfBytes,
  type LibraryDocument,
  type LibraryFolder,
} from '../platform/ipadLibrary';
import { prefixForScope, useLibraryStore } from '../store/libraryStore';
import { useSyncStore } from '../store/syncStore';
import { FolderSyncAdapter } from './adapters/folderSyncAdapter';
import { GoogleDriveSyncAdapter } from './adapters/googleDriveSyncAdapter';
import { ICloudSyncAdapter } from './adapters/icloudSyncAdapter';
import { buildSyncPlan } from './syncMerge';
import {
  fingerprintPdfBytes,
  remoteNameForDocument,
  type SyncAdapter,
  type SyncItemRecord,
  type SyncManifest,
  type SyncProviderId,
} from './syncTypes';

const adapters: Record<Exclude<SyncProviderId, 'local'>, SyncAdapter> = {
  icloud: new ICloudSyncAdapter(),
  gdrive: new GoogleDriveSyncAdapter(),
  folder: new FolderSyncAdapter(),
};

let activeSyncPromise: Promise<boolean> | null = null;

export function getSyncAdapter(provider: SyncProviderId): SyncAdapter | null {
  if (provider === 'local') return null;
  return adapters[provider] ?? null;
}

/**
 * Executes a full bidirectional conflict-safe sync ONLY for Cloud-scoped
 * (`scope === 'cloud'`) folders & documents, keeping local device items untouched.
 */
export async function syncNow(): Promise<boolean> {
  if (activeSyncPromise) return activeSyncPromise;

  const syncStore = useSyncStore.getState();
  const adapter = getSyncAdapter(syncStore.provider);
  if (!adapter) return false;

  activeSyncPromise = (async () => {
    try {
      syncStore.setStatus('syncing', null);

      if (!(await adapter.isConnected())) {
        const ok = await adapter.connect();
        if (!ok) {
          syncStore.setStatus('error', 'Cloud account is not connected.');
          return false;
        }
      }

      const lib = useLibraryStore.getState();
      if (!lib.initialized) await lib.initialize();
      const freshLib = useLibraryStore.getState();

      // Strictly separate Local ("This Device") vs Cloud ("Bulut") entries!
      const preservedLocalFolders = freshLib.folders.filter((f) => getScope(f) === 'local');
      const cloudFolders = freshLib.folders.filter((f) => getScope(f) === 'cloud');

      const preservedLocalItems = freshLib.items.filter((i) => getScope(i) === 'local');
      const cloudItemsSource = freshLib.items.filter((i) => getScope(i) === 'cloud');

      // Build cloud sync records with live content fingerprints
      const localCloudRecords: SyncItemRecord[] = [];
      const localBytesById = new Map<string, Uint8Array>();

      for (const item of cloudItemsSource) {
        const bytes = item.trashedAt ? null : await freshLib.readDocumentBytes(item.id).catch(() => null);
        if (bytes) localBytesById.set(item.id, bytes);
        localCloudRecords.push({
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
        localFolders: cloudFolders,
        localItems: localCloudRecords,
        remoteManifest,
        remoteFiles,
        lastSyncedAt: syncStore.lastSyncedAt,
      });

      let uploaded = 0;
      let downloaded = 0;
      const conflicts = plan.conflictCopies.length;
      const cloudPrefix = prefixForScope('cloud');
      const downloadedThumbs = new Map<string, { thumbnail?: string; pageCount?: number }>();

      // 1. Preserve remote conflict copies locally before uploading local winners
      for (const { sourceRemoteName, conflictItem } of plan.conflictCopies) {
        const remoteBytes = await adapter.readPdf(sourceRemoteName);
        if (remoteBytes) {
          await writeLibraryPdfBytes(cloudPrefix + conflictItem.remoteName, remoteBytes);
          await adapter.writePdf(conflictItem.remoteName, remoteBytes);
          const rendered = await renderPdfCoverThumbnail(remoteBytes).catch(() => null);
          if (rendered) {
            downloadedThumbs.set(conflictItem.id, { thumbnail: rendered.dataUrl, pageCount: rendered.pageCount });
          }
          downloaded++;
        }
      }

      // 2. Upload new / updated local cloud-scoped PDFs
      for (const item of plan.toUpload) {
        const bytes = localBytesById.get(item.id);
        if (!bytes) continue;
        await adapter.writePdf(item.remoteName, bytes);
        uploaded++;
      }

      // 3. Download new / updated remote PDFs into Cloud cache
      for (const item of plan.toDownload) {
        const bytes = await adapter.readPdf(item.remoteName);
        if (!bytes) continue;
        const targetPath = cloudPrefix + item.remoteName;
        await writeLibraryPdfBytes(targetPath, bytes);
        item.sizeBytes = bytes.byteLength;
        item.contentHash = fingerprintPdfBytes(bytes);
        const rendered = await renderPdfCoverThumbnail(bytes).catch(() => null);
        if (rendered) {
          downloadedThumbs.set(item.id, { thumbnail: rendered.dataUrl, pageCount: rendered.pageCount });
        }
        downloaded++;
      }

      // 4. Clean up remote trashed PDFs
      for (const remoteName of plan.toDeleteRemote) {
        await adapter.deletePdf(remoteName).catch(() => undefined);
      }

      // 5. Merge Cloud items/folders back alongside untouched Local items/folders
      const existingCloudById = new Map(cloudItemsSource.map((i) => [i.id, i]));
      const mergedCloudFolders: LibraryFolder[] = plan.mergedFolders.map((f) => ({
        ...f,
        scope: 'cloud',
      }));
      const mergedCloudDocs: LibraryDocument[] = plan.mergedItems.map((rec) => {
        const prev = existingCloudById.get(rec.id);
        const freshThumb = downloadedThumbs.get(rec.id);
        return {
          id: rec.id,
          title: rec.title,
          filePath: prev?.filePath || cloudPrefix + rec.remoteName,
          scope: 'cloud',
          kind: rec.kind,
          folderId: rec.folderId,
          coverTheme: rec.coverTheme,
          thumbnail: freshThumb?.thumbnail ?? prev?.thumbnail,
          favorite: rec.favorite,
          pageCount: freshThumb?.pageCount ?? rec.pageCount,
          sizeBytes: rec.sizeBytes,
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt,
          lastOpenedAt: rec.lastOpenedAt,
          trashedAt: rec.trashedAt,
        };
      });

      const nextFolders = [...mergedCloudFolders, ...preservedLocalFolders];
      const nextItems = [...mergedCloudDocs, ...preservedLocalItems];

      useLibraryStore.setState({ folders: nextFolders, items: nextItems });
      await saveLibraryMeta({ version: 1, folders: nextFolders, items: nextItems });

      // 6. Write updated shared manifest to the cloud provider
      const nextManifest: SyncManifest = {
        version: 1,
        updatedAt: Date.now(),
        deviceId: syncStore.deviceId,
        folders: mergedCloudFolders,
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
 * Connects or switches the active cloud provider (iCloud Drive, Google Drive,
 * or Desktop Cloud Folder). By default (`migrateExisting = false`), local
 * "This Device" files remain strictly on the device and only Cloud-mode files sync.
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
    useLibraryStore.getState().setStorageScope('local');
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
    // Only copy local docs to Cloud if explicitly requested by the user in Settings
    if (options?.migrateExisting) {
      const lib = useLibraryStore.getState();
      if (!lib.initialized) await lib.initialize();
      const localIds = useLibraryStore
        .getState()
        .items.filter((i) => !i.trashedAt && getScope(i) === 'local')
        .map((i) => i.id);
      if (localIds.length > 0) {
        await useLibraryStore.getState().transferDocumentsScope(localIds, 'cloud', 'copy');
      }
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
