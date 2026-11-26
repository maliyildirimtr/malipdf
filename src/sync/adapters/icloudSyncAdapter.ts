/**
 * iCloud Drive Sync Adapter (Apple Ecosystem: Mac · iPad · iPhone + iCloud for Windows).
 *
 * - On Mac & Windows Desktop: automatically connects to the system iCloud Drive
 *   `MaliPDF` container (`iCloud~com~maliyildirimtr~malipdf/Documents`) via Electron IPC.
 * - On iPadOS / iOS: talks directly to the native Apple Ubiquity Container
 *   (`iCloud.com.maliyildirimtr.malipdf/Documents`) via `MaliPDFiCloudBridge`.
 *   Without that bridge (older shell) iCloud is reported UNAVAILABLE: the
 *   app's local Documents folder must never be used as the "remote", or cloud
 *   docs would overwrite/delete local ones while the UI says "synced".
 */

import { base64ToBytes, bytesToBase64, isIpadApp, isIphoneDevice } from '../../platform/native';
import { useSyncStore } from '../../store/syncStore';
import { parseSyncManifest, type RemoteFileEntry, type SyncAdapter, type SyncManifest } from '../syncTypes';

const MANIFEST_NAME = 'library-sync.json';
const noBridgeMessage = () =>
  isIphoneDevice()
    ? 'iCloud Drive sync needs the latest MaliPDF app on this iPhone. Please update the app.'
    : 'iCloud Drive sync needs the latest MaliPDF app on this iPad. Please update the app.';
const icloudOffMessage = () =>
  isIphoneDevice()
    ? 'iCloud Drive is turned off on this iPhone. Enable iCloud Drive in Settings › Apple Account › iCloud.'
    : 'iCloud Drive is turned off on this iPad. Enable iCloud Drive in Settings › Apple Account › iCloud.';

interface NativeICloudReply {
  id: string;
  ok: boolean;
  available?: boolean;
  files?: RemoteFileEntry[];
  data?: string | null;
  error?: string;
}

type WebKitWindow = Window & {
  webkit?: {
    messageHandlers?: {
      malipdfICloud?: { postMessage: (msg: Record<string, unknown>) => void };
    };
  };
  __malipdfICloudResolve?: (reply: NativeICloudReply) => void;
};

let nextReqId = 1;
const pendingNative = new Map<string, { resolve: (r: NativeICloudReply) => void; reject: (e: Error) => void }>();

function hasNativeICloudBridge(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as WebKitWindow).webkit?.messageHandlers?.malipdfICloud);
}

function callNativeICloud(op: string, extra?: Record<string, unknown>): Promise<NativeICloudReply> {
  const win = window as WebKitWindow;
  const handler = win.webkit?.messageHandlers?.malipdfICloud;
  if (!handler) {
    return Promise.reject(new Error(noBridgeMessage()));
  }
  if (!win.__malipdfICloudResolve) {
    win.__malipdfICloudResolve = (reply: NativeICloudReply) => {
      const entry = pendingNative.get(reply.id);
      if (!entry) return;
      pendingNative.delete(reply.id);
      if (reply.ok) entry.resolve(reply);
      else entry.reject(new Error(reply.error || 'iCloud operation failed.'));
    };
  }
  const id = `ic_${Date.now()}_${nextReqId++}`;
  return new Promise<NativeICloudReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingNative.delete(id)) reject(new Error('iCloud request timed out.'));
    }, 20000);
    pendingNative.set(id, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    handler.postMessage({ id, op, ...extra });
  });
}

export class ICloudSyncAdapter implements SyncAdapter {
  readonly id = 'icloud' as const;

  private async resolveDesktopICloudPath(): Promise<string | null> {
    if (!window.electronAPI?.syncDetectCloudFolders) return null;
    const detected = await window.electronAPI.syncDetectCloudFolders();
    return detected.find((d) => d.id === 'icloud')?.path ?? null;
  }

  private async desktopFolder(): Promise<string> {
    // Always check live detected iCloud path first when available so macOS
    // automatically upgrades from a fallback CloudDocs path to the real
    // iCloud~com~maliyildirimtr~malipdf/Documents container shared with iPad & iPhone.
    const liveDetected = await this.resolveDesktopICloudPath();
    const saved = useSyncStore.getState().folderPath;
    const folder = liveDetected ?? saved;
    if (!folder || !window.electronAPI?.syncReadFile) throw new Error('iCloud Drive folder not found.');
    if (liveDetected && liveDetected !== saved) {
      useSyncStore.getState().setFolderPath(liveDetected);
    }
    return folder;
  }

  async isAvailable(): Promise<boolean> {
    if (isIpadApp()) {
      if (!hasNativeICloudBridge()) return false;
      try {
        const res = await callNativeICloud('status');
        return Boolean(res.available);
      } catch {
        return false;
      }
    }
    if (await this.resolveDesktopICloudPath()) return true;
    // In the Mac App Store sandbox, ~/Library/Mobile Documents requires a one-time user folder selection.
    return Boolean(useSyncStore.getState().folderPath || window.electronAPI?.platform === 'darwin');
  }

  async isConnected(): Promise<boolean> {
    if (isIpadApp()) return this.isAvailable();
    const path = (await this.resolveDesktopICloudPath()) ?? useSyncStore.getState().folderPath;
    return Boolean(path);
  }

  async connect(): Promise<boolean> {
    if (isIpadApp()) {
      if (!hasNativeICloudBridge()) throw new Error(noBridgeMessage());
      const res = await callNativeICloud('status');
      if (!res.available) {
        throw new Error(icloudOffMessage());
      }
      return true;
    }
    let icloudPath = await this.resolveDesktopICloudPath();
    if (!icloudPath && window.electronAPI?.platform === 'darwin') {
      icloudPath = useSyncStore.getState().folderPath
        ?? (await window.electronAPI.chooseFolder?.('Choose your iCloud Drive › MaliPDF folder'))
        ?? null;
    }
    if (!icloudPath || !window.electronAPI?.syncActivateFolder) return false;
    const activated = await window.electronAPI.syncActivateFolder(icloudPath);
    useSyncStore.getState().setFolderPath(activated);
    return true;
  }

  async disconnect(): Promise<void> {
    // Keep local files untouched on disconnect
  }

  /** null ONLY when the manifest does not exist; bridge/IPC/parse failures throw. */
  async readManifest(): Promise<SyncManifest | null> {
    if (isIpadApp()) {
      // Rejects without the bridge or when the native side reports an error
      // (e.g. the file is still an undownloaded iCloud placeholder).
      const res = await callNativeICloud('read', { name: MANIFEST_NAME });
      if (res.data == null) return null;
      return parseSyncManifest(base64ToBytes(res.data));
    }
    const folder = await this.desktopFolder();
    await window.electronAPI.syncActivateFolder!(folder);
    const buf = await window.electronAPI.syncReadFile!(folder, MANIFEST_NAME);
    if (!buf) return null;
    return parseSyncManifest(new Uint8Array(buf));
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    const enc = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    if (isIpadApp()) {
      await callNativeICloud('write', { name: MANIFEST_NAME, data: bytesToBase64(enc) });
      return;
    }
    const folder = await this.desktopFolder();
    await window.electronAPI.syncActivateFolder!(folder);
    await window.electronAPI.syncWriteFile!(folder, MANIFEST_NAME, enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength));
  }

  async readPdf(remoteName: string): Promise<Uint8Array | null> {
    if (isIpadApp()) {
      const res = await callNativeICloud('read', { name: remoteName });
      return res.data ? base64ToBytes(res.data) : null;
    }
    const folder = await this.desktopFolder();
    const buf = await window.electronAPI.syncReadFile!(folder, remoteName);
    return buf ? new Uint8Array(buf) : null;
  }

  async writePdf(remoteName: string, bytes: Uint8Array): Promise<void> {
    if (isIpadApp()) {
      await callNativeICloud('write', { name: remoteName, data: bytesToBase64(bytes) });
      return;
    }
    const folder = await this.desktopFolder();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await window.electronAPI.syncWriteFile!(folder, remoteName, ab);
  }

  async deletePdf(remoteName: string): Promise<void> {
    if (isIpadApp()) {
      if (!hasNativeICloudBridge()) throw new Error(noBridgeMessage());
      await callNativeICloud('delete', { name: remoteName }).catch(() => undefined);
      return;
    }
    const folder = await this.desktopFolder();
    if (!window.electronAPI?.syncDeleteFile) return;
    await window.electronAPI.syncDeleteFile(folder, remoteName);
  }

  async listRemotePdfs(): Promise<RemoteFileEntry[]> {
    if (isIpadApp()) {
      // Errors propagate: an empty list must mean an empty folder, not a failure.
      const res = await callNativeICloud('list');
      return (res.files ?? []).filter((f) => /\.pdf$/i.test(f.name));
    }
    const folder = await this.desktopFolder();
    if (!window.electronAPI?.syncList) throw new Error('iCloud Drive folder not found.');
    const entries = await window.electronAPI.syncList(folder);
    return entries.filter((e) => /\.pdf$/i.test(e.name));
  }
}
