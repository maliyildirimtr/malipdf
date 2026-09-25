import { describe, it, expect } from 'vitest';
import {
  hitTestAnnotations,
  hitTestSelectedBounds,
  rectsIntersect,
  eraserHitTest,
} from '../annotationHitTest';
import { getAnnotationBounds } from '../annotationGeometry';
import type { Annotation } from '../../types/annotations';
import { createPageTransform } from '../coordinateTransform';

describe('annotationHitTest', () => {
  const transform = createPageTransform(
    { view: [0, 0, 500, 500], rotate: 0, getViewport: () => ({ viewBox: [0,0,500,500] }) } as any,
    { scale: 1, displayRotation: 0 }
  );

  const rectAnn: Annotation = {
    id: 'rect1',
    pageIndex: 0,
    type: 'shape',
    shapeKind: 'rectangle',
    color: '#000',
    fillColor: 'transparent',
    opacity: 1,
    strokeWidth: 2,
    startPoint: { x: 100, y: 100 },
    endPoint: { x: 200, y: 200 },
    createdAt: 0,
    updatedAt: 0,
    locked: false,
  };

  const lineAnn: Annotation = {
    id: 'line1',
    pageIndex: 0,
    type: 'shape',
    shapeKind: 'line',
    color: '#000',
    fillColor: 'transparent',
    opacity: 1,
    strokeWidth: 2,
    startPoint: { x: 50, y: 50 },
    endPoint: { x: 150, y: 150 },
    createdAt: 0,
    updatedAt: 0,
    locked: false,
  };

  const arrowAnn: Annotation = {
    ...lineAnn,
    id: 'arrow1',
    type: 'shape',
    shapeKind: 'arrow',
    strokeWidth: 5,
  };

  const penAnn: Annotation = {
    id: 'pen1',
    pageIndex: 0,
    type: 'stroke',
    color: '#000',
    width: 4,
    opacity: 1,
    smooth: true,
    pressure: true,
    points: [
      { x: 300, y: 300, pressure: 0.5, timestamp: 0 },
      { x: 310, y: 310, pressure: 0.5, timestamp: 10 },
    ],
    createdAt: 0,
    updatedAt: 0,
    locked: false,
  };

  const textAnn: Annotation = {
    id: 'text1',
    pageIndex: 0,
    type: 'text',
    color: '#000',
    content: 'Hello',
    bounds: { x: 400, y: 400, width: 50, height: 20 },
    fontSize: 12,
    fontFamily: 'sans-serif',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    opacity: 1,
    backgroundColor: 'transparent',
    createdAt: 0,
    updatedAt: 0,
    locked: false,
  };

  describe('getAnnotationBounds', () => {
    it('returns exact bounds for text', () => {
      const bounds = getAnnotationBounds(textAnn);
      expect(bounds).toEqual({ x: 400, y: 400, width: 50, height: 20 });
    });

    it('pads rectangle by strokeWidth / 2', () => {
      const bounds = getAnnotationBounds(rectAnn);
      expect(bounds.x).toBe(99);
      expect(bounds.y).toBe(99);
      expect(bounds.width).toBe(102);
      expect(bounds.height).toBe(102);
    });

    it('pads arrow with large head clearance', () => {
      const bounds = getAnnotationBounds(arrowAnn);
      const pad = 5 * 4 + 12; // 32
      expect(bounds.x).toBe(50 - pad);
      expect(bounds.y).toBe(50 - pad);
      expect(bounds.width).toBe(100 + pad * 2);
      expect(bounds.height).toBe(100 + pad * 2);
    });

    it('pads pen stroke by width / 2', () => {
      const bounds = getAnnotationBounds(penAnn);
      expect(bounds.x).toBe(298);
      expect(bounds.width).toBe(14);
    });
  });

  describe('hitTestAnnotations (Pointer Select)', () => {
    it('hits rectangle on the edge', () => {
      const hit = hitTestAnnotations({ x: 100, y: 150 }, [rectAnn], transform);
      expect(hit?.id).toBe('rect1');
    });

    it('misses rectangle outside tolerance', () => {
      const hit = hitTestAnnotations({ x: 50, y: 150 }, [rectAnn], transform);
      expect(hit).toBeNull();
    });

    it('hits text inside bounds', () => {
      const hit = hitTestAnnotations({ x: 410, y: 410 }, [textAnn], transform);
      expect(hit?.id).toBe('text1');
    });

    it('returns topmost overlapping annotation', () => {
      const topRect: Annotation = { ...rectAnn, id: 'topRect', color: '#f00' };
      const hit = hitTestAnnotations({ x: 100, y: 100 }, [rectAnn, topRect], transform);
      expect(hit?.id).toBe('topRect');
    });
  });

  describe('hitTestSelectedBounds (Selection Drag)', () => {
    it('does NOT hit empty space inside a selected hollow rectangle', () => {
      expect(hitTestAnnotations({ x: 150, y: 150 }, [rectAnn], transform)).toBeNull();
      expect(hitTestSelectedBounds({ x: 150, y: 150 }, [rectAnn], ['rect1'])?.id).toBeUndefined();
    });

    it('does not expand hit areas for unselected annotations', () => {
      expect(hitTestSelectedBounds({ x: 150, y: 150 }, [rectAnn], [])).toBeNull();
    });
  });

  describe('rectsIntersect (Rubber-band Selection)', () => {
    it('returns true when intersecting', () => {
      const a = { x: 0, y: 0, width: 10, height: 10 };
      const b = { x: 5, y: 5, width: 10, height: 10 };
      expect(rectsIntersect(a, b)).toBe(true);
    });

    it('returns false when disjoint', () => {
      const a = { x: 0, y: 0, width: 10, height: 10 };
      const b = { x: 20, y: 20, width: 10, height: 10 };
      expect(rectsIntersect(a, b)).toBe(false);
    });
  });

  describe('eraserHitTest', () => {
    it('returns all intersecting annotations', () => {
      const hits = eraserHitTest({ x: 100, y: 100 }, [rectAnn, lineAnn], 10);
      expect(hits.map(h => h.id)).toContain('rect1');
      // line goes from 50,50 to 150,150. Distance to 100,100 is 0.
      expect(hits.map(h => h.id)).toContain('line1');
    });
  });
});
