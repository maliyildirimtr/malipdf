import { beforeAll, describe, expect, it } from 'vitest';
import { renderAnnotations } from '../annotationRenderer';
import { useUIStore } from '../../store/uiStore';
import type { Annotation } from '../../types/annotations';
import type { PageTransform } from '../coordinateTransform';

beforeAll(() => {
  (globalThis as any).Path2D = class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} };
});

/** Minimal 2D context that records the dash pattern used for each stroke. */
function fakeContext() {
  let state = { dash: [] as number[] };
  const stack: typeof state[] = [];
  const strokes: number[][] = [];
  const ctx: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'save') return () => stack.push({ dash: [...state.dash] });
      if (prop === 'restore') return () => { state = stack.pop() ?? state; };
      if (prop === 'setLineDash') return (d: number[]) => { state.dash = [...d]; };
      if (prop === 'stroke') return () => strokes.push([...state.dash]);
      return () => undefined;
    },
    set() { return true; },
  });
  return { ctx, strokes };
}

const transform = {
  scale: 1,
  viewport: { convertToViewportPoint: (x: number, y: number) => [x, y] },
} as unknown as PageTransform;
const base = { opacity: 1, locked: false, createdAt: 0, updatedAt: 0, pageIndex: 0, color: '#000000' };

describe('renderer state isolation', () => {
  it('a dashed shape does not make the next pen stroke dashed', () => {
    const dashed = { ...base, id: 'r', type: 'shape', shapeKind: 'rectangle', startPoint: { x: 0, y: 0 }, endPoint: { x: 50, y: 50 }, strokeWidth: 2, fillColor: 'transparent', borderStyle: 'dashed' } as Annotation;
    const pen = { ...base, id: 'p', type: 'stroke', points: [{ x: 0, y: 0, pressure: 0.5, timestamp: 0 }, { x: 10, y: 10, pressure: 0.5, timestamp: 1 }], width: 2, smooth: true, pressure: false } as Annotation;
    const { ctx, strokes } = fakeContext();
    renderAnnotations(ctx, [dashed, pen], transform);
    expect(strokes[0].length).toBeGreaterThan(0); // the rectangle is dashed
    expect(strokes[strokes.length - 1]).toEqual([]); // the pen is solid
  });
});

describe('per-tool shape styles', () => {
  it('each shape tool keeps its own style', () => {
    const ui = useUIStore.getState();
    ui.setActiveTool('rectangle');
    useUIStore.getState().updateShapeOptions({ borderStyle: 'dashed', strokeWidth: 7 });
    useUIStore.getState().setActiveTool('line');
    expect(useUIStore.getState().toolOptions.shape.borderStyle).toBe('solid');
    useUIStore.getState().updateShapeOptions({ color: '#00ff00' });
    useUIStore.getState().setActiveTool('pen');
    useUIStore.getState().setActiveTool('rectangle');
    expect(useUIStore.getState().toolOptions.shape).toMatchObject({ borderStyle: 'dashed', strokeWidth: 7 });
    useUIStore.getState().setActiveTool('line');
    expect(useUIStore.getState().toolOptions.shape.color).toBe('#00ff00');
  });
});
