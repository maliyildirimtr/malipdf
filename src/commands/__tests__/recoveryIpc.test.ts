import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'malipdf-recovery-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn),
    on: vi.fn(),
  },
}));

const trusted = { senderFrame: { url: 'http://localhost:5173/' } };
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);

beforeAll(async () => {
  const { setupRecoveryIpc } = await import('../../../electron/services/recovery');
  setupRecoveryIpc(true);
});
afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));

const meta = (title: string) => JSON.stringify({ format: 1, title, filePath: null, savedAt: 5, pageCount: 2, annotations: [{}, {}], assets: [{ id: 'a1' }] });

describe('recovery IPC (main process)', () => {
  it('writes, lists, loads and removes snapshots', async () => {
    await call('recovery:write', 'doc1', meta('One.pdf'), new Uint8Array([1, 2]), [{ id: 'a1', mimeType: 'image/png', width: 1, height: 1, data: new Uint8Array([7]) }]);
    expect(await call('recovery:list')).toEqual([
      { docId: 'doc1', title: 'One.pdf', filePath: null, savedAt: 5, pageCount: 2, annotationCount: 2 },
    ]);

    // Later snapshot without new bytes keeps the stored PDF.
    await call('recovery:write', 'doc1', meta('One (edited).pdf'), null, []);
    const loaded = await call('recovery:load', 'doc1') as { meta: string; source: ArrayBuffer; assets: { id: string; data: ArrayBuffer }[] };
    expect(JSON.parse(loaded.meta).title).toBe('One (edited).pdf');
    expect([...new Uint8Array(loaded.source)]).toEqual([1, 2]);
    expect(loaded.assets.map((a) => [a.id, [...new Uint8Array(a.data)]])).toEqual([['a1', [7]]]);

    await call('recovery:remove', 'doc1');
    expect(await call('recovery:list')).toEqual([]);
  });

  it('ignores a snapshot whose first write never finished', async () => {
    fs.mkdirSync(path.join(userData, 'recovery', 'broken'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'recovery', 'broken', 'session.json'), meta('Broken.pdf'));
    expect(await call('recovery:list')).toEqual([]); // no source.pdf
  });

  it('rejects path tricks and untrusted senders', async () => {
    await expect(call('recovery:write', '../evil', meta('x'), new Uint8Array([1]), [])).rejects.toThrow('Invalid document id');
    await expect(call('recovery:load', 'a/b')).rejects.toThrow('Invalid document id');
    await expect(call('recovery:write', 'ok', meta('x'), new Uint8Array([1]), [{ id: '../x', data: new Uint8Array([1]) }])).rejects.toThrow('Invalid asset id');
    await expect(handlers.get('recovery:list')!({ senderFrame: { url: 'https://evil.example' } })).rejects.toThrow('untrusted');
  });
});
