export const FIXED_PALETTE = [
  '#000000', '#3E0000', '#3E3E00', '#003E00', '#003E3E', '#00007F', '#3E003E', '#3E3E3E',
  '#7F0000', '#7F3E00', '#7F7F00', '#007F00', '#007F7F', '#0000FF', '#7F007F', '#7F7F7F',
  '#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#00FFFF', '#007FFF', '#FF00FF', '#C0C0C0',
  '#FF7F7F', '#FFC07F', '#FFFF7F', '#7FFF7F', '#7FFFFF', '#7FBFFF', '#FF7FFF', '#E0E0E0',
  '#FFBFBF', '#FFE0BF', '#FFFFBF', '#BFFFBF', '#BFFFFF', '#BFDFFF', '#FFBFFF', '#F0F0F0',
  '#FFDFDF', '#FFF0DF', '#FFFFDF', '#DFFFDF', '#DFFFFF', '#DFEFFF', '#FFDFFF', '#FFFFFF'
] as const;

export type FixedPaletteColor = typeof FIXED_PALETTE[number];

export function normalizeColor(color: string): string {
  const lower = color.toLowerCase();
  if (lower === 'white') return '#ffffff';
  if (lower === 'black') return '#000000';
  if (lower === 'transparent') return 'transparent';

  if (lower.startsWith('#')) {
    if (lower.length === 4) {
      // #f00 -> #ff0000
      return '#' + lower[1].repeat(2) + lower[2].repeat(2) + lower[3].repeat(2);
    }
    return lower;
  }
  return lower;
}
