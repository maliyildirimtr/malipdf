import { describe, it, expect } from 'vitest';
import { calculatePrintoutRasterSize } from '../printoutRasterSize';

describe('calculatePrintoutRasterSize', () => {
  it('calculates unconstrained dimensions correctly', () => {
    // 8.5 x 11 inches at 72 points per inch = 612 x 792 points
    const result = calculatePrintoutRasterSize({
      widthPdfPoints: 612,
      heightPdfPoints: 792,
      targetDpi: 144, // 2x density
      maxPixelArea: 16000000,
    });
    
    expect(result.widthPx).toBe(1224);
    expect(result.heightPx).toBe(1584);
    expect(result.effectiveDpi).toBe(144);
  });

  it('clamps dimensions to maxPixelArea while preserving aspect ratio', () => {
    // 612 x 792 points
    // At 1440 DPI, this would be 12240 x 15840 = 193,881,600 pixels (way over 16MP)
    const result = calculatePrintoutRasterSize({
      widthPdfPoints: 612,
      heightPdfPoints: 792,
      targetDpi: 1440,
      maxPixelArea: 16000000,
    });
    
    const area = result.widthPx * result.heightPx;
    
    expect(area).toBeLessThanOrEqual(16000000);
    // Should be close to max area
    expect(area).toBeGreaterThan(15900000);
    
    // Check aspect ratio (width / height = 612 / 792 = 0.7727)
    const aspect = result.widthPx / result.heightPx;
    expect(aspect).toBeCloseTo(612 / 792, 2);
    
    expect(result.effectiveDpi).toBeLessThan(1440);
  });
  
  it('handles tiny pages', () => {
    const result = calculatePrintoutRasterSize({
      widthPdfPoints: 1,
      heightPdfPoints: 1,
      targetDpi: 144,
      maxPixelArea: 16000000,
    });
    
    expect(result.widthPx).toBe(2);
    expect(result.heightPx).toBe(2);
  });
});
