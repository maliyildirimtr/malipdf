import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'malipdf-pptx-test-'));
const seen: { input: string; bytes: string }[] = [];

vi.mock('electron', () => ({
  app: { getPath: () => temp, whenReady: () => new Promise(() => {}), on: vi.fn() },
  dialog: {},
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn), on: vi.fn() },
}));
vi.mock('../libreOfficeProvider', () => ({
  LibreOfficeProvider: class {
    async isAvailable() { return true; }
    async convertToPdf(input: string, outDir: string) {
      seen.push({ input, bytes: fs.readFileSync(input, 'utf8') });
      const out = path.join(outDir, 'out.pdf');
      fs.writeFileSync(out, '%PDF-1.7 fake');
      return out;
    }
  },
}));

const trusted = { senderFrame: { url: 'http://localhost:5173/' } };

beforeAll(async () => {
  const { setupPptxIpc } = await import('../pptxIpc');
  setupPptxIpc(true);
});
afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));

describe('pptx drag & drop conversion', () => {
  it('converts dropped presentation bytes and cleans up', async () => {
    const data = new TextEncoder().encode('fake pptx');
    const result = await handlers.get('pptx:convertBytes')!(trusted, 'job1', data, '../../Ders 3.pptx') as { buffer: ArrayBuffer; name: string };
    expect(new TextDecoder().decode(result.buffer)).toBe('%PDF-1.7 fake');
    expect(result.name).toBe('Ders 3.pptx'); // path parts stripped
    expect(seen[0].bytes).toBe('fake pptx');
    expect(path.basename(seen[0].input)).toMatch(/^input-[0-9a-f-]+\.pptx$/); // never the user's name
    expect(fs.readdirSync(temp).filter((n) => n.startsWith('malipdf-pptx-'))).toEqual([]);
  });

  it('rejects other file types', async () => {
    await expect(handlers.get('pptx:convertBytes')!(trusted, 'job2', new Uint8Array([1]), 'notes.docx')).rejects.toThrow('Only PowerPoint');
  });
});
