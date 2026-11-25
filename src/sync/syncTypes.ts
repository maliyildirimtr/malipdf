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
  /** Lightweight content fingerprint (size + FNV-1a sample hash) for conflict detection. */
  contentHash?: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  trashedAt: number | null;
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
  readManifest(): Promise<SyncManifest | null>;
  writeManifest(manifest: SyncManifest): Promise<void>;
  readPdf(remoteName: string): Promise<Uint8Array | null>;
  writePdf(remoteName: string, bytes: Uint8Array): Promise<void>;
  deletePdf(remoteName: string): Promise<void>;
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
}

/** Fast deterministic content fingerprint for PDF bytes (size + sampled FNV-1a). */
export function fingerprintPdfBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  const len = bytes.byteLength;
  const stride = Math.max(1, Math.floor(len / 4096));
  for (let i = 0; i < len; i += stride) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  // Always mix tail bytes where PDF incremental updates / MaliPDF annotations live
  const tailStart = Math.max(0, len - 256);
  for (let i = tailStart; i < len; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${len}:${(h >>> 0).toString(16)}`;
}

/** Extracts a safe single-segment PDF filename for shared sync storage. */
export function remoteNameForDocument(doc: Pick<LibraryDocument, 'filePath' | 'title'>): string {
  const fromPath = doc.filePath?.split(/[\\/]/).pop();
  const base = (fromPath || doc.title || 'Untitled.pdf').replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').trim() || 'Untitled.pdf';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}
