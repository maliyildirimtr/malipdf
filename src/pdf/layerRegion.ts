/**
 * Viewport-sized render layers: instead of one canvas for a whole (zoomed)
 * page — which has to be rendered below screen resolution to stay within
 * memory limits — layers cover only the visible part of the page (plus a
 * margin) at full device resolution.
 */

export interface LayerRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Extra area rendered around the visible part, so small scrolls need no redraw. */
const LAYER_MARGIN = 160;

/**
 * The part of the page (page-local CSS px) the ink canvases should cover:
 * the visible part plus a margin. Returns `current` unchanged while it still
 * covers what is visible, so scrolling rarely re-allocates canvases.
 */
export function computeLayerRegion(
  pageRect: { left: number; top: number },
  pageWidth: number,
  pageHeight: number,
  current: LayerRegion,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): LayerRegion {
  const visLeft = Math.max(0, -pageRect.left);
  const visTop = Math.max(0, -pageRect.top);
  const visRight = Math.min(pageWidth, viewport.width - pageRect.left);
  const visBottom = Math.min(pageHeight, viewport.height - pageRect.top);
  if (visRight <= visLeft || visBottom <= visTop) return current; // off-screen: keep what we have
  const covered = current.w > 0
    && current.x <= visLeft && current.y <= visTop
    && current.x + current.w >= visRight && current.y + current.h >= visBottom;
  if (covered) return current;
  const x = Math.max(0, Math.floor(visLeft - LAYER_MARGIN));
  const y = Math.max(0, Math.floor(visTop - LAYER_MARGIN));
  const right = Math.min(pageWidth, Math.ceil(visRight + LAYER_MARGIN));
  const bottom = Math.min(pageHeight, Math.ceil(visBottom + LAYER_MARGIN));
  return { x, y, w: right - x, h: bottom - y };
}

/** Largest backing store for one region layer (pixels). */
export const REGION_MAX_PIXELS = 16 * 1024 * 1024;

/** Full device resolution (up to 3×) unless the region would be huge. */
export function regionOutputScale(width: number, height: number, deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1): number {
  if (!(width > 0) || !(height > 0)) return Math.min(deviceRatio, 3);
  return Math.max(0.5, Math.min(deviceRatio, 3, Math.sqrt(REGION_MAX_PIXELS / (width * height)), 8192 / width, 8192 / height));
}
