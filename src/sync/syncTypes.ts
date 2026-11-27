import type { CoverThemeId, LibraryDocument, LibraryFolder } from '../platform/ipadLibrary';

export type SyncProviderId = 'local' | 'icloud' | 'gdrive' | 'folder';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface SyncItemRecord {
  id: string;
  title: string;
  /** Canonical single-segment PDF filename inside the shared MaliPDF sync folder. */
  remoteName: string;
  kind: 'pdf' | 'notebook';
  folderId: string | null;
  coverTheme?: CoverThemeId;
  favorite: boolean;
  pageCount: number;
  sizeBytes: number;
  /** Full-content fingerprint (size + 53-bit hash, see fingerprintPdfBytes) for conflict detection. */
  contentHash?: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  trashedAt: number | null;
  /**
   * Tombstone: set when the document was permanently deleted. The record stays
   * in the shared manifest so other devices delete their copy instead of
   * uploading it again (unless they edited it after this time).
   */
  deletedAt?: number | null;
  /**
   * Plan-only (never written to the manifest): a conflict copy created from a
   * LOCAL document carries the id of that document, because its bytes are
   * still stored under the original id until the copy is written to its own file.
   */
  sourceLocalId?: string;
  /**
   * Plan-only: the local document must be moved to a new file named after
   * `remoteName` before anything is downloaded, because a different remote
   * document with the same file name is about to be downloaded over its path.
   */
  relocateLocal?: boolean;
}

/** A document permanently deleted on this device that the remote has not recorded yet. */
export interface SyncTombstone {
  id: string;
  remoteName: string;
  deletedAt: number;
}

/** A cloud folder deleted on this device that the remote manifest has not recorded yet. */
export interface SyncFolderTombstone {
  id: string;
  name: string;
  deletedAt: number;
}

export interface SyncManifest {
  version: 1;
  updatedAt: number;
  deviceId: string;
  folders: LibraryFolder[];
  items: SyncItemRecord[];
}

export interface RemoteFileEntry {
  name: string;
  size: number;
  updatedAt: number;
}

export interface DetectedCloudFolder {
  id: 'icloud' | 'gdrive' | 'onedrive' | 'dropbox';
  label: string;
  path: string;
}

export interface SyncAdapter {
  readonly id: SyncProviderId;
  isAvailable(): Promise<boolean>;
  isConnected(): Promise<boolean>;
  connect(options?: Record<string, unknown>): Promise<boolean>;
  disconnect(): Promise<void>;
  /**
   * Resolves null ONLY when no manifest exists yet (first sync). Any other
   * failure (network, timeout, permission, partial write, bad JSON) MUST
   * throw, so the sync aborts instead of overwriting newer remote files.
   */
  readManifest(): Promise<SyncManifest | null>;
  writeManifest(manifest: SyncManifest): Promise<void>;
  readPdf(remoteName: string): Promise<Uint8Array | null>;
  writePdf(remoteName: string, bytes: Uint8Array): Promise<void>;
  deletePdf(remoteName: string): Promise<void>;
  /** Throws when the listing fails (an empty result must mean an empty folder). */
  listRemotePdfs(): Promise<RemoteFileEntry[]>;
}

export interface SyncPlan {
  mergedFolders: LibraryFolder[];
  mergedItems: SyncItemRecord[];
  toUpload: SyncItemRecord[];
  toDownload: SyncItemRecord[];
  /** Conflict copies to create locally from remote so neither device's edits are ever lost. */
  conflictCopies: Array<{
    sourceRemoteName: string;
    conflictItem: SyncItemRecord;
  }>;
  toDeleteRemote: string[];
  /** Local document ids deleted on another device (remote tombstone newer than the local copy). */
  toDeleteLocal: string[];
}

/**
 * Deterministic fingerprint of the FULL PDF content (size + cyrb53 hash).
 * Every byte is hashed: a sampled hash misses same-size edits (e.g. an
 * annotation changed in place), which would hide a real conflict and let one
 * side's edits be overwritten.
 */
export function fingerprintPdfBytes(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${len}:${hash.toString(16)}`;
}

/**
 * Parses a manifest file. Throws on anything unreadable so a damaged or
 * half-written manifest is never mistaken for "no manifest yet".
 */
export function parseSyncManifest(bytes: Uint8Array): SyncManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The cloud sync index (library-sync.json) is damaged or incomplete. Sync stopped; nothing was changed.');
  }
  const m = parsed as Partial<SyncManifest> | null;
  if (!m || m.version !== 1 || !Array.isArray(m.items) || !Array.isArray(m.folders)) {
    throw new Error('The cloud sync index was written by an unsupported MaliPDF version. Sync stopped; nothing was changed.');
  }
  return m as SyncManifest;
}

export const LEGACY_MANIFEST_NAME = 'library-sync.json';
export const DEVICE_MANIFEST_PREFIX = 'sync-device-';

/** Each device writes ONLY its own manifest file so iCloud/Cloud folders never hit multi-writer file conflicts. */
export function deviceManifestFileName(deviceId: string): string {
  const safe = (deviceId || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'default';
  return `${DEVICE_MANIFEST_PREFIX}${safe}.json`;
}

export function isManifestFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === LEGACY_MANIFEST_NAME) return true;
  return lower.startsWith(DEVICE_MANIFEST_PREFIX) && lower.endsWith('.json') && !/[\\/]/.test(name);
}

function pickWinningRecord(a: SyncItemRecord, b: SyncItemRecord, canonicalId: string): SyncItemRecord {
  const aDel = a.deletedAt ?? null;
  const bDel = b.deletedAt ?? null;
  if (aDel || bDel) {
    const delRec = aDel && bDel ? (aDel >= bDel ? a : b) : (aDel ? a : b);
    const liveRec = aDel && bDel ? null : (aDel ? b : a);
    const delAt = delRec.deletedAt!;
    if (
      liveRec
      && !liveRec.trashedAt
      && liveRec.updatedAt > delAt
      && Boolean(!delRec.contentHash || (liveRec.contentHash && liveRec.contentHash !== delRec.contentHash))
    ) {
      return { ...liveRec, id: canonicalId, deletedAt: null };
    }
    return {
      ...liveRec,
      ...delRec,
      id: canonicalId,
      updatedAt: Math.max(delRec.updatedAt, delAt),
      trashedAt: delRec.trashedAt ?? delAt,
      deletedAt: delAt,
    };
  }
  if (b.updatedAt > a.updatedAt) {
    return {
      ...a,
      ...b,
      id: canonicalId,
      kind: a.id === canonicalId ? a.kind : b.kind,
      favorite: b.trashedAt ? false : b.favorite,
    };
  }
  if (a.updatedAt > b.updatedAt) {
    return {
      ...b,
      ...a,
      id: canonicalId,
      kind: a.id === canonicalId ? a.kind : b.kind,
      favorite: a.trashedAt ? false : a.favorite,
    };
  }
  // Tie-breaker: prefer record with contentHash or trashedAt
  const base = b.contentHash && !a.contentHash ? b : a;
  return { ...a, ...b, ...base, id: canonicalId };
}

/**
 * Merges per-device manifests (`sync-device-*.json`) and any legacy `library-sync.json`
 * into a single unified remote view without shared-file write contention.
 */
export function mergeSyncManifests(manifests: readonly SyncManifest[]): SyncManifest | null {
  if (manifests.length === 0) return null;
  if (manifests.length === 1) return manifests[0];

  const folderMap = new Map<string, LibraryFolder>();
  let latestUpdatedAt = 0;
  let latestDeviceId = manifests[0].deviceId;

  // Map `remoteName.toLowerCase()` -> canonical non-`cloud-*` ID so if one device
  // discovered a PDF before the creator's manifest arrived (`cloud-...`), its edits
  // merge seamlessly back onto the creator's canonical document ID!
  const canonicalIdByName = new Map<string, string>();
  for (const m of manifests) {
    if (m.updatedAt >= latestUpdatedAt) {
      latestUpdatedAt = m.updatedAt;
      latestDeviceId = m.deviceId;
    }
    for (const item of m.items) {
      if (!item.deletedAt && !item.id.startsWith('cloud-')) {
        const key = item.remoteName.toLowerCase();
        const prevId = canonicalIdByName.get(key);
        if (!prevId) canonicalIdByName.set(key, item.id);
      }
    }
    for (const f of m.folders) {
      const existing = folderMap.get(f.id);
      if (!existing) {
        folderMap.set(f.id, { ...f });
      } else if (f.deletedAt && (!existing.deletedAt || f.deletedAt >= existing.updatedAt)) {
        folderMap.set(f.id, { ...f });
      } else if (!f.deletedAt && existing.deletedAt) {
        if (f.updatedAt > existing.deletedAt) folderMap.set(f.id, { ...f, deletedAt: null });
      } else if (f.updatedAt > existing.updatedAt) {
        folderMap.set(f.id, { ...f });
      }
    }
  }

  const itemMap = new Map<string, SyncItemRecord>();
  for (const m of manifests) {
    for (const raw of m.items) {
      const canonicalFromName =
        raw.id.startsWith('cloud-') && !raw.deletedAt
          ? canonicalIdByName.get(raw.remoteName.toLowerCase())
          : undefined;
      const targetId = canonicalFromName ?? raw.id;
      const existing = itemMap.get(targetId);
      if (!existing) {
        itemMap.set(targetId, { ...raw, id: targetId });
      } else {
        itemMap.set(targetId, pickWinningRecord(existing, raw, targetId));
      }
    }
  }

  return {
    version: 1,
    updatedAt: latestUpdatedAt,
    deviceId: latestDeviceId,
    folders: Array.from(folderMap.values()),
    items: Array.from(itemMap.values()),
  };
}

/** Extracts a safe single-segment PDF filename for shared sync storage. */
export function remoteNameForDocument(doc: Pick<LibraryDocument, 'filePath' | 'title'>): string {
  const fromPath = doc.filePath?.split(/[\\/]/).pop();
  const base = (fromPath || doc.title || 'Untitled.pdf').replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').trim() || 'Untitled.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}
