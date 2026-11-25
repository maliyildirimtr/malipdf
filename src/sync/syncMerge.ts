/**
 * Pure, conflict-safe bidirectional sync merge engine shared by ALL providers
 * (iCloud Drive, Google Drive, OneDrive/Desktop Folder).
 *
 * Design guarantees:
 * - Never loses handwritten notes: if both local and remote edited the same PDF
 *   since `lastSyncedAt` with different content hashes, keeps the newer version
 *   and creates a non-destructive "(Conflict Copy)" for the other version.
 * - Preserves folder structure, favorites, cover themes, and trash state via
 *   per-entity `updatedAt` last-write-wins.
 * - Discovers brand-new PDFs dropped directly into the cloud folder from
 *   another device or OS file manager even if not yet listed in the manifest.
 */

import type { LibraryFolder } from '../platform/ipadLibrary';
import type { RemoteFileEntry, SyncItemRecord, SyncManifest, SyncPlan } from './syncTypes';

export interface MergeSyncInputs {
  localFolders: readonly LibraryFolder[];
  localItems: readonly SyncItemRecord[];
  remoteManifest: SyncManifest | null;
  remoteFiles: readonly RemoteFileEntry[];
  lastSyncedAt: number | null;
  now?: number;
}

function mergeFolders(
  localFolders: readonly LibraryFolder[],
  remoteFolders: readonly LibraryFolder[],
): LibraryFolder[] {
  const map = new Map<string, LibraryFolder>();
  for (const f of localFolders) map.set(f.id, { ...f });
  for (const rf of remoteFolders) {
    const existing = map.get(rf.id);
    if (!existing) {
      map.set(rf.id, { ...rf });
    } else if (rf.updatedAt > existing.updatedAt) {
      map.set(rf.id, { ...rf });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function makeConflictRemoteName(remoteName: string, stamp: number): string {
  const stem = remoteName.replace(/\.pdf$/i, '');
  const d = new Date(stamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  const tag = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stem} (Conflict ${tag}).pdf`;
}

export function buildSyncPlan(input: MergeSyncInputs): SyncPlan {
  const now = input.now ?? Date.now();
  const lastSync = input.lastSyncedAt ?? 0;
  const remoteFolders = input.remoteManifest?.folders ?? [];
  const mergedFolders = mergeFolders(input.localFolders, remoteFolders);

  const remoteById = new Map<string, SyncItemRecord>();
  const remoteByName = new Map<string, SyncItemRecord>();
  for (const r of input.remoteManifest?.items ?? []) {
    remoteById.set(r.id, r);
    remoteByName.set(r.remoteName.toLowerCase(), r);
  }

  const remoteFileMap = new Map<string, RemoteFileEntry>();
  for (const rf of input.remoteFiles) {
    if (/\.pdf$/i.test(rf.name)) {
      remoteFileMap.set(rf.name.toLowerCase(), rf);
    }
  }

  const mergedById = new Map<string, SyncItemRecord>();
  const matchedRemoteIds = new Set<string>();
  const toUpload: SyncItemRecord[] = [];
  const toDownload: SyncItemRecord[] = [];
  const conflictCopies: SyncPlan['conflictCopies'] = [];
  const toDeleteRemote: string[] = [];

  // 1. Reconcile all local items against remote manifest
  for (const local of input.localItems) {
    const remote = remoteById.get(local.id) ?? remoteByName.get(local.remoteName.toLowerCase());
    if (!remote) {
      // Exists only locally (either new local doc, or first sync)
      mergedById.set(local.id, { ...local });
      if (!local.trashedAt) {
        toUpload.push(local);
      }
      continue;
    }

    matchedRemoteIds.add(remote.id);

    const localEdited = local.updatedAt > lastSync;
    const remoteEdited = remote.updatedAt > lastSync;
    const contentDiffers =
      (local.contentHash && remote.contentHash && local.contentHash !== remote.contentHash)
      || (!local.contentHash && !remote.contentHash && local.sizeBytes !== remote.sizeBytes);

    if (lastSync > 0 && localEdited && remoteEdited && contentDiffers && !local.trashedAt && !remote.trashedAt) {
      // True two-sided edit conflict: keep newer version at original name, preserve older copy!
      if (local.updatedAt >= remote.updatedAt) {
        mergedById.set(local.id, { ...local });
        toUpload.push(local);
        const conflictName = makeConflictRemoteName(remote.remoteName, remote.updatedAt || now);
        const conflictItem: SyncItemRecord = {
          ...remote,
          id: `${remote.id}-conflict-${now}`,
          title: conflictName.replace(/\.pdf$/i, ''),
          remoteName: conflictName,
          updatedAt: now,
        };
        mergedById.set(conflictItem.id, conflictItem);
        conflictCopies.push({ sourceRemoteName: remote.remoteName, conflictItem });
      } else {
        const winning: SyncItemRecord = { ...remote, id: local.id };
        mergedById.set(local.id, winning);
        toDownload.push(winning);
        const conflictName = makeConflictRemoteName(local.remoteName, local.updatedAt || now);
        const conflictItem: SyncItemRecord = {
          ...local,
          id: `${local.id}-conflict-${now}`,
          title: conflictName.replace(/\.pdf$/i, ''),
          remoteName: conflictName,
          updatedAt: now,
        };
        mergedById.set(conflictItem.id, conflictItem);
        toUpload.push(conflictItem);
      }
      continue;
    }

    // Non-conflict reconciliation by updatedAt
    if (local.updatedAt > remote.updatedAt) {
      mergedById.set(local.id, { ...local });
      if (local.trashedAt && !remote.trashedAt) {
        toDeleteRemote.push(remote.remoteName);
      } else if (!local.trashedAt && (contentDiffers || !remoteFileMap.has(local.remoteName.toLowerCase()))) {
        toUpload.push(local);
      }
    } else if (remote.updatedAt > local.updatedAt) {
      const updated: SyncItemRecord = { ...remote, id: local.id };
      mergedById.set(local.id, updated);
      if (!remote.trashedAt && contentDiffers) {
        toDownload.push(updated);
      }
    } else {
      // Same timestamp — keep local, upload if remote file is missing
      mergedById.set(local.id, { ...local });
      if (!local.trashedAt && !remoteFileMap.has(local.remoteName.toLowerCase())) {
        toUpload.push(local);
      }
    }
  }

  // 2. Remote manifest items not yet on this device -> download
  for (const remote of input.remoteManifest?.items ?? []) {
    if (matchedRemoteIds.has(remote.id)) continue;
    mergedById.set(remote.id, { ...remote });
    if (!remote.trashedAt && remoteFileMap.has(remote.remoteName.toLowerCase())) {
      toDownload.push(remote);
    }
  }

  // 3. Unindexed PDF files dropped straight into the cloud folder (e.g. via Finder/Explorer/Files)
  const knownNames = new Set(Array.from(mergedById.values()).map((i) => i.remoteName.toLowerCase()));
  for (const rf of input.remoteFiles) {
    if (!/\.pdf$/i.test(rf.name)) continue;
    if (knownNames.has(rf.name.toLowerCase())) continue;
    const discovered: SyncItemRecord = {
      id: `cloud-${rf.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${rf.size}`,
      title: rf.name.replace(/\.pdf$/i, ''),
      remoteName: rf.name,
      kind: 'pdf',
      folderId: null,
      coverTheme: 'none',
      favorite: false,
      pageCount: 1,
      sizeBytes: rf.size,
      createdAt: rf.updatedAt || now,
      updatedAt: rf.updatedAt || now,
      lastOpenedAt: 0,
      trashedAt: null,
    };
    mergedById.set(discovered.id, discovered);
    toDownload.push(discovered);
  }

  return {
    mergedFolders,
    mergedItems: Array.from(mergedById.values()),
    toUpload,
    toDownload,
    conflictCopies,
    toDeleteRemote,
  };
}
