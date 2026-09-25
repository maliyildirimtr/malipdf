import { describe, expect, it } from 'vitest';
import { buildPageTextIndex, findMatchesInPage, normalizeQuery } from '../textSearch';

const item = (str: string, x: number, y: number, width: number, size = 10, hasEOL = false) => ({
  str, transform: [size, 0, 0, size, x, y], width, height: size, hasEOL,
});

describe('text search', () => {
  it('is case, diacritic and Turkish-i insensitive', () => {
    expect(normalizeQuery('  ŞEHİR  ışık ')).toBe('sehir isik');
    const index = buildPageTextIndex([item('İstanbul büyük bir şehir.', 0, 0, 250)]);
    expect(findMatchesInPage(index, 'istanbul', 0)).toHaveLength(1);
    expect(findMatchesInPage(index, 'sehir', 0)).toHaveLength(1);
    expect(findMatchesInPage(index, 'ŞEHİR', 0)[0].snippet).toContain('şehir');
  });

  it('matches across line breaks and counts every occurrence', () => {
    const index = buildPageTextIndex([item('the quick', 0, 100, 90, 10, true), item('brown fox, the end', 0, 80, 180)]);
    expect(findMatchesInPage(index, 'quick brown', 3)).toHaveLength(1);
    expect(findMatchesInPage(index, 'the', 3)).toHaveLength(2);
    expect(findMatchesInPage(index, 'quick brown', 3)[0].rects).toHaveLength(2); // spans two lines
    expect(findMatchesInPage(index, '   ', 0)).toEqual([]);
  });

  it('places rectangles in PDF user space over the matched characters', () => {
    const index = buildPageTextIndex([item('abcdefghij', 100, 500, 100)]);
    const [match] = findMatchesInPage(index, 'cde', 0);
    const [rect] = match.rects;
    expect(rect.x).toBeCloseTo(120);
    expect(rect.width).toBeCloseTo(30);
    expect(rect.y).toBeLessThan(500);
    expect(rect.y + rect.height).toBeGreaterThan(500);
  });
});
