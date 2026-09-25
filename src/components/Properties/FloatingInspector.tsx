import React, { useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import type { Annotation, ShapeAnnotation } from '../../types/annotations';
import type { PageTransform } from '../../pdf/coordinateTransform';
import type { DocumentIdentity } from '../../types/documentSession';
import { getAnnotationBounds } from '../../pdf/annotationGeometry';
import { useSelectionStore } from '../../store/selectionStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore, makeUpdateAction } from '../../store/historyStore';
import { pdfToScreen } from '../../pdf/coordinateTransform';
import { WidthControl } from './WidthControl';
import { BorderStyleControl } from './BorderStyleControl';
import { ColorWell } from '../MainRibbon/ColorWell';
import { OpacityControl } from '../MainRibbon/PropertyControls';
import { TOOL_WIDTH_CONSTRAINTS } from '../../constants/toolConstraints';
import { computeInspectorPosition } from './positionHelper';
import styles from './FloatingInspector.module.css';

interface FloatingInspectorProps {
  annotation: Annotation;
  transform: PageTransform;
  identity: DocumentIdentity;
  pageIndex: number;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

// Use React.memo so FloatingInspector only re-renders when props actually change
export const FloatingInspector = React.memo(function FloatingInspector({
  annotation,
  transform,
  identity,
  pageIndex,
  canvasRef,
}: FloatingInspectorProps) {
  const { setTransientStyle } = useSelectionStore();
  const pushHistory = useHistoryStore(state => state.push);
  const updateAnnotation = useAnnotationStore(s => s.updateAnnotation);

  const inspectorRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  const [placement, setPlacement] = useState<'above' | 'below'>('below');

  // Keep latest annotation in a ref so position calc always uses fresh data
  const annotationRef = useRef(annotation);
  annotationRef.current = annotation;

  // Build a correctly-typed patch for this annotation type
  const buildPatch = useCallback((raw: Record<string, unknown>): Partial<Annotation> => {
    const ann = annotationRef.current;
    if (ann.type === 'stroke' || ann.type === 'highlight') {
      const patch: Record<string, unknown> = {};
      if ('width' in raw) patch.width = raw.width;
      if ('color' in raw) patch.color = raw.color;
      if ('opacity' in raw) patch.opacity = raw.opacity;
      return patch as Partial<Annotation>;
    }
    if (ann.type === 'freeform') {
      const patch: Record<string, unknown> = {};
      if ('strokeWidth' in raw) patch.strokeWidth = raw.strokeWidth;
      if ('color' in raw) patch.color = raw.color;
      if ('opacity' in raw) patch.opacity = raw.opacity;
      if ('fillColor' in raw) patch.fillColor = raw.fillColor;
      return patch as Partial<Annotation>;
    }
    if (ann.type === 'shape') {
      const patch: Partial<ShapeAnnotation> = {};
      if ('strokeWidth' in raw) patch.strokeWidth = raw.strokeWidth as number;
      if ('color' in raw) patch.color = raw.color as string;
      if ('opacity' in raw) patch.opacity = raw.opacity as number;
      if ('fillColor' in raw) patch.fillColor = raw.fillColor as string;
      if ('borderStyle' in raw) patch.borderStyle = raw.borderStyle as any;
      return patch as Partial<Annotation>;
    }
    if (ann.type === 'text') {
      const patch: Record<string, unknown> = {};
      if ('color' in raw) patch.color = raw.color;
      return patch as Partial<Annotation>;
    }
    if (ann.type === 'image') {
      const patch: Record<string, unknown> = {};
      if ('opacity' in raw) patch.opacity = raw.opacity;
      return patch as Partial<Annotation>;
    }
    return {};
  }, []); // no deps — reads from ref

  const handlePropertyChange = useCallback((raw: Record<string, unknown>) => {
    const ann = annotationRef.current;
    const patch = buildPatch(raw);
    setTransientStyle(identity, pageIndex, ann.id, patch);
  }, [identity, pageIndex, buildPatch, setTransientStyle]);

  const handlePropertyCommit = useCallback((raw: Record<string, unknown>) => {
    const ann = annotationRef.current;
    const patch = buildPatch(raw);
    // Clear transient first
    setTransientStyle(identity, pageIndex, ann.id, undefined);
    // No real change (e.g. blur without editing): no store write, no undo step.
    const changed = Object.entries(patch).some(
      ([key, value]) => (ann as unknown as Record<string, unknown>)[key] !== value,
    );
    if (!changed) return;
    // Persist to store
    const after = { ...ann, ...patch } as Annotation;
    updateAnnotation(identity.docId, pageIndex, ann.id, patch);
    pushHistory(makeUpdateAction(identity.docId, ann, after));
  }, [identity, pageIndex, buildPatch, setTransientStyle, updateAnnotation, pushHistory]);

  const handleCancel = useCallback(() => {
    const ann = annotationRef.current;
    setTransientStyle(identity, pageIndex, ann.id, undefined);
  }, [identity, pageIndex, setTransientStyle]);

  // Recalculate inspector position
  const recalc = useCallback(() => {
    if (!canvasRef.current || !inspectorRef.current) return;

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const inspectorRect = inspectorRef.current.getBoundingClientRect();

    // Guard: skip if inspector has zero size (not laid out yet)
    if (inspectorRect.width === 0 || inspectorRect.height === 0) return;

    const pdfBounds = getAnnotationBounds(annotationRef.current);
    const p1 = pdfToScreen(pdfBounds.x, pdfBounds.y, transform);
    const p2 = pdfToScreen(pdfBounds.x + pdfBounds.width, pdfBounds.y + pdfBounds.height, transform);

    const aLeft = Math.min(p1.x, p2.x);
    const aTop = Math.min(p1.y, p2.y);
    const aRight = Math.max(p1.x, p2.x);
    const aBottom = Math.max(p1.y, p2.y);

    const anchorBounds = {
      left: canvasRect.left + aLeft,
      top: canvasRect.top + aTop,
      right: canvasRect.left + aRight,
      bottom: canvasRect.top + aBottom,
      width: aRight - aLeft,
      height: aBottom - aTop,
    };

    const computed = computeInspectorPosition({
      anchorBounds,
      inspectorSize: { width: inspectorRect.width, height: inspectorRect.height },
      viewportSize: { width: window.innerWidth, height: window.innerHeight },
      margin: 10,
      gap: 10,
    });

    setPosition({ left: computed.left, top: computed.top });
    setPlacement(computed.placement);
  }, [transform, canvasRef]);

  // Position updates — only depends on annotation.id (not the full object) and transform
  useLayoutEffect(() => {
    let pendingRaf: number | null = null;

    const scheduleRecalc = () => {
      if (pendingRaf) cancelAnimationFrame(pendingRaf);
      pendingRaf = requestAnimationFrame(() => {
        recalc();
        pendingRaf = null;
      });
    };

    scheduleRecalc();

    window.addEventListener('resize', scheduleRecalc, { passive: true });
    window.addEventListener('scroll', scheduleRecalc, { passive: true, capture: true });

    return () => {
      if (pendingRaf) cancelAnimationFrame(pendingRaf);
      window.removeEventListener('resize', scheduleRecalc);
      window.removeEventListener('scroll', scheduleRecalc, { capture: true });
    };
  }, [annotation.id, recalc]); // annotation.id keeps effect stable; recalc re-creates when transform changes

  // Reposition when annotation geometry changes (e.g. after move/resize)
  useEffect(() => {
    recalc();
  }, [annotation, recalc]);

  // Cleanup transient style strictly on unmount (annotation.id scoped key)
  const annIdRef = useRef(annotation.id);
  annIdRef.current = annotation.id;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;

  useEffect(() => {
    return () => {
      // Use refs in cleanup to always target the right annotation
      setTransientStyle(identityRef.current, pageIndexRef.current, annIdRef.current, undefined);
    };
  }, []); // empty deps — only runs on unmount

  // ── Derive current display values ──────────────────────────────────────────

  let widthConstraint = TOOL_WIDTH_CONSTRAINTS.shape;
  let currentWidth = 1;
  let currentColor = '#000000';
  let currentOpacity = 1;
  let currentBorderStyle = 'solid';
  let currentFillColor = 'transparent';

  if (annotation.type === 'stroke') {
    widthConstraint = TOOL_WIDTH_CONSTRAINTS.pen;
    currentWidth = annotation.width;
    currentColor = annotation.color || '#000000';
    currentOpacity = annotation.opacity ?? 1;
  } else if (annotation.type === 'highlight') {
    widthConstraint = TOOL_WIDTH_CONSTRAINTS.highlighter;
    currentWidth = annotation.width;
    currentColor = annotation.color || '#ffff00';
    currentOpacity = annotation.opacity ?? 1;
  } else if (annotation.type === 'shape') {
    currentWidth = annotation.strokeWidth;
    currentColor = annotation.color || '#000000';
    currentOpacity = annotation.opacity ?? 1;
    currentBorderStyle = annotation.borderStyle || 'solid';
    currentFillColor = annotation.fillColor || 'transparent';
  } else if (annotation.type === 'freeform') {
    currentWidth = annotation.strokeWidth;
    currentColor = annotation.color || '#000000';
    currentOpacity = annotation.opacity ?? 1;
    currentFillColor = annotation.fillColor || 'transparent';
  } else if (annotation.type === 'text') {
    currentColor = annotation.color || '#000000';
  } else if (annotation.type === 'image') {
    currentOpacity = annotation.opacity ?? 1;
  } else {
    return null;
  }

  const hasStrokeColor = annotation.type !== 'image';
  const hasWidth = annotation.type !== 'text' && annotation.type !== 'image';
  const hasBorderStyle = annotation.type === 'shape';
  const hasFill = annotation.type === 'shape' || annotation.type === 'freeform';
  const hasOpacity = annotation.type === 'stroke' || annotation.type === 'highlight' || annotation.type === 'shape' || annotation.type === 'freeform' || annotation.type === 'image';

  const content = (
    <div
      ref={inspectorRef}
      className={`${styles.inspector} ${placement === 'above' ? styles.placementAbove : styles.placementBelow}`}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 10000,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Stroke color */}
      {hasStrokeColor && (
        <div className={styles.controlGroup}>
          <ColorWell
            label="Stroke"
            value={currentColor}
            onChange={(color) => handlePropertyChange({ color })}
            onCommit={(color) => handlePropertyCommit({ color })}
          />
        </div>
      )}

      {/* Fill color (shapes only) */}
      {hasFill && (
        <>
          <div className={styles.divider} />
          <div className={styles.controlGroup}>
            <ColorWell
              label="Fill"
              value={currentFillColor}
              allowTransparent={true}
              onChange={(fillColor) => handlePropertyChange({ fillColor })}
              onCommit={(fillColor) => handlePropertyCommit({ fillColor })}
            />
          </div>
        </>
      )}

      {/* Width */}
      {hasWidth && (
        <>
          <div className={styles.divider} />
          <div className={styles.controlGroup}>
            <WidthControl
              value={currentWidth}
              constraint={widthConstraint}
              onChange={(w) => {
                if (annotation.type === 'shape' || annotation.type === 'freeform') {
                  handlePropertyChange({ strokeWidth: w });
                } else {
                  handlePropertyChange({ width: w });
                }
              }}
              onCommit={(w) => {
                if (annotation.type === 'shape' || annotation.type === 'freeform') {
                  handlePropertyCommit({ strokeWidth: w });
                } else {
                  handlePropertyCommit({ width: w });
                }
              }}
              onCancel={handleCancel}
            />
          </div>
        </>
      )}

      {/* Border style (shapes only) */}
      {hasBorderStyle && (
        <>
          <div className={styles.divider} />
          <div className={styles.controlGroup}>
            <BorderStyleControl
              value={currentBorderStyle as any}
              onChange={(borderStyle) => handlePropertyChange({ borderStyle })}
              onCommit={(borderStyle) => handlePropertyCommit({ borderStyle })}
            />
          </div>
        </>
      )}

      {/* Opacity */}
      {hasOpacity && (
        <>
          <div className={styles.divider} />
          <div className={styles.controlGroup}>
            <OpacityControl
              value={currentOpacity}
              onChange={(opacity) => handlePropertyChange({ opacity })}
              onCommit={(opacity) => handlePropertyCommit({ opacity })}
              onCancel={handleCancel}
            />
          </div>
        </>
      )}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
});
