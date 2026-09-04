/** Central memory limits for page and thumbnail raster resources. */
export const CANVAS_MEMORY_POLICY = Object.freeze({
  maxRetainedPages: 12,
  maxConcurrentPageLoads: 3,
  maxDpr: 2,
  maxBackingPixels: 8 * 1024 * 1024,
  maxPhysicalDimension: 8192,
  maxThumbnailBuffers: 24,
  cleanupRetryMs: 100,
});

/**
 * Computes the backing-store scale independently from CSS/PDF coordinates.
 * The result may be below 1 at extreme zoom to keep a single layer bounded.
 */
export function computeSafeCanvasOutputScale(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): number {
  if (!(cssWidth > 0) || !(cssHeight > 0)) return 1;

  const requested = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? Math.min(devicePixelRatio, CANVAS_MEMORY_POLICY.maxDpr)
    : 1;
  const pixelLimit = Math.sqrt(
    CANVAS_MEMORY_POLICY.maxBackingPixels / (cssWidth * cssHeight),
  );
  const widthLimit = CANVAS_MEMORY_POLICY.maxPhysicalDimension / cssWidth;
  const heightLimit = CANVAS_MEMORY_POLICY.maxPhysicalDimension / cssHeight;

  return Math.max(Number.EPSILON, Math.min(requested, pixelLimit, widthLimit, heightLimit));
}

/** Release a canvas backing buffer while preserving its CSS layout contract. */
export function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** Small deterministic LRU used to bound retained thumbnail backing buffers. */
export class CanvasBufferLru {
  private readonly entries = new Map<string, () => void>();

  constructor(private readonly limit: number) {}

  retain(key: string, release: () => void): void {
    this.entries.delete(key);
    this.entries.set(key, release);
    while (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldestRelease = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      oldestRelease?.();
    }
  }

  forget(key: string): void {
    this.entries.delete(key);
  }

  releaseAll(): void {
    for (const release of this.entries.values()) release();
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
