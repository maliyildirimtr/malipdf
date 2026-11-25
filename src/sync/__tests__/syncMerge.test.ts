import { describe, expect, it } from 'vitest';
import { buildSyncPlan } from '../syncMerge';
import { fingerprintPdfBytes, type SyncItemRecord, type SyncManifest } from '../syncTypes';
import type { LibraryFolder } from '../../platform/ipadLibrary';

function makeItem(overrides: Partial<SyncItemRecord> & { id: string; remoteName: string }): SyncItemRecord {
  return {
    title: overrides.remoteName.replace(/\.pdf$/i, ''),
    kind: 'pdf',
    folderId: null,
    coverTheme: 'cobalt',
    favorite: false,
    pageCount: 2,
    sizeBytes: 1000,
    contentHash: '1000:abc',
    createdAt: 100,
    updatedAt: 100,
    lastOpenedAt: 100,
    trashedAt: null,
    ...overrides,
  };
}

describe('syncMerge', () => {
  it('uploads new local docs and downloads new remote docs cleanly', () => {
    const localDoc = makeItem({ id: 'l1', remoteName: 'Physics.pdf', updatedAt: 500 });
    const remoteDoc = makeItem({ id: 'r1', remoteName: 'Calculus.pdf', updatedAt: 600 });
    const manifest: SyncManifest = {
      version: 1,
      updatedAt: 600,
      deviceId: 'other-ipad',
      folders: [],
      items: [remoteDoc],
    };

    const plan = buildSyncPlan({
      localFolders: [],
      localItems: [localDoc],
      remoteManifest: manifest,
      remoteFiles: [{ name: 'Calculus.pdf', size: 1000, updatedAt: 600 }],
      lastSyncedAt: 200,
      now: 1000,
    });

    expect(plan.toUpload.map((i) => i.remoteName)).toEqual(['Physics.pdf']);
    expect(plan.toDownload.map((i) => i.remoteName)).toEqual(['Calculus.pdf']);
    expect(plan.mergedItems).toHaveLength(2);
    expect(plan.conflictCopies).toHaveLength(0);
  });

  it('creates a conflict copy when both devices edited the same PDF after lastSyncedAt', () => {
    const localDoc = makeItem({
      id: 'doc-1',
      remoteName: 'Notes.pdf',
      updatedAt: 900,
      contentHash: '1200:local',
    });
    const remoteDoc = makeItem({
      id: 'doc-1',
      remoteName: 'Notes.pdf',
      updatedAt: 800,
      contentHash: '1300:remote',
    });
    const manifest: SyncManifest = {
      version: 1,
      updatedAt: 800,
      deviceId: 'win-pc',
      folders: [],
      items: [remoteDoc],
    };

    const plan = buildSyncPlan({
      localFolders: [],
      localItems: [localDoc],
      remoteManifest: manifest,
      remoteFiles: [{ name: 'Notes.pdf', size: 1300, updatedAt: 800 }],
      lastSyncedAt: 500,
      now: 1000,
    });

    // Local is newer -> uploaded as Notes.pdf; remote is preserved as conflict copy!
    expect(plan.toUpload.map((i) => i.remoteName)).toEqual(['Notes.pdf']);
    expect(plan.conflictCopies).toHaveLength(1);
    expect(plan.conflictCopies[0].sourceRemoteName).toBe('Notes.pdf');
    expect(plan.conflictCopies[0].conflictItem.remoteName).toContain('(Conflict');
    expect(plan.mergedItems).toHaveLength(2);
  });

  it('merges folders by latest updatedAt and discovers unindexed PDFs dropped into the cloud folder', () => {
    const localFolder: LibraryFolder = {
      id: 'f1', name: 'Old Name', color: 'blue', parentId: null, favorite: false, createdAt: 10, updatedAt: 100,
    };
    const remoteFolder: LibraryFolder = {
      id: 'f1', name: 'Üniversite Notları', color: 'emerald', parentId: null, favorite: true, createdAt: 10, updatedAt: 300,
    };

    const plan = buildSyncPlan({
      localFolders: [localFolder],
      localItems: [],
      remoteManifest: { version: 1, updatedAt: 300, deviceId: 'mac', folders: [remoteFolder], items: [] },
      remoteFiles: [{ name: 'DroppedFromWindows.pdf', size: 4096, updatedAt: 400 }],
      lastSyncedAt: 50,
      now: 1000,
    });

    expect(plan.mergedFolders[0].name).toBe('Üniversite Notları');
    expect(plan.toDownload.map((i) => i.remoteName)).toEqual(['DroppedFromWindows.pdf']);
  });

  it('computes stable PDF fingerprints sensitive to tail changes', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const b = new Uint8Array([1, 2, 3, 4, 5, 7]);
    expect(fingerprintPdfBytes(a)).toBe(fingerprintPdfBytes(new Uint8Array([1, 2, 3, 4, 5, 6])));
    expect(fingerprintPdfBytes(a)).not.toBe(fingerprintPdfBytes(b));
  });
});
