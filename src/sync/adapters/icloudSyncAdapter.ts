/**
 * iCloud Drive Sync Adapter (Apple Ecosystem: Mac · iPad · iPhone + iCloud for Windows).
 *
 * - On Mac & Windows Desktop: automatically connects to the system iCloud Drive
 *   `MaliPDF` folder via Electron's trusted sync folder IPC.
 * - On iPadOS / iOS: bridges with the app's Files / iCloud container (`DOCUMENTS`)
 *   using the exact same `library-sync.json` + `.pdf` format.
 */

import { base64ToBytes, bytesToBase64, callNative, isIpadApp } from '../../platform/native';
import { useSyncStore } from '../../store/syncStore';
import type { RemoteFileEntry, SyncAdapter, SyncManifest } from '../syncTypes';

const MANIFEST_NAME = 'library-sync.json';
const DOCUMENTS = 'DOCUMENTS';

export class ICloudSyncAdapter implements SyncAdapter {
  readonly id = 'icloud' as const;

  private async resolveDesktopICloudPath(): Promise<string | null> {
    if (!window.electronAPI?.syncDetectCloudFolders) return null;
    const detected = await window.electronAPI.syncDetectCloudFolders();
    return detected.find((d) => d.id === 'icloud')?.path ?? null;
  }

  async isAvailable(): Promise<boolean> {
    if (isIpadApp()) return true;
    return Boolean(await this.resolveDesktopICloudPath());
  }

  async isConnected(): Promise<boolean> {
    if (isIpadApp()) return true;
    const path = useSyncStore.getState().folderPath ?? (await this.resolveDesktopICloudPath());
    return Boolean(path);
  }

  async connect(): Promise<boolean> {
    if (isIpadApp()) return true;
    const icloudPath = await this.resolveDesktopICloudPath();
    if (!icloudPath || !window.electronAPI?.syncActivateFolder) return false;
    const activated = await window.electronAPI.syncActivateFolder(icloudPath);
    useSyncStore.getState().setFolderPath(activated);
    return true;
  }

  async disconnect(): Promise<void> {
    // Keep local files untouched on disconnect
  }

  async readManifest(): Promise<SyncManifest | null> {
    if (isIpadApp()) {
      try {
        const res = await callNative<{ data: string }>('Filesystem', 'readFile', {
          path: MANIFEST_NAME,
          directory: DOCUMENTS,
          encoding: 'utf8',
        });
        const parsed = JSON.parse(res.data) as SyncManifest;
        return parsed?.version === 1 ? parsed : null;
      } catch {
        return null;
      }
    }
    const folder = useSyncStore.getState().folderPath ?? (await this.resolveDesktopICloudPath());
    if (!folder || !window.electronAPI?.syncReadFile) return null;
    await window.electronAPI.syncActivateFolder!(folder);
    const buf = await window.electronAPI.syncReadFile(folder, MANIFEST_NAME);
    if (!buf) return null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(buf))) as SyncManifest;
      return parsed?.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    const json = JSON.stringify(manifest, null, 2);
    if (isIpadApp()) {
      await callNative('Filesystem', 'writeFile', {
        path: MANIFEST_NAME,
        directory: DOCUMENTS,
        data: json,
        encoding: 'utf8',
        recursive: true,
      });
      return;
    }
    const folder = useSyncStore.getState().folderPath ?? (await this.resolveDesktopICloudPath());
    if (!folder || !window.electronAPI?.syncWriteFile) throw new Error('iCloud Drive folder not found.');
    await window.electronAPI.syncActivateFolder!(folder);
    const enc = new TextEncoder().encode(json);
    await window.electronAPI.syncWriteFile(folder, MANIFEST_NAME, enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength));
  }

  async readPdf(remoteName: string): Promise<Uint8Array | null> {
    if (isIpadApp()) {
      try {
        const res = await callNative<{ data: string }>('Filesystem', 'readFile', {
          path: remoteName,
          directory: DOCUMENTS,
        });
        return base64ToBytes(res.data);
      } catch {
        return null;
      }
    }
    const folder = useSyncStore.getState().folderPath ?? (await this.resolveDesktopICloudPath());
    if (!folder || !window.electronAPI?.syncReadFile) return null;
    const buf = await window.electronAPI.syncReadFile(folder, remoteName);
    return buf ? new Uint8Array(buf) : null;
  }

  async writePdf(remoteName: string, bytes: Uint8Array): Promise<void> {
    if (isIpadApp()) {
      await callNative('Filesystem', 'writeFile', {
        path: remoteName,
        directory: DOCUMENTS,
        data: bytesToBase64(bytes),
        recursive: true,
      });
      return;
    }
    const folder = useSyncStore.getState().folderPath ?? (await this.resolveDesktopICloudPath());
    if (!folder || !window.electronAPI?.syncWriteFile) throw new Error('iCloud Drive folder not found.');
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await window.electronAPI.syncWriteFile(folder, remoteName, ab);
  }

  async deletePdf(remoteName: string): Promise<void> {
    if (isIpadApp()) {
      await callNative('Filesystem', 'deleteFile', { path: remoteName, directory: DOCUMENTS }).catch(() => undefined);
      return;
    }
    const folder = useSyncStore.getState().folderPath ?? (await this.resolveDesktopICloudPath());
    if (!folder || !window.electronAPI?.syncDeleteFile) return;
    await window.electronAPI.syncDeleteFile(folder, remoteName);
  }

  async listRemotePdfs(): Promise<RemoteFileEntry[]> {
    if (isIpadApp()) {
      try {
        const res = await callNative<{ files: Array<{ name: string; size?: number; mtime?: number } | string> }>('Filesystem', 'readdir', {
          path: '',
          directory: DOCUMENTS,
        });
        return (res.files ?? [])
          .map((f) => (typeof f === 'string' ? { name: f, size: 0, updatedAt: Date.now() } : { name: f.name, size: f.size ?? 0, updatedAt: f.mtime ?? Date.now() }))
          .filter((f) => /\.pdf$/i.test(f.name));
      } catch {
        return [];
      }
    }
    const folder = useSyncStore.getState().folderPath ?? (await this.resolveDesktopICloudPath());
    if (!folder || !window.electronAPI?.syncList) return [];
    const entries = await window.electronAPI.syncList(folder);
    return entries.filter((e) => /\.pdf$/i.test(e.name));
  }
}
