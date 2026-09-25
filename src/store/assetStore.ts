/**
 * Asset Store
 *
 * Central source of truth for semantic ImageAsset data.
 * All assets are strictly scoped to DocumentIdentity (docId + instanceId).
 *
 * Memory and Persistence Invariants:
 * - Image byte buffers are NEVER persisted via localStorage or UI persist middleware
 * - Assets are retained for the document session lifetime (allowing Undo/Redo to retain asset references)
 * - Closing a document session disposes the document's assets and evicts its render cache
 */

import { create } from 'zustand';
import type { DocumentIdentity } from '../types/documentSession';
import { documentIdentityKey } from '../types/documentSession';
import { evictDocumentImageCache } from '../pdf/imageRenderCache';

export interface ImageAsset {
  readonly id: string;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

interface AssetStore {
  /** Map of documentIdentityKey -> Map<assetId, ImageAsset> */
  docAssets: Map<string, Map<string, ImageAsset>>;

  /** Add an asset to a document session */
  addAsset: (identity: DocumentIdentity, asset: ImageAsset) => void;

  /** Retrieve an asset by ID within a document session */
  getAsset: (identity: DocumentIdentity, assetId: string) => ImageAsset | undefined;

  /** Retrieve all assets registered for a document session */
  getAssetsForDocument: (identity: DocumentIdentity) => Map<string, ImageAsset> | undefined;

  /** Remove and clean up all assets for a closed document session */
  removeDocument: (identity: DocumentIdentity) => void;

  /** Remove a specific asset from a document session */
  removeAsset: (identity: DocumentIdentity, assetId: string) => void;

  /** Clear all assets across all documents (e.g. during test teardown) */
  clearAll: () => void;
}

export const useAssetStore = create<AssetStore>((set, get) => ({
  docAssets: new Map(),

  addAsset: (identity, asset) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      const newDocAssets = new Map(state.docAssets);
      const existingMap = newDocAssets.get(key) || new Map<string, ImageAsset>();
      const updatedMap = new Map(existingMap);
      updatedMap.set(asset.id, asset);
      newDocAssets.set(key, updatedMap);
      return { docAssets: newDocAssets };
    });
  },

  removeAsset: (identity, assetId) => {
    set((state) => {
      const key = documentIdentityKey(identity);
      if (!state.docAssets.has(key)) return state;
      const newDocAssets = new Map(state.docAssets);
      const existingMap = newDocAssets.get(key)!;
      const updatedMap = new Map(existingMap);
      updatedMap.delete(assetId);
      newDocAssets.set(key, updatedMap);
      return { docAssets: newDocAssets };
    });
  },

  getAsset: (identity, assetId) => {
    const key = documentIdentityKey(identity);
    return get().docAssets.get(key)?.get(assetId);
  },

  getAssetsForDocument: (identity) => {
    const key = documentIdentityKey(identity);
    return get().docAssets.get(key);
  },

  removeDocument: (identity) => {
    // Evict decoded cache resources
    evictDocumentImageCache(identity);

    set((state) => {
      const key = documentIdentityKey(identity);
      if (!state.docAssets.has(key)) return state;
      const newDocAssets = new Map(state.docAssets);
      newDocAssets.delete(key);
      return { docAssets: newDocAssets };
    });
  },

  clearAll: () => {
    set({ docAssets: new Map() });
  },
}));

/** Pure helper to get an asset without needing React hook */
export function getAssetFromStore(identity: DocumentIdentity, assetId: string): ImageAsset | undefined {
  return useAssetStore.getState().getAsset(identity, assetId);
}

/** Pure helper to get all assets for a document */
export function getDocumentAssetsFromStore(identity: DocumentIdentity): Map<string, ImageAsset> | undefined {
  return useAssetStore.getState().getAssetsForDocument(identity);
}
