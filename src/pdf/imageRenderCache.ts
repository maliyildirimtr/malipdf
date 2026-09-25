/**
 * Image Render Cache
 *
 * Maintains decoded ImageBitmap / HTMLImageElement objects for canvas rendering.
 * Keeps decoded resources completely separate from the semantic Zustand asset store.
 *
 * Invariants:
 * - Keyed by `${documentIdentityKey(identity)}:${assetId}`
 * - In-flight decode requests are deduplicated (no redundant decodes per frame)
 * - Decoding failures are cached to prevent repeated failure loops
 * - When a document is closed, all cached resources are disposed (e.g. ImageBitmap.close())
 */

import type { DocumentIdentity } from '../types/documentSession';
import { documentIdentityKey } from '../types/documentSession';
import type { ImageAsset } from '../store/assetStore';

type CacheStatus = 'pending' | 'decoded' | 'error';

interface CacheEntry {
  status: CacheStatus;
  image?: ImageBitmap | HTMLImageElement;
  promise?: Promise<ImageBitmap | HTMLImageElement>;
  error?: Error;
}

const renderCache = new Map<string, CacheEntry>();

function getCacheKey(identity: DocumentIdentity, assetId: string): string {
  return `${documentIdentityKey(identity)}:${assetId}`;
}

/**
 * Returns the decoded image if already available in the synchronous render cache.
 */
export function getCachedDecodedImage(
  identity: DocumentIdentity,
  assetId: string,
): ImageBitmap | HTMLImageElement | null {
  const key = getCacheKey(identity, assetId);
  const entry = renderCache.get(key);
  if (entry && entry.status === 'decoded' && entry.image) {
    return entry.image;
  }
  return null;
}

/**
 * Request async decode of an ImageAsset.
 * If already decoded, returns immediately.
 * If pending, attaches to the existing promise without spawning another decode.
 * If error, does not retry repeatedly.
 *
 * @param identity - Scoped document identity
 * @param asset - The ImageAsset containing raw byte data
 * @param onDecoded - Callback invoked when decode completes to trigger a redraw
 */
export function requestImageDecode(
  identity: DocumentIdentity,
  asset: ImageAsset,
  onDecoded?: () => void,
): void {
  const key = getCacheKey(identity, asset.id);
  const existing = renderCache.get(key);

  if (existing) {
    if (existing.status === 'decoded') return;
    if (existing.status === 'pending') {
      // In-flight decode already active. Attach listener to trigger redraw on resolution.
      if (onDecoded) {
        existing.promise?.then(() => onDecoded()).catch(() => {});
      }
      return;
    }
    if (existing.status === 'error') {
      // Already failed; do not retry every frame.
      return;
    }
  }

  // Start new decode
  const decodePromise = (async (): Promise<ImageBitmap | HTMLImageElement> => {
    // Web / worker path: use createImageBitmap if available
    const blob = new Blob([asset.data as BlobPart], { type: asset.mimeType });
    if (typeof createImageBitmap === 'function') {
      return await createImageBitmap(blob);
    }

    // Fallback: HTMLImageElement decode
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to decode image ${asset.id}: ${String(err)}`));
      };
      img.src = url;
    });
  })();

  renderCache.set(key, {
    status: 'pending',
    promise: decodePromise,
  });

  decodePromise
    .then((image) => {
      // Verify entry was not evicted while decoding
      const current = renderCache.get(key);
      if (current && current.status === 'pending') {
        renderCache.set(key, {
          status: 'decoded',
          image,
        });
        onDecoded?.();
      } else {
        // Was evicted, clean up immediately
        if ('close' in image && typeof image.close === 'function') {
          image.close();
        }
      }
    })
    .catch((err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      renderCache.set(key, {
        status: 'error',
        error,
      });
      console.warn(`[ImageRenderCache] Decoding failed for asset ${asset.id}:`, error);
    });
}

/**
 * Disposes all cached render resources associated with a specific DocumentIdentity.
 * Frees GPU memory for any ImageBitmap objects.
 */
export function evictDocumentImageCache(identity: DocumentIdentity): void {
  const prefix = `${documentIdentityKey(identity)}:`;
  for (const [key, entry] of renderCache.entries()) {
    if (key.startsWith(prefix)) {
      if (entry.image && 'close' in entry.image && typeof entry.image.close === 'function') {
        entry.image.close();
      }
      renderCache.delete(key);
    }
  }
}

/**
 * Clear the entire render cache (useful in test teardown).
 */
export function clearAllImageRenderCache(): void {
  for (const entry of renderCache.values()) {
    if (entry.image && 'close' in entry.image && typeof entry.image.close === 'function') {
      entry.image.close();
    }
  }
  renderCache.clear();
}
