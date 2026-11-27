/**
 * Desktop Folder Sync Adapter (Mac & Windows).
 *
 * Syncs MaliPDF's shared `library-sync.json` + `.pdf` documents with ANY local
 * or desktop-synced cloud folder: iCloud Drive, Google Drive for Desktop,
 * OneDrive, Dropbox, or a user-chosen folder.
 */

import { useSyncStore } from '../../store/syncStore';
import {
  LEGACY_MANIFEST_NAME,
  deviceManifestFileName,
  isManifestFileName,
  mergeSyncManifests,
  parseSyncManifest,
  type RemoteFileEntry,
  type SyncAdapter,
  type SyncManifest,
} from '../syncTypes';

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

  /**
   * Returns null ONLY when there is no manifest file yet. Any other failure
   * (IPC/disk error, partial write, bad JSON, unknown version) throws: treating
   * it as "no manifest" would make the sync re-upload every local document
   * over possibly newer remote files.
   */
  async readManifest(): Promise<SyncManifest | null> {
    const folder = this.getFolder();
    if (!folder || !hasDesktopSyncIPC()) throw new Error('Sync folder not configured.');
    await window.electronAPI.syncActivateFolder!(folder);
    const entries = await window.electronAPI.syncList!(folder);
    const listedNames = entries.map((e) => e.name).filter(isManifestFileName);
    const hasPerDevice = listedNames.some((n) => n.toLowerCase() !== LEGACY_MANIFEST_NAME);
    const manifestNames = Array.from(new Set([...listedNames, LEGACY_MANIFEST_NAME]));

    const manifests: SyncManifest[] = [];
    for (const name of manifestNames) {
      try {
        const buf = await window.electronAPI.syncReadFile!(folder, name);
        if (!buf) continue;
        manifests.push(parseSyncManifest(new Uint8Array(buf)));
      } catch (err) {
        if (hasPerDevice && name.toLowerCase() === LEGACY_MANIFEST_NAME) continue;
        throw err;
      }
    }
    return mergeSyncManifests(manifests);
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    const folder = this.getFolder();
    if (!folder || !hasDesktopSyncIPC()) throw new Error('Sync folder not configured.');
    await window.electronAPI.syncActivateFolder!(folder);
    const targetName = deviceManifestFileName(manifest.deviceId);
    const encoded = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    await window.electronAPI.syncWriteFile!(folder, targetName, ab);
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
    if (!folder || !hasDesktopSyncIPC()) throw new Error('Sync folder not configured.');
    const entries = await window.electronAPI.syncList!(folder);
    return entries.filter((e) => /\.pdf$/i.test(e.name));
  }
}
