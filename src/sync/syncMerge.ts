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
 * - Two different documents that merely share a file name are never merged
 *   into one: unless their content is provably identical, both are kept.
 * - Permanently deleted documents are kept as tombstones (`deletedAt`) so they
 *   do not come back from another device's copy.
 */

import type { LibraryFolder } from '../platform/ipadLibrary';
import type { RemoteFileEntry, SyncItemRecord, SyncManifest, SyncPlan, SyncTombstone } from './syncTypes';

export interface MergeSyncInputs {
  localFolders: readonly LibraryFolder[];
  localItems: readonly SyncItemRecord[];
  /** Documents permanently deleted on this device since the last successful sync. */
  localTombstones?: readonly SyncTombstone[];
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

function makeConflictRemoteName(remoteName: string, stamp: number, taken: Set<string>): string {
  const stem = remoteName.replace(/\.pdf$/i, '');
  const d = new Date(stamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  const tag = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  // Two conflicts in the same minute must not share a file and overwrite each other.
  let name = `${stem} (Conflict ${tag}).pdf`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem} (Conflict ${tag} ${n}).pdf`;
  taken.add(name.toLowerCase());
  return name;
}

function tombstoneRecord(t: SyncTombstone): SyncItemRecord {
  return {
    id: t.id,
    title: t.remoteName.replace(/\.pdf$/i, ''),
    remoteName: t.remoteName,
    kind: 'pdf',
    folderId: null,
    favorite: false,
    pageCount: 0,
    sizeBytes: 0,
    createdAt: t.deletedAt,
    updatedAt: t.deletedAt,
    lastOpenedAt: 0,
    // Also trashed, so older app versions that ignore `deletedAt` never download it.
    trashedAt: t.deletedAt,
    deletedAt: t.deletedAt,
  };
}

export function buildSyncPlan(input: MergeSyncInputs): SyncPlan {
  const now = input.now ?? Date.now();
  const lastSync = input.lastSyncedAt ?? 0;
  const remoteFolders = input.remoteManifest?.folders ?? [];
  const mergedFolders = mergeFolders(input.localFolders, remoteFolders);
  const tombById = new Map((input.localTombstones ?? []).map((t) => [t.id, t]));

  const remoteById = new Map<string, SyncItemRecord>();
  const remoteByName = new Map<string, SyncItemRecord>();
  for (const r of input.remoteManifest?.items ?? []) {
    remoteById.set(r.id, r);
    // A tombstone's name is free for reuse: never match a live local doc to it by name.
    if (!r.deletedAt) remoteByName.set(r.remoteName.toLowerCase(), r);
  }

  const remoteFileMap = new Map<string, RemoteFileEntry>();
  for (const rf of input.remoteFiles) {
    if (/\.pdf$/i.test(rf.name)) {
      remoteFileMap.set(rf.name.toLowerCase(), rf);
    }
  }

  // Every name in use on either side, so generated conflict names never collide.
  const takenNames = new Set<string>([
    ...remoteFileMap.keys(),
    ...Array.from(remoteById.values()).map((r) => r.remoteName.toLowerCase()),
    ...input.localItems.map((l) => l.remoteName.toLowerCase()),
  ]);

  const mergedById = new Map<string, SyncItemRecord>();
  const matchedRemoteIds = new Set<string>();
  const toUpload: SyncItemRecord[] = [];
  const toDownload: SyncItemRecord[] = [];
  const conflictCopies: SyncPlan['conflictCopies'] = [];
  const toDeleteRemote: string[] = [];
  const toDeleteLocal: string[] = [];

  // 1. Reconcile all local items against remote manifest
  for (const local of input.localItems) {
    let remote = remoteById.get(local.id);
    if (!remote) {
      const byName = remoteByName.get(local.remoteName.toLowerCase());
      const sameContent = Boolean(byName && local.contentHash && byName.contentHash && local.contentHash === byName.contentHash);
      if (byName && !matchedRemoteIds.has(byName.id) && sameContent) {
        // Same file added independently on two devices: safe to treat as one.
        remote = byName;
      } else if (byName || remoteFileMap.has(local.remoteName.toLowerCase())) {
        // A DIFFERENT remote document (or an unindexed remote file whose content
        // we cannot compare) uses this name. Matching by name would let one
        // overwrite the other, so keep both: move the local one to a new name.
        const newName = makeConflictRemoteName(local.remoteName, now, takenNames);
        const relocated: SyncItemRecord = {
          ...local,
          title: newName.replace(/\.pdf$/i, ''),
          remoteName: newName,
          updatedAt: Math.max(local.updatedAt, now),
          relocateLocal: true,
        };
        mergedById.set(local.id, relocated);
        if (!local.trashedAt) toUpload.push(relocated);
        continue;
      }
    }
    if (!remote) {
      // Exists only locally (either new local doc, or first sync)
      mergedById.set(local.id, { ...local });
      if (!local.trashedAt) {
        toUpload.push(local);
      }
      continue;
    }

    matchedRemoteIds.add(remote.id);

    if (remote.deletedAt) {
      if (local.updatedAt > remote.deletedAt) {
        // Edited here after the other device deleted it: the edit wins, revive it.
        mergedById.set(local.id, { ...local, deletedAt: null });
        if (!local.trashedAt) toUpload.push(local);
      } else {
        mergedById.set(local.id, { ...remote, id: local.id });
        toDeleteLocal.push(local.id);
      }
      continue;
    }

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
        const conflictName = makeConflictRemoteName(remote.remoteName, remote.updatedAt || now, takenNames);
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
        const conflictName = makeConflictRemoteName(local.remoteName, local.updatedAt || now, takenNames);
        const conflictItem: SyncItemRecord = {
          ...local,
          id: `${local.id}-conflict-${now}`,
          title: conflictName.replace(/\.pdf$/i, ''),
          remoteName: conflictName,
          updatedAt: now,
          // The local edits are still stored under the ORIGINAL id; the sync
          // manager must save and upload them before the winner is downloaded.
          sourceLocalId: local.id,
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
    if (matchedRemoteIds.has(remote.id) || mergedById.has(remote.id)) continue;
    if (remote.deletedAt) {
      // Deleted elsewhere and not here: keep the tombstone for other devices.
      mergedById.set(remote.id, { ...remote });
      continue;
    }
    const tomb = tombById.get(remote.id);
    if (tomb && remote.updatedAt <= tomb.deletedAt) {
      // Permanently deleted here; the remote copy is not newer than the deletion.
      mergedById.set(remote.id, { ...tombstoneRecord(tomb), ...remote, trashedAt: remote.trashedAt ?? tomb.deletedAt, deletedAt: tomb.deletedAt });
      if (remoteFileMap.has(remote.remoteName.toLowerCase())) toDeleteRemote.push(remote.remoteName);
      continue;
    }
    mergedById.set(remote.id, { ...remote });
    if (!remote.trashedAt && remoteFileMap.has(remote.remoteName.toLowerCase())) {
      toDownload.push(remote);
    }
  }

  // 2b. Local deletions the remote never knew about: publish the tombstone.
  for (const tomb of tombById.values()) {
    if (!mergedById.has(tomb.id)) mergedById.set(tomb.id, tombstoneRecord(tomb));
  }

  // 3. Unindexed PDF files dropped straight into the cloud folder (e.g. via Finder/Explorer/Files)
  const knownNames = new Set<string>();
  const tombNames = new Map<string, number>();
  for (const rec of mergedById.values()) {
    if (rec.deletedAt) tombNames.set(rec.remoteName.toLowerCase(), rec.deletedAt);
    else knownNames.add(rec.remoteName.toLowerCase());
  }
  for (const rf of input.remoteFiles) {
    if (!/\.pdf$/i.test(rf.name)) continue;
    const key = rf.name.toLowerCase();
    if (knownNames.has(key)) continue;
    // A leftover file of a deleted document is not a new document, unless it
    // was written after the deletion.
    const deletedAt = tombNames.get(key);
    if (deletedAt !== undefined && !(rf.updatedAt > deletedAt)) continue;
    const discovered: SyncItemRecord = {
      id: `cloud-${key.replace(/[^a-z0-9]+/g, '-')}-${rf.size}`,
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
    toDeleteLocal,
  };
}
