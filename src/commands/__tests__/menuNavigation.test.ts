import { describe, expect, it } from 'vitest';
import { findTypeaheadMenuIndex, moveMenuIndex } from '..';

describe('menu keyboard navigation', () => {
  const enabled = [true, false, true, true, false];

  it('wraps and skips disabled items', () => {
    expect(moveMenuIndex(enabled, 0, 'next')).toBe(2);
    expect(moveMenuIndex(enabled, 3, 'next')).toBe(0);
    expect(moveMenuIndex(enabled, 0, 'previous')).toBe(3);
  });

  it('supports Home and End semantics', () => {
    expect(moveMenuIndex(enabled, 3, 'first')).toBe(0);
    expect(moveMenuIndex(enabled, 0, 'last')).toBe(3);
    expect(moveMenuIndex([false, false], -1, 'first')).toBe(-1);
  });

  it('supports wrapping typeahead while excluding disabled items', () => {
    const labels = ['Actual Size', 'Annotations', 'Fit Page', 'Fit Width'];
    const availability = [true, false, true, true];
    expect(findTypeaheadMenuIndex(labels, availability, 0, 'f')).toBe(2);
    expect(findTypeaheadMenuIndex(labels, availability, 2, 'f')).toBe(3);
    expect(findTypeaheadMenuIndex(labels, availability, 3, 'a')).toBe(0);
    expect(findTypeaheadMenuIndex(labels, availability, 0, 'ann')).toBe(-1);
  });
});
