/**
 * Desktop Folder Sync Adapter (Mac & Windows).
 *
 * Syncs MaliPDF's shared `library-sync.json` + `.pdf` documents with ANY local
 * or desktop-synced cloud folder: iCloud Drive, Google Drive for Desktop,
 * OneDrive, Dropbox, or a user-chosen folder.
 */

import { useSyncStore } from '../../store/syncStore';
import type { RemoteFileEntry, SyncAdapter, SyncManifest } from '../syncTypes';

const MANIFEST_NAME = 'library-sync.json';

function hasDesktopSyncIPC(): boolean {
  return Boolean(
    typeof window !== 'undefined'
    && window.electronAPI?.syncList
    && window.electronAPI?.syncReadFile
    && window.electronAPI?.syncWriteFile,
  );
}

export class FolderSyncAdapter implements SyncAdapter {
  readonly id = 'folder' as const;

  private getFolder(): string | null {
    return useSyncStore.getState().folderPath;
  }

  async isAvailable(): Promise<boolean> {
    return hasDesktopSyncIPC();
  }

  async isConnected(): Promise<boolean> {
    return hasDesktopSyncIPC() && Boolean(this.getFolder());
  }

  async connect(options?: Record<string, unknown>): Promise<boolean> {
    if (!hasDesktopSyncIPC()) return false;
    let folder = typeof options?.folderPath === 'string' ? options.folderPath : this.getFolder();
    if (!folder) {
      folder = (await window.electronAPI.chooseFolder?.('Choose MaliPDF Sync Folder')) ?? null;
    }
    if (!folder) return false;
    const activated = await window.electronAPI.syncActivateFolder!(folder);
    useSyncStore.getState().setFolderPath(activated);
    return true;
  }

  async disconnect(): Promise<void> {
    useSyncStore.getState().setFolderPath(null);
  }

  async readManifest(): Promise<SyncManifest | null> {
    const folder = this.getFolder();
    if (!folder || !hasDesktopSyncIPC()) return null;
    await window.electronAPI.syncActivateFolder!(folder);
    const buf = await window.electronAPI.syncReadFile!(folder, MANIFEST_NAME);
    if (!buf) return null;
    try {
      const text = new TextDecoder().decode(new Uint8Array(buf));
      const parsed = JSON.parse(text) as SyncManifest;
      return parsed?.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    const folder = this.getFolder();
    if (!folder || !hasDesktopSyncIPC()) throw new Error('Sync folder not configured.');
    await window.electronAPI.syncActivateFolder!(folder);
    const encoded = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    await window.electronAPI.syncWriteFile!(folder, MANIFEST_NAME, ab);
  }

  async readPdf(remoteName: string): Promise<Uint8Array | null> {
    const folder = this.getFolder();
    if (!folder || !hasDesktopSyncIPC()) return null;
    const buf = await window.electronAPI.syncReadFile!(folder, remoteName);
    return buf ? new Uint8Array(buf) : null;
  }

  async writePdf(remoteName: string, bytes: Uint8Array): Promise<void> {
    const folder = this.getFolder();
    if (!folder || !hasDesktopSyncIPC()) throw new Error('Sync folder not configured.');
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await window.electronAPI.syncWriteFile!(folder, remoteName, ab);
  }

  async deletePdf(remoteName: string): Promise<void> {
    const folder = this.getFolder();
    if (!folder || !hasDesktopSyncIPC()) return;
    await window.electronAPI.syncDeleteFile!(folder, remoteName);
  }

  async listRemotePdfs(): Promise<RemoteFileEntry[]> {
    const folder = this.getFolder();
    if (!folder || !hasDesktopSyncIPC()) return [];
    const entries = await window.electronAPI.syncList!(folder);
    return entries.filter((e) => /\.pdf$/i.test(e.name));
  }
}
