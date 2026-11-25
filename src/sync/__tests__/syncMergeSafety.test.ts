import { describe, expect, it } from 'vitest';
import { buildSyncPlan } from '../syncMerge';
import { fingerprintPdfBytes, type SyncItemRecord, type SyncManifest } from '../syncTypes';

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

function manifest(items: SyncItemRecord[]): SyncManifest {
  return { version: 1, updatedAt: 1, deviceId: 'other', folders: [], items };
}

describe('syncMerge data-safety', () => {
  it('remote-wins conflict: the local conflict copy remembers which local document holds its bytes', () => {
    const local = makeItem({ id: 'doc-1', remoteName: 'Notes.pdf', updatedAt: 800, contentHash: 'L' });
    const remote = makeItem({ id: 'doc-1', remoteName: 'Notes.pdf', updatedAt: 900, contentHash: 'R' });
    const plan = buildSyncPlan({
      localFolders: [],
      localItems: [local],
      remoteManifest: manifest([remote]),
      remoteFiles: [{ name: 'Notes.pdf', size: 1000, updatedAt: 900 }],
      lastSyncedAt: 500,
      now: 1000,
    });
    const copy = plan.toUpload.find((i) => i.id !== 'doc-1');
    expect(copy).toBeDefined();
    expect(copy!.remoteName).toContain('(Conflict');
    expect(copy!.sourceLocalId).toBe('doc-1');
    expect(plan.toDownload.map((i) => i.id)).toEqual(['doc-1']);
  });

  it('keeps BOTH documents when only the file name matches and the content differs', () => {
    const local = makeItem({ id: 'mine', remoteName: 'Homework.pdf', updatedAt: 300, contentHash: 'A' });
    const remote = makeItem({ id: 'theirs', remoteName: 'Homework.pdf', updatedAt: 200, contentHash: 'B' });
    const plan = buildSyncPlan({
      localFolders: [],
      localItems: [local],
      remoteManifest: manifest([remote]),
      remoteFiles: [{ name: 'Homework.pdf', size: 1000, updatedAt: 200 }],
      lastSyncedAt: null,
      now: 1000,
    });
    const ids = plan.mergedItems.map((i) => i.id).sort();
    expect(ids).toEqual(['mine', 'theirs']);
    // The local document must not be uploaded over the other document's file.
    const up = plan.toUpload.find((i) => i.id === 'mine')!;
    expect(up.remoteName).not.toBe('Homework.pdf');
    expect(plan.toDownload.map((i) => i.id)).toEqual(['theirs']);
    const names = plan.mergedItems.map((i) => i.remoteName.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps both when a local doc has the same name as an unindexed remote file', () => {
    const local = makeItem({ id: 'mine', remoteName: 'Scan.pdf', updatedAt: 300 });
    const plan = buildSyncPlan({
      localFolders: [],
      localItems: [local],
      remoteManifest: null,
      remoteFiles: [{ name: 'Scan.pdf', size: 5555, updatedAt: 200 }],
      lastSyncedAt: null,
      now: 1000,
    });
    expect(plan.toUpload.find((i) => i.id === 'mine')!.remoteName).not.toBe('Scan.pdf');
    expect(plan.toDownload.map((i) => i.remoteName)).toEqual(['Scan.pdf']);
  });

  it('still merges a name-only match when the content is provably identical', () => {
    const local = makeItem({ id: 'mine', remoteName: 'Same.pdf', updatedAt: 300, contentHash: 'X' });
    const remote = makeItem({ id: 'theirs', remoteName: 'Same.pdf', updatedAt: 300, contentHash: 'X' });
    const plan = buildSyncPlan({
      localFolders: [],
      localItems: [local],
      remoteManifest: manifest([remote]),
      remoteFiles: [{ name: 'Same.pdf', size: 1000, updatedAt: 300 }],
      lastSyncedAt: null,
      now: 1000,
    });
    expect(plan.mergedItems.map((i) => i.id)).toEqual(['mine']);
    expect(plan.toUpload).toHaveLength(0);
    expect(plan.toDownload).toHaveLength(0);
  });

  it('a local tombstone keeps a permanently deleted doc from coming back and deletes the remote file', () => {
    const remote = makeItem({ id: 'gone', remoteName: 'Old.pdf', updatedAt: 200, trashedAt: 200 });
    const plan = buildSyncPlan({
      localFolders: [],
      localItems: [],
      localTombstones: [{ id: 'gone', remoteName: 'Old.pdf', deletedAt: 300 }],
      remoteManifest: manifest([remote]),
      remoteFiles: [{ name: 'Old.pdf', size: 1000, updatedAt: 200 }],
      lastSyncedAt: 250,
      now: 1000,
    });
    expect(plan.toDownload).toHaveLength(0);
    expect(plan.toDeleteRemote).toEqual(['Old.pdf']);
    const rec = plan.mergedItems.find((i) => i.id === 'gone')!;
    expect(rec.deletedAt).toBe(300);
  });

  it('a remote tombstone removes the doc on another device unless that device edited it later', () => {
    const tomb = makeItem({ id: 'gone', remoteName: 'Old.pdf', updatedAt: 300, deletedAt: 300, trashedAt: 300 });
    const stale = makeItem({ id: 'gone', remoteName: 'Old.pdf', updatedAt: 200 });
    const plan = buildSyncPlan({
      localFolders: [],
      localItems: [stale],
      remoteManifest: manifest([tomb]),
      remoteFiles: [],
      lastSyncedAt: 250,
      now: 1000,
    });
    expect(plan.toDeleteLocal).toEqual(['gone']);
    expect(plan.toUpload).toHaveLength(0);
    expect(plan.mergedItems.find((i) => i.id === 'gone')!.deletedAt).toBe(300);

    const edited = makeItem({ id: 'gone', remoteName: 'Old.pdf', updatedAt: 400 });
    const plan2 = buildSyncPlan({
      localFolders: [],
      localItems: [edited],
      remoteManifest: manifest([tomb]),
      remoteFiles: [],
      lastSyncedAt: 250,
      now: 1000,
    });
    expect(plan2.toDeleteLocal).toEqual([]);
    expect(plan2.toUpload.map((i) => i.id)).toEqual(['gone']);
    expect(plan2.mergedItems.find((i) => i.id === 'gone')!.deletedAt ?? null).toBeNull();
  });

  it('a remote tombstone is not re-downloaded nor rediscovered as an unindexed file', () => {
    const tomb = makeItem({ id: 'gone', remoteName: 'Old.pdf', updatedAt: 300, deletedAt: 300, trashedAt: 300 });
    const plan = buildSyncPlan({
      localFolders: [],
      localItems: [],
      remoteManifest: manifest([tomb]),
      remoteFiles: [{ name: 'Old.pdf', size: 1000, updatedAt: 250 }],
      lastSyncedAt: null,
      now: 1000,
    });
    expect(plan.toDownload).toHaveLength(0);
    expect(plan.mergedItems.map((i) => i.id)).toEqual(['gone']);
  });

  it('fingerprints the full content so a same-size edit anywhere is detected', () => {
    const a = new Uint8Array(200_000);
    const b = a.slice();
    b[1] = 7; // not on the old sampling stride, not in the tail
    expect(fingerprintPdfBytes(a)).not.toBe(fingerprintPdfBytes(b));
    expect(fingerprintPdfBytes(a)).toBe(fingerprintPdfBytes(a.slice()));
  });
});
