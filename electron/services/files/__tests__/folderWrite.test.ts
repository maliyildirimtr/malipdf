import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FolderGrants, outputExtension, safeFileName, safePdfFileName, uniqueName, writeFilesToFolder } from '../folderWrite';

describe('split output files', () => {
  it('makes plain, safe PDF names', () => {
    expect(safePdfFileName('Ders 1 (sayfa 1-3)')).toBe('Ders 1 (sayfa 1-3).pdf');
    expect(safePdfFileName('../../etc/passwd')).toBe('-..-etc-passwd.pdf');
    expect(safePdfFileName('..hidden.PDF')).toBe('hidden.pdf');
    expect(safePdfFileName('')).toBe('Document.pdf');
    expect(safePdfFileName(42)).toBe('Document.pdf');
    expect(safeFileName('Sayfa 1.png', 'png')).toBe('Sayfa 1.png');
    expect(safeFileName('x.pdf', 'jpg')).toBe('x.pdf.jpg');
    expect(outputExtension('exe')).toBe('pdf');
    expect(uniqueName('a.png', (n) => n === 'a.png')).toBe('a (2).png');
  });

  it('never reuses a taken name', () => {
    const taken = new Set(['a.pdf', 'a (2).pdf']);
    expect(uniqueName('a.pdf', (n) => taken.has(n))).toBe('a (3).pdf');
    expect(uniqueName('b.pdf', (n) => taken.has(n))).toBe('b.pdf');
  });

  it('only allows granted folders and writes without overwriting', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-'));
    const grants = new FolderGrants();
    expect(grants.has(dir)).toBe(false);
    grants.grant(dir);
    expect(grants.has(dir)).toBe(true);
    expect(grants.has('relative/dir')).toBe(false);
    fs.writeFileSync(path.join(dir, 'x.pdf'), 'old');
    const names = await writeFilesToFolder(dir, [{ name: 'x', data: new Uint8Array([1]) }, { name: 'x', data: new Uint8Array([2]) }]);
    expect(names).toEqual(['x (2).pdf', 'x (3).pdf']);
    expect(fs.readFileSync(path.join(dir, 'x.pdf'), 'utf8')).toBe('old');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
