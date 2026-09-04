export type IsoASeries = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10';
export type IsoBSeries = 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9' | 'B10';
export type IsoCSeries = 'C0' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9' | 'C10';
export type NorthAmerican = 'Letter' | 'Legal' | 'Tabloid' | 'Executive';
export type ScreenPresentation = '16:9' | '16:10' | '4:3' | '3:2' | '21:9' | '1:1';

export type PageSizePreset = IsoASeries | IsoBSeries | IsoCSeries | NorthAmerican | ScreenPresentation | 'Custom';
export type Orientation = 'Portrait' | 'Landscape';
export type Unit = 'mm' | 'inch' | 'pt';

const MM_TO_PT = 72 / 25.4;
const INCH_TO_PT = 72;

export const ISO_A_MM: Record<IsoASeries, [number, number]> = {
  A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420],
  A4: [210, 297], A5: [148, 210], A6: [105, 148], A7: [74, 105],
  A8: [52, 74], A9: [37, 52], A10: [26, 37],
};

export const ISO_B_MM: Record<IsoBSeries, [number, number]> = {
  B0: [1000, 1414], B1: [707, 1000], B2: [500, 707], B3: [353, 500],
  B4: [250, 353], B5: [176, 250], B6: [125, 176], B7: [88, 125],
  B8: [62, 88], B9: [44, 62], B10: [31, 44],
};

export const ISO_C_MM: Record<IsoCSeries, [number, number]> = {
  C0: [917, 1297], C1: [648, 917], C2: [458, 648], C3: [324, 458],
  C4: [229, 324], C5: [162, 229], C6: [114, 162], C7: [81, 114],
  C8: [57, 81], C9: [40, 57], C10: [28, 40],
};

// Defined in pure inches to avoid round trip errors
export const NA_INCH: Record<NorthAmerican, [number, number]> = {
  Letter: [8.5, 11],
  Legal: [8.5, 14],
  Tabloid: [11, 17],
  Executive: [7.25, 10.5],
};

// Defined directly in PDF Points representing standard presentation physical sizes
// We anchor width at 960pt (13.33 inches) for widescreen, which is common in PowerPoint.
export const SCREEN_PT: Record<ScreenPresentation, [number, number]> = {
  '16:9': [960, 540],
  '16:10': [960, 600],
  '4:3': [960, 720],
  '3:2': [960, 640],
  '21:9': [1120, 480],
  '1:1': [800, 800],
};

export function convertToPt(value: number, unit: Unit): number {
  switch (unit) {
    case 'mm': return value * MM_TO_PT;
    case 'inch': return value * INCH_TO_PT;
    case 'pt': return value;
  }
}

export function getCanonicalPageDimensions(
  preset: PageSizePreset,
  orientation: Orientation,
  customWidth: number = 210,
  customHeight: number = 297,
  customUnit: Unit = 'mm',
): [number, number] {
  let widthPt = 0;
  let heightPt = 0;

  if (preset === 'Custom') {
    widthPt = convertToPt(customWidth, customUnit);
    heightPt = convertToPt(customHeight, customUnit);
  } else if (preset in ISO_A_MM) {
    const [w, h] = ISO_A_MM[preset as IsoASeries];
    widthPt = convertToPt(w, 'mm');
    heightPt = convertToPt(h, 'mm');
  } else if (preset in ISO_B_MM) {
    const [w, h] = ISO_B_MM[preset as IsoBSeries];
    widthPt = convertToPt(w, 'mm');
    heightPt = convertToPt(h, 'mm');
  } else if (preset in ISO_C_MM) {
    const [w, h] = ISO_C_MM[preset as IsoCSeries];
    widthPt = convertToPt(w, 'mm');
    heightPt = convertToPt(h, 'mm');
  } else if (preset in NA_INCH) {
    const [w, h] = NA_INCH[preset as NorthAmerican];
    widthPt = convertToPt(w, 'inch');
    heightPt = convertToPt(h, 'inch');
  } else if (preset in SCREEN_PT) {
    const [w, h] = SCREEN_PT[preset as ScreenPresentation];
    widthPt = w;
    heightPt = h;
  }

  // Ensure width <= height for Portrait, and width > height for Landscape
  const min = Math.min(widthPt, heightPt);
  const max = Math.max(widthPt, heightPt);

  if (orientation === 'Portrait') {
    return [min, max];
  } else {
    return [max, min];
  }
}
