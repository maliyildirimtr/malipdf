/**
 * Unicode fonts for flattening Text annotations.
 *
 * pdf-lib's Standard 14 fonts only cover WinAnsi, so Turkish (ğ ş İ ı …) and
 * most non-Latin text cannot be written with them. The exporter instead embeds
 * (subsets) the Liberation font matching the annotation's family — metric
 * compatible with Arial / Times New Roman / Courier New, which the canvas uses
 * on screen, so line wrapping stays identical.
 *
 * Loading: vite.config.ts inlines the .ttf files as data: URLs in production
 * builds (fetch() cannot read file:// URLs from a packaged app, and the CSP
 * blocks fetching data: URLs), so bytes are decoded directly. In `vite dev` the
 * URLs are same-origin http URLs and are fetched. Each face is its own lazy
 * chunk and is only loaded when a document containing text in that face is
 * saved or exported.
 *
 * Liberation fonts 2.1.5 — SIL Open Font License 1.1, see assets/fonts/OFL.txt.
 */
import type { Fontkit } from 'pdf-lib/cjs/types/fontkit';
import { readAssetBytes, dataUrlToBytes } from '../utils/assetBytes';
import type { FontFamilyKey, FontStyleKey } from './fontFamilies';

export { readAssetBytes, dataUrlToBytes };

export interface ExportFontSet {
  readonly fontkit: Fontkit;
  /** TrueType bytes of one Liberation face. */
  load: (family: FontFamilyKey, style: FontStyleKey) => Promise<Uint8Array>;
}

export type AssetReader = (url: string) => Promise<Uint8Array>;

const FONT_URL_LOADERS = import.meta.glob('../assets/fonts/Liberation*.ttf', {
  query: '?url', import: 'default',
}) as Record<string, () => Promise<string>>;

const FAMILY_FILE: Record<FontFamilyKey, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono' };
const STYLE_FILE: Record<FontStyleKey, string> = { regular: 'Regular', bold: 'Bold', italic: 'Italic', boldItalic: 'BoldItalic' };

export function exportFontPath(family: FontFamilyKey, style: FontStyleKey): string {
  return `../assets/fonts/Liberation${FAMILY_FILE[family]}-${STYLE_FILE[style]}.ttf`;
}

export function bundledExportFontPaths(): string[] {
  return Object.keys(FONT_URL_LOADERS).sort();
}

let pending: Promise<ExportFontSet> | null = null;

export function loadExportFonts(readAsset: AssetReader = readAssetBytes): Promise<ExportFontSet> {
  if (!pending) {
    pending = (async () => {
      const fontkitModule = await import('@pdf-lib/fontkit');
      const cache = new Map<string, Promise<Uint8Array>>();
      const load = (family: FontFamilyKey, style: FontStyleKey) => {
        const path = exportFontPath(family, style);
        let bytes = cache.get(path);
        if (!bytes) {
          const loader = FONT_URL_LOADERS[path];
          if (!loader) return Promise.reject(new Error(`Missing bundled font ${path}`));
          bytes = loader().then(readAsset);
          bytes.catch(() => cache.delete(path));
          cache.set(path, bytes);
        }
        return bytes;
      };
      return { fontkit: fontkitModule.default, load };
    })();
    // Allow a later retry if loading failed (e.g. dependency missing).
    pending.catch(() => { pending = null; });
  }
  return pending;
}
