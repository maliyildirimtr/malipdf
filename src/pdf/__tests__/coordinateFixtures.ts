import { degrees, PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PdfBox, QuarterTurn } from '../coordinateTransform';

export interface CoordinateFixtureDefinition {
  name: string;
  mediaBox: PdfBox;
  cropBox: PdfBox;
}

export interface LoadedCoordinateFixture {
  definition: CoordinateFixtureDefinition;
  document: PDFDocumentProxy;
  page: PDFPageProxy;
}

export const COORDINATE_FIXTURES: CoordinateFixtureDefinition[] = [
  {
    name: 'letter-full-box',
    mediaBox: box(0, 0, 612, 792),
    cropBox: box(0, 0, 612, 792),
  },
  {
    name: 'letter-inset-crop',
    mediaBox: box(0, 0, 612, 792),
    cropBox: box(36, 72, 576, 720),
  },
  {
    name: 'offset-media-and-crop',
    mediaBox: box(-100, -50, 700, 950),
    cropBox: box(25, 40, 625, 840),
  },
  {
    name: 'landscape-offset-crop',
    mediaBox: box(0, 0, 842, 595),
    cropBox: box(20, 30, 800, 560),
  },
];

export function box(xMin: number, yMin: number, xMax: number, yMax: number): PdfBox {
  return {
    xMin,
    yMin,
    xMax,
    yMax,
    width: xMax - xMin,
    height: yMax - yMin,
  };
}

export async function loadCoordinateFixture(
  definition: CoordinateFixtureDefinition,
  intrinsicRotation: QuarterTurn,
): Promise<LoadedCoordinateFixture> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([definition.mediaBox.width, definition.mediaBox.height]);

  page.setMediaBox(
    definition.mediaBox.xMin,
    definition.mediaBox.yMin,
    definition.mediaBox.width,
    definition.mediaBox.height,
  );
  page.setCropBox(
    definition.cropBox.xMin,
    definition.cropBox.yMin,
    definition.cropBox.width,
    definition.cropBox.height,
  );
  page.setRotation(degrees(intrinsicRotation));

  const data = await pdf.save({ useObjectStreams: false });
  const loadingTask = pdfjs.getDocument({ data: data.slice(0) });
  const document = await loadingTask.promise;
  const pdfPage = await document.getPage(1);

  return {
    definition,
    document: document as PDFDocumentProxy,
    page: pdfPage as PDFPageProxy,
  };
}

export function expectedViewportPoint(
  pdfX: number,
  pdfY: number,
  cropBox: PdfBox,
  scale: number,
  rotation: QuarterTurn,
): { x: number; y: number } {
  switch (rotation) {
    case 0:
      return {
        x: (pdfX - cropBox.xMin) * scale,
        y: (cropBox.yMax - pdfY) * scale,
      };
    case 90:
      return {
        x: (pdfY - cropBox.yMin) * scale,
        y: (pdfX - cropBox.xMin) * scale,
      };
    case 180:
      return {
        x: (cropBox.xMax - pdfX) * scale,
        y: (pdfY - cropBox.yMin) * scale,
      };
    case 270:
      return {
        x: (cropBox.yMax - pdfY) * scale,
        y: (cropBox.xMax - pdfX) * scale,
      };
  }
}
