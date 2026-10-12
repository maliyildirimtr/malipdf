import { describe, expect, it } from 'vitest';
import { fingerNavigates, PALM_AFTER_PENCIL_MS, StylusScrollGuard } from '../pencilInput';
import { base64ToBytes, bytesToBase64, isIpadApp } from '../native';

const pencil = { touchType: 'stylus' } as unknown as Touch;
const finger = { touchType: 'direct' } as unknown as Touch;

describe('iPad: draw with Apple Pencil only', () => {
  it('a finger scrolls with drawing tools but still taps with select, text and note', () => {
    expect(fingerNavigates('touch', 'pen', true)).toBe(true);
    expect(fingerNavigates('touch', 'eraser', true)).toBe(true);
    expect(fingerNavigates('touch', 'select', true)).toBe(false);
    expect(fingerNavigates('touch', 'text', true)).toBe(false);
    expect(fingerNavigates('pen', 'pen', true)).toBe(false);
    expect(fingerNavigates('touch', 'pen', false)).toBe(false);
  });

  it('the Pencil never scrolls; a finger does', () => {
    const guard = new StylusScrollGuard();
    expect(guard.touchStart([finger], 0)).toBe(false);
    expect(guard.touchStart([pencil], 10)).toBe(true);
    expect(guard.touchMove([pencil])).toBe(true);
  });

  it('a palm resting while writing, or just after, does not scroll', () => {
    const guard = new StylusScrollGuard();
    guard.touchStart([pencil], 0);
    expect(guard.touchStart([finger], 50)).toBe(true); // pencil still down
    guard.touchEnd([pencil], 100);
    expect(guard.touchStart([finger], 100 + PALM_AFTER_PENCIL_MS - 1)).toBe(true);
    expect(guard.touchStart([finger], 100 + PALM_AFTER_PENCIL_MS + 1)).toBe(false);
  });
});

describe('iPad bridge helpers', () => {
  it('round-trips binary data through base64', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes('data:image/png;base64,AAEC')).toEqual(new Uint8Array([0, 1, 2]));
  });

  it('is off outside the iPad app', () => {
    expect(isIpadApp()).toBe(false);
  });
});
