import { describe, expect, it } from 'vitest';
import {
  CANVAS_MEMORY_POLICY,
  CanvasBufferLru,
  computeSafeCanvasOutputScale,
  releaseCanvas,
} from '../canvasMemory';

describe('canvas memory policy', () => {
  it.each([
    [612, 792, 1],
    [612, 792, 2],
    [1224, 1584, 3],
    [4896, 6336, 2],
    [20000, 10000, 3],
  ])('bounds backing storage for %sx%s at DPR %s', (width, height, dpr) => {
    const outputScale = computeSafeCanvasOutputScale(width, height, dpr);
    const physicalWidth = Math.max(1, Math.round(width * outputScale));
    const physicalHeight = Math.max(1, Math.round(height * outputScale));

    expect(outputScale).toBeGreaterThan(0);
    expect(outputScale).toBeLessThanOrEqual(CANVAS_MEMORY_POLICY.maxDpr);
    expect(physicalWidth).toBeLessThanOrEqual(CANVAS_MEMORY_POLICY.maxPhysicalDimension);
    expect(physicalHeight).toBeLessThanOrEqual(CANVAS_MEMORY_POLICY.maxPhysicalDimension);
    expect(physicalWidth * physicalHeight).toBeLessThanOrEqual(
      CANVAS_MEMORY_POLICY.maxBackingPixels + Math.max(physicalWidth, physicalHeight),
    );
  });

  it('releases the backing buffer without changing CSS geometry', () => {
    const canvas = {
      width: 2000,
      height: 3000,
      style: { width: '1000px', height: '1500px' },
    } as HTMLCanvasElement;

    releaseCanvas(canvas);

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(canvas.style.width).toBe('1000px');
    expect(canvas.style.height).toBe('1500px');
  });

  it('bounds retained thumbnail buffers with deterministic LRU eviction', () => {
    const released: string[] = [];
    const lru = new CanvasBufferLru(2);
    lru.retain('page-1', () => released.push('page-1'));
    lru.retain('page-2', () => released.push('page-2'));
    lru.retain('page-1', () => released.push('page-1-new'));
    lru.retain('page-3', () => released.push('page-3'));

    expect(lru.size).toBe(2);
    expect(released).toEqual(['page-2']);

    lru.releaseAll();
    expect(released).toEqual(['page-2', 'page-1-new', 'page-3']);
    expect(lru.size).toBe(0);
  });
});
