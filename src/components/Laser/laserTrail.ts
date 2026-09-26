/**
 * Laser pointer trails: short-lived lines in window (client) coordinates,
 * never saved. Works like MaliPen's laser: each trail is one smooth glowing
 * line that fades out after the pen lifts.
 *
 * - 'individual': every line fades on its own, `durationMs` after it ends.
 * - 'group': lines stay while you keep pointing and all fade together
 *   `durationMs` after the last one ends.
 */

export interface LaserPoint { x: number; y: number }
export interface LaserTrail { points: LaserPoint[]; endedAt: number | null }
export type LaserMode = 'individual' | 'group';
export interface LaserOptions { mode: LaserMode; durationMs: number; color: string; width: number }

export const DEFAULT_LASER_OPTIONS: LaserOptions = { mode: 'individual', durationMs: 2000, color: '#ff2d2d', width: 4 };

const trails: LaserTrail[] = [];
const listeners = new Set<() => void>();
/** Last time a laser line was being drawn (group mode fades from here). */
let lastActivity = 0;

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeLaser(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function laserTrails(): readonly LaserTrail[] {
  return trails;
}

export function startLaserTrail(x: number, y: number, now = performance.now()): void {
  endLaserTrail(now);
  trails.push({ points: [{ x, y }], endedAt: null });
  lastActivity = now;
  notify();
}

export function addLaserPoint(x: number, y: number, now = performance.now()): void {
  const trail = trails[trails.length - 1];
  if (!trail || trail.endedAt !== null) {
    startLaserTrail(x, y, now);
    return;
  }
  const last = trail.points[trail.points.length - 1];
  if (last && Math.abs(last.x - x) < 0.5 && Math.abs(last.y - y) < 0.5) return;
  trail.points.push({ x, y });
  lastActivity = now;
  notify();
}

export function endLaserTrail(now = performance.now()): void {
  const trail = trails[trails.length - 1];
  if (trail && trail.endedAt === null) {
    trail.endedAt = now;
    lastActivity = now;
    notify();
  }
}

export function clearLaser(): void {
  trails.length = 0;
  notify();
}

function isDrawing(): boolean {
  return trails.some((t) => t.endedAt === null);
}

/** Opacity of a trail at `now` (1 while drawing, then fading to 0). */
export function laserAlpha(trail: LaserTrail, now: number, options: LaserOptions): number {
  const duration = Math.max(100, options.durationMs);
  if (options.mode === 'group') {
    if (isDrawing()) return 1;
    return fade((now - lastActivity) / duration);
  }
  if (trail.endedAt === null) return 1;
  return fade((now - trail.endedAt) / duration);
}

/** Stays bright for most of its time, then eases out. */
function fade(progress: number): number {
  if (progress <= 0) return 1;
  if (progress >= 1) return 0;
  const hold = 0.35;
  if (progress < hold) return 1;
  const t = (progress - hold) / (1 - hold);
  return 1 - t * t * (3 - 2 * t);
}

/** Drop what has fully faded. Returns true while something is still visible. */
export function pruneLaser(now: number, options: LaserOptions): boolean {
  for (let i = trails.length - 1; i >= 0; i--) {
    if (laserAlpha(trails[i], now, options) <= 0) trails.splice(i, 1);
  }
  return trails.length > 0;
}
