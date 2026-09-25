import { describe, expect, it, beforeEach } from 'vitest';
import { useAssetStore, type ImageAsset } from '../assetStore';
import type { DocumentIdentity } from '../../types/documentSession';

describe('useAssetStore', () => {
  const docA: DocumentIdentity = { docId: 'doc-A', instanceId: 1 };
  const docB: DocumentIdentity = { docId: 'doc-B', instanceId: 1 };

  const asset1: ImageAsset = {
    id: 'asset-1',
    mimeType: 'image/png',
    width: 800,
    height: 600,
    data: new Uint8Array([1, 2, 3, 4]),
  };

  const asset2: ImageAsset = {
    id: 'asset-2',
    mimeType: 'image/jpeg',
    width: 400,
    height: 300,
    data: new Uint8Array([5, 6, 7, 8]),
  };

  beforeEach(() => {
    useAssetStore.getState().removeDocument(docA);
    useAssetStore.getState().removeDocument(docB);
  });

  it('stores and retrieves assets scoped by DocumentIdentity', () => {
    useAssetStore.getState().addAsset(docA, asset1);
    useAssetStore.getState().addAsset(docB, asset2);

    // Retrieve single asset
    expect(useAssetStore.getState().getAsset(docA, 'asset-1')).toEqual(asset1);
    expect(useAssetStore.getState().getAsset(docB, 'asset-2')).toEqual(asset2);

    // Strict document isolation: docA cannot access docB's assets
    expect(useAssetStore.getState().getAsset(docA, 'asset-2')).toBeUndefined();
    expect(useAssetStore.getState().getAsset(docB, 'asset-1')).toBeUndefined();
  });

  it('returns all assets for a document via getAssetsForDocument', () => {
    useAssetStore.getState().addAsset(docA, asset1);
    useAssetStore.getState().addAsset(docA, asset2);

    const assetsMap = useAssetStore.getState().getAssetsForDocument(docA)!;
    expect(assetsMap.size).toBe(2);
    expect(assetsMap.get('asset-1')).toEqual(asset1);
    expect(assetsMap.get('asset-2')).toEqual(asset2);
  });

  it('removes all assets when document is removed', () => {
    useAssetStore.getState().addAsset(docA, asset1);
    expect(useAssetStore.getState().getAsset(docA, 'asset-1')).toBeDefined();

    useAssetStore.getState().removeDocument(docA);
    expect(useAssetStore.getState().getAsset(docA, 'asset-1')).toBeUndefined();
    expect(useAssetStore.getState().getAssetsForDocument(docA)).toBeUndefined();
  });

  it('does not leak asset binary bytes to localStorage or persist middleware', () => {
    // Audit that persist is not used
    expect((useAssetStore as any).persist).toBeUndefined();
  });
});
