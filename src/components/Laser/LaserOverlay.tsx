import { useEffect, useRef } from 'react';
import { LASER_FADE_MS, LASER_TAIL_MS, laserTrails, pruneLaser, subscribeLaser } from './laserTrail';

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
      const dpr = canvas.width / Math.max(1, window.innerWidth);
      const now = performance.now();
      const alive = pruneLaser(now);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const trail of laserTrails()) {
        const fade = trail.endedAt === null ? 1 : Math.max(0, 1 - (now - trail.endedAt) / LASER_FADE_MS);
        const pts = trail.points;
        if (pts.length === 0 || fade <= 0) continue;
        // Older segments are thinner and more transparent: a comet tail.
        for (let i = 1; i < pts.length; i++) {
          const age = Math.min(1, (now - pts[i].t) / LASER_TAIL_MS);
          const life = trail.endedAt === null ? 1 - age * 0.85 : 1;
          const alpha = fade * life;
          if (alpha <= 0.02) continue;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.strokeStyle = `rgba(255, 40, 40, ${alpha * 0.35})`;
          ctx.lineWidth = 10 * (0.5 + life * 0.5);
          ctx.stroke();
          ctx.strokeStyle = `rgba(255, 70, 60, ${alpha})`;
          ctx.lineWidth = 3.5 * (0.5 + life * 0.5);
          ctx.stroke();
        }
        const head = pts[pts.length - 1];
        ctx.beginPath();
        ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 60, 50, ${fade})`;
        ctx.shadowColor = 'rgba(255, 0, 0, 0.8)';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
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
