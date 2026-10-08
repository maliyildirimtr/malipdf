import { describe, expect, it } from 'vitest';
import { saveFile } from '../services/saveFile';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function fakeFs(opts: { tempFails?: string } = {}) {
  const files = new Map<string, Uint8Array>();
  const api = {
    writeFile: async (p: string, data: Uint8Array) => {
      if (opts.tempFails && p.includes('.tmp-')) throw errno(opts.tempFails);
      files.set(p, data);
    },
    rename: async (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); },
    unlink: async (p: string) => { files.delete(p); },
  };
  return { files, api: api as never };
}

describe('saveFile', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it('writes through a temporary file and renames it', async () => {
    const { files, api } = fakeFs();
    expect(await saveFile('/docs/a.pdf', bytes, api)).toBe('atomic');
    expect([...files.keys()]).toEqual(['/docs/a.pdf']);
  });

  it('writes in place when the sandbox forbids the folder (EPERM)', async () => {
    const { files, api } = fakeFs({ tempFails: 'EPERM' });
    expect(await saveFile('/docs/a.pdf', bytes, api)).toBe('in-place');
    expect(files.get('/docs/a.pdf')).toBe(bytes);
  });

  it('passes other errors on', async () => {
    const { api } = fakeFs({ tempFails: 'ENOSPC' });
    await expect(saveFile('/docs/a.pdf', bytes, api)).rejects.toThrow('ENOSPC');
  });
});
