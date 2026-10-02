/**
 * Unicode fonts for flattening Text annotations.
 *
 * pdf-lib's Standard 14 fonts only cover WinAnsi, so Turkish (ğ ş İ ı …) and
 * most non-Latin text cannot be written with them. The exporter instead embeds
 * (subsets) the bundled font matching the annotation's family — the same face
 * the canvas uses on screen (Liberation is metric compatible with Arial / Times
 * New Roman / Courier New), so line wrapping stays identical.
 *
 * Loading: vite.config.ts inlines the .ttf files as data: URLs in production
 * builds (fetch() cannot read file:// URLs from a packaged app, and the CSP
 * blocks fetching data: URLs), so bytes are decoded directly. In `vite dev` the
 * URLs are same-origin http URLs and are fetched. Each face is its own lazy
 * chunk and is only loaded when a document containing text in that face is
 * saved or exported.
 *
 * Liberation 2.1.5, Carlito, Caladea, Poppins — SIL Open Font License 1.1
 * (assets/fonts/OFL.txt). DejaVu — Bitstream Vera license
 * (assets/fonts/DejaVu-LICENSE.txt). All files are shipped unmodified.
 */
import type { Fontkit } from 'pdf-lib/cjs/types/fontkit';
import { readAssetBytes, dataUrlToBytes } from '../utils/assetBytes';
import type { FontFamilyKey, FontStyleKey } from './fontFamilies';
import { padTrueTypeGlyphs } from './fontPadding';

export { readAssetBytes, dataUrlToBytes };

export interface ExportFontSet {
  readonly fontkit: Fontkit;
  /** TrueType bytes of one bundled face. */
  load: (family: FontFamilyKey, style: FontStyleKey) => Promise<Uint8Array>;
}

export type AssetReader = (url: string) => Promise<Uint8Array>;

const FONT_URL_LOADERS = import.meta.glob('../assets/fonts/*.ttf', {
  query: '?url', import: 'default',
}) as Record<string, () => Promise<string>>;

const STYLE_SUFFIX: Record<FontStyleKey, string> = { regular: '-Regular', bold: '-Bold', italic: '-Italic', boldItalic: '-BoldItalic' };
/** DejaVu names its faces "DejaVuSans.ttf", "DejaVuSans-Oblique.ttf", … */
const DEJAVU_SUFFIX = (oblique: boolean): Record<FontStyleKey, string> => ({
  regular: '', bold: '-Bold', italic: oblique ? '-Oblique' : '-Italic', boldItalic: oblique ? '-BoldOblique' : '-BoldItalic',
});

const FONT_FILES: Record<FontFamilyKey, { base: string; suffix: Record<FontStyleKey, string> }> = {
  sans: { base: 'LiberationSans', suffix: STYLE_SUFFIX },
  serif: { base: 'LiberationSerif', suffix: STYLE_SUFFIX },
  mono: { base: 'LiberationMono', suffix: STYLE_SUFFIX },
  carlito: { base: 'Carlito', suffix: STYLE_SUFFIX },
  poppins: { base: 'Poppins', suffix: STYLE_SUFFIX },
  caladea: { base: 'Caladea', suffix: STYLE_SUFFIX },
  dejavuSans: { base: 'DejaVuSans', suffix: DEJAVU_SUFFIX(true) },
  dejavuSerif: { base: 'DejaVuSerif', suffix: DEJAVU_SUFFIX(false) },
  dejavuMono: { base: 'DejaVuSansMono', suffix: DEJAVU_SUFFIX(true) },
};

export function exportFontPath(family: FontFamilyKey, style: FontStyleKey): string {
  const file = FONT_FILES[family] ?? FONT_FILES.sans;
  return `../assets/fonts/${file.base}${file.suffix[style]}.ttf`;
}

const byteCache = new Map<string, Promise<Uint8Array>>();

/** Bytes of one bundled face (no fontkit needed; also used for on-screen fonts). */
export function loadFontBytes(family: FontFamilyKey, style: FontStyleKey, readAsset: AssetReader = readAssetBytes): Promise<Uint8Array> {
  const path = exportFontPath(family, style);
  const key = readAsset === readAssetBytes ? path : '';
  let bytes = key ? byteCache.get(key) : undefined;
  if (!bytes) {
    const loader = FONT_URL_LOADERS[path];
    if (!loader) return Promise.reject(new Error(`Missing bundled font ${path}`));
    bytes = loader().then(readAsset);
    if (key) {
      bytes.catch(() => byteCache.delete(key));
      byteCache.set(key, bytes);
    }
  }
  return bytes;
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
          // Padded copy: fontkit cannot subset fonts with odd-length glyphs.
          bytes = loadFontBytes(family, style, readAsset).then(padTrueTypeGlyphs);
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
