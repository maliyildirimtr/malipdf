/**
 * On-screen ruler (like OneNote's): floats over the pages; pen and
 * highlighter strokes that start next to one of its long edges are drawn
 * straight along that edge.
 */
import { create } from 'zustand';

export const RULER_LENGTH = 640;
export const RULER_THICKNESS = 64;
/** A stroke that starts this close (px) to an edge snaps to it. */
export const RULER_SNAP_DISTANCE = 24;

interface RulerState {
  visible: boolean;
  /** Centre in window (client) coordinates. */
  x: number;
  y: number;
  /** Degrees, clockwise on screen. */
  angle: number;
  toggle: () => void;
  moveBy: (dx: number, dy: number) => void;
  rotateBy: (degrees: number) => void;
  setAngle: (degrees: number) => void;
}

const normalize = (deg: number) => ((deg % 360) + 540) % 360 - 180;

export const useRulerStore = create<RulerState>((set) => ({
  visible: false,
  x: typeof window !== 'undefined' ? window.innerWidth / 2 : 600,
  y: typeof window !== 'undefined' ? window.innerHeight / 2 : 400,
  angle: 0,
  toggle: () => set((s) => ({
    visible: !s.visible,
    // Re-centre when it is shown again, so it is never lost off-screen.
    ...(!s.visible && typeof window !== 'undefined' ? { x: window.innerWidth / 2, y: window.innerHeight / 2 } : {}),
  })),
  moveBy: (dx, dy) => set((s) => ({ x: s.x + dx, y: s.y + dy })),
  rotateBy: (degrees) => set((s) => ({ angle: normalize(s.angle + degrees) })),
  setAngle: (degrees) => set({ angle: normalize(degrees) }),
}));

export interface EdgeLine {
  /** A point on the edge and the unit direction along it (client coords). */
  px: number;
  py: number;
  dx: number;
  dy: number;
  /** Unit normal pointing away from the ruler body. */
  nx: number;
  ny: number;
}

/** The two long edges of the ruler. */
export function rulerEdges(state: Pick<RulerState, 'x' | 'y' | 'angle'>): [EdgeLine, EdgeLine] {
  const rad = (state.angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  // Normal "up" on screen for angle 0 is (0, -1).
  const nx = dy;
  const ny = -dx;
  const half = RULER_THICKNESS / 2;
  return [
    { px: state.x + nx * half, py: state.y + ny * half, dx, dy, nx, ny },
    { px: state.x - nx * half, py: state.y - ny * half, dx, dy, nx: -nx, ny: -ny },
  ];
}

/**
 * The edge a stroke starting at (cx, cy) should follow, or null. Only points
 * outside the ruler, next to an edge and within its length, snap.
 */
export function snapEdgeFor(state: Pick<RulerState, 'visible' | 'x' | 'y' | 'angle'>, cx: number, cy: number): EdgeLine | null {
  if (!state.visible) return null;
  for (const edge of rulerEdges(state)) {
    const along = (cx - state.x) * edge.dx + (cy - state.y) * edge.dy;
    const out = (cx - edge.px) * edge.nx + (cy - edge.py) * edge.ny;
    if (Math.abs(along) <= RULER_LENGTH / 2 && out >= -2 && out <= RULER_SNAP_DISTANCE) return edge;
  }
  return null;
}

/** Project a point onto the edge, `offset` px outside it (half the ink width). */
export function projectOntoEdge(edge: EdgeLine, cx: number, cy: number, offset: number): { x: number; y: number } {
  const t = (cx - edge.px) * edge.dx + (cy - edge.py) * edge.dy;
  return { x: edge.px + edge.dx * t + edge.nx * offset, y: edge.py + edge.dy * t + edge.ny * offset };
}
