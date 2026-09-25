/**
 * Image and Screenshot Command Handlers
 *
 * Orchestrates image file insertion, desktop screenshot capture,
 * region capture, and clipboard paste.
 *
 * Enforces async target snapshot safety: target identity and page are
 * verified before and after all async boundaries.
 */

import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useAssetStore } from '../store/assetStore';
import { useHistoryStore, makeAddAction } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { documentSessionStore } from '../store/documentSessionStore';
import { documentIdentityKey } from '../types/documentSession';
import type { ImageAnnotation } from '../types/annotations';
import {
  createInsertTargetSnapshot,
  isInsertTargetValid,
  normalizeAndCreateImageAsset,
  calculateDefaultImageBounds,
} from '../pdf/imageUtils';

export async function insertImageFromBytes(
  rawBytes: ArrayBuffer,
  mimeType: string,
): Promise<boolean> {
  const target = createInsertTargetSnapshot();
  if (!target) return false;

  try {
    const asset = await normalizeAndCreateImageAsset(rawBytes, mimeType);
    if (!isInsertTargetValid(target)) return false;

    const session = documentSessionStore.getState().sessions.get(documentIdentityKey(target.identity));
    const pageEntry = session?.pages.get(target.pageIndex);
    const layout = pageEntry?.layout;
    const pageWidth = layout?.intrinsicWidth || 612;
    const pageHeight = layout?.intrinsicHeight || 792;
    const pageBox = {
      xMin: 0,
      yMin: 0,
      xMax: pageWidth,
      yMax: pageHeight,
      width: pageWidth,
      height: pageHeight,
    };

    const bounds = calculateDefaultImageBounds(asset.width, asset.height, pageBox);

    useAssetStore.getState().addAsset(target.identity, asset);

    const ann: ImageAnnotation = {
      id: crypto.randomUUID(),
      pageIndex: target.pageIndex,
      type: 'image',
      color: '#000000',
      opacity: 1,
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      assetId: asset.id,
    };

    useAnnotationStore.getState().addAnnotation(target.identity.docId, ann);
    useHistoryStore.getState().push(makeAddAction(target.identity.docId, ann));
    useSelectionStore.getState().selectAnnotation(target.identity, target.pageIndex, ann.id);
    return true;
  } catch (err) {
    console.warn('[ImageInsert] Failed to insert image:', err);
    return false;
  }
}

export async function insertImageFromFile(): Promise<boolean> {
  const target = createInsertTargetSnapshot();
  if (!target) return false;

  if (window.electronAPI?.openImage) {
    const result = await window.electronAPI.openImage();
    if (!result || !result.data) {
      // User cancelled file picker — 0 asset, 0 annotation, 0 history, 0 dirty
      return false;
    }

    if (!isInsertTargetValid(target)) return false;

    return await insertImageFromBytes(result.data, result.mimeType);
  }

  // Web fallback using HTML5 file input
  return new Promise<boolean>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.style.display = 'none';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) {
          resolve(false);
          return;
        }
        const buffer = await file.arrayBuffer();
        if (!isInsertTargetValid(target)) {
          resolve(false);
          return;
        }
        const success = await insertImageFromBytes(buffer, file.type || 'image/png');
        resolve(success);
      } catch (err) {
        console.warn('[ImageInsert] Web fallback failed:', err);
        resolve(false);
      } finally {
        input.remove();
      }
    };
    input.oncancel = () => {
      input.remove();
      resolve(false);
    };
    document.body.appendChild(input);
    input.click();
  });
}

export async function captureScreenToImage(): Promise<boolean> {
  const target = createInsertTargetSnapshot();
  if (!target) return false;

  if (window.electronAPI?.captureScreen) {
    const result = await window.electronAPI.captureScreen();
    if (!result.success || !result.data) {
      if (result.error) {
        console.warn('[ScreenCapture] Capture error:', result.error);
      }
      return false;
    }

    if (!isInsertTargetValid(target)) return false;

    return await insertImageFromBytes(result.data, result.mimeType || 'image/png');
  }

  // Web fallback via navigator.mediaDevices.getDisplayMedia
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);

      track.stop();
      stream.getTracks().forEach((t) => t.stop());

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob || !isInsertTargetValid(target)) return false;
      const buffer = await blob.arrayBuffer();
      return await insertImageFromBytes(buffer, 'image/png');
    } catch (err) {
      console.warn('[ScreenCapture] Web capture failed or cancelled:', err);
      return false;
    }
  }

  console.warn('[ScreenCapture] Neither Electron nor getDisplayMedia is available.');
  return false;
}

export async function captureRegionToImage(): Promise<boolean> {
  const target = createInsertTargetSnapshot();
  if (!target) return false;

  if (window.electronAPI?.captureRegion) {
    const result = await window.electronAPI.captureRegion();
    if (result.canceled || !result.success || !result.data) {
      if (result.error) {
        console.warn('[RegionCapture] Region capture error:', result.error);
      }
      return false;
    }

    if (!isInsertTargetValid(target)) return false;

    return await insertImageFromBytes(result.data, result.mimeType || 'image/png');
  }

  // Fallback to screen capture
  return await captureScreenToImage();
}
