import { afterEach, describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfRect } from '../../types/annotations';
import {
  createPageTransform,
  normalizeRotation,
  pdfRectToScreenBounds,
  pdfToScreen,
  screenRectToPdfBounds,
  screenToPdf,
  type PdfBox,
  type QuarterTurn,
} from '../coordinateTransform';
import {
  COORDINATE_FIXTURES,
  expectedViewportPoint,
  loadCoordinateFixture,
} from './coordinateFixtures';

const ROTATIONS: QuarterTurn[] = [0, 90, 180, 270];
const SCALES = [0.25, 0.5, 1, 1.5, 2, 4];
const EPSILON = 1e-6;

const documentsToDestroy: PDFDocumentProxy[] = [];

afterEach(async () => {
  await Promise.all(documentsToDestroy.splice(0).map((document) => document.destroy()));
});

function closeTo(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(EPSILON);
}

function expectPointClose(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void {
  closeTo(actual.x, expected.x);
  closeTo(actual.y, expected.y);
}

function testPdfPoints(cropBox: PdfBox): Array<{ x: number; y: number }> {
  return [
    { x: cropBox.xMin, y: cropBox.yMin },
    { x: cropBox.xMin, y: cropBox.yMax },
    { x: cropBox.xMax, y: cropBox.yMin },
    { x: cropBox.xMax, y: cropBox.yMax },
    { x: cropBox.xMin + cropBox.width / 2, y: cropBox.yMin + cropBox.height / 2 },
    { x: cropBox.xMin + cropBox.width * 0.23, y: cropBox.yMin + cropBox.height * 0.61 },
  ];
}

describe('PageTransform rotation model', () => {
  it.each([
    [-450, 270],
    [-90, 270],
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [360, 0],
    [450, 90],
  ])('normalizes %s degrees to %s', (input, expected) => {
    expect(normalizeRotation(input)).toBe(expected);
  });

  it('rejects non-quarter-turn rotations', () => {
    expect(() => normalizeRotation(45)).toThrow(/multiple of 90/i);
  });

  for (const intrinsicRotation of ROTATIONS) {
    for (const displayRotation of ROTATIONS) {
      it(`combines intrinsic ${intrinsicRotation} and display ${displayRotation}`, async () => {
        const loaded = await loadCoordinateFixture(COORDINATE_FIXTURES[0], intrinsicRotation);
        documentsToDestroy.push(loaded.document);

        const transform = createPageTransform(loaded.page, {
          scale: 1,
          displayRotation,
          mediaBox: loaded.definition.mediaBox,
        });

        expect(transform.intrinsicRotation).toBe(intrinsicRotation);
        expect(transform.displayRotation).toBe(displayRotation);
        expect(transform.effectiveRotation).toBe(
          normalizeRotation(intrinsicRotation + displayRotation),
        );
      });
    }
  }
});

describe('PageTransform golden coordinate matrix', () => {
  for (const definition of COORDINATE_FIXTURES) {
    for (const intrinsicRotation of ROTATIONS) {
      for (const displayRotation of ROTATIONS) {
        for (const scale of SCALES) {
          const effectiveRotation = normalizeRotation(intrinsicRotation + displayRotation);
          const caseName = `${definition.name}: intrinsic=${intrinsicRotation}, display=${displayRotation}, scale=${scale}`;

          it(caseName, async () => {
            const loaded = await loadCoordinateFixture(definition, intrinsicRotation);
            documentsToDestroy.push(loaded.document);
            const transform = createPageTransform(loaded.page, {
              scale,
              displayRotation,
              mediaBox: definition.mediaBox,
            });

            expect(transform.cropBox).toEqual(definition.cropBox);
            expect(transform.mediaBox).toEqual(definition.mediaBox);

            const swapsAxes = effectiveRotation === 90 || effectiveRotation === 270;
            closeTo(
              transform.cssWidth,
              (swapsAxes ? definition.cropBox.height : definition.cropBox.width) * scale,
            );
            closeTo(
              transform.cssHeight,
              (swapsAxes ? definition.cropBox.width : definition.cropBox.height) * scale,
            );

            for (const pdfPoint of testPdfPoints(definition.cropBox)) {
              const expectedScreen = expectedViewportPoint(
                pdfPoint.x,
                pdfPoint.y,
                definition.cropBox,
                scale,
                effectiveRotation,
              );
              const screenPoint = pdfToScreen(pdfPoint.x, pdfPoint.y, transform);

              // Independent golden anchor mapping.
              expectPointClose(screenPoint, expectedScreen);

              // PDF -> screen -> PDF invariant.
              expectPointClose(screenToPdf(screenPoint.x, screenPoint.y, transform), pdfPoint);
            }

            const screenPoints = [
              { x: 0, y: 0 },
              { x: transform.cssWidth, y: 0 },
              { x: 0, y: transform.cssHeight },
              { x: transform.cssWidth, y: transform.cssHeight },
              { x: transform.cssWidth / 2, y: transform.cssHeight / 2 },
              { x: transform.cssWidth * 0.37, y: transform.cssHeight * 0.68 },
            ];
            for (const screenPoint of screenPoints) {
              const pdfPoint = screenToPdf(screenPoint.x, screenPoint.y, transform);
              expectPointClose(pdfToScreen(pdfPoint.x, pdfPoint.y, transform), screenPoint);
            }
          });
        }
      }
    }
  }
});

describe('PageTransform rectangle conversion', () => {
  for (const effectiveRotation of ROTATIONS) {
    it(`uses all four corners and normalizes rectangles at rotation ${effectiveRotation}`, async () => {
      const definition = COORDINATE_FIXTURES[2];
      const loaded = await loadCoordinateFixture(definition, 0);
      documentsToDestroy.push(loaded.document);
      const transform = createPageTransform(loaded.page, {
        scale: 1.5,
        displayRotation: effectiveRotation,
        mediaBox: definition.mediaBox,
      });
      const pdfRect: PdfRect = {
        x: definition.cropBox.xMin + 40,
        y: definition.cropBox.yMin + 70,
        width: 180,
        height: 120,
      };

      const screenBounds = pdfRectToScreenBounds(pdfRect, transform);
      expect(screenBounds.width).toBeGreaterThan(0);
      expect(screenBounds.height).toBeGreaterThan(0);
      const roundTrip = screenRectToPdfBounds(screenBounds, transform);
      closeTo(roundTrip.x, pdfRect.x);
      closeTo(roundTrip.y, pdfRect.y);
      closeTo(roundTrip.width, pdfRect.width);
      closeTo(roundTrip.height, pdfRect.height);

      const reverseDrag = screenRectToPdfBounds(
        {
          x: screenBounds.x + screenBounds.width,
          y: screenBounds.y + screenBounds.height,
          width: -screenBounds.width,
          height: -screenBounds.height,
        },
        transform,
      );
      expect(reverseDrag.width).toBeGreaterThan(0);
      expect(reverseDrag.height).toBeGreaterThan(0);
      closeTo(reverseDrag.x, pdfRect.x);
      closeTo(reverseDrag.y, pdfRect.y);
      closeTo(reverseDrag.width, pdfRect.width);
      closeTo(reverseDrag.height, pdfRect.height);
    });
  }
});

describe('PageTransform zoom and DPR invariants', () => {
  it('does not include devicePixelRatio in canonical coordinate conversion', async () => {
    const definition = COORDINATE_FIXTURES[1];
    const loaded = await loadCoordinateFixture(definition, 90);
    documentsToDestroy.push(loaded.document);
    const pdfPoint = { x: 123, y: 456 };

    for (const scale of SCALES) {
      const transform = createPageTransform(loaded.page, {
        scale,
        displayRotation: 270,
        mediaBox: definition.mediaBox,
      });
      const screenPoint = pdfToScreen(pdfPoint.x, pdfPoint.y, transform);
      expectPointClose(screenToPdf(screenPoint.x, screenPoint.y, transform), pdfPoint);
      expect('devicePixelRatio' in transform).toBe(false);
    }
  });

  it('never mutates canonical annotation geometry across zoom and display rotation', async () => {
    const definition = COORDINATE_FIXTURES[2];
    const loaded = await loadCoordinateFixture(definition, 90);
    documentsToDestroy.push(loaded.document);
    const annotationGeometry = {
      points: [
        { x: 80, y: 120 },
        { x: 215, y: 455 },
        { x: 510, y: 700 },
      ],
      width: 3,
    };
    const originalGeometry = structuredClone(annotationGeometry);

    for (const displayRotation of ROTATIONS) {
      for (const scale of SCALES) {
        const transform = createPageTransform(loaded.page, {
          scale,
          displayRotation,
          mediaBox: definition.mediaBox,
        });
        for (const point of annotationGeometry.points) {
          const screenPoint = pdfToScreen(point.x, point.y, transform);
          expectPointClose(screenToPdf(screenPoint.x, screenPoint.y, transform), point);
        }
      }
    }

    expect(annotationGeometry).toEqual(originalGeometry);
    expect(annotationGeometry.width).toBe(3);
  });
});
