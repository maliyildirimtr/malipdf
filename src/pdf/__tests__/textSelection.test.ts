import { describe, expect, it } from 'vitest';
import { buildTextLayout, glyphAt, markupShape, selectText } from '../textSelection';

// Two lines of 10 pt text, every character 5 pt wide (even split: no canvas).
const items = [
  { str: 'Hello world', transform: [10, 0, 0, 10, 100, 700], width: 55, height: 10, hasEOL: true },
  { str: 'second line', transform: [10, 0, 0, 10, 100, 680], width: 55, height: 10, hasEOL: false },
];
const layout = buildTextLayout(items, null);

describe('text selection', () => {
  it('finds the glyph under a point', () => {
    expect(glyphAt(layout, { x: 102, y: 703 })).toBe(0);           // "H"
    expect(glyphAt(layout, { x: 131, y: 703 })).toBe(6);           // "w"
    expect(glyphAt(layout, { x: 400, y: 400 })).toBe(-1);          // far away
  });

  it('snaps to whole words on one line', () => {
    const sel = selectText(layout, { x: 133, y: 703 }, { x: 136, y: 703 })!;
    expect(sel.text).toBe('world');
    expect(sel.quads).toHaveLength(1);
    const [bl, br, tr, tl] = sel.quads[0];
    expect(bl.x).toBeCloseTo(130);
    expect(br.x).toBeCloseTo(155);
    expect(tl.y).toBeCloseTo(709);
    expect(bl.y).toBeCloseTo(697.8);
    expect(tr.x).toBeCloseTo(155);
  });

  it('spans lines in reading order, also when dragged backwards', () => {
    const forward = selectText(layout, { x: 133, y: 703 }, { x: 103, y: 683 })!;
    const backward = selectText(layout, { x: 103, y: 683 }, { x: 133, y: 703 })!;
    expect(forward.text).toBe('world\nsecond');
    expect(backward.text).toBe(forward.text);
    expect(forward.quads).toHaveLength(2);
  });

  it('returns null away from text', () => {
    expect(selectText(layout, { x: 400, y: 100 }, { x: 410, y: 100 })).toBeNull();
  });

  it('builds a fill path for highlights and lines for underline / strikethrough', () => {
    const sel = selectText(layout, { x: 102, y: 703 }, { x: 102, y: 703 })!;
    const fill = markupShape('highlight', sel.quads);
    expect(fill.shape.mode).toBe('fill');
    expect(fill.shape.commands.filter((c) => c.op === 'Z')).toHaveLength(1);
    const under = markupShape('underline', sel.quads);
    const strike = markupShape('strikeout', sel.quads);
    expect(under.shape.mode).toBe('stroke');
    const y = (shape: typeof under) => (shape.shape.commands[0] as { y: number }).y;
    expect(y(under)).toBeLessThan(y(strike));
    expect(y(under)).toBeLessThan(700);            // below the baseline area
    expect(y(strike)).toBeGreaterThan(700);        // through the letters
  });
});
