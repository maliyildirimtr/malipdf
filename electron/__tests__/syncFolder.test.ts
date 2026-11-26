import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authorizeSyncFolder,
  deleteSyncFile,
  isValidSyncFileName,
  listSyncFolder,
  loadRememberedSyncFolder,
  loadRememberedSyncGrant,
  readSyncFile,
  rememberSyncFolder,
  writeSyncFile,
} from '../services/files/syncFolder';

let root: string;
let granted: string;
let outside: string;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'malipdf-sync-'));
  granted = path.join(root, 'granted');
  outside = path.join(root, 'outside');
  await fs.promises.mkdir(granted);
  await fs.promises.mkdir(outside);
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe('sync folder authorization', () => {
  it('refuses a folder the user did not pick and that was not detected', async () => {
    await expect(authorizeSyncFolder(outside, [granted])).rejects.toThrow(/not authorized/);
    await expect(authorizeSyncFolder(path.join(granted, '..', 'outside'), [granted])).rejects.toThrow(/not authorized/);
    await expect(authorizeSyncFolder('relative/dir', [granted])).rejects.toThrow();
  });

  it('accepts a granted folder, also through a different spelling or a symlink', async () => {
    expect(await authorizeSyncFolder(granted, [granted])).toBe(path.resolve(granted));
    expect(await authorizeSyncFolder(path.join(granted, '.'), [granted])).toBe(path.resolve(granted));
    const link = path.join(root, 'link');
    await fs.promises.symlink(granted, link);
    expect(await authorizeSyncFolder(link, [granted])).toBe(path.resolve(link));
  });

  it('accepts a detected cloud folder that does not exist yet', async () => {
    const detected = path.join(granted, 'MaliPDF');
    expect(await authorizeSyncFolder(detected, [detected])).toBe(detected);
  });
});

describe('sync file names', () => {
  it('rejects names Windows cannot store or that escape the folder', () => {
    for (const bad of ['', '.', '..', 'a/b.pdf', 'a\\b.pdf', 'a.pdf.', 'a.pdf ', 'a.pdf:stream', 'CON', 'con.pdf', 'Nul.txt', 'PRN.pdf', 'aux', 'COM1.pdf', 'lpt9.pdf', 'a<b.pdf', 'a\u0001.pdf']) {
      expect(isValidSyncFileName(bad), bad).toBe(false);
    }
    for (const ok of ['Notes.pdf', 'Console.pdf', 'COM10.pdf', 'library-sync.json', 'Ödev (Conflict 20261125-1200).pdf']) {
      expect(isValidSyncFileName(ok), ok).toBe(true);
    }
  });
});

describe('sync file io', () => {
  it('writes through a temp file + rename and leaves no temp files behind', async () => {
    await fs.promises.writeFile(path.join(granted, 'library-sync.json'), 'old');
    await writeSyncFile(granted, 'library-sync.json', new TextEncoder().encode('new'));
    expect(await fs.promises.readFile(path.join(granted, 'library-sync.json'), 'utf8')).toBe('new');
    expect(await fs.promises.readdir(granted)).toEqual(['library-sync.json']);
    expect(new TextDecoder().decode((await readSyncFile(granted, 'library-sync.json'))!)).toBe('new');
    expect(await readSyncFile(granted, 'missing.pdf')).toBeNull();
  });

  it('refuses to read, write or delete through a symlink', async () => {
    const secret = path.join(outside, 'secret.pdf');
    await fs.promises.writeFile(secret, 'secret');
    await fs.promises.symlink(secret, path.join(granted, 'evil.pdf'));
    await expect(readSyncFile(granted, 'evil.pdf')).rejects.toThrow(/symbolic link/);
    await expect(writeSyncFile(granted, 'evil.pdf', new Uint8Array([1]))).rejects.toThrow(/symbolic link/);
    await expect(deleteSyncFile(granted, 'evil.pdf')).rejects.toThrow(/symbolic link/);
    expect(await fs.promises.readFile(secret, 'utf8')).toBe('secret');
    // Listing skips symlinks too.
    expect((await listSyncFolder(granted)).map((e) => e.name)).toEqual([]);
  });

  it('rejects invalid names in io calls', async () => {
    await expect(writeSyncFile(granted, 'CON.pdf', new Uint8Array([1]))).rejects.toThrow(/Invalid sync file name/);
    await expect(readSyncFile(granted, '../outside/secret.pdf')).rejects.toThrow(/Invalid sync file name/);
  });

  it('unwraps macOS .icloud evicted placeholders and never returns null while downloading', async () => {
    const placeholder = path.join(granted, '.Lecture.pdf.icloud');
    await fs.promises.writeFile(placeholder, 'bplist00-placeholder');

    const listed = await listSyncFolder(granted, 'darwin');
    expect(listed.map((f) => f.name)).toEqual(['Lecture.pdf']);

    await expect(
      readSyncFile(granted, 'Lecture.pdf', { platform: 'darwin', pollMs: 5, maxPolls: 2 }),
    ).rejects.toThrow(/still downloading/);

    // Materialized file wins over leftover placeholder in listing
    await fs.promises.writeFile(path.join(granted, 'Lecture.pdf'), 'real-pdf-bytes');
    const listedBoth = await listSyncFolder(granted, 'darwin');
    expect(listedBoth).toHaveLength(1);
    expect(listedBoth[0].size).toBe('real-pdf-bytes'.length);

    await deleteSyncFile(granted, 'Lecture.pdf', 'darwin');
    expect(await listSyncFolder(granted, 'darwin')).toEqual([]);
  });

  it('persists and loads security-scoped bookmarks alongside remembered sync folders', async () => {
    const stateFile = path.join(root, 'sync-folder.json');
    await rememberSyncFolder(stateFile, granted, 'bookmark-base64-token');
    expect(await loadRememberedSyncFolder(stateFile)).toBe(granted);
    expect(await loadRememberedSyncGrant(stateFile)).toEqual({
      folder: granted,
      bookmark: 'bookmark-base64-token',
    });
  });
});
