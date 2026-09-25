export interface CalculatePrintoutRasterSizeOptions {
  widthPdfPoints: number;
  heightPdfPoints: number;
  targetDpi: number;
  maxPixelArea: number;
}

export interface PrintoutRasterSizeResult {
  widthPx: number;
  heightPx: number;
  effectiveDpi: number;
}

export function calculatePrintoutRasterSize({
  widthPdfPoints,
  heightPdfPoints,
  targetDpi,
  maxPixelArea,
}: CalculatePrintoutRasterSizeOptions): PrintoutRasterSizeResult {
  const pointsPerInch = 72;
  
  // Calculate unconstrained physical pixels
  let widthPx = (widthPdfPoints / pointsPerInch) * targetDpi;
  let heightPx = (heightPdfPoints / pointsPerInch) * targetDpi;
  
  let area = widthPx * heightPx;
  let effectiveDpi = targetDpi;

  // Clamp if over max pixel area
  if (area > maxPixelArea && maxPixelArea > 0) {
    const scale = Math.sqrt(maxPixelArea / area);
    widthPx *= scale;
    heightPx *= scale;
    effectiveDpi *= scale;
  }

  // Round to nearest integer for raster dimensions
  widthPx = Math.max(1, Math.round(widthPx));
  heightPx = Math.max(1, Math.round(heightPx));

  return {
    widthPx,
    heightPx,
    effectiveDpi,
  };
}
