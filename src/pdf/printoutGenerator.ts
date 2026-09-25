import { loadPdfDocument, loadPage, renderPage } from './renderer';
import { calculatePrintoutRasterSize } from './printoutRasterSize';
import { nanoid } from '../utils/nanoid';
import type { ImageAsset } from '../store/assetStore';

export const PRINT_OUT_TARGET_DPI = 144;
export const PRINT_OUT_MAX_PIXEL_AREA = 16000000;
export const PRINT_OUT_RENDER_CONCURRENCY = 2;

export interface PreparedPrintoutPage {
  sourcePageIndex: number;
  widthPdfPoints: number;
  heightPdfPoints: number;
  rasterWidth: number;
  rasterHeight: number;
  asset: ImageAsset;
}

export interface PrintoutGeneratorOptions {
  sourcePdfBytes: Uint8Array;
  signal: AbortSignal;
  onProgress?: () => void;
  onTotalPages?: (total: number) => void;
}

export async function generatePrintoutPages({
  sourcePdfBytes,
  signal,
  onProgress,
  onTotalPages,
}: PrintoutGeneratorOptions): Promise<PreparedPrintoutPage[]> {
  if (signal.aborted) throw new Error('Printout import cancelled');

  const pdfDoc = await loadPdfDocument(sourcePdfBytes);
  const totalPages = pdfDoc.numPages;
  onTotalPages?.(totalPages);

  try {
    const results: PreparedPrintoutPage[] = new Array(totalPages);
    let currentIndex = 0;
    
    // Process queue with bounded concurrency
    const workers = Array.from({ length: PRINT_OUT_RENDER_CONCURRENCY }).map(
      async () => {
        while (true) {
          if (signal.aborted) throw new Error('Printout import cancelled');
          
          const pageIndex = currentIndex++;
          if (pageIndex >= totalPages) break;

          // Render the single page
          const preparedPage = await generateSinglePage(pdfDoc, pageIndex, signal);
          
          if (signal.aborted) throw new Error('Printout import cancelled');

          results[pageIndex] = preparedPage;
          if (onProgress) onProgress();
        }
      }
    );

    await Promise.all(workers);
    return results;
  } finally {
    // ALWAYS destroy the PDF.js document to free resources
    await pdfDoc.destroy();
  }
}

async function generateSinglePage(
  pdfDoc: import('pdfjs-dist').PDFDocumentProxy,
  pageIndex: number,
  signal: AbortSignal
): Promise<PreparedPrintoutPage> {
  if (signal.aborted) throw new Error('Printout import cancelled');

  const loadedPage = await loadPage(pdfDoc, pageIndex);
  
  // Use scale=1 to get the actual visible page dimensions (including CropBox)
  const viewport = loadedPage.viewport;
  const widthPdfPoints = viewport.width;
  const heightPdfPoints = viewport.height;

  const { widthPx, heightPx, effectiveDpi } = calculatePrintoutRasterSize({
    widthPdfPoints,
    heightPdfPoints,
    targetDpi: PRINT_OUT_TARGET_DPI,
    maxPixelArea: PRINT_OUT_MAX_PIXEL_AREA,
  });

  const canvas = document.createElement('canvas');
  try {
    if (signal.aborted) throw new Error('Printout import cancelled');

    const renderScale = effectiveDpi / 72; // Since PDF.js scale=1 is 72DPI
    const renderViewport = loadedPage.page.getViewport({ scale: renderScale });

    canvas.width = Math.round(renderViewport.width);
    canvas.height = Math.round(renderViewport.height);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context for printout render');

    const renderTask = loadedPage.page.render({
      canvasContext: ctx,
      viewport: renderViewport,
    });

    // Check for cancellation inside render
    const cancelRender = () => renderTask.cancel();
    signal.addEventListener('abort', cancelRender);
    try {
      await renderTask.promise;
    } finally {
      signal.removeEventListener('abort', cancelRender);
    }

    if (signal.aborted) throw new Error('Printout import cancelled');

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))), 'image/png');
    });

    const buffer = await blob.arrayBuffer();
    const assetId = nanoid();

    const asset: ImageAsset = {
      id: assetId,
      mimeType: 'image/png',
      data: new Uint8Array(buffer),
      width: widthPx,
      height: heightPx,
    };

    return {
      sourcePageIndex: pageIndex,
      widthPdfPoints,
      heightPdfPoints,
      rasterWidth: widthPx,
      rasterHeight: heightPx,
      asset,
    };
  } finally {
    // Release canvas memory aggressively
    canvas.width = 0;
    canvas.height = 0;
  }
}
