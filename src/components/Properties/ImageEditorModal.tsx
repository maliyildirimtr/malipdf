import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  Crop,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  PenTool,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanText,
  Sparkles,
  Undo2,
  UserRound,
} from 'lucide-react';
import type { ImageAnnotation } from '../../types/annotations';
import type { DocumentIdentity } from '../../types/documentSession';
import { useAssetStore } from '../../store/assetStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore, makeUpdateAction } from '../../store/historyStore';
import { normalizeAndCreateImageAsset } from '../../pdf/imageUtils';
import { notifyUser } from '../../utils/notify';
import styles from './ImageEditorModal.module.css';

type EditorTool = 'crop' | 'filter' | 'censor' | 'draw' | 'document' | 'cutout';
type FilterPreset = 'none' | 'document' | 'grayscale' | 'vivid' | 'warm' | 'cool' | 'contrast';
type CropRatio = 'free' | '1:1' | '4:3' | '16:9';
type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

interface CropRect {
  x: number; // normalized 0..1
  y: number;
  w: number;
  h: number;
}

interface BrushStroke {
  kind: 'draw' | 'censor';
  color: string;
  size: number; // normalized fraction of min(w, h)
  points: { x: number; y: number }[]; // normalized 0..1 of transformed image
}

interface EditorState {
  rotation: number; // 0 | 90 | 180 | 270
  flipH: boolean;
  flipV: boolean;
  crop: CropRect;
  filter: FilterPreset;
  brightness: number; // -40..40
  contrast: number; // -40..40
  documentClean: boolean;
  removeWhiteBg: boolean;
  whiteThreshold: number; // 210..250
  cornerRadius: number; // 0..24 (% of min dimension)
  opacity: number; // 0.1..1
  strokes: BrushStroke[];
}

const INITIAL_STATE: EditorState = {
  rotation: 0,
  flipH: false,
  flipV: false,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  filter: 'none',
  brightness: 0,
  contrast: 0,
  documentClean: false,
  removeWhiteBg: false,
  whiteThreshold: 235,
  cornerRadius: 0,
  opacity: 1,
  strokes: [],
};

const DRAW_COLORS = ['#ef4444', '#1d5d9f', '#10b981', '#f59e0b', '#1a1a2e', '#ffffff'];

const FILTER_PRESETS: { id: FilterPreset; label: string }[] = [
  { id: 'none', label: 'Original' },
  { id: 'document', label: 'Document' },
  { id: 'grayscale', label: 'B&W' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'contrast', label: 'Contrast' },
];

function cssFilterFor(state: EditorState): string {
  const parts: string[] = [];
  const bright = 100 + state.brightness + (state.documentClean ? 14 : 0);
  const contr = 100 + state.contrast + (state.documentClean ? 42 : 0);
  if (bright !== 100) parts.push(`brightness(${bright}%)`);
  if (contr !== 100) parts.push(`contrast(${contr}%)`);
  switch (state.filter) {
    case 'document':
      parts.push('grayscale(100%) contrast(155%) brightness(112%)');
      break;
    case 'grayscale':
      parts.push('grayscale(100%)');
      break;
    case 'vivid':
      parts.push('saturate(145%) contrast(108%)');
      break;
    case 'warm':
      parts.push('sepia(28%) saturate(120%)');
      break;
    case 'cool':
      parts.push('hue-rotate(12deg) saturate(112%) brightness(103%)');
      break;
    case 'contrast':
      parts.push('contrast(135%)');
      break;
    default:
      break;
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

function renderTransformedToCanvas(
  img: HTMLImageElement,
  state: EditorState,
  applyCrop: boolean,
  maxDim?: number,
): HTMLCanvasElement {
  const rot = ((state.rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const rawW = swap ? img.naturalHeight : img.naturalWidth;
  const rawH = swap ? img.naturalWidth : img.naturalHeight;

  const scaleDown = maxDim && Math.max(rawW, rawH) > maxDim ? maxDim / Math.max(rawW, rawH) : 1;
  const baseW = Math.max(1, Math.round(rawW * scaleDown));
  const baseH = Math.max(1, Math.round(rawH * scaleDown));

  const work = document.createElement('canvas');
  work.width = baseW;
  work.height = baseH;
  const wCtx = work.getContext('2d')!;

  // 1. Draw rotated + flipped + filtered base image
  wCtx.save();
  wCtx.filter = cssFilterFor(state);
  wCtx.translate(baseW / 2, baseH / 2);
  wCtx.rotate((rot * Math.PI) / 180);
  wCtx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  const drawW = swap ? baseH : baseW;
  const drawH = swap ? baseW : baseH;
  wCtx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  wCtx.restore();

  // 2. Document clean / Remove white background pixel passes
  if (state.documentClean || state.removeWhiteBg) {
    const imgData = wCtx.getImageData(0, 0, baseW, baseH);
    const d = imgData.data;
    const thresh = state.whiteThreshold;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (state.documentClean) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 218) {
          d[i] = 255;
          d[i + 1] = 255;
          d[i + 2] = 255;
        }
      }
      if (state.removeWhiteBg) {
        if (d[i] >= thresh && d[i + 1] >= thresh && d[i + 2] >= thresh) {
          d[i + 3] = 0;
        }
      }
    }
    wCtx.putImageData(imgData, 0, 0);
  }

  // 3. Apply censor (mosaic pixelation) & draw strokes
  const minSide = Math.min(baseW, baseH);
  for (const stroke of state.strokes) {
    if (stroke.points.length === 0) continue;
    const radius = Math.max(4, stroke.size * minSide);
    if (stroke.kind === 'draw') {
      wCtx.save();
      wCtx.strokeStyle = stroke.color;
      wCtx.lineWidth = radius;
      wCtx.lineCap = 'round';
      wCtx.lineJoin = 'round';
      wCtx.beginPath();
      wCtx.moveTo(stroke.points[0].x * baseW, stroke.points[0].y * baseH);
      for (let i = 1; i < stroke.points.length; i++) {
        wCtx.lineTo(stroke.points[i].x * baseW, stroke.points[i].y * baseH);
      }
      if (stroke.points.length === 1) {
        wCtx.lineTo(stroke.points[0].x * baseW + 0.1, stroke.points[0].y * baseH + 0.1);
      }
      wCtx.stroke();
      wCtx.restore();
    } else {
      // Mosaic pixelation along brush path
      const block = Math.max(8, Math.round(minSide * 0.022));
      const seen = new Set<string>();
      for (const pt of stroke.points) {
        const cx = pt.x * baseW;
        const cy = pt.y * baseH;
        const x0 = Math.max(0, Math.floor((cx - radius) / block) * block);
        const y0 = Math.max(0, Math.floor((cy - radius) / block) * block);
        const x1 = Math.min(baseW, Math.ceil((cx + radius) / block) * block);
        const y1 = Math.min(baseH, Math.ceil((cy + radius) / block) * block);
        for (let by = y0; by < y1; by += block) {
          for (let bx = x0; bx < x1; bx += block) {
            if (Math.hypot(bx + block / 2 - cx, by + block / 2 - cy) > radius) continue;
            const key = `${bx},${by}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const bw = Math.min(block, baseW - bx);
            const bh = Math.min(block, baseH - by);
            const sample = wCtx.getImageData(bx, by, bw, bh).data;
            let sr = 0, sg = 0, sb = 0, cnt = 0;
            for (let k = 0; k < sample.length; k += 4) {
              sr += sample[k];
              sg += sample[k + 1];
              sb += sample[k + 2];
              cnt++;
            }
            if (cnt > 0) {
              wCtx.fillStyle = `rgb(${Math.round(sr / cnt)}, ${Math.round(sg / cnt)}, ${Math.round(sb / cnt)})`;
              wCtx.fillRect(bx, by, bw, bh);
            }
          }
        }
      }
    }
  }

  if (!applyCrop && state.cornerRadius <= 0) {
    return work;
  }

  const cx = applyCrop ? Math.round(state.crop.x * baseW) : 0;
  const cy = applyCrop ? Math.round(state.crop.y * baseH) : 0;
  const cw = applyCrop ? Math.max(8, Math.round(state.crop.w * baseW)) : baseW;
  const ch = applyCrop ? Math.max(8, Math.round(state.crop.h * baseH)) : baseH;

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const oCtx = out.getContext('2d')!;
  if (state.cornerRadius > 0) {
    const rad = (state.cornerRadius / 100) * Math.min(cw, ch);
    oCtx.beginPath();
    oCtx.roundRect(0, 0, cw, ch, rad);
    oCtx.clip();
  }
  oCtx.drawImage(work, cx, cy, cw, ch, 0, 0, cw, ch);
  return out;
}

export interface ImageEditorModalProps {
  annotation: ImageAnnotation;
  identity: DocumentIdentity;
  pageIndex: number;
  onClose: () => void;
}

export function ImageEditorModal({
  annotation,
  identity,
  pageIndex,
  onClose,
}: ImageEditorModalProps) {
  const [tool, setTool] = useState<EditorTool>('crop');
  const [cropRatio, setCropRatio] = useState<CropRatio>('free');
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [brushSize, setBrushSize] = useState(0.028);
  const [saving, setSaving] = useState(false);

  const [history, setHistory] = useState<EditorState[]>([
    { ...INITIAL_STATE, opacity: annotation.opacity ?? 1 },
  ]);
  const [histIdx, setHistIdx] = useState(0);
  const state = history[histIdx];

  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const activeStrokeRef = useRef<BrushStroke | null>(null);
  const cropDragRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    startCrop: CropRect;
    rect: DOMRect;
  } | null>(null);
  const [liveCrop, setLiveCrop] = useState<CropRect | null>(null);
  const [liveStrokeTick, setLiveStrokeTick] = useState(0);

  const commitState = useCallback((next: EditorState) => {
    setHistory((prev) => [...prev.slice(0, histIdx + 1), next]);
    setHistIdx((i) => i + 1);
  }, [histIdx]);

  const updateInline = useCallback((patch: Partial<EditorState>) => {
    setHistory((prev) => {
      const copy = [...prev];
      copy[histIdx] = { ...copy[histIdx], ...patch };
      return copy;
    });
  }, [histIdx]);

  // Decode source ImageAsset into an HTMLImageElement
  useEffect(() => {
    const asset = useAssetStore.getState().getAsset(identity, annotation.assetId);
    if (!asset) return;
    const blob = new Blob([asset.data as BlobPart], { type: asset.mimeType });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => setLoadedImg(img);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [identity, annotation.assetId]);

  // Repaint preview canvas whenever image or state changes
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !loadedImg) return;
    const effectiveState: EditorState = activeStrokeRef.current
      ? { ...state, strokes: [...state.strokes, activeStrokeRef.current] }
      : state;
    const rendered = renderTransformedToCanvas(loadedImg, effectiveState, false, 1200);
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = state.opacity;
      ctx.drawImage(rendered, 0, 0);
    }
  }, [loadedImg, state, liveStrokeTick]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const effectiveCrop = liveCrop ?? state.crop;

  const applyAspectToCrop = (ratio: CropRatio, base: CropRect): CropRect => {
    if (ratio === 'free' || !loadedImg) return base;
    const swap = state.rotation === 90 || state.rotation === 270;
    const imgAspect = (swap ? loadedImg.naturalHeight : loadedImg.naturalWidth)
      / Math.max(1, swap ? loadedImg.naturalWidth : loadedImg.naturalHeight);
    const target = ratio === '1:1' ? 1 : ratio === '4:3' ? 4 / 3 : 16 / 9;
    const normRatio = target / imgAspect;
    let w = base.w;
    let h = w / normRatio;
    if (h > 1) {
      h = 1;
      w = h * normRatio;
    }
    if (w > 1) {
      w = 1;
      h = w / normRatio;
    }
    const cx = base.x + base.w / 2;
    const cy = base.y + base.h / 2;
    return {
      x: Math.max(0, Math.min(1 - w, cx - w / 2)),
      y: Math.max(0, Math.min(1 - h, cy - h / 2)),
      w,
      h,
    };
  };

  const handleCropPointerDown = (handle: CropHandle, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    cropDragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...state.crop },
      rect: canvas.getBoundingClientRect(),
    };
  };

  const handleCropPointerMove = (e: React.PointerEvent) => {
    const drag = cropDragRef.current;
    if (!drag || drag.rect.width <= 0 || drag.rect.height <= 0) return;
    e.stopPropagation();
    const dx = (e.clientX - drag.startX) / drag.rect.width;
    const dy = (e.clientY - drag.startY) / drag.rect.height;
    const s = drag.startCrop;
    const minS = 0.1;
    let { x, y, w, h } = s;

    if (drag.handle === 'move') {
      x = Math.max(0, Math.min(1 - w, s.x + dx));
      y = Math.max(0, Math.min(1 - h, s.y + dy));
    } else {
      if (drag.handle.includes('w')) {
        const nx = Math.max(0, Math.min(s.x + s.w - minS, s.x + dx));
        w = s.x + s.w - nx;
        x = nx;
      }
      if (drag.handle.includes('e')) {
        w = Math.max(minS, Math.min(1 - s.x, s.w + dx));
      }
      if (drag.handle.includes('n')) {
        const ny = Math.max(0, Math.min(s.y + s.h - minS, s.y + dy));
        h = s.y + s.h - ny;
        y = ny;
      }
      if (drag.handle.includes('s')) {
        h = Math.max(minS, Math.min(1 - s.y, s.h + dy));
      }
    }
    setLiveCrop({ x, y, w, h });
  };

  const handleCropPointerUp = (e: React.PointerEvent) => {
    if (!cropDragRef.current) return;
    e.stopPropagation();
    cropDragRef.current = null;
    if (liveCrop) {
      commitState({ ...state, crop: liveCrop });
      setLiveCrop(null);
    }
  };

  // Freehand draw / mosaic censor pointer handlers on the preview canvas
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool !== 'draw' && tool !== 'censor') return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    activeStrokeRef.current = {
      kind: tool === 'censor' ? 'censor' : 'draw',
      color: drawColor,
      size: tool === 'censor' ? Math.max(0.04, brushSize * 1.6) : brushSize,
      points: [{ x, y }],
    };
    setLiveStrokeTick((t) => t + 1);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const active = activeStrokeRef.current;
    if (!active) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    active.points.push({ x, y });
    setLiveStrokeTick((t) => t + 1);
  };

  const handleCanvasPointerUp = () => {
    const active = activeStrokeRef.current;
    if (!active) return;
    activeStrokeRef.current = null;
    commitState({ ...state, strokes: [...state.strokes, active] });
  };

  const handleDone = async () => {
    if (!loadedImg || saving) return;
    setSaving(true);
    try {
      const finalCanvas = renderTransformedToCanvas(loadedImg, state, true, 2400);
      const blob = await new Promise<Blob | null>((resolve) => finalCanvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not encode edited image');
      const buffer = await blob.arrayBuffer();
      const preserveAlpha = state.removeWhiteBg || state.cornerRadius > 0;
      const newAsset = await normalizeAndCreateImageAsset(buffer, 'image/png', {
        compactPhotos: !preserveAlpha,
      });

      useAssetStore.getState().addAsset(identity, newAsset);

      // Keep the edited image centered at the same spot with updated proportions
      const oldArea = annotation.width * annotation.height;
      const newAspect = newAsset.width / Math.max(1, newAsset.height);
      const cropScale = Math.sqrt(Math.max(0.08, state.crop.w * state.crop.h));
      const targetArea = oldArea * cropScale * cropScale;
      const newW = Math.max(24, Math.sqrt(targetArea * newAspect));
      const newH = Math.max(24, newW / newAspect);
      const centerX = annotation.x + annotation.width / 2;
      const centerY = annotation.y + annotation.height / 2;

      const before = structuredClone(annotation);
      const after: ImageAnnotation = {
        ...structuredClone(annotation),
        assetId: newAsset.id,
        x: centerX - newW / 2,
        y: centerY - newH / 2,
        width: newW,
        height: newH,
        opacity: state.opacity,
        updatedAt: Date.now(),
      };

      useAnnotationStore.getState().replaceAnnotation(identity.docId, pageIndex, after);
      useHistoryStore.getState().push(makeUpdateAction(identity.docId, before, after));
      onClose();
    } catch {
      notifyUser('error', 'Could not save edited image');
      setSaving(false);
    }
  };

  const tools: { id: EditorTool; label: string; icon: React.ReactNode }[] = [
    { id: 'crop', label: 'Crop', icon: <Crop size={19} /> },
    { id: 'filter', label: 'Filter', icon: <Sparkles size={19} /> },
    { id: 'censor', label: 'Censor', icon: <EyeOff size={19} /> },
    { id: 'draw', label: 'Draw', icon: <PenTool size={19} /> },
    { id: 'document', label: 'Document', icon: <ScanText size={19} /> },
    { id: 'cutout', label: 'Cutout', icon: <UserRound size={19} /> },
  ];

  return ReactDOM.createPortal(
    <div
      className={styles.backdrop}
      data-keeps-selection="true"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Edit Image"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className={styles.topBar}>
          <div className={styles.iconGroup}>
            <button
              type="button"
              className={styles.circleBtn}
              disabled={histIdx === 0}
              onClick={() => setHistIdx((i) => Math.max(0, i - 1))}
              aria-label="Undo"
            >
              <Undo2 size={18} />
            </button>
            <button
              type="button"
              className={styles.circleBtn}
              disabled={histIdx >= history.length - 1}
              onClick={() => setHistIdx((i) => Math.min(history.length - 1, i + 1))}
              aria-label="Redo"
            >
              <Redo2 size={18} />
            </button>
          </div>

          <div className={styles.iconGroup}>
            <button
              type="button"
              className={styles.circleBtn}
              onClick={() => commitState({ ...state, rotation: (state.rotation + 270) % 360 })}
              aria-label="Rotate Left"
            >
              <RotateCcw size={18} />
            </button>
            <button
              type="button"
              className={styles.circleBtn}
              onClick={() => commitState({ ...state, rotation: (state.rotation + 90) % 360 })}
              aria-label="Rotate Right"
            >
              <RotateCw size={18} />
            </button>
            <button
              type="button"
              className={styles.circleBtn}
              onClick={() => commitState({ ...state, flipH: !state.flipH })}
              aria-label="Flip Horizontal"
            >
              <FlipHorizontal2 size={18} />
            </button>
            <button
              type="button"
              className={styles.circleBtn}
              onClick={() => commitState({ ...state, flipV: !state.flipV })}
              aria-label="Flip Vertical"
            >
              <FlipVertical2 size={18} />
            </button>
          </div>
        </div>

        {/* Main Body: Left tool rail + Center live canvas */}
        <div className={styles.body}>
          <nav className={styles.toolRail} aria-label="Image editing tools">
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.railBtn} ${tool === t.id ? styles.railBtnActive : ''}`}
                onClick={() => setTool(t.id)}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          <div ref={stageRef} className={styles.stage}>
            <div className={styles.canvasWrap}>
              <canvas
                ref={previewCanvasRef}
                className={styles.previewCanvas}
                style={{
                  cursor: tool === 'draw' || tool === 'censor' ? 'crosshair' : 'default',
                  borderRadius: state.cornerRadius > 0 ? `${state.cornerRadius}%` : undefined,
                }}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
              />

              {tool === 'crop' && (
                <div className={styles.cropOverlay}>
                  {/* Dimmed exterior masks */}
                  <div className={styles.cropMask} style={{ left: 0, top: 0, right: 0, height: `${effectiveCrop.y * 100}%` }} />
                  <div className={styles.cropMask} style={{ left: 0, bottom: 0, right: 0, height: `${(1 - effectiveCrop.y - effectiveCrop.h) * 100}%` }} />
                  <div className={styles.cropMask} style={{ left: 0, top: `${effectiveCrop.y * 100}%`, width: `${effectiveCrop.x * 100}%`, height: `${effectiveCrop.h * 100}%` }} />
                  <div className={styles.cropMask} style={{ right: 0, top: `${effectiveCrop.y * 100}%`, width: `${(1 - effectiveCrop.x - effectiveCrop.w) * 100}%`, height: `${effectiveCrop.h * 100}%` }} />

                  {/* Active Crop Box with 8 blue handles */}
                  <div
                    className={styles.cropBox}
                    style={{
                      left: `${effectiveCrop.x * 100}%`,
                      top: `${effectiveCrop.y * 100}%`,
                      width: `${effectiveCrop.w * 100}%`,
                      height: `${effectiveCrop.h * 100}%`,
                    }}
                    onPointerDown={(e) => handleCropPointerDown('move', e)}
                    onPointerMove={handleCropPointerMove}
                    onPointerUp={handleCropPointerUp}
                  >
                    {(['nw', 'ne', 'sw', 'se'] as CropHandle[]).map((h) => (
                      <div
                        key={h}
                        className={`${styles.cornerHandle} ${styles[`h_${h}`]}`}
                        onPointerDown={(e) => handleCropPointerDown(h, e)}
                        onPointerMove={handleCropPointerMove}
                        onPointerUp={handleCropPointerUp}
                      />
                    ))}
                    {(['n', 's', 'w', 'e'] as CropHandle[]).map((h) => (
                      <div
                        key={h}
                        className={`${styles.edgeHandle} ${styles[`h_${h}`]}`}
                        onPointerDown={(e) => handleCropPointerDown(h, e)}
                        onPointerMove={handleCropPointerMove}
                        onPointerUp={handleCropPointerUp}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom contextual toolbar + Cancel / Done */}
        <div className={styles.bottomBar}>
          <div className={styles.contextControls}>
            {tool === 'crop' && (
              <>
                <select
                  className={styles.selectPill}
                  value={cropRatio}
                  onChange={(e) => {
                    const nextRatio = e.target.value as CropRatio;
                    setCropRatio(nextRatio);
                    commitState({ ...state, crop: applyAspectToCrop(nextRatio, state.crop) });
                  }}
                >
                  <option value="free">Rectangle</option>
                  <option value="1:1">1 : 1</option>
                  <option value="4:3">4 : 3</option>
                  <option value="16:9">16 : 9</option>
                </select>
                <button
                  type="button"
                  className={styles.pillBtn}
                  onClick={() => {
                    setCropRatio('free');
                    commitState({ ...state, crop: { x: 0, y: 0, w: 1, h: 1 } });
                  }}
                >
                  Reset
                </button>
              </>
            )}

            {tool === 'filter' && (
              <div className={styles.chipScroll}>
                {FILTER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.pillBtn} ${state.filter === p.id ? styles.pillBtnActive : ''}`}
                    onClick={() => commitState({ ...state, filter: p.id })}
                  >
                    {p.label}
                  </button>
                ))}
                <label className={styles.inlineSlider}>
                  <span>Brightness</span>
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    value={state.brightness}
                    onChange={(e) => updateInline({ brightness: Number(e.target.value) })}
                  />
                </label>
                <label className={styles.inlineSlider}>
                  <span>Contrast</span>
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    value={state.contrast}
                    onChange={(e) => updateInline({ contrast: Number(e.target.value) })}
                  />
                </label>
              </div>
            )}

            {(tool === 'draw' || tool === 'censor') && (
              <div className={styles.chipScroll}>
                {tool === 'draw' && DRAW_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.swatch} ${drawColor === c ? styles.swatchActive : ''}`}
                    style={{ background: c }}
                    onClick={() => setDrawColor(c)}
                  />
                ))}
                <label className={styles.inlineSlider}>
                  <span>Size</span>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    step={0.5}
                    value={brushSize * 100}
                    onChange={(e) => setBrushSize(Number(e.target.value) / 100)}
                  />
                </label>
                {state.strokes.length > 0 && (
                  <button
                    type="button"
                    className={styles.pillBtn}
                    onClick={() => commitState({ ...state, strokes: [] })}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {tool === 'document' && (
              <div className={styles.chipScroll}>
                <button
                  type="button"
                  className={`${styles.pillBtn} ${state.documentClean ? styles.pillBtnActive : ''}`}
                  onClick={() => commitState({ ...state, documentClean: !state.documentClean })}
                >
                  Enhance Document
                </button>
              </div>
            )}

            {tool === 'cutout' && (
              <div className={styles.chipScroll}>
                <button
                  type="button"
                  className={`${styles.pillBtn} ${state.removeWhiteBg ? styles.pillBtnActive : ''}`}
                  onClick={() => commitState({ ...state, removeWhiteBg: !state.removeWhiteBg })}
                >
                  Remove White Background
                </button>
                <label className={styles.inlineSlider}>
                  <span>Corners</span>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={state.cornerRadius}
                    onChange={(e) => updateInline({ cornerRadius: Number(e.target.value) })}
                  />
                </label>
                <label className={styles.inlineSlider}>
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={Math.round(state.opacity * 100)}
                    onChange={(e) => updateInline({ opacity: Number(e.target.value) / 100 })}
                  />
                </label>
              </div>
            )}
          </div>

          <div className={styles.footerActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={styles.doneBtn} disabled={saving} onClick={() => void handleDone()}>
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
