import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BundledCMapReaderFactory,
  BundledStandardFontDataFactory,
  bundledCMapNames,
  bundledStandardFontNames,
} from '../pdfjsAssets';

describe('bundled pdf.js assets (no CDN)', () => {
  it('bundles every pdf.js CMap and standard font', () => {
    expect(bundledCMapNames()).toContain('UniJIS-UTF16-H');
    expect(bundledCMapNames().length).toBeGreaterThan(150);
    expect(bundledStandardFontNames()).toEqual(expect.arrayContaining(['FoxitSerif.pfb', 'LiberationSans-Regular.ttf']));
  });

  it('rejects unknown names instead of fetching anything', async () => {
    await expect(new BundledCMapReaderFactory().fetch({ name: '../../etc/passwd' })).rejects.toThrow(/Unknown CMap/);
    await expect(new BundledStandardFontDataFactory().fetch({ filename: 'x.pfb' })).rejects.toThrow(/Unknown standard font/);
  });

  it('the renderer no longer points pdf.js at a CDN and disables eval', () => {
    const renderer = readFileSync(resolve(__dirname, '../renderer.ts'), 'utf8');
    expect(renderer).not.toMatch(/cdnjs|https?:\/\//);
    expect(renderer).toMatch(/isEvalSupported:\s*false/);
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');
    expect(html).not.toMatch(/unsafe-eval/);
  });
});
