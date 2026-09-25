/**
 * Unicode fonts for flattening Text annotations.
 *
 * pdf-lib's Standard 14 fonts only cover WinAnsi, so Turkish (ğ ş İ ı …) and
 * most non-Latin text cannot be written with them. When this font set is
 * available, the exporter embeds (subsets) Liberation Sans, which is metric
 * compatible with Helvetica/Arial, so line wrapping stays identical.
 *
 * Loading: vite.config.ts inlines the .ttf files as data: URLs in production
 * builds (fetch() cannot read file:// URLs from a packaged app, and the CSP
 * blocks fetching data: URLs), so bytes are decoded directly. In `vite dev` the
 * URLs are same-origin http URLs and are fetched. This module is only imported
 * lazily when a document containing text is saved or exported.
 *
 * Liberation Sans 2.1.5 — SIL Open Font License 1.1, see assets/fonts/OFL.txt.
 */
import type { Fontkit } from 'pdf-lib/cjs/types/fontkit';
import { readAssetBytes, dataUrlToBytes } from '../utils/assetBytes';

export { readAssetBytes, dataUrlToBytes };
import regularUrl from '../assets/fonts/LiberationSans-Regular.ttf?url';
import boldUrl from '../assets/fonts/LiberationSans-Bold.ttf?url';
import italicUrl from '../assets/fonts/LiberationSans-Italic.ttf?url';
import boldItalicUrl from '../assets/fonts/LiberationSans-BoldItalic.ttf?url';

export interface ExportFontSet {
  readonly fontkit: Fontkit;
  readonly regular: Uint8Array;
  readonly bold: Uint8Array;
  readonly italic: Uint8Array;
  readonly boldItalic: Uint8Array;
}

export type AssetReader = (url: string) => Promise<Uint8Array>;

export const EXPORT_FONT_URLS = {
  regular: regularUrl,
  bold: boldUrl,
  italic: italicUrl,
  boldItalic: boldItalicUrl,
} as const;

let pending: Promise<ExportFontSet> | null = null;

export function loadExportFonts(readAsset: AssetReader = readAssetBytes): Promise<ExportFontSet> {
  if (!pending) {
    pending = (async () => {
      const [fontkitModule, regular, bold, italic, boldItalic] = await Promise.all([
        import('@pdf-lib/fontkit'),
        readAsset(EXPORT_FONT_URLS.regular),
        readAsset(EXPORT_FONT_URLS.bold),
        readAsset(EXPORT_FONT_URLS.italic),
        readAsset(EXPORT_FONT_URLS.boldItalic),
      ]);
      return { fontkit: fontkitModule.default, regular, bold, italic, boldItalic };
    })();
    // Allow a later retry if loading failed (e.g. dependency missing).
    pending.catch(() => { pending = null; });
  }
  return pending;
}
