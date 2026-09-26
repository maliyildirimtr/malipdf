/**
 * Laser pointer trails: short-lived red lines in window (client) coordinates.
 * Nothing here is saved; each trail fades out shortly after the pointer lifts.
 */

export interface LaserPoint { x: number; y: number; t: number }
export interface LaserTrail { points: LaserPoint[]; endedAt: number | null }

/** Points older than this fade from the tail while drawing. */
export const LASER_TAIL_MS = 700;
/** How long a finished trail takes to fade out. */
export const LASER_FADE_MS = 450;

const trails: LaserTrail[] = [];
const listeners = new Set<() => void>();

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

export function startLaserTrail(x: number, y: number, t = performance.now()): void {
  endLaserTrail(t);
  trails.push({ points: [{ x, y, t }], endedAt: null });
  notify();
}

export function addLaserPoint(x: number, y: number, t = performance.now()): void {
  const trail = trails[trails.length - 1];
  if (!trail || trail.endedAt !== null) {
    startLaserTrail(x, y, t);
    return;
  }
  trail.points.push({ x, y, t });
  notify();
}

export function endLaserTrail(t = performance.now()): void {
  const trail = trails[trails.length - 1];
  if (trail && trail.endedAt === null) {
    trail.endedAt = t;
    notify();
  }
}

export function clearLaser(): void {
  trails.length = 0;
  notify();
}

/**
 * Drop what has fully faded. Returns true while something is still visible
 * (the overlay keeps animating until then).
 */
export function pruneLaser(now: number): boolean {
  for (let i = trails.length - 1; i >= 0; i--) {
    const trail = trails[i];
    if (trail.endedAt !== null && now - trail.endedAt > LASER_FADE_MS) {
      trails.splice(i, 1);
      continue;
    }
    // Trim the tail of a trail that is still being drawn.
    if (trail.endedAt === null) {
      const cutoff = now - LASER_TAIL_MS;
      let drop = 0;
      while (drop < trail.points.length - 1 && trail.points[drop].t < cutoff) drop++;
      if (drop > 0) trail.points.splice(0, drop);
    }
  }
  return trails.length > 0;
}
