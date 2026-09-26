import { useEffect, useRef } from 'react';
import { useUIStore } from '../../store/uiStore';
import { DEFAULT_LASER_OPTIONS, laserAlpha, laserTrails, pruneLaser, subscribeLaser, type LaserPoint } from './laserTrail';

/** One smooth path through the points (quadratic curves through midpoints). */
function tracePath(ctx: CanvasRenderingContext2D, pts: readonly LaserPoint[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) {
    ctx.lineTo(pts[0].x + 0.01, pts[0].y + 0.01);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const n = pts[i + 1];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

/** Full-window canvas that draws laser trails; never takes pointer input. */
export function LaserOverlay({ zIndex = 4000 }: { zIndex?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf: number | null = null;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };

    const draw = () => {
      raf = null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const options = useUIStore.getState().laserOptions ?? DEFAULT_LASER_OPTIONS;
      const dpr = canvas.width / Math.max(1, window.innerWidth);
      const now = performance.now();
      const alive = pruneLaser(now, options);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const trail of laserTrails()) {
        const alpha = laserAlpha(trail, now, options);
        if (alpha <= 0 || trail.points.length === 0) continue;
        tracePath(ctx, trail.points);
        ctx.globalAlpha = alpha;
        // One continuous line with a soft glow (as in MaliPen).
        ctx.shadowColor = options.color;
        ctx.shadowBlur = options.width * 2.5;
        ctx.strokeStyle = options.color;
        ctx.lineWidth = options.width;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      if (alive) raf = requestAnimationFrame(draw);
    };

    const schedule = () => {
      if (raf === null) raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    const unsubscribe = subscribeLaser(schedule);
    return () => {
      window.removeEventListener('resize', resize);
      unsubscribe();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex }}
    />
  );
}
