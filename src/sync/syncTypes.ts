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

/** Extracts a safe single-segment PDF filename for shared sync storage. */
export function remoteNameForDocument(doc: Pick<LibraryDocument, 'filePath' | 'title'>): string {
  const fromPath = doc.filePath?.split(/[\\/]/).pop();
  const base = (fromPath || doc.title || 'Untitled.pdf').replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').trim() || 'Untitled.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}
