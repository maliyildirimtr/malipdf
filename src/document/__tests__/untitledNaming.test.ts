import { describe, expect, it } from 'vitest';
import { getNextUntitledName } from '../untitledNaming';

describe('untitledNaming', () => {
  it('returns Untitled.pdf when no documents exist', () => {
    expect(getNextUntitledName([])).toBe('Untitled.pdf');
  });

  it('returns Untitled 2.pdf when Untitled.pdf exists', () => {
    expect(getNextUntitledName(['Untitled.pdf'])).toBe('Untitled 2.pdf');
  });

  it('reuses gap if Untitled 2.pdf exists but Untitled.pdf does not', () => {
    expect(getNextUntitledName(['Untitled 2.pdf'])).toBe('Untitled.pdf');
  });

  it('returns Untitled 3.pdf if 1 and 2 exist', () => {
    expect(getNextUntitledName(['Untitled.pdf', 'Untitled 2.pdf'])).toBe('Untitled 3.pdf');
  });

  it('reuses gap 2 if 1 and 3 exist', () => {
    expect(getNextUntitledName(['Untitled.pdf', 'Untitled 3.pdf'])).toBe('Untitled 2.pdf');
  });

  it('ignores other files', () => {
    expect(getNextUntitledName(['MyDoc.pdf', 'Another.pdf'])).toBe('Untitled.pdf');
  });

  it('is case insensitive for existing titles', () => {
    expect(getNextUntitledName(['UNTITLED.PDF'])).toBe('Untitled 2.pdf');
  });
});
