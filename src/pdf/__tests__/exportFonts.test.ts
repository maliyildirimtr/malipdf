import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The loader must work whether or not the real package is installed here.
vi.mock('@pdf-lib/fontkit', () => ({ default: { create: () => ({}) } }));

import { bundledExportFontPaths, dataUrlToBytes, loadExportFonts, readAssetBytes } from '../exportFonts';
import { fontFamilyKey } from '../fontFamilies';

const projectRoot = resolve(__dirname, '../../..');
const readFromDisk = async (url: string) => new Uint8Array(readFileSync(resolve(projectRoot, url.replace(/^\//, '').replace(/\?.*$/, ''))));

describe('exportFonts', () => {
  it('decodes data URLs (production build inlines the fonts)', async () => {
    expect([...dataUrlToBytes('data:font/ttf;base64,AAEC/w==')]).toEqual([0, 1, 2, 255]);
    expect([...await readAssetBytes('data:font/ttf;base64,AAEC/w==')]).toEqual([0, 1, 2, 255]);
  });

  it('bundles 12 Liberation faces (sans, serif, mono × 4 styles)', async () => {
    expect(bundledExportFontPaths()).toHaveLength(12);
    const fonts = await loadExportFonts(readFromDisk);
    for (const family of ['sans', 'serif', 'mono'] as const) {
      for (const style of ['regular', 'bold', 'italic', 'boldItalic'] as const) {
        const bytes = await fonts.load(family, style);
        expect(bytes.byteLength).toBeGreaterThan(100_000);
        expect([...bytes.slice(0, 4)]).toEqual([0, 1, 0, 0]); // TrueType signature
      }
    }
  });

  it('classifies stored font families', () => {
    expect(fontFamilyKey('Inter, sans-serif')).toBe('sans');
    expect(fontFamilyKey('Georgia, serif')).toBe('serif');
    expect(fontFamilyKey('"Times New Roman", "Liberation Serif", Times, serif')).toBe('serif');
    expect(fontFamilyKey('Courier New, monospace')).toBe('mono');
  });
});
