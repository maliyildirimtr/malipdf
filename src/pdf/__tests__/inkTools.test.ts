import { describe, expect, it } from 'vitest';
import { annotationsInLasso, pointInPolygon } from '../lassoSelect';
import { buildReplayPlan, replayFrame, replayLength, REPLAY_GAP_MS } from '../inkReplay';
import { projectOntoEdge, rulerEdges, snapEdgeFor, RULER_THICKNESS } from '../../store/rulerStore';
import { penButtonTool } from '../../utils/penButtons';
import type { Annotation, InputPoint } from '../../types/annotations';

const base = { opacity: 1, locked: false, updatedAt: 0, pageIndex: 0, color: '#000000' };
const pts = (xs: [number, number][], t0 = 0): InputPoint[] => xs.map(([x, y], i) => ({ x, y, pressure: 0.5, timestamp: t0 + i * 10 }));
const stroke = (id: string, points: InputPoint[], createdAt = 0) =>
  ({ ...base, id, createdAt, type: 'stroke', points, width: 2, smooth: true, pressure: false } as Annotation);

describe('lasso selection', () => {
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  it('point in polygon', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
  });
  it('selects ink that is mostly inside, skips locked/hidden and ink mostly outside', () => {
    const inside = stroke('in', pts([[10, 10], [50, 50], [90, 90]]));
    const mostlyOut = stroke('out', pts([[90, 50], [150, 50], [200, 50], [250, 50]]));
    const locked = { ...stroke('locked', pts([[20, 20], [30, 30]])), locked: true };
    const text = { ...base, createdAt: 0, id: 'text', type: 'text', bounds: { x: 40, y: 40, width: 20, height: 10 }, content: 'a' } as unknown as Annotation;
    expect(annotationsInLasso([inside, mostlyOut, locked, text], square)).toEqual(['in', 'text']);
  });
});

describe('ink replay', () => {
  it('replays in creation order at the recorded speed and grows strokes', () => {
    const a = stroke('a', pts([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]], 1000), 2); // 40 ms recorded → min 120
    const b = stroke('b', pts([[0, 10], [10, 10]], 5000), 1);
    const plan = buildReplayPlan([a, b]);
    expect(plan.map((i) => i.annotation.id)).toEqual(['b', 'a']);
    expect(plan[1].start).toBe(plan[0].duration + REPLAY_GAP_MS);
    const mid = replayFrame(plan, plan[1].start + plan[1].duration / 2);
    expect(mid.done.map((x) => x.id)).toEqual(['b']);
    expect(mid.partial?.type === 'stroke' && mid.partial.points.length).toBeGreaterThan(1);
    expect(mid.partial?.type === 'stroke' && mid.partial.points.length).toBeLessThan(5);
    const end = replayFrame(plan, replayLength(plan));
    expect(end.finished).toBe(true);
    expect(end.done).toHaveLength(2);
  });
});

describe('ruler', () => {
  const ruler = { visible: true, x: 500, y: 300, angle: 0 };
  it('snaps strokes that start just outside a long edge', () => {
    const top = 300 - RULER_THICKNESS / 2;
    expect(snapEdgeFor(ruler, 500, top - 10)).not.toBeNull();
    expect(snapEdgeFor(ruler, 500, top - 60)).toBeNull(); // too far
    expect(snapEdgeFor(ruler, 1200, top - 10)).toBeNull(); // beyond the ends
    expect(snapEdgeFor({ ...ruler, visible: false }, 500, top - 10)).toBeNull();
  });
  it('projects points onto the edge, half the ink width outside', () => {
    const [topEdge] = rulerEdges(ruler);
    const p = projectOntoEdge(topEdge, 420, 150, 2);
    expect(p.x).toBeCloseTo(420);
    expect(p.y).toBeCloseTo(300 - RULER_THICKNESS / 2 - 2);
    const tilted = rulerEdges({ ...ruler, angle: 45 })[0];
    const q = projectOntoEdge(tilted, 600, 100, 0);
    // stays on the tilted line through the edge point
    expect((q.x - tilted.px) * tilted.nx + (q.y - tilted.py) * tilted.ny).toBeCloseTo(0);
  });
});

describe('pen buttons', () => {
  it('maps the eraser end and barrel button', () => {
    expect(penButtonTool({ pointerType: 'pen', button: 5, buttons: 32 })).toBe('eraser');
    expect(penButtonTool({ pointerType: 'pen', button: 0, buttons: 3 })).toBe('lasso');
    expect(penButtonTool({ pointerType: 'pen', button: 0, buttons: 1 })).toBeNull();
    expect(penButtonTool({ pointerType: 'mouse', button: 2, buttons: 2 })).toBeNull();
  });
});
