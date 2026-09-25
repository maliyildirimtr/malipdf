import { describe, expect, it } from 'vitest';
import type { ImageAnnotation } from '../../types/annotations';
import { getAnnotationBounds } from '../annotationGeometry';
import { hitTestAnnotation, hitTestMarquee } from '../annotationHitTest';
import { translateAnnotation, scaleAnnotationFromBounds } from '../annotationTransform';

function createSampleImage(overrides: Partial<ImageAnnotation> = {}): ImageAnnotation {
  return {
    id: 'test-img-1',
    pageIndex: 0,
    type: 'image',
    x: 100,
    y: 200,
    width: 300,
    height: 150,
    assetId: 'asset-123',
    opacity: 0.9,
    locked: false,
    color: '#000000',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('ImageAnnotation Geometry and Hit-Testing', () => {
  it('calculates canonical bounding box correctly', () => {
    const img = createSampleImage({ x: 50, y: 80, width: 200, height: 100 });
    const bounds = getAnnotationBounds(img);
    expect(bounds).toEqual({
      x: 50,
      y: 80,
      width: 200,
      height: 100,
    });
  });

  it('hit-tests successfully inside the image rectangle', () => {
    const img = createSampleImage({ x: 100, y: 100, width: 200, height: 100 });
    // Inside
    expect(hitTestAnnotation({ x: 150, y: 150 }, img, 0)).toBe(true);
    expect(hitTestAnnotation({ x: 100, y: 100 }, img, 0)).toBe(true);
    expect(hitTestAnnotation({ x: 300, y: 200 }, img, 0)).toBe(true);
  });

  it('hit-tests with tolerance for Object Eraser', () => {
    const img = createSampleImage({ x: 100, y: 100, width: 200, height: 100 });
    const tolerance = 8;
    // Just outside but within tolerance
    expect(hitTestAnnotation({ x: 95, y: 150 }, img, tolerance)).toBe(true);
    expect(hitTestAnnotation({ x: 305, y: 205 }, img, tolerance)).toBe(true);
    // Far outside
    expect(hitTestAnnotation({ x: 80, y: 150 }, img, tolerance)).toBe(false);
    expect(hitTestAnnotation({ x: 150, y: 220 }, img, tolerance)).toBe(false);
  });

  it('selects via marquee enclosing or intersecting bounding box', () => {
    const img = createSampleImage({ x: 100, y: 100, width: 100, height: 100 });
    // Completely enclosing marquee
    const enclosingMarquee = { x: 50, y: 50, width: 200, height: 200 };
    expect(hitTestMarquee(enclosingMarquee, img)).toBe(true);

    // Intersecting marquee
    const intersectingMarquee = { x: 150, y: 150, width: 100, height: 100 };
    expect(hitTestMarquee(intersectingMarquee, img)).toBe(true);

    // Disjoint marquee
    const disjointMarquee = { x: 300, y: 300, width: 100, height: 100 };
    expect(hitTestMarquee(disjointMarquee, img)).toBe(false);
  });
});

describe('ImageAnnotation Transformations', () => {
  it('translates image position along x and y', () => {
    const img = createSampleImage({ x: 100, y: 200, width: 300, height: 150 });
    const moved = translateAnnotation(img, 25, -50);
    expect(moved.type).toBe('image');
    if (moved.type === 'image') {
      expect(moved.x).toBe(125);
      expect(moved.y).toBe(150);
      expect(moved.width).toBe(300);
      expect(moved.height).toBe(150);
      expect(moved.assetId).toBe('asset-123');
    }
  });

  it('scales image to new bounding box', () => {
    const img = createSampleImage({ x: 100, y: 100, width: 200, height: 100 });
    const initialBounds = getAnnotationBounds(img);
    const targetBounds = { x: 150, y: 120, width: 300, height: 200 };

    const scaled = scaleAnnotationFromBounds(img, initialBounds, targetBounds);
    expect(scaled.type).toBe('image');
    if (scaled.type === 'image') {
      expect(scaled.x).toBe(150);
      expect(scaled.y).toBe(120);
      expect(scaled.width).toBe(300);
      expect(scaled.height).toBe(200);
    }
  });
});
