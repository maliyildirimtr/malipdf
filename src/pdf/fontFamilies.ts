/**
 * Text annotation font families. The CSS stacks put the macOS/Windows system
 * font first and Liberation second: Liberation Sans/Serif/Mono are metric-
 * compatible with Arial/Times New Roman/Courier New, and the same Liberation
 * faces are embedded when saving, so line breaks match between screen and PDF.
 */
export type FontFamilyKey = 'sans' | 'serif' | 'mono';
export type FontStyleKey = 'regular' | 'bold' | 'italic' | 'boldItalic';

export const TEXT_FONT_FAMILIES: { key: FontFamilyKey; label: string; css: string }[] = [
  { key: 'sans', label: 'Sans (Arial)', css: 'Arial, "Liberation Sans", Helvetica, sans-serif' },
  { key: 'serif', label: 'Serif (Times)', css: '"Times New Roman", "Liberation Serif", Times, serif' },
  { key: 'mono', label: 'Mono (Courier)', css: '"Courier New", "Liberation Mono", Courier, monospace' },
];

/** Classify any stored CSS font-family string (including older values like "Georgia, serif"). */
export function fontFamilyKey(css: string | undefined): FontFamilyKey {
  const value = (css ?? '').toLowerCase();
  if (/mono|courier|consolas|menlo/.test(value)) return 'mono';
  if (/(^|[\s,"'])serif|times|georgia|garamond|cambria/.test(value.replace(/sans-serif/g, ''))) return 'serif';
  return 'sans';
}

export function cssForFamily(key: FontFamilyKey): string {
  return TEXT_FONT_FAMILIES.find((f) => f.key === key)!.css;
}

export function fontStyleKey(bold: boolean, italic: boolean): FontStyleKey {
  return bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
}
