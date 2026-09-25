import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The loader must work whether or not the real package is installed here.
vi.mock('@pdf-lib/fontkit', () => ({ default: { create: () => ({}) } }));

import { dataUrlToBytes, loadExportFonts, readAssetBytes, EXPORT_FONT_URLS } from '../exportFonts';

const projectRoot = resolve(__dirname, '../../..');
const readFromDisk = async (url: string) => new Uint8Array(readFileSync(resolve(projectRoot, url.replace(/^\//, '').replace(/\?.*$/, ''))));

describe('exportFonts', () => {
  it('decodes data URLs (production build inlines the fonts)', async () => {
    expect([...dataUrlToBytes('data:font/ttf;base64,AAEC/w==')]).toEqual([0, 1, 2, 255]);
    expect([...await readAssetBytes('data:font/ttf;base64,AAEC/w==')]).toEqual([0, 1, 2, 255]);
  });

  it('points at the four bundled Liberation Sans faces', async () => {
    const fonts = await loadExportFonts(readFromDisk);
    for (const url of Object.values(EXPORT_FONT_URLS)) expect(url).toMatch(/LiberationSans-.*\.ttf/);
    for (const bytes of [fonts.regular, fonts.bold, fonts.italic, fonts.boldItalic]) {
      expect(bytes.byteLength).toBeGreaterThan(100_000);
      expect([...bytes.slice(0, 4)]).toEqual([0, 1, 0, 0]); // TrueType signature
    }
    expect(fonts.fontkit).toBeDefined();
  });
});
