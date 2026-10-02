import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from '../linkSafety';

describe('safeExternalUrl', () => {
  it('allows web and mail links only', () => {
    expect(safeExternalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeExternalUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
    expect(safeExternalUrl(42)).toBeNull();
  });
});
