/**
 * MaliPDF Selective Cross-Platform Cloud Sync Coordinator.
 *
 * Strictly syncs ONLY `scope === 'cloud'` folders and documents with the active
 * `SyncAdapter` (iCloud Drive, Google Drive, or Desktop Cloud Folder), leaving
 * all `scope === 'local'` ("This Device" / "Cihazım") files strictly on the
 * device unless the user explicitly moves/copies/saves a file into Cloud mode.
 */

import {
  deleteLibraryPdfBytes,
  getScope,
  renameLibraryPdfFile,
  renderPdfCoverThumbnail,
  saveLibraryMeta,
  writeLibraryPdfBytes,
  type LibraryDocument,
  type LibraryFolder,
} from '../platform/ipadLibrary';
import { prefixForScope, useLibraryStore } from '../store/libraryStore';
import { useDocumentStore } from '../store/documentStore';
import { useSyncStore } from '../store/syncStore';
import { FolderSyncAdapter } from './adapters/folderSyncAdapter';
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

/**
 * Google Drive is NOT offered: in the packaged app the CSP (`connect-src 'self'
 * blob:`), the window-open policy and the file:// / capacitor:// origin make
 * the OAuth redirect and the REST calls impossible. The adapter file is kept
 * for a future version, but no code path may use it.
 */
export const GOOGLE_DRIVE_UNAVAILABLE = 'Google Drive sync is not available in this version of MaliPDF yet.';

const adapters: Partial<Record<Exclude<SyncProviderId, 'local'>, SyncAdapter>> = {
  icloud: new ICloudSyncAdapter(),
  folder: new FolderSyncAdapter(),
};

let activeSyncPromise: Promise<boolean> | null = null;

export function getSyncAdapter(provider: SyncProviderId): SyncAdapter | null {
  if (provider === 'local' || provider === 'gdrive') return null;
  return adapters[provider] ?? null;
}

/** Strips plan-only fields so they never reach the shared manifest. */
function manifestRecord(rec: SyncItemRecord): SyncItemRecord {
  const { sourceLocalId: _s, relocateLocal: _r, ...clean } = rec;
  return clean;
}

/**
 * Executes a full bidirectional conflict-safe sync ONLY for Cloud-scoped
 * (`scope === 'cloud'`) folders & documents, keeping local device items untouched.
 */
export async function syncNow(): Promise<boolean> {
  if (activeSyncPromise) return activeSyncPromise;

  const syncStore = useSyncStore.getState();
  if (syncStore.provider === 'gdrive') {
    syncStore.setStatus('error', GOOGLE_DRIVE_UNAVAILABLE);
    return false;
  }
  const adapter = getSyncAdapter(syncStore.provider);
  if (!adapter) return false;

  activeSyncPromise = (async () => {
    // Recorded as lastSyncedAt: edits made while this sync runs must still
    // count as "changed since the last sync" next time.
    const startedAt = Date.now();
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
      const cloudFolders = freshLib.folders.filter((f) => getScope(f) === 'cloud');
      const cloudItemsSource = freshLib.items.filter((i) => getScope(i) === 'cloud');
      const localTombstones = [...useSyncStore.getState().tombstones];

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

      // A failed read THROWS (adapters return null only for a missing
      // manifest), which aborts here before anything is written.
      const [remoteManifest, remoteFiles] = await Promise.all([
        adapter.readManifest(),
        adapter.listRemotePdfs(),
      ]);

      const plan = buildSyncPlan({
        localFolders: cloudFolders,
        localItems: localCloudRecords,
        localTombstones,
        remoteManifest,
        remoteFiles,
        lastSyncedAt: syncStore.lastSyncedAt,
      });

      // Never download a winner over local edits we could not read and save.
      for (const item of plan.toUpload) {
        if (item.sourceLocalId && !localBytesById.has(item.sourceLocalId)) {
          throw new Error(`Could not read local changes of "${item.title}". Sync stopped so they are not overwritten.`);
        }
      }

      let uploaded = 0;
      let downloaded = 0;
      const conflicts = plan.conflictCopies.length + plan.toUpload.filter((i) => i.sourceLocalId).length;
      const cloudPrefix = prefixForScope('cloud');
      const downloadedThumbs = new Map<string, { thumbnail?: string; pageCount?: number }>();
      const snapshotById = new Map(cloudItemsSource.map((i) => [i.id, i]));
      const newFilePathById = new Map<string, string>();

      /** True when the user changed this doc after the snapshot: the sync must not clobber it. */
      const changedSinceSnapshot = (id: string): boolean => {
        const snap = snapshotById.get(id);
        if (!snap) return false;
        const cur = useLibraryStore.getState().items.find((i) => i.id === id);
        return !cur || cur.updatedAt !== snap.updatedAt || cur.filePath !== snap.filePath;
      };

      // 0. A different remote document has the same file name as a local one:
      //    move the local one to its new name before the remote one is downloaded.
      for (const item of plan.mergedItems) {
        if (!item.relocateLocal) continue;
        const prev = snapshotById.get(item.id);
        if (!prev) continue;
        const nextPath = cloudPrefix + item.remoteName;
        await renameLibraryPdfFile(prev.filePath, nextPath);
        newFilePathById.set(item.id, nextPath);
        const docStore = useDocumentStore.getState();
        for (const doc of docStore.documents.values()) {
          if (doc.filePath === prev.filePath) docStore.updateDocument(doc.id, { filePath: nextPath });
        }
      }

      // 1. Preserve remote conflict copies locally before uploading local winners
      for (const { sourceRemoteName, conflictItem } of plan.conflictCopies) {
        const remoteBytes = await adapter.readPdf(sourceRemoteName);
        if (!remoteBytes) {
          // The local winner is about to be uploaded over this file: without a
          // preserved copy the other device's edits would be lost.
          throw new Error(`Could not download "${sourceRemoteName}" to keep both versions. Sync stopped; try again.`);
        }
        await writeLibraryPdfBytes(cloudPrefix + conflictItem.remoteName, remoteBytes);
        await adapter.writePdf(conflictItem.remoteName, remoteBytes);
        const rendered = await renderPdfCoverThumbnail(remoteBytes).catch(() => null);
        if (rendered) {
          downloadedThumbs.set(conflictItem.id, { thumbnail: rendered.dataUrl, pageCount: rendered.pageCount });
        }
        downloaded++;
      }

      // 1b. Save local conflict copies (remote won) to their OWN local file
      //     before the winner is downloaded over the original file.
      for (const item of plan.toUpload) {
        if (!item.sourceLocalId) continue;
        const bytes = localBytesById.get(item.sourceLocalId)!;
        const copyPath = cloudPrefix + item.remoteName;
        await writeLibraryPdfBytes(copyPath, bytes);
        newFilePathById.set(item.id, copyPath);
        const prev = snapshotById.get(item.sourceLocalId);
        if (prev?.thumbnail) downloadedThumbs.set(item.id, { thumbnail: prev.thumbnail, pageCount: prev.pageCount });
      }

      // 2. Upload new / updated local cloud-scoped PDFs (incl. local conflict copies)
      for (const item of plan.toUpload) {
        const bytes = localBytesById.get(item.sourceLocalId ?? item.id);
        if (!bytes) continue;
        await adapter.writePdf(item.remoteName, bytes);
        uploaded++;
      }

      // 3. Download new / updated remote PDFs into Cloud cache
      for (const item of plan.toDownload) {
        // Edited locally while syncing: keep the edit, the next sync reconciles it.
        if (changedSinceSnapshot(item.id)) continue;
        const bytes = await adapter.readPdf(item.remoteName);
        if (!bytes) continue;
        const targetPath = newFilePathById.get(item.id) ?? snapshotById.get(item.id)?.filePath ?? cloudPrefix + item.remoteName;
        await writeLibraryPdfBytes(targetPath, bytes);
        item.sizeBytes = bytes.byteLength;
        item.contentHash = fingerprintPdfBytes(bytes);
        const rendered = await renderPdfCoverThumbnail(bytes).catch(() => null);
        if (rendered) {
          downloadedThumbs.set(item.id, { thumbnail: rendered.dataUrl, pageCount: rendered.pageCount });
        }
        downloaded++;
      }

      // 4. Clean up remote trashed / deleted PDFs
      for (const remoteName of plan.toDeleteRemote) {
        await adapter.deletePdf(remoteName).catch(() => undefined);
      }

      // 5. Apply the result to the CURRENT library (not the snapshot taken at
      //    the start): documents/folders added, renamed, trashed or deleted
      //    while the sync ran must survive. Only records the user did not touch
      //    since the snapshot are replaced by their merged version.
      const mergedCloudFolders: LibraryFolder[] = plan.mergedFolders.map((f) => ({
        ...f,
        scope: 'cloud',
      }));
      const mergedCloudDocs: LibraryDocument[] = plan.mergedItems
        .filter((rec) => !rec.deletedAt)
        .map((rec) => {
          const prev = snapshotById.get(rec.id);
          const freshThumb = downloadedThumbs.get(rec.id);
          return {
            id: rec.id,
            title: rec.title,
            filePath: newFilePathById.get(rec.id) || prev?.filePath || cloudPrefix + rec.remoteName,
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

      const deleteLocal = new Set(plan.toDeleteLocal);
      const current = useLibraryStore.getState();

      const mergedDocById = new Map(mergedCloudDocs.map((d) => [d.id, d]));
      const seenItemIds = new Set<string>();
      const nextItems: LibraryDocument[] = [];
      for (const cur of current.items) {
        seenItemIds.add(cur.id);
        const snap = snapshotById.get(cur.id);
        if (getScope(cur) !== 'cloud' || !snap || cur.updatedAt !== snap.updatedAt || cur.filePath !== snap.filePath) {
          nextItems.push(cur);
          continue;
        }
        if (deleteLocal.has(cur.id)) {
          // Permanently deleted on another device.
          await deleteLibraryPdfBytes(cur.filePath);
          continue;
        }
        nextItems.push(mergedDocById.get(cur.id) ?? cur);
      }
      for (const doc of mergedCloudDocs) {
        // In the snapshot but gone now = deleted while syncing: do not resurrect.
        if (seenItemIds.has(doc.id) || snapshotById.has(doc.id)) continue;
        nextItems.push(doc);
      }

      const snapFolderById = new Map(cloudFolders.map((f) => [f.id, f]));
      const mergedFolderById = new Map(mergedCloudFolders.map((f) => [f.id, f]));
      const seenFolderIds = new Set<string>();
      const nextFolders: LibraryFolder[] = [];
      for (const cur of current.folders) {
        seenFolderIds.add(cur.id);
        const snap = snapFolderById.get(cur.id);
        if (getScope(cur) !== 'cloud' || !snap || cur.updatedAt !== snap.updatedAt) {
          nextFolders.push(cur);
          continue;
        }
        nextFolders.push(mergedFolderById.get(cur.id) ?? cur);
      }
      for (const f of mergedCloudFolders) {
        if (seenFolderIds.has(f.id) || snapFolderById.has(f.id)) continue;
        nextFolders.push(f);
      }

      useLibraryStore.setState({ folders: nextFolders, items: nextItems });
      await saveLibraryMeta({ version: 1, folders: nextFolders, items: nextItems });

      // 6. Write updated shared manifest to the cloud provider
      const nextManifest: SyncManifest = {
        version: 1,
        updatedAt: Date.now(),
        deviceId: syncStore.deviceId,
        folders: mergedCloudFolders,
        items: plan.mergedItems.map(manifestRecord),
      };
      await adapter.writeManifest(nextManifest);

      // The tombstones are in the shared manifest now.
      useSyncStore.getState().clearTombstones(localTombstones.map((t) => t.id));
      useSyncStore.getState().recordSyncSuccess({ uploaded, downloaded, conflicts }, startedAt);
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

  if (nextProvider === 'gdrive') {
    store.setStatus('error', GOOGLE_DRIVE_UNAVAILABLE);
    return false;
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
