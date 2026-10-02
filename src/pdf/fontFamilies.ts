/**
 * Text annotation font families.
 *
 * Every family is bundled with the app (src/assets/fonts) and the same face is
 * embedded when saving, so line breaks match between screen and PDF.
 *
 * - Arial / Times New Roman / Courier New put the system font first and
 *   Liberation second (metric-compatible), so no loading is needed on screen.
 * - The other families are registered on screen from the bundled files
 *   (screenFonts.ts) under their `face` name, which comes first in the stack.
 */
export type FontFamilyKey =
  | 'sans' | 'serif' | 'mono'
  | 'carlito' | 'poppins' | 'dejavuSans'
  | 'caladea' | 'dejavuSerif'
  | 'dejavuMono';
export type FontStyleKey = 'regular' | 'bold' | 'italic' | 'boldItalic';
export type FontGroup = 'sans' | 'serif' | 'mono';

export interface TextFontFamily {
  key: FontFamilyKey;
  label: string;
  css: string;
  group: FontGroup;
  /** Name registered with document.fonts; absent for system-first families. */
  face?: string;
  /** Matches one name of a stored CSS font-family string. */
  match: RegExp;
}

export const TEXT_FONT_FAMILIES: TextFontFamily[] = [
  { key: 'sans', label: 'Arial', group: 'sans', css: 'Arial, "Liberation Sans", Helvetica, sans-serif', match: /arial|liberation sans|helvetica/ },
  { key: 'carlito', label: 'Carlito (Calibri)', group: 'sans', face: 'MaliPDF Carlito', css: '"MaliPDF Carlito", Carlito, Calibri, sans-serif', match: /carlito|calibri/ },
  { key: 'poppins', label: 'Poppins', group: 'sans', face: 'MaliPDF Poppins', css: '"MaliPDF Poppins", Poppins, sans-serif', match: /poppins/ },
  { key: 'dejavuSans', label: 'DejaVu Sans (Verdana)', group: 'sans', face: 'MaliPDF DejaVu Sans', css: '"MaliPDF DejaVu Sans", "DejaVu Sans", Verdana, sans-serif', match: /dejavu sans(?! mono)|verdana/ },
  { key: 'serif', label: 'Times New Roman', group: 'serif', css: '"Times New Roman", "Liberation Serif", Times, serif', match: /times|liberation serif/ },
  { key: 'caladea', label: 'Caladea (Cambria)', group: 'serif', face: 'MaliPDF Caladea', css: '"MaliPDF Caladea", Caladea, Cambria, serif', match: /caladea|cambria/ },
  { key: 'dejavuSerif', label: 'DejaVu Serif', group: 'serif', face: 'MaliPDF DejaVu Serif', css: '"MaliPDF DejaVu Serif", "DejaVu Serif", serif', match: /dejavu serif/ },
  { key: 'mono', label: 'Courier New', group: 'mono', css: '"Courier New", "Liberation Mono", Courier, monospace', match: /courier|liberation mono/ },
  { key: 'dejavuMono', label: 'DejaVu Sans Mono', group: 'mono', face: 'MaliPDF DejaVu Sans Mono', css: '"MaliPDF DejaVu Sans Mono", "DejaVu Sans Mono", Menlo, monospace', match: /dejavu sans mono|menlo/ },
];

export const FONT_GROUP_LABELS: Record<FontGroup, string> = { sans: 'Sans-serif', serif: 'Serif', mono: 'Monospace' };

const BY_KEY = new Map(TEXT_FONT_FAMILIES.map((f) => [f.key, f]));

export function fontFamilyInfo(key: FontFamilyKey): TextFontFamily {
  return BY_KEY.get(key) ?? TEXT_FONT_FAMILIES[0];
}

/** Classify any stored CSS font-family string (including older values like "Georgia, serif"). */
export function fontFamilyKey(css: string | undefined): FontFamilyKey {
  const value = (css ?? '').toLowerCase();
  // The first known name decides; later names are fallbacks.
  for (const name of value.split(',')) {
    const hit = TEXT_FONT_FAMILIES.find((f) => f.match.test(name));
    if (hit) return hit.key;
  }
  if (/mono|courier|consolas|menlo/.test(value)) return 'mono';
  if (/(^|[\s,"'])serif|times|georgia|garamond/.test(value.replace(/sans-serif/g, ''))) return 'serif';
  return 'sans';
}

export function cssForFamily(key: FontFamilyKey): string {
  return fontFamilyInfo(key).css;
}

/** Sans / serif / mono, for Standard 14 fallbacks. */
export function fontGroup(key: FontFamilyKey): FontGroup {
  return fontFamilyInfo(key).group;
}

export function fontStyleKey(bold: boolean, italic: boolean): FontStyleKey {
  return bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
}
