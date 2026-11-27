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
import type {
  RemoteFileEntry,
  SyncFolderTombstone,
  SyncItemRecord,
  SyncManifest,
  SyncPlan,
  SyncTombstone,
} from './syncTypes';

/**
 * Grace window (10 minutes) when an unindexed cloud PDF shares a deleted
 * document's filename: iCloud's daemon on another device often materializes
 * the old file a few seconds *after* `deletedAt` (or with slight clock skew)
 * before unlinking it. Within this window, clean up the lingering file instead
 * of resurrecting it as a brand-new `cloud-...` document.
 */
const TOMBSTONE_GRACE_MS = 10 * 60 * 1000;

export interface MergeSyncInputs {
  localFolders: readonly LibraryFolder[];
  localItems: readonly SyncItemRecord[];
  /** Documents permanently deleted on this device since the last successful sync. */
  localTombstones?: readonly SyncTombstone[];
  /** Cloud folders deleted on this device since the last successful sync. */
  localFolderTombstones?: readonly SyncFolderTombstone[];
  remoteManifest: SyncManifest | null;
  remoteFiles: readonly RemoteFileEntry[];
  lastSyncedAt: number | null;
  now?: number;
}

function mergeFolders(
  localFolders: readonly LibraryFolder[],
  remoteFolders: readonly LibraryFolder[],
  localFolderTombstones: readonly SyncFolderTombstone[],
): LibraryFolder[] {
  const map = new Map<string, LibraryFolder>();
  for (const f of localFolders) map.set(f.id, { ...f });
  for (const rf of remoteFolders) {
    const existing = map.get(rf.id);
    if (!existing) {
      map.set(rf.id, { ...rf });
    } else if (rf.deletedAt && (!existing.deletedAt || rf.deletedAt >= existing.updatedAt)) {
      map.set(rf.id, { ...rf });
    } else if (!rf.deletedAt && existing.deletedAt) {
      if (rf.updatedAt > existing.deletedAt) {
        map.set(rf.id, { ...rf, deletedAt: null });
      }
    } else if (rf.updatedAt > existing.updatedAt) {
      map.set(rf.id, { ...rf });
    }
  }
  for (const tomb of localFolderTombstones) {
    const existing = map.get(tomb.id);
    const stamp = Math.max(tomb.deletedAt, (existing?.updatedAt ?? 0) + 1);
    if (existing) {
      map.set(tomb.id, {
        ...existing,
        favorite: false,
        updatedAt: stamp,
        deletedAt: stamp,
      });
    } else {
      map.set(tomb.id, {
        id: tomb.id,
        name: tomb.name || 'Deleted Folder',
        color: 'blue',
        parentId: null,
        scope: 'cloud',
        favorite: false,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: stamp,
      });
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
  const mergedFolders = mergeFolders(input.localFolders, remoteFolders, input.localFolderTombstones ?? []);
  const deletedFolderIds = new Set(mergedFolders.filter((f) => f.deletedAt).map((f) => f.id));
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
  const toDeleteRemoteSet = new Set<string>();
  const toDeleteLocal: string[] = [];

  const queueRemoteDelete = (remoteName: string) => {
    if (remoteName) toDeleteRemoteSet.add(remoteName);
  };

  // 1. Reconcile all local items against remote manifest
  for (const local of input.localItems) {
    const localTomb = tombById.get(local.id);
    if (localTomb) {
      const remote = remoteById.get(local.id);
      if (remote) matchedRemoteIds.add(remote.id);
      const stamp = Math.max(localTomb.deletedAt, local.updatedAt, (remote?.updatedAt ?? 0) + 1);
      mergedById.set(local.id, {
        ...tombstoneRecord({ ...localTomb, deletedAt: stamp }),
        ...(remote ?? local),
        id: local.id,
        updatedAt: stamp,
        trashedAt: stamp,
        deletedAt: stamp,
      });
      toDeleteLocal.push(local.id);
      queueRemoteDelete(local.remoteName);
      if (remote) queueRemoteDelete(remote.remoteName);
      continue;
    }

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

    const contentDiffers =
      (local.contentHash && remote.contentHash && local.contentHash !== remote.contentHash)
      || (!local.contentHash && !remote.contentHash && local.sizeBytes !== remote.sizeBytes);

    if (remote.deletedAt) {
      // Only revive a remotely deleted doc if THIS device made a real content edit
      // AFTER its last sync and AFTER `remote.deletedAt` (prevents clock skew or
      // metadata touches from resurrecting deleted documents!).
      const genuinelyEditedAfterDelete =
        lastSync > 0
        && !local.trashedAt
        && local.updatedAt > remote.deletedAt
        && local.updatedAt > lastSync
        && Boolean(!remote.contentHash || contentDiffers);
      if (genuinelyEditedAfterDelete) {
        mergedById.set(local.id, { ...local, deletedAt: null });
        toUpload.push(local);
      } else {
        mergedById.set(local.id, { ...remote, id: local.id });
        toDeleteLocal.push(local.id);
        if (remoteFileMap.has(remote.remoteName.toLowerCase())) {
          queueRemoteDelete(remote.remoteName);
        }
      }
      continue;
    }

    const localEdited = local.updatedAt > lastSync;
    const remoteEdited = remote.updatedAt > lastSync;

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
      if (local.trashedAt) {
        queueRemoteDelete(remote.remoteName);
        if (local.remoteName.toLowerCase() !== remote.remoteName.toLowerCase()) {
          queueRemoteDelete(local.remoteName);
        }
      } else if (contentDiffers || !remoteFileMap.has(local.remoteName.toLowerCase())) {
        toUpload.push(local);
      }
    } else if (remote.updatedAt > local.updatedAt) {
      const updated: SyncItemRecord = { ...remote, id: local.id };
      mergedById.set(local.id, updated);
      if (remote.trashedAt) {
        if (remoteFileMap.has(remote.remoteName.toLowerCase())) {
          queueRemoteDelete(remote.remoteName);
        }
      } else if (contentDiffers) {
        toDownload.push(updated);
      }
    } else {
      // Same timestamp — keep local. Only upload a missing remote file on the
      // very first sync (`lastSync === 0`) or when edited locally since `lastSync`:
      // in iCloud Drive, another device's PDF deletion often arrives 1–2s BEFORE
      // its `library-sync.json` update, so re-uploading an unchanged pre-sync doc
      // here would resurrect a file the other device just deleted!
      mergedById.set(local.id, { ...local });
      if (!local.trashedAt && !remoteFileMap.has(local.remoteName.toLowerCase()) && (lastSync === 0 || localEdited)) {
        toUpload.push(local);
      }
    }
  }

  // 2. Remote manifest items not yet on this device -> download (unless deleted here)
  for (const remote of input.remoteManifest?.items ?? []) {
    if (matchedRemoteIds.has(remote.id) || mergedById.has(remote.id)) continue;
    if (remote.deletedAt) {
      // Deleted elsewhere and not here: keep the tombstone for other devices.
      mergedById.set(remote.id, { ...remote });
      if (remoteFileMap.has(remote.remoteName.toLowerCase())) {
        queueRemoteDelete(remote.remoteName);
      }
      continue;
    }
    const tomb = tombById.get(remote.id);
    if (tomb) {
      // Permanently deleted on THIS device since last sync: unless the remote was
      // edited strictly after both `lastSync` and `tomb.deletedAt` (true newer edit),
      // the local deletion wins even if device clocks differ by a few seconds!
      const remoteEditedAfterLocalDelete =
        lastSync > 0 && remote.updatedAt > tomb.deletedAt && remote.updatedAt > lastSync;
      if (!remoteEditedAfterLocalDelete) {
        const stamp = Math.max(tomb.deletedAt, remote.updatedAt + 1);
        mergedById.set(remote.id, {
          ...tombstoneRecord(tomb),
          ...remote,
          updatedAt: stamp,
          trashedAt: remote.trashedAt ?? stamp,
          deletedAt: stamp,
        });
        if (remoteFileMap.has(remote.remoteName.toLowerCase())) queueRemoteDelete(remote.remoteName);
        continue;
      }
    }
    mergedById.set(remote.id, { ...remote });
    if (remote.trashedAt) {
      if (remoteFileMap.has(remote.remoteName.toLowerCase())) queueRemoteDelete(remote.remoteName);
    } else if (remoteFileMap.has(remote.remoteName.toLowerCase())) {
      toDownload.push(remote);
    }
  }

  // 2b. Local deletions the remote never knew about: publish the tombstone & remove lingering PDF.
  for (const tomb of tombById.values()) {
    if (!mergedById.has(tomb.id)) {
      mergedById.set(tomb.id, tombstoneRecord(tomb));
      if (remoteFileMap.has(tomb.remoteName.toLowerCase())) {
        queueRemoteDelete(tomb.remoteName);
      }
    }
  }

  // 2c. Detach items from deleted cloud folders & guarantee trashed/deleted remote PDFs are cleaned up.
  for (const [id, rec] of mergedById) {
    if (rec.folderId && deletedFolderIds.has(rec.folderId)) {
      mergedById.set(id, { ...rec, folderId: null });
    }
    if ((rec.deletedAt || rec.trashedAt) && remoteFileMap.has(rec.remoteName.toLowerCase())) {
      queueRemoteDelete(rec.remoteName);
    }
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
    // A leftover file of a deleted document is not a new document; within the
    // grace window (clock skew / iCloud daemon materialization lag), delete the
    // lingering file instead of resurrecting it!
    const deletedAt = tombNames.get(key);
    if (deletedAt !== undefined && rf.updatedAt <= deletedAt + TOMBSTONE_GRACE_MS) {
      queueRemoteDelete(rf.name);
      continue;
    }
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
    toDeleteRemote: Array.from(toDeleteRemoteSet),
    toDeleteLocal,
  };
}
