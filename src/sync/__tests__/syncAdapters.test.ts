import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderSyncAdapter } from '../adapters/folderSyncAdapter';
import { ICloudSyncAdapter } from '../adapters/icloudSyncAdapter';
import { GoogleDriveSyncAdapter } from '../adapters/googleDriveSyncAdapter';
import { useSyncStore } from '../../store/syncStore';

const g = globalThis as unknown as { window?: any };

function bytes(text: string): ArrayBuffer {
  const e = new TextEncoder().encode(text);
  return e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength);
}

function desktopWindow(readFile: (folder: string, name: string) => Promise<ArrayBuffer | null>) {
  g.window = {
    electronAPI: {
      syncList: async () => [],
      syncReadFile: readFile,
      syncWriteFile: async () => true,
      syncDeleteFile: async () => true,
      syncActivateFolder: async (f: string) => f,
    },
  };
}

afterEach(() => {
  delete g.window;
  vi.unstubAllGlobals();
  useSyncStore.setState({ folderPath: null });
});

describe('manifest read failures are not "no manifest"', () => {
  it('folder adapter: missing manifest -> null', async () => {
    desktopWindow(async () => null);
    useSyncStore.setState({ folderPath: '/sync' });
    expect(await new FolderSyncAdapter().readManifest()).toBeNull();
  });

  it('folder adapter: IPC error, broken JSON or unknown version -> throws', async () => {
    useSyncStore.setState({ folderPath: '/sync' });
    desktopWindow(async () => { throw new Error('EIO'); });
    await expect(new FolderSyncAdapter().readManifest()).rejects.toThrow();
    desktopWindow(async () => bytes('{"version":1,"items":['));
    await expect(new FolderSyncAdapter().readManifest()).rejects.toThrow();
    desktopWindow(async () => bytes('{"version":2}'));
    await expect(new FolderSyncAdapter().readManifest()).rejects.toThrow();
  });

  it('folder adapter: no folder configured -> throws', async () => {
    desktopWindow(async () => null);
    await expect(new FolderSyncAdapter().readManifest()).rejects.toThrow();
  });

  it('desktop iCloud adapter: broken JSON -> throws', async () => {
    desktopWindow(async () => bytes('not json'));
    useSyncStore.setState({ folderPath: '/icloud' });
    await expect(new ICloudSyncAdapter().readManifest()).rejects.toThrow();
  });

  it('Google Drive adapter: non-OK download -> throws', async () => {
    useSyncStore.setState({ googleAccessToken: 't', googleTokenExpiresAt: Date.now() + 3_600_000, googleRootFolderId: 'root' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('alt=media')) return new Response('oops', { status: 500 });
      return new Response(JSON.stringify({ files: [{ id: 'm', name: 'library-sync.json' }] }), { status: 200 });
    }));
    await expect(new GoogleDriveSyncAdapter().readManifest()).rejects.toThrow();
  });
});

describe('iPad iCloud adapter', () => {
  function ipadWindow(bridge?: (msg: Record<string, unknown>) => void) {
    g.window = {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
      webkit: bridge ? { messageHandlers: { malipdfICloud: { postMessage: bridge } } } : undefined,
    };
  }

  it('without the native bridge it is unavailable and never touches the local Documents folder', async () => {
    const nativePromise = vi.fn(async () => ({ data: '{"version":1,"folders":[],"items":[]}', files: [] }));
    ipadWindow();
    g.window.Capacitor.nativePromise = nativePromise;
    const a = new ICloudSyncAdapter();
    expect(await a.isAvailable()).toBe(false);
    expect(await a.isConnected()).toBe(false);
    await expect(a.connect()).rejects.toThrow(/iCloud/);
    await expect(a.readManifest()).rejects.toThrow();
    await expect(a.listRemotePdfs()).rejects.toThrow();
    await expect(a.writePdf('x.pdf', new Uint8Array([1]))).rejects.toThrow();
    expect(nativePromise).not.toHaveBeenCalled();
  });

  it('bridge errors on manifest read or list are thrown, not treated as empty', async () => {
    ipadWindow((msg) => {
      setTimeout(() => g.window.__malipdfICloudResolve({ id: msg.id, ok: false, error: 'not downloaded yet' }), 0);
    });
    const a = new ICloudSyncAdapter();
    await expect(a.readManifest()).rejects.toThrow(/not downloaded/);
    await expect(a.listRemotePdfs()).rejects.toThrow(/not downloaded/);
  });
});
