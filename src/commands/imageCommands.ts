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
import { useHistoryStore, makeAddAction, makeUpdateAction } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { documentSessionStore } from '../store/documentSessionStore';
import { documentIdentityKey } from '../types/documentSession';
import type { ImageAnnotation } from '../types/annotations';
import { errorMessage, notifyUser } from '../utils/notify';
import {
  createInsertTargetSnapshot,
  isInsertTargetValid,
  normalizeAndCreateImageAsset,
  calculateDefaultImageBounds,
} from '../pdf/imageUtils';

export async function insertImageFromBytes(
  rawBytes: ArrayBuffer,
  mimeType: string,
  /** Fixed size in PDF points (signatures, stamps); default = natural size. */
  size?: { width: number; height: number },
  /** Extra annotation fields (e.g. a formula's LaTeX source). */
  extra?: Pick<ImageAnnotation, 'formula'>,
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

    // Centre it on the part of the page that is on screen, so it appears where the user is looking.
    const onScreen = visiblePageCenter(target.pageIndex, pageWidth, pageHeight);
    const bounds = size
      ? calculateDefaultImageBounds(size.width, size.height, pageBox, onScreen)
      : calculateDefaultImageBounds(asset.width, asset.height, pageBox, onScreen);

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
      ...extra,
    };

    useAnnotationStore.getState().addAnnotation(target.identity.docId, ann);
    useHistoryStore.getState().push(makeAddAction(target.identity.docId, ann));
    useSelectionStore.getState().selectAnnotation(target.identity, target.pageIndex, ann.id);
    return true;
  } catch (err) {
    console.warn('[ImageInsert] Failed to insert image:', err);
    notifyUser('error', `Image could not be inserted: ${errorMessage(err)}`);
    return false;
  }
}

/**
 * Centre (PDF points) of the visible part of a page, or undefined when the
 * page is not on screen or is shown rotated.
 */
function visiblePageCenter(pageIndex: number, pageWidth: number, pageHeight: number): { x: number; y: number } | undefined {
  if (typeof document === 'undefined') return undefined;
  const doc = useDocumentStore.getState().documents.get(useDocumentStore.getState().activeDocId ?? '');
  if (!doc || (doc.pageRotations[pageIndex] ?? 0) % 360 !== 0) return undefined;
  const el = document.querySelector(`[data-page-index="${pageIndex}"]`);
  if (!el) return undefined;
  const page = el.getBoundingClientRect();
  const area = (el.closest('[data-document-scroll]') ?? document.documentElement).getBoundingClientRect();
  const left = Math.max(page.left, area.left, 0);
  const right = Math.min(page.right, area.right, window.innerWidth);
  const top = Math.max(page.top, area.top, 0);
  const bottom = Math.min(page.bottom, area.bottom, window.innerHeight);
  if (right <= left || bottom <= top || page.width <= 0 || page.height <= 0) return undefined;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  return {
    x: ((cx - page.left) / page.width) * pageWidth,
    y: pageHeight - ((cy - page.top) / page.height) * pageHeight,
  };
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
        notifyUser('error', `Screenshot failed: ${result.error}`);
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
        notifyUser('error', `Screenshot failed: ${result.error}`);
      }
      return false;
    }

    if (!isInsertTargetValid(target)) return false;

    return await insertImageFromBytes(result.data, result.mimeType || 'image/png');
  }

  // Fallback to screen capture
  return await captureScreenToImage();
}

// ─── Formulas ────────────────────────────────────────────────────────────────

export interface FormulaSource { latex: string; color: string; size: number }

/** Typeset `formula` and insert it on the active page (centred, selected). */
export async function insertFormula(formula: FormulaSource): Promise<boolean> {
  const { renderFormula } = await import('../pdf/formula');
  const rendered = await renderFormula(formula.latex, formula);
  return insertImageFromBytes(
    rendered.png.slice().buffer,
    'image/png',
    { width: rendered.width, height: rendered.height },
    { formula: { ...formula, naturalWidth: rendered.width } },
  );
}

/**
 * Replace an existing formula with a new version. Its top-left corner stays,
 * and a formula the user resized keeps that zoom. One undo step.
 */
export async function updateFormula(docId: string, annotationId: string, pageIndex: number, formula: FormulaSource): Promise<boolean> {
  const { renderFormula } = await import('../pdf/formula');
  const rendered = await renderFormula(formula.latex, formula);
  const doc = useDocumentStore.getState().documents.get(docId);
  if (!doc) return false;
  const current = useAnnotationStore.getState().getPageAnnotations(docId, pageIndex).find((a) => a.id === annotationId);
  if (!current || current.type !== 'image') return false;
  const asset = await normalizeAndCreateImageAsset(rendered.png.slice().buffer, 'image/png');
  useAssetStore.getState().addAsset({ docId, instanceId: doc.instanceId }, asset);
  const natural = current.formula?.naturalWidth;
  const zoom = natural && natural > 0 ? current.width / natural : 1;
  const width = rendered.width * zoom;
  const height = rendered.height * zoom;
  const top = current.y + current.height;
  const after: ImageAnnotation = {
    ...current,
    assetId: asset.id,
    x: current.x,
    y: top - height,
    width,
    height,
    formula: { ...formula, naturalWidth: rendered.width },
    updatedAt: Date.now(),
  };
  useAnnotationStore.getState().replaceAnnotation(docId, pageIndex, after);
  useHistoryStore.getState().push(makeUpdateAction(docId, current, after));
  return true;
}
