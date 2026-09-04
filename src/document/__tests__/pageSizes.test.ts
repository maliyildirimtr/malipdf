import { describe, expect, it } from 'vitest';
import { getCanonicalPageDimensions, convertToPt } from '../pageSizes';

describe('pageSizes', () => {
  it('converts correctly', () => {
    expect(convertToPt(1, 'pt')).toBe(1);
    expect(convertToPt(1, 'inch')).toBe(72);
    expect(convertToPt(25.4, 'mm')).toBeCloseTo(72);
  });

  it('returns correctly for ISO A series', () => {
    const [wA4, hA4] = getCanonicalPageDimensions('A4', 'Portrait');
    expect(wA4).toBeCloseTo(210 * 72 / 25.4);
    expect(hA4).toBeCloseTo(297 * 72 / 25.4);

    const [wA0, hA0] = getCanonicalPageDimensions('A0', 'Landscape');
    expect(wA0).toBeCloseTo(1189 * 72 / 25.4);
    expect(hA0).toBeCloseTo(841 * 72 / 25.4);
    
    const [wA10, hA10] = getCanonicalPageDimensions('A10', 'Portrait');
    expect(wA10).toBeCloseTo(26 * 72 / 25.4);
  });

  it('returns correctly for ISO B series', () => {
    const [w, h] = getCanonicalPageDimensions('B0', 'Portrait');
    expect(w).toBeCloseTo(1000 * 72 / 25.4);
    expect(h).toBeCloseTo(1414 * 72 / 25.4);
  });

  it('returns correctly for ISO C series', () => {
    const [w, h] = getCanonicalPageDimensions('C5', 'Landscape');
    expect(w).toBeCloseTo(229 * 72 / 25.4);
    expect(h).toBeCloseTo(162 * 72 / 25.4);
  });

  it('returns correctly for North American series (in inches natively)', () => {
    const [wL, hL] = getCanonicalPageDimensions('Letter', 'Portrait');
    expect(wL).toBeCloseTo(8.5 * 72);
    expect(hL).toBeCloseTo(11 * 72);

    const [wT, hT] = getCanonicalPageDimensions('Tabloid', 'Landscape');
    expect(wT).toBeCloseTo(17 * 72);
    expect(hT).toBeCloseTo(11 * 72);
  });

  it('returns correctly for Screen / Presentation formats', () => {
    // 16:9 is 960 x 540 in Landscape
    const [w1, h1] = getCanonicalPageDimensions('16:9', 'Landscape');
    expect(w1).toBe(960);
    expect(h1).toBe(540);

    // 16:9 in Portrait is swapped to 540 x 960
    const [w2, h2] = getCanonicalPageDimensions('16:9', 'Portrait');
    expect(w2).toBe(540);
    expect(h2).toBe(960);

    // 4:3
    const [w3, h3] = getCanonicalPageDimensions('4:3', 'Landscape');
    expect(w3).toBe(960);
    expect(h3).toBe(720);
  });

  it('returns custom size', () => {
    const [w, h] = getCanonicalPageDimensions('Custom', 'Portrait', 10, 20, 'inch');
    expect(w).toBe(720);
    expect(h).toBe(1440);
  });

  it('custom size ignores orientation if already correct, but flips if wrong', () => {
    const [w1, h1] = getCanonicalPageDimensions('Custom', 'Portrait', 20, 10, 'inch');
    expect(w1).toBe(720);
    expect(h1).toBe(1440);

    const [w2, h2] = getCanonicalPageDimensions('Custom', 'Landscape', 10, 20, 'inch');
    expect(w2).toBe(1440);
    expect(h2).toBe(720);
  });
});
