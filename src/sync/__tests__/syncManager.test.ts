import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteFileEntry, SyncManifest } from '../syncTypes';

// In-memory "remote" used by a fake folder adapter, and in-memory local PDF storage.
const h = vi.hoisted(() => {
  const remote = {
    files: new Map<string, Uint8Array>(),
    manifest: null as unknown,
    manifestError: null as Error | null,
    onList: null as null | (() => Promise<void> | void),
    writes: [] as string[],
  };
  const localFiles = new Map<string, Uint8Array>();
  return { remote, localFiles };
});

vi.mock('../adapters/folderSyncAdapter', () => ({
  FolderSyncAdapter: class {
    readonly id = 'folder';
    async isAvailable() { return true; }
    async isConnected() { return true; }
    async connect() { return true; }
    async disconnect() {}
    async readManifest() {
      if (h.remote.manifestError) throw h.remote.manifestError;
      return h.remote.manifest ? JSON.parse(JSON.stringify(h.remote.manifest)) : null;
    }
    async writeManifest(m: SyncManifest) { h.remote.manifest = JSON.parse(JSON.stringify(m)); h.remote.writes.push('library-sync.json'); }
    async readPdf(name: string) { return h.remote.files.get(name)?.slice() ?? null; }
    async writePdf(name: string, bytes: Uint8Array) { h.remote.files.set(name, bytes.slice()); h.remote.writes.push(name); }
    async deletePdf(name: string) { h.remote.files.delete(name); }
    async listRemotePdfs(): Promise<RemoteFileEntry[]> {
      if (h.remote.onList) await h.remote.onList();
      return Array.from(h.remote.files.entries()).map(([name, b]) => ({ name, size: b.byteLength, updatedAt: 1 }));
    }
  },
}));

vi.mock('../../platform/ipadLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platform/ipadLibrary')>();
  return {
    ...actual,
    saveLibraryMeta: async () => {},
    loadLibraryMeta: async () => ({ version: 1, folders: [], items: [] }),
    renderPdfCoverThumbnail: async () => null,
    writeLibraryPdfBytes: async (p: string, b: Uint8Array) => { h.localFiles.set(p, b.slice()); },
    readLibraryPdfBytes: async (p: string) => h.localFiles.get(p)?.slice() ?? null,
    deleteLibraryPdfBytes: async (p: string) => { h.localFiles.delete(p); },
    renameLibraryPdfFile: async (a: string, b: string) => {
      const v = h.localFiles.get(a);
      if (v) { h.localFiles.set(b, v); h.localFiles.delete(a); }
    },
  };
});

import { switchSyncProvider, syncNow } from '../syncManager';
import { fingerprintPdfBytes } from '../syncTypes';
import { useLibraryStore } from '../../store/libraryStore';
import { useSyncStore } from '../../store/syncStore';
import type { LibraryDocument } from '../../platform/ipadLibrary';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);

function cloudDoc(id: string, name: string, updatedAt: number, extra: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    id,
    title: name,
    filePath: `Cloud/${name}`,
    scope: 'cloud',
    kind: 'pdf',
    folderId: null,
    favorite: false,
    pageCount: 1,
    sizeBytes: 10,
    createdAt: 1,
    updatedAt,
    lastOpenedAt: 0,
    trashedAt: null,
    ...extra,
  } as LibraryDocument;
}

function remoteRecord(id: string, name: string, updatedAt: number, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
  return {
    id, title: name, remoteName: name, kind: 'pdf', folderId: null, favorite: false, pageCount: 1,
    sizeBytes: bytes.byteLength, contentHash: fingerprintPdfBytes(bytes), createdAt: 1, updatedAt,
    lastOpenedAt: 0, trashedAt: null, ...extra,
  };
}

beforeEach(() => {
  h.remote.files.clear();
  h.remote.manifest = null;
  h.remote.manifestError = null;
  h.remote.onList = null;
  h.remote.writes = [];
  h.localFiles.clear();
  useSyncStore.setState({ provider: 'folder', status: 'idle', lastError: null, lastSyncedAt: null, autoSync: false, tombstones: [] });
  useLibraryStore.setState({ initialized: true, folders: [], items: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncManager data-safety', () => {
  it('remote-wins conflict: local edits survive as an uploaded and local conflict copy', async () => {
    const localBytes = enc('LOCAL EDITS');
    const remoteBytes = enc('REMOTE EDITS!!');
    h.localFiles.set('Cloud/Notes.pdf', localBytes);
    useLibraryStore.setState({ items: [cloudDoc('doc-1', 'Notes.pdf', 800)] });
    h.remote.files.set('Notes.pdf', remoteBytes);
    h.remote.manifest = { version: 1, updatedAt: 900, deviceId: 'x', folders: [], items: [remoteRecord('doc-1', 'Notes.pdf', 900, remoteBytes)] };
    useSyncStore.setState({ lastSyncedAt: 500 });

    expect(await syncNow()).toBe(true);

    const conflictName = Array.from(h.remote.files.keys()).find((n) => n.includes('(Conflict'));
    expect(conflictName).toBeDefined();
    expect(dec(h.remote.files.get(conflictName!))).toBe('LOCAL EDITS');
    // The winner replaced the original, but the local edits are still in the library.
    expect(dec(h.localFiles.get('Cloud/Notes.pdf'))).toBe('REMOTE EDITS!!');
    const copy = useLibraryStore.getState().items.find((i) => i.id !== 'doc-1')!;
    expect(copy).toBeDefined();
    expect(dec(h.localFiles.get(copy.filePath))).toBe('LOCAL EDITS');
  });

  it('local-wins conflict: does not upload over the remote version when it cannot be preserved', async () => {
    h.localFiles.set('Cloud/Notes.pdf', enc('LOCAL'));
    useLibraryStore.setState({ items: [cloudDoc('doc-1', 'Notes.pdf', 900)] });
    const remoteBytes = enc('REMOTE');
    h.remote.manifest = { version: 1, updatedAt: 800, deviceId: 'x', folders: [], items: [remoteRecord('doc-1', 'Notes.pdf', 800, remoteBytes)] };
    // Listed, but reading it fails (e.g. iCloud placeholder not downloaded).
    h.remote.files.set('Notes.pdf', remoteBytes);
    useSyncStore.setState({ lastSyncedAt: 500 });
    const { FolderSyncAdapter } = await import('../adapters/folderSyncAdapter');
    vi.spyOn(FolderSyncAdapter.prototype as any, 'readPdf').mockResolvedValue(null);

    expect(await syncNow()).toBe(false);
    expect(dec(h.remote.files.get('Notes.pdf'))).toBe('REMOTE');
  });

  it('aborts without touching anything when the remote manifest cannot be read', async () => {
    h.localFiles.set('Cloud/A.pdf', enc('a'));
    useLibraryStore.setState({ items: [cloudDoc('a', 'A.pdf', 800)] });
    h.remote.files.set('A.pdf', enc('newer remote'));
    h.remote.manifestError = new Error('iCloud request timed out.');

    expect(await syncNow()).toBe(false);
    expect(useSyncStore.getState().status).toBe('error');
    expect(useSyncStore.getState().lastError).toContain('timed out');
    expect(h.remote.writes).toEqual([]);
    expect(dec(h.remote.files.get('A.pdf'))).toBe('newer remote');
    expect(useSyncStore.getState().lastSyncedAt).toBeNull();
  });

  it('keeps library changes made while the sync was running and records the start time', async () => {
    h.localFiles.set('Cloud/A.pdf', enc('a'));
    h.localFiles.set('Cloud/B.pdf', enc('b'));
    useLibraryStore.setState({ items: [cloudDoc('a', 'A.pdf', 100), cloudDoc('b', 'B.pdf', 100)] });
    const realNow = Date.now();
    let fakeNow = realNow;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    h.remote.onList = () => {
      fakeNow = realNow + 60_000;
      useLibraryStore.setState((s) => ({
        items: [
          ...s.items.map((i) => (i.id === 'b' ? { ...i, title: 'Renamed.pdf', updatedAt: fakeNow } : i)),
          cloudDoc('new', 'Added.pdf', fakeNow),
        ],
      }));
    };

    expect(await syncNow()).toBe(true);

    const items = useLibraryStore.getState().items;
    expect(items.map((i) => i.id).sort()).toEqual(['a', 'b', 'new']);
    expect(items.find((i) => i.id === 'b')!.title).toBe('Renamed.pdf');
    expect(useSyncStore.getState().lastSyncedAt).toBe(realNow);
  });

  it('does not resurrect a doc deleted while the sync ran', async () => {
    h.localFiles.set('Cloud/A.pdf', enc('a'));
    useLibraryStore.setState({ items: [cloudDoc('a', 'A.pdf', 100)] });
    h.remote.onList = () => { useLibraryStore.setState({ items: [] }); };
    expect(await syncNow()).toBe(true);
    expect(useLibraryStore.getState().items).toEqual([]);
  });

  it('a permanently deleted cloud doc does not come back on the next sync', async () => {
    const bytes = enc('doc');
    h.localFiles.set('Cloud/Gone.pdf', bytes);
    useLibraryStore.setState({ items: [cloudDoc('gone', 'Gone.pdf', 100)] });
    expect(await syncNow()).toBe(true);
    expect(h.remote.files.has('Gone.pdf')).toBe(true);

    await useLibraryStore.getState().permanentlyDeleteDocument('gone');
    expect(await syncNow()).toBe(true);
    expect(useLibraryStore.getState().items).toEqual([]);
    expect(h.remote.files.has('Gone.pdf')).toBe(false);
    const rec = (h.remote.manifest as SyncManifest).items.find((i) => i.id === 'gone')!;
    expect(rec.deletedAt).toBeTypeOf('number');

    // Another device that still has the doc removes it.
    h.localFiles.set('Cloud/Gone.pdf', bytes);
    useLibraryStore.setState({ items: [cloudDoc('gone', 'Gone.pdf', 100)] });
    useSyncStore.setState({ tombstones: [] });
    expect(await syncNow()).toBe(true);
    expect(useLibraryStore.getState().items).toEqual([]);
  });

  it('queues a follow-up sync and writes tombstone when a doc is deleted mid-sync', async () => {
    const bytes = enc('mid-sync-delete');
    h.localFiles.set('Cloud/Temp.pdf', bytes);
    useLibraryStore.setState({ items: [cloudDoc('temp', 'Temp.pdf', 100)] });
    expect(await syncNow()).toBe(true);
    expect(h.remote.files.has('Temp.pdf')).toBe(true);

    let deletedOnce = false;
    h.remote.onList = async () => {
      if (deletedOnce) return;
      deletedOnce = true;
      await useLibraryStore.getState().permanentlyDeleteDocument('temp');
      void syncNow(); // called while first syncNow() is still running!
    };

    expect(await syncNow()).toBe(true);
    expect(useLibraryStore.getState().items).toEqual([]);
    expect(h.remote.files.has('Temp.pdf')).toBe(false);
    const rec = (h.remote.manifest as SyncManifest).items.find((i) => i.id === 'temp')!;
    expect(rec.deletedAt).toBeTypeOf('number');
  });

  it('refuses Google Drive (not supported in the packaged app)', async () => {
    // A Drive API that would "work" — the manager must still never reach it.
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ files: [{ id: 'root' }], email: 'a@b.c' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    useSyncStore.setState({ provider: 'gdrive', googleAccessToken: 'tok', googleTokenExpiresAt: Date.now() + 3_600_000, googleRootFolderId: 'root' });
    expect(await syncNow()).toBe(false);
    expect(useSyncStore.getState().lastError).toMatch(/Google Drive.*not available/i);
    useSyncStore.setState({ provider: 'local' });
    expect(await switchSyncProvider('gdrive', { accessToken: 'x' })).toBe(false);
    expect(useSyncStore.getState().provider).toBe('local');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
