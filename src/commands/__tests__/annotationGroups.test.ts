import { describe, expect, it } from 'vitest';
import { groupAnnotations } from '../annotationListCommands';
import type { Annotation } from '../../types/annotations';

const stroke = (id: string, color = '#16a34a', extra: Partial<Annotation> = {}) =>
  ({ id, type: 'stroke', pageIndex: 0, color, opacity: 1, points: [], width: 2, ...extra }) as unknown as Annotation;
const shape = (id: string) => ({ id, type: 'shape', shapeKind: 'arrow', pageIndex: 0, color: '#16a34a' }) as unknown as Annotation;

describe('annotation groups', () => {
  it('joins consecutive strokes of one colour', () => {
    const items = groupAnnotations([stroke('a', '#e63946'), stroke('b'), stroke('c'), stroke('d'), shape('e'), stroke('f'), stroke('g', '#E63946'), stroke('h', '#e63946')]);
    expect(items.map((i) => (i.kind === 'group' ? i.annotations.map((a) => a.id).join('') : i.annotation.id))).toEqual(['a', 'bcd', 'e', 'f', 'gh']);
  });

  it('keeps differently tagged strokes apart', () => {
    const items = groupAnnotations([stroke('a', '#000', { tags: ['exam'] }), stroke('b', '#000')]);
    expect(items.every((i) => i.kind === 'single')).toBe(true);
  });
});
