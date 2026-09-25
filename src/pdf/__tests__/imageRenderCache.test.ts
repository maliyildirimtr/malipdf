import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  getCachedDecodedImage,
  requestImageDecode,
  evictDocumentImageCache,
  clearAllImageRenderCache,
} from '../imageRenderCache';
import type { DocumentIdentity } from '../../types/documentSession';
import type { ImageAsset } from '../../store/assetStore';

describe('imageRenderCache', () => {
  const docId: DocumentIdentity = { docId: 'doc-cache-test', instanceId: 1 };

  const sampleAsset: ImageAsset = {
    id: 'asset-cache-1',
    mimeType: 'image/png',
    width: 100,
    height: 100,
    // Minimal 1x1 transparent PNG
    data: new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0,
      1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0,
      1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]),
  };

  beforeEach(() => {
    clearAllImageRenderCache();
  });

  it('returns null synchronously on cache miss', () => {
    const result = getCachedDecodedImage(docId, 'non-existent');
    expect(result).toBeNull();
  });

  it('deduplicates in-flight decode requests for the same asset', async () => {
    const mockBitmap = { width: 100, height: 100, close: vi.fn() };
    const createBitmapSpy = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => resolve(mockBitmap), 20);
      });
    });
    vi.stubGlobal('createImageBitmap', createBitmapSpy);

    const onDecoded1 = vi.fn();
    const onDecoded2 = vi.fn();

    // Call 1
    requestImageDecode(docId, sampleAsset, onDecoded1);
    // Call 2 (during in-flight decode)
    requestImageDecode(docId, sampleAsset, onDecoded2);

    // Only one createImageBitmap call should have been initiated
    expect(createBitmapSpy).toHaveBeenCalledTimes(1);

    // Wait for decode to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onDecoded1).toHaveBeenCalledTimes(1);
    expect(onDecoded2).toHaveBeenCalledTimes(1);

    // Now cached synchronously
    const cached = getCachedDecodedImage(docId, sampleAsset.id);
    expect(cached).toBe(mockBitmap);

    // Third call after decode should immediately return without creating another decode
    requestImageDecode(docId, sampleAsset);
    expect(createBitmapSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('caches failure state and does not retry every frame', async () => {
    const failSpy = vi.fn().mockRejectedValue(new Error('Corrupt image data'));
    vi.stubGlobal('createImageBitmap', failSpy);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // First attempt fails
    requestImageDecode(docId, sampleAsset);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(failSpy).toHaveBeenCalledTimes(1);

    // Subsequent attempts should be ignored (failure cached)
    requestImageDecode(docId, sampleAsset);
    requestImageDecode(docId, sampleAsset);

    expect(failSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('evicts document cache and closes ImageBitmap on session cleanup', async () => {
    const mockClose = vi.fn();
    const mockBitmap = { width: 100, height: 100, close: mockClose };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap));

    requestImageDecode(docId, sampleAsset);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getCachedDecodedImage(docId, sampleAsset.id)).toBe(mockBitmap);

    // Evict docId
    evictDocumentImageCache(docId);

    // Cached resource should be gone
    expect(getCachedDecodedImage(docId, sampleAsset.id)).toBeNull();
    // Resource disposal invoked
    expect(mockClose).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
