import { afterEach, describe, expect, it } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type {
  Annotation,
  DocumentAnnotationState,
  HighlightAnnotation,
  ShapeAnnotation,
  StrokeAnnotation,
  TextAnnotation,
} from '../../types/annotations';
import { createPageTransform, pdfToScreen, screenToPdf, type QuarterTurn } from '../coordinateTransform';
import {
  AnnotationExportError,
  buildAnnotationsMap,
  exportAnnotatedPdf,
  type DocumentAnnotations,
} from '../annotationExporter';

interface Box { x: number; y: number; width: number; height: number }
interface Point { x: number; y: number }
type Matrix = [number, number, number, number, number, number];

const openDocuments: PDFDocumentProxy[] = [];
const anchor = { x: 125, y: 210 };
const end = { x: 245, y: 330 };

afterEach(async () => {
  await Promise.all(openDocuments.splice(0).map((document) => document.destroy()));
});

describe('annotation exporter canonical coordinate contract', () => {
  it.each([0, 90, 180, 270] as const)(
    'keeps canonical line geometry unchanged with intrinsic rotation %s',
    async (intrinsicRotation) => {
      const source = await createSource({ intrinsicRotation });
      const result = await exportAnnotatedPdf(source, mapOf(shape('line')));
      const reopened = await reopen(result.data);
      const page = await reopened.getPage(1);

      expect(page.rotate).toBe(intrinsicRotation);
      expect(await firstPaintedSegment(page)).toEqualSegment(anchor, end);
    },
  );

  it.each(
    ([0, 90, 180, 270] as const).flatMap((intrinsicRotation) =>
      ([0, 90, 180, 270] as const).map((displayRotation) => ({ intrinsicRotation, displayRotation })),
    ),
  )(
    'ignores display rotation $displayRotation with intrinsic rotation $intrinsicRotation',
    async ({ intrinsicRotation, displayRotation }) => {
      const source = await createSource({ intrinsicRotation });
      const result = await legacyExportCall(source, mapOf(shape('line')), { 0: displayRotation });
      const reopened = await reopen(result.data);
      const page = await reopened.getPage(1);

      expect(page.rotate).toBe(intrinsicRotation);
      expect(await firstPaintedSegment(page)).toEqualSegment(anchor, end);
    },
  );

  it.each([0.25, 0.5, 1, 1.5, 2, 4])(
    'exports identical PDF geometry after a zoom %s viewport round trip',
    async (scale) => {
      const source = await createSource({ intrinsicRotation: 90 });
      const sourceDocument = await reopen(source);
      const sourcePage = await sourceDocument.getPage(1);
      const transform = createPageTransform(sourcePage, { scale, displayRotation: 270 });
      const screenAnchor = pdfToScreen(anchor.x, anchor.y, transform);
      const canonicalAnchor = screenToPdf(screenAnchor.x, screenAnchor.y, transform);
      const annotation = shape('line', canonicalAnchor, end);

      const result = await exportAnnotatedPdf(source, mapOf(annotation));
      const reopened = await reopen(result.data);
      expect(await firstPaintedSegment(await reopened.getPage(1))).toEqualSegment(anchor, end);
    },
  );
});

describe('annotation exporter page boxes', () => {
  it.each([
    { name: 'equal origin boxes', media: box(0, 0, 612, 792), crop: box(0, 0, 612, 792) },
    { name: 'offset media box', media: box(-100, -50, 800, 1000), crop: box(-100, -50, 800, 1000) },
    { name: 'inset non-zero crop', media: box(-100, -50, 800, 1000), crop: box(25, 40, 600, 800) },
  ])('preserves $name and absolute annotation coordinates', async ({ media, crop }) => {
    const source = await createSource({ intrinsicRotation: 270, media, crop });
    const result = await exportAnnotatedPdf(source, mapOf(shape('line')));
    const pdfLibDocument = await PDFDocument.load(result.data);
    const outputPage = pdfLibDocument.getPage(0);

    expect(outputPage.getMediaBox()).toEqual(media);
    expect(outputPage.getCropBox()).toEqual(crop);

    const reopened = await reopen(result.data);
    const page = await reopened.getPage(1);
    expect(page.view).toEqual([crop.x, crop.y, crop.x + crop.width, crop.y + crop.height]);
    expect(await firstPaintedSegment(page)).toEqualSegment(anchor, end);
  });

  it('does not clamp content to CropBox; PDF viewing applies clipping', async () => {
    const media = box(0, 0, 600, 800);
    const crop = box(100, 150, 350, 400);
    const outside = shape('line', { x: 20, y: 30 }, { x: 580, y: 760 });
    const result = await exportAnnotatedPdf(
      await createSource({ intrinsicRotation: 90, media, crop }),
      mapOf(outside),
    );
    const reopened = await reopen(result.data);
    expect(await firstPaintedSegment(await reopened.getPage(1))).toEqualSegment(outside.startPoint, outside.endPoint);
  });
});

describe('annotation exporter annotation types', () => {
  it('exports pen points, width, color and opacity in PDF points', async () => {
    const result = await exportAnnotatedPdf(await createSource({}), mapOf(stroke()));
    const page = await (await reopen(result.data)).getPage(1);
    const operators = await interpretedOperators(page);
    expect(operators.segments).toContainEqualSegment(anchor, end);
    expect(operators.lineWidths).toContain(5);
    expect(operators.strokeColors).toContainEqual([17, 34, 51]);
    expect(operators.gStates.length).toBeGreaterThan(0);
  });

  it('exports pressure pen as variable-width PDF segments', async () => {
    const annotation = stroke(true);
    const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 180 }), mapOf(annotation));
    const operators = await interpretedOperators(await (await reopen(result.data)).getPage(1));
    expect(operators.lineWidths).toEqual(expect.arrayContaining([1.5, 8.5]));
    expect(operators.segments).toContainEqualSegment(anchor, { x: 185, y: 270 });
    expect(operators.segments).toContainEqualSegment({ x: 185, y: 270 }, end);
  });

  it('preserves smooth pen endpoints while exporting interpolated segments', async () => {
    const annotation = {
      ...stroke(), smooth: true,
      points: [point(anchor), point({ x: 185, y: 300 }), point(end)],
    };
    const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 90 }), mapOf(annotation));
    const operators = await interpretedOperators(await (await reopen(result.data)).getPage(1));
    expect(operators.segments.length).toBeGreaterThan(2);
    expect(operators.segments[0].start).toSatisfy((value: Point) => closePoint(value, anchor));
    expect(operators.segments.at(-1)?.end).toSatisfy((value: Point) => closePoint(value, end));
  });

  it('exports a 2-point smooth pen without crashing and matches endpoints', async () => {
    const annotation = { ...stroke(), smooth: true, points: [point(anchor), point(end)] };
    const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 0 }), mapOf(annotation));
    const operators = await interpretedOperators(await (await reopen(result.data)).getPage(1));
    expect(operators.segments).toHaveLength(1);
    expect(operators.segments[0]).toEqualSegment(anchor, end);
  });

  it('exports highlighter geometry, width, opacity and Multiply blend mode', async () => {
    const result = await exportAnnotatedPdf(await createSource({}), mapOf(highlight()));
    const page = await (await reopen(result.data)).getPage(1);
    const operators = await interpretedOperators(page);
    expect(operators.segments).toContainEqualSegment(anchor, end);
    expect(operators.lineWidths).toContain(18);
    expect(operators.gStates.length).toBeGreaterThan(0);
    expect(JSON.stringify(operators.gStates)).toContain('["BM","multiply"]');
  });

  it('exports a 3+ point highlighter as a smoothed path using Multiply blend mode', async () => {
    const annotation = {
      ...highlight(),
      points: [point(anchor), point({ x: 185, y: 300 }), point(end)],
    };
    const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 90 }), mapOf(annotation));
    const operators = await interpretedOperators(await (await reopen(result.data)).getPage(1));
    expect(operators.segments.length).toBeGreaterThan(2);
    expect(operators.segments[0].start).toSatisfy((value: Point) => closePoint(value, anchor));
    expect(operators.segments.at(-1)?.end).toSatisfy((value: Point) => closePoint(value, end));
    expect(operators.lineWidths).toContain(18);
    expect(JSON.stringify(operators.gStates)).toContain('["BM","multiply"]');
  });

  it.each(['line', 'arrow', 'rectangle', 'ellipse', 'roundedRect'] as const)(
    'reopens exported %s shape with non-empty drawing operators',
    async (shapeKind) => {
      const result = await exportAnnotatedPdf(
        await createSource({ intrinsicRotation: 90 }),
        mapOf(shape(shapeKind)),
      );
      const reopened = await reopen(result.data);
      const page = await reopened.getPage(1);
      const operators = await interpretedOperators(page);
      expect(page.rotate).toBe(90);
      expect(operators.pathPointCount).toBeGreaterThan(1);
      expect(operators.lineWidths).toContain(3);
      expect(operators.strokeColors).toContainEqual([51, 102, 153]);
    },
  );

  it('exports rectangle dimensions, fill and opacity without viewport scaling', async () => {
    const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 270 }), mapOf(shape('rectangle')));
    const operators = await interpretedOperators(await (await reopen(result.data)).getPage(1));
    expect(operators.pathBounds).toContainEqual({ x: 125, y: 210, width: 120, height: 120 });
    expect(operators.fillColors).toContainEqual([204, 221, 238]);
    expect(operators.gStates.length).toBeGreaterThan(0);
  });

  it('exports ellipse bounds without swapping dimensions on rotated pages', async () => {
    const annotation = shape('ellipse', { x: 100, y: 200 }, { x: 260, y: 280 });
    const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 90 }), mapOf(annotation));
    const operators = await interpretedOperators(await (await reopen(result.data)).getPage(1));
    expect(operators.pathBounds).toContainEqual({ x: 100, y: 200, width: 160, height: 80 });
  });

  it('keeps arrowhead length in PDF points on a rotated page', async () => {
    const annotation = shape('arrow', { x: 100, y: 200 }, { x: 200, y: 200 });
    const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 270 }), mapOf(annotation));
    const operators = await interpretedOperators(await (await reopen(result.data)).getPage(1));
    const wings = operators.segments.filter((segment) => closePoint(segment.start, annotation.endPoint));
    expect(wings).toHaveLength(2);
    for (const wing of wings) {
      expect(Math.hypot(wing.end.x - wing.start.x, wing.end.y - wing.start.y)).toBeCloseTo(12, 5);
    }
  });

  it('exports a true rounded rectangle at canonical PDF bounds', async () => {
    const annotation = shape('roundedRect', { x: 100, y: 200 }, { x: 260, y: 280 });
    const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 180 }), mapOf(annotation));
    const operators = await interpretedOperators(await (await reopen(result.data)).getPage(1));
    expect(operators.pathBounds).toContainEqual({ x: 100, y: 200, width: 160, height: 80 });
  });

  it('exports multiline aligned text, background and baseline inside canonical bounds', async () => {
    const annotation = text();
    const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 90 }), mapOf(annotation));
    const page = await (await reopen(result.data)).getPage(1);
    const content = await page.getTextContent();
    const items = content.items.filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item);

    const visibleItems = items.filter((item) => item.str.length > 0);
    expect(visibleItems.map((item) => item.str)).toEqual(['First line', 'Second line']);
    for (const item of visibleItems) {
      expect(item.transform[4]).toBeGreaterThanOrEqual(annotation.bounds.x);
      expect(item.transform[4]).toBeLessThanOrEqual(annotation.bounds.x + annotation.bounds.width);
      expect(item.transform[5]).toBeGreaterThanOrEqual(annotation.bounds.y);
      expect(item.transform[5]).toBeLessThanOrEqual(annotation.bounds.y + annotation.bounds.height);
    }
    const operators = await interpretedOperators(page);
    expect(operators.pathBounds).toContainEqual(annotation.bounds);
    expect(operators.fillColors).toEqual(expect.arrayContaining([[221, 238, 255], [34, 68, 102]]));
    expect(operators.gStates.length).toBeGreaterThan(0);
    expect(visibleItems[0].transform[0]).toBeCloseTo(annotation.fontSize, 5);
  });

  it('preserves left, center and right text alignment ordering', async () => {
    const positions: number[] = [];
    for (const align of ['left', 'center', 'right'] as const) {
      const annotation = { ...text(), content: 'Aligned', align, backgroundColor: 'transparent' };
      const result = await exportAnnotatedPdf(await createSource({ intrinsicRotation: 270 }), mapOf(annotation));
      const content = await (await (await reopen(result.data)).getPage(1)).getTextContent();
      const item = content.items.find((candidate): candidate is typeof candidate & { str: string; transform: number[] } =>
        'str' in candidate && candidate.str === 'Aligned');
      if (!item) throw new Error(`Missing ${align} text item`);
      positions.push(item.transform[4]);
    }
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  });
});

describe('annotation exporter safety contract', () => {
  it('returns a typed error instead of silently dropping an invalid annotation', async () => {
    const invalid = { ...shape('line'), strokeWidth: Number.NaN };
    await expect(exportAnnotatedPdf(await createSource({}), mapOf(invalid))).rejects.toMatchObject({
      name: 'AnnotationExportError',
      code: 'INVALID_ANNOTATION',
      annotationId: invalid.id,
      pageIndex: 0,
    });
  });

  it('rejects annotation pages outside the source PDF', async () => {
    const annotations: DocumentAnnotations = new Map([[4, [{ ...shape('line'), pageIndex: 4 }]]]);
    await expect(exportAnnotatedPdf(await createSource({}), annotations)).rejects.toBeInstanceOf(AnnotationExportError);
  });

  it('rejects invalid colors instead of silently exporting black', async () => {
    const invalid = { ...shape('rectangle'), color: 'not-a-color' };
    await expect(exportAnnotatedPdf(await createSource({}), mapOf(invalid))).rejects.toMatchObject({
      code: 'INVALID_ANNOTATION',
      annotationId: invalid.id,
    });
  });

  it('rejects unsupported runtime annotation types with identity context', async () => {
    const unsupported = { ...base('stamp'), id: 'future-stamp' } as unknown as Annotation;
    await expect(exportAnnotatedPdf(await createSource({}), mapOf(unsupported))).rejects.toMatchObject({
      name: 'AnnotationExportError',
      code: 'INVALID_ANNOTATION',
      annotationId: 'future-stamp',
      pageIndex: 0,
    });
  });

  it('reports exactly the annotations serialized across pages', async () => {
    const sourceDocument = await PDFDocument.create();
    sourceDocument.addPage([600, 800]);
    sourceDocument.addPage([600, 800]);
    const second = { ...highlight(), id: 'highlight-page-2', pageIndex: 1 };
    const annotations: DocumentAnnotations = new Map([[0, [stroke(), text()]], [1, [second]]]);
    const result = await exportAnnotatedPdf(await sourceDocument.save(), annotations);
    expect(result).toMatchObject({ pageCount: 2, annotationCount: 3 });
    const reopened = await reopen(result.data);
    expect(reopened.numPages).toBe(2);
    await expect(reopened.getPage(1).then((page) => page.getOperatorList())).resolves.toBeDefined();
    await expect(reopened.getPage(2).then((page) => page.getOperatorList())).resolves.toBeDefined();
  });

  it('does not mutate source bytes or annotation objects', async () => {
    const source = await createSource({});
    const originalBytes = source.slice();
    const annotation = stroke();
    const originalAnnotation = structuredClone(annotation);
    await exportAnnotatedPdf(source, mapOf(annotation));
    expect(source).toEqual(originalBytes);
    expect(annotation).toEqual(originalAnnotation);
  });

  it('creates a deep annotation snapshot detached from store mutations', () => {
    const annotation = stroke();
    const state: DocumentAnnotationState = {
      pages: new Map([[0, { pageIndex: 0, annotations: [annotation] }]]),
    };
    const snapshot = buildAnnotationsMap(state);
    annotation.points[0].x = 999;
    annotation.color = '#ffffff';
    expect(snapshot.get(0)?.[0]).toMatchObject({ color: '#112233' });
    expect((snapshot.get(0)?.[0] as StrokeAnnotation).points[0].x).toBe(anchor.x);
  });

  it('rejects re-flattening an already exported source with the same live annotation set', async () => {
    const annotations = mapOf(shape('line'));
    const first = await exportAnnotatedPdf(await createSource({}), annotations);
    await expect(exportAnnotatedPdf(first.data, annotations)).rejects.toMatchObject({
      name: 'AnnotationExportError',
      code: 'SOURCE_ALREADY_FLATTENED',
    });
  });
});

async function createSource(options: {
  intrinsicRotation?: QuarterTurn;
  media?: Box;
  crop?: Box;
}): Promise<Uint8Array> {
  const intrinsicRotation = options.intrinsicRotation ?? 0;
  const media = options.media ?? box(0, 0, 600, 800);
  const crop = options.crop ?? media;
  const document = await PDFDocument.create();
  const page = document.addPage([media.width, media.height]);
  page.setMediaBox(media.x, media.y, media.width, media.height);
  page.setCropBox(crop.x, crop.y, crop.width, crop.height);
  page.setRotation(degrees(intrinsicRotation));
  return document.save({ useObjectStreams: false });
}

async function reopen(data: Uint8Array): Promise<PDFDocumentProxy> {
  const document = await pdfjs.getDocument({ data: data.slice() }).promise;
  openDocuments.push(document);
  return document;
}

function mapOf(...annotations: Annotation[]): DocumentAnnotations {
  return new Map([[0, annotations]]);
}

function box(x: number, y: number, width: number, height: number): Box {
  return { x, y, width, height };
}

function base(type: string) {
  return {
    id: `${type}-1`, pageIndex: 0, type, color: '#112233', opacity: 0.6,
    locked: false, createdAt: 1, updatedAt: 1,
  } as const;
}

function point(value: Point, pressure = 0.5) {
  return { ...value, pressure, timestamp: 1 };
}

function stroke(pressure = false): StrokeAnnotation {
  return {
    ...base('stroke'), type: 'stroke',
    points: pressure
      ? [point(anchor, 0), point({ x: 185, y: 270 }, 1), point(end, 0.5)]
      : [point(anchor), point(end)],
    width: 5, smooth: false, pressure,
  };
}

function highlight(): HighlightAnnotation {
  return {
    ...base('highlight'), type: 'highlight', color: '#ffee00', opacity: 0.35,
    points: [point(anchor), point(end)], width: 18,
  };
}

function text(): TextAnnotation {
  return {
    ...base('text'), type: 'text', color: '#224466', opacity: 0.75,
    bounds: { x: 140, y: 240, width: 180, height: 100 },
    content: 'First line\nSecond line', fontSize: 14, fontFamily: 'Inter',
    bold: true, italic: false, underline: true, align: 'center',
    backgroundColor: '#ddeeff',
  };
}

function shape(kind: ShapeAnnotation['shapeKind'], startPoint: Point = anchor, endPoint: Point = end): ShapeAnnotation {
  return {
    ...base('shape'), id: `shape-${kind}`, type: 'shape', shapeKind: kind,
    color: '#336699', startPoint, endPoint, strokeWidth: 3,
    fillColor: kind === 'line' || kind === 'arrow' ? 'transparent' : '#ccddee',
    cornerRadius: kind === 'roundedRect' ? 12 : undefined,
  };
}

async function legacyExportCall(
  source: Uint8Array,
  annotations: DocumentAnnotations,
  legacyDisplayRotations: Record<number, number>,
) {
  return (exportAnnotatedPdf as unknown as (
    data: Uint8Array,
    values: DocumentAnnotations,
    legacy: Record<number, number>,
  ) => ReturnType<typeof exportAnnotatedPdf>)(source, annotations, legacyDisplayRotations);
}

async function firstPaintedSegment(page: PDFPageProxy) {
  const operators = await interpretedOperators(page);
  if (!operators.segments[0]) throw new Error('No painted segment found');
  return operators.segments[0];
}

async function interpretedOperators(page: PDFPageProxy) {
  const list = await page.getOperatorList();
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const segments: Array<{ start: Point; end: Point }> = [];
  const pathBounds: Array<{ x: number; y: number; width: number; height: number }> = [];
  const lineWidths: number[] = [];
  const strokeColors: number[][] = [];
  const fillColors: number[][] = [];
  const gStates: unknown[] = [];
  let pathPointCount = 0;

  for (let index = 0; index < list.fnArray.length; index++) {
    const operation = list.fnArray[index];
    const args = list.argsArray[index] as any;
    if (operation === pdfjs.OPS.save) stack.push([...ctm] as Matrix);
    else if (operation === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (operation === pdfjs.OPS.transform) ctm = multiply(ctm, args as Matrix);
    else if (operation === pdfjs.OPS.setLineWidth) lineWidths.push(args[0]);
    else if (operation === pdfjs.OPS.setStrokeRGBColor) strokeColors.push(Array.from(args));
    else if (operation === pdfjs.OPS.setFillRGBColor) fillColors.push(Array.from(args));
    else if (operation === pdfjs.OPS.setGState) gStates.push(args);
    else if (operation === pdfjs.OPS.constructPath) {
      const coordinates = args[1] as number[];
      const points: Point[] = [];
      for (let offset = 0; offset < coordinates.length; offset += 2) {
        points.push(applyMatrix(ctm, { x: coordinates[offset], y: coordinates[offset + 1] }));
      }
      if (points.length > 1) {
        const first = points[0];
        const last = points[points.length - 1];
        segments.push({ start: first, end: last });
        const xs = points.map((value) => value.x);
        const ys = points.map((value) => value.y);
        pathBounds.push({
          x: Math.min(...xs), y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        });
        pathPointCount += points.length;
      }
    }
  }

  return { segments, pathBounds, lineWidths, strokeColors, fillColors, gStates, pathPointCount };
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function applyMatrix(matrix: Matrix, pointValue: Point): Point {
  return {
    x: matrix[0] * pointValue.x + matrix[2] * pointValue.y + matrix[4],
    y: matrix[1] * pointValue.x + matrix[3] * pointValue.y + matrix[5],
  };
}

expect.extend({
  toEqualSegment(received: { start: Point; end: Point }, expectedStart: Point, expectedEnd: Point) {
    const pass = closePoint(received.start, expectedStart) && closePoint(received.end, expectedEnd);
    return { pass, message: () => `expected ${JSON.stringify(received)} to equal segment ${JSON.stringify({ start: expectedStart, end: expectedEnd })}` };
  },
  toContainEqualSegment(received: Array<{ start: Point; end: Point }>, expectedStart: Point, expectedEnd: Point) {
    const pass = received.some((segment) => closePoint(segment.start, expectedStart) && closePoint(segment.end, expectedEnd));
    return { pass, message: () => `expected segments ${JSON.stringify(received)} to contain ${JSON.stringify({ start: expectedStart, end: expectedEnd })}` };
  },
});

function closePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) < 0.01 && Math.abs(left.y - right.y) < 0.01;
}

declare module 'vitest' {
  interface Assertion<T = any> {
    toEqualSegment(start: Point, end: Point): T;
    toContainEqualSegment(start: Point, end: Point): T;
  }
}
