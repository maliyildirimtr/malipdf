import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { padTrueTypeGlyphs } from '../fontPadding';

const font = (file: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../assets/fonts', file)));

const fontkitName = '@pdf-lib/fontkit';
const fontkit = await import(/* @vite-ignore */ fontkitName).then((m) => m.default, () => null);

function glyphLengths(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    tables.set(String.fromCharCode(...bytes.subarray(at, at + 4)), view.getUint32(at + 8));
  }
  const long = view.getInt16(tables.get('head')! + 50) === 1;
  const count = view.getUint16(tables.get('maxp')! + 4);
  const loca = tables.get('loca')!;
  const offset = (i: number) => (long ? view.getUint32(loca + i * 4) : view.getUint16(loca + i * 2) * 2);
  return Array.from({ length: count }, (_, i) => offset(i + 1) - offset(i));
}

describe('padTrueTypeGlyphs', () => {
  it('leaves padded fonts alone', () => {
    const bytes = font('LiberationSans-Regular.ttf');
    expect(padTrueTypeGlyphs(bytes)).toBe(bytes);
  });

  it('pads odd-length glyphs (Carlito) without changing their data', () => {
    const bytes = font('Carlito-Regular.ttf');
    const before = glyphLengths(bytes);
    expect(before.some((n) => n % 2 === 1)).toBe(true);
    const padded = padTrueTypeGlyphs(bytes);
    const after = glyphLengths(padded);
    expect(after.every((n) => n % 2 === 0)).toBe(true);
    expect(after.map((n, i) => n - before[i])).toEqual(before.map((n) => n % 2));
  });

  it.skipIf(!fontkit)('gives fontkit the same outlines', () => {
    const original = fontkit.create(font('Carlito-Regular.ttf'));
    const padded = fontkit.create(padTrueTypeGlyphs(font('Carlito-Regular.ttf')));
    for (const ch of 'Carlito Iğdır şoför ÖĞÜŞ 123') {
      const a = original.glyphForCodePoint(ch.codePointAt(0)!);
      const b = padded.glyphForCodePoint(ch.codePointAt(0)!);
      expect(b.path.toSVG()).toBe(a.path.toSVG());
      expect(b.advanceWidth).toBe(a.advanceWidth);
    }
  });
});
