import { describe, expect, it } from 'vitest';
import { stabilizePoints } from '../inkGeometry';
import { recognizeShape } from '../shapeRecognizer';
import { DEFAULT_LASER_OPTIONS, clearLaser, endLaserTrail, laserAlpha, laserTrails, startLaserTrail, addLaserPoint } from '../../components/Laser/laserTrail';

const pt = (x: number, y: number) => ({ x, y, pressure: 0.5, timestamp: 0 });

describe('stabilizer', () => {
  const jitter = Array.from({ length: 40 }, (_, i) => pt(i * 3, i % 2 ? 2 : -2));

  it('off keeps the input', () => {
    expect(stabilizePoints(jitter, 'off')).toEqual(jitter);
  });

  it('smooths tremor more at higher levels and ends where the pen lifted', () => {
    const wobble = (pts: { y: number }[]) => pts.slice(5, 30).reduce((a, p) => a + Math.abs(p.y), 0);
    const basic = stabilizePoints(jitter, 'basic');
    const fluid = stabilizePoints(jitter, 'fluid');
    expect(wobble(basic)).toBeLessThan(wobble(jitter));
    expect(wobble(fluid)).toBeLessThan(wobble(basic));
    expect(fluid[0]).toEqual(jitter[0]);
    expect(fluid[fluid.length - 1]).toEqual(jitter[jitter.length - 1]);
  });
});

describe('arrow recognition', () => {
  it('finds an arrow drawn in one stroke (shaft, then a head)', () => {
    const shaft = Array.from({ length: 30 }, (_, i) => ({ x: i * 5, y: 0 }));
    const head = [{ x: 135, y: 10 }, { x: 130, y: 15 }, { x: 145, y: 0 }, { x: 135, y: -10 }, { x: 130, y: -15 }];
    const shape = recognizeShape([...shaft, ...head]);
    expect(shape?.kind).toBe('arrow');
    if (shape?.kind === 'arrow') {
      expect(shape.start).toEqual({ x: 0, y: 0 });
      expect(shape.end.x).toBeGreaterThanOrEqual(140);
    }
  });

  it('leaves an open curve as ink', () => {
    const curve = Array.from({ length: 40 }, (_, i) => ({ x: i * 4, y: Math.sin(i / 4) * 30 }));
    expect(recognizeShape(curve)).toBeNull();
  });
});

describe('laser fade', () => {
  it('individual lines fade on their own; group lines wait for the last one', () => {
    clearLaser();
    startLaserTrail(0, 0, 0); addLaserPoint(10, 0, 10); endLaserTrail(100);
    startLaserTrail(0, 10, 1000); addLaserPoint(10, 10, 1010);
    const [first, second] = laserTrails();
    const individual = DEFAULT_LASER_OPTIONS;
    const group = { ...DEFAULT_LASER_OPTIONS, mode: 'group' as const };
    expect(laserAlpha(first, 1900, individual)).toBeLessThan(1);
    expect(laserAlpha(second, 1900, individual)).toBe(1);
    expect(laserAlpha(first, 1900, group)).toBe(1);      // still pointing: nothing fades
    endLaserTrail(2000);
    expect(laserAlpha(first, 2300, group)).toBe(1);      // fades together, from the last activity
    expect(laserAlpha(first, 3800, group)).toBeLessThan(0.3);
    expect(laserAlpha(first, 4100, group)).toBe(0);
    clearLaser();
  });
});
