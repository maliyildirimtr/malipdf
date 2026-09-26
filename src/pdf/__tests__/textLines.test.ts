import { describe, expect, it } from 'vitest';
import { buildLines, fontStyleFromName, lineAt } from '../textLines';

describe('edit PDF text: lines', () => {
  const runs = [
    { str: 'Hello ', transform: [12, 0, 0, 12, 50, 700], width: 32, fontName: 'f1' },
    { str: 'world', transform: [12, 0, 0, 12, 82, 700], width: 30, fontName: 'f2' },
    { str: 'Second line', transform: [12, 0, 0, 12, 50, 680], width: 60 },
    { str: 'far away', transform: [12, 0, 0, 12, 400, 700], width: 40 },
  ];

  it('joins runs on one baseline and splits far ones', () => {
    const lines = buildLines(runs);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Second line', 'far away']);
    expect(lines[0].width).toBeCloseTo(62);
    expect(lines[0].fontName).toBe('f1');
  });

  it('finds the line under a point', () => {
    const lines = buildLines(runs);
    expect(lineAt(lines, { x: 60, y: 704 })?.text).toBe('Hello world');
    expect(lineAt(lines, { x: 60, y: 683 })?.text).toBe('Second line');
    expect(lineAt(lines, { x: 300, y: 704 })).toBeNull();
  });

  it('works on rotated text', () => {
    const lines = buildLines([{ str: 'Up', transform: [0, 12, -12, 0, 100, 100], width: 20 }]);
    expect(lines[0].angle).toBeCloseTo(Math.PI / 2);
    expect(lineAt(lines, { x: 96, y: 110 })?.text).toBe('Up');
  });

  it('guesses the font style', () => {
    expect(fontStyleFromName('ABCDEF+Arial-BoldItalicMT')).toEqual({ bold: true, italic: true, family: 'sans' });
    expect(fontStyleFromName('TimesNewRomanPSMT')).toEqual({ bold: false, italic: false, family: 'serif' });
    expect(fontStyleFromName('CourierNew', 'sans-serif').family).toBe('mono');
  });
});
