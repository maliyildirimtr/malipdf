import { describe, expect, it } from 'vitest';
import { splitByRanges, splitEvery } from '../splitPlan';

describe('split plan', () => {
  it('splits every N pages', () => {
    expect(splitEvery(7, 3).map((p) => p.pages)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(splitEvery(3, 1).map((p) => p.label)).toEqual(['page 1', 'page 2', 'page 3']);
  });

  it('parses ranges, single pages and open ends', () => {
    const parts = splitByRanges(10, '1-3, 5; 8-');
    expect(parts.map((p) => p.pages)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
    expect(parts.map((p) => p.label)).toEqual(['pages 1-3', 'page 5', 'pages 8-10']);
    expect(splitByRanges(10, '-2')[0].pages).toEqual([0, 1]);
  });

  it('rejects bad ranges', () => {
    expect(() => splitByRanges(5, '')).toThrow();
    expect(() => splitByRanges(5, '2-9')).toThrow(/outside/);
    expect(() => splitByRanges(5, '4-2')).toThrow();
    expect(() => splitByRanges(5, 'abc')).toThrow(/not a page range/);
  });
});
