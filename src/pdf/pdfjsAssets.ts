/**
 * pdf.js CMaps (CJK and other CID fonts) and standard font data, bundled with
 * the app instead of downloaded from a CDN: the app works offline, and the CSP
 * (connect-src 'self') no longer silently blocks them.
 *
 * pdf.js asks the main thread for these files through the factories below
 * (useWorkerFetch = false), so they are resolved from the Vite bundle.
 */
import { readAssetBytes } from '../utils/assetBytes';

const CMAP_DIR = '/node_modules/pdfjs-dist/cmaps/';
const FONT_DIR = '/node_modules/pdfjs-dist/standard_fonts/';

const cMapUrls = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?url', import: 'default', exhaustive: true,
}) as Record<string, () => Promise<string>>;

const standardFontUrls = import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
  query: '?url', import: 'default', exhaustive: true,
}) as Record<string, () => Promise<string>>;

/** pdf.js CMapCompressionType.BINARY */
const CMAP_COMPRESSION_BINARY = 1;

export class BundledCMapReaderFactory {
  // pdf.js passes { baseUrl, isCompressed }; bundled files need neither.
  constructor(_options?: unknown) {}

  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; compressionType: number }> {
    const load = cMapUrls[`${CMAP_DIR}${name}.bcmap`];
    if (!load) throw new Error(`Unknown CMap "${name}".`);
    return { cMapData: await readAssetBytes(await load()), compressionType: CMAP_COMPRESSION_BINARY };
  }
}

export class BundledStandardFontDataFactory {
  constructor(_options?: unknown) {}

  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    const load = standardFontUrls[`${FONT_DIR}${filename}`];
    if (!load) throw new Error(`Unknown standard font "${filename}".`);
    return readAssetBytes(await load());
  }
}

export const bundledCMapNames = (): string[] =>
  Object.keys(cMapUrls).map((key) => key.slice(CMAP_DIR.length, -'.bcmap'.length));
export const bundledStandardFontNames = (): string[] =>
  Object.keys(standardFontUrls).map((key) => key.slice(FONT_DIR.length));
