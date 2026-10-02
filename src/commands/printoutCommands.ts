import { useTaskProgressStore } from '../store/taskProgressStore';
import { useDocumentStore } from '../store/documentStore';
import { notifyUser } from '../utils/notify';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore, makeMutateDocumentBytesAction } from '../store/historyStore';
import { displayedPageSize, fitPrintoutToPage, insertBlankPagesAfter, type PrintoutPlacement } from '../document/documentMutator';
import type { Annotation, DocumentAnnotationState, ImageAnnotation } from '../types/annotations';
import { remapDocumentStateForInsertion, remapAnnotationsForInsertion } from '../pdf/pageRemap';
import { nanoid } from '../utils/nanoid';
import { generatePrintoutPages } from '../pdf/printoutGenerator';
import { useImportJobStore } from '../store/importJobStore';
import { useAssetStore } from '../store/assetStore';

let nextRequestId = 1;

/** True while a printout import is still running (only one job at a time). */
function isImportBusy(): boolean {
  const status = useImportJobStore.getState().job?.status;
  return status !== undefined && status !== 'completed' && status !== 'cancelled' && status !== 'failed';
}

export async function insertPdfPrintout(
  docId: string,
  printoutData: Uint8Array,
): Promise<boolean> {
  const docStore = useDocumentStore.getState();
  const activeDoc = docStore.documents.get(docId);
  if (!activeDoc || isImportBusy()) return false;

  const targetIdentity = { docId, instanceId: activeDoc.instanceId };
  const targetPageIndex = activeDoc.activePageIndex;
  const requestId = nextRequestId++;
  const abortController = new AbortController();

  const importJobStore = useImportJobStore.getState();
  importJobStore.startJob(requestId, targetIdentity, targetPageIndex, abortController);

  return runPrintoutPipeline(
    docId,
    printoutData,
    targetIdentity,
    targetPageIndex,
    requestId,
    abortController
  );
}

async function runPrintoutPipeline(
  docId: string,
  printoutData: Uint8Array,
  targetIdentity: { docId: string, instanceId: number },
  targetPageIndex: number,
  requestId: number,
  abortController: AbortController
): Promise<boolean> {
  let generatedPages: import('../pdf/printoutGenerator').PreparedPrintoutPage[] = [];

  try {
    generatedPages = await generatePrintoutPages({
      sourcePdfBytes: printoutData,
      signal: abortController.signal,
      onTotalPages: (total) => useImportJobStore.getState().setTotalPages(total),
      onProgress: () => useImportJobStore.getState().incrementCompleted(),
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      // cancelJob already marked the job; remove the overlay shortly after.
      scheduleJobClear(requestId);
      return false;
    }
    console.error('Printout generation failed:', err);
    useImportJobStore.getState().updateStatus('failed', err instanceof Error ? err.message : String(err));
    return false;
  }

  useImportJobStore.getState().updateStatus('committing');

  const initialDoc = useDocumentStore.getState().documents.get(docId);
  if (!initialDoc || initialDoc.instanceId !== targetIdentity.instanceId) {
    // Document was closed or replaced while rendering. Discard.
    useImportJobStore.getState().clearJob();
    return false;
  }

  // Page insertion is based on the bytes as they are right now.
  const baseSourceData = initialDoc.sourceData;
  const insertAfter = Math.min(targetPageIndex, initialDoc.pageCount - 1);

  let mutatedBytes: Uint8Array;
  let placements: PrintoutPlacement[];
  try {
    const target = await displayedPageSize(baseSourceData, insertAfter);
    placements = fitPrintoutToPage(
      generatedPages.map(p => ({ width: p.widthPdfPoints, height: p.heightPdfPoints })),
      target,
    );
    mutatedBytes = await insertBlankPagesAfter(baseSourceData, insertAfter, placements.map(p => p.page));
  } catch (error) {
    console.error('Printout page insertion failed:', error);
    useImportJobStore.getState().updateStatus('failed', error instanceof Error ? error.message : String(error));
    return false;
  }

  // ── Synchronous commit section: re-read every store AFTER the last await ──
  const currentDoc = useDocumentStore.getState().documents.get(docId);
  if (!currentDoc || currentDoc.instanceId !== targetIdentity.instanceId) {
    useImportJobStore.getState().clearJob();
    return false;
  }
  if (currentDoc.sourceData !== baseSourceData) {
    // Another page mutation (or undo/redo of one) happened meanwhile; the
    // computed bytes would silently drop it.
    useImportJobStore.getState().updateStatus('failed', 'The document changed while the printout was being inserted. Please try again.');
    return false;
  }

  const beforeSourceData = currentDoc.sourceData;
  const beforePageCount = currentDoc.pageCount;
  const beforePageRotations = currentDoc.pageRotations;
  const beforeAnnotations = Array.from(
    useAnnotationStore.getState().docAnnotations.get(docId)?.pages.values() ?? [],
  ).flatMap(p => p.annotations);

  const afterDocState = remapDocumentStateForInsertion(currentDoc, insertAfter, generatedPages.length);
  const now = Date.now();
  const newAnnotations: ImageAnnotation[] = generatedPages.map((p, i) => ({
    id: nanoid(),
    type: 'image',
    pageIndex: insertAfter + 1 + i,
    color: '#000000',
    opacity: 1,
    locked: false,
    createdAt: now,
    updatedAt: now,
    x: placements[i].image.x,
    y: placements[i].image.y,
    width: placements[i].image.width,
    height: placements[i].image.height,
    assetId: p.asset.id,
  }));
  const afterAnnotations: Annotation[] = [
    ...remapAnnotationsForInsertion(beforeAnnotations, insertAfter, generatedPages.length),
    ...newAnnotations,
  ];

  const assetStore = useAssetStore.getState();
  for (const page of generatedPages) {
    assetStore.addAsset(targetIdentity, page.asset);
  }

  useDocumentStore.getState().updateDocument(docId, {
    sourceData: mutatedBytes,
    sourceRevision: currentDoc.sourceRevision + 1,
    pageCount: afterDocState.pageCount,
    activePageIndex: insertAfter + 1, // navigate to first inserted page
    pageRotations: afterDocState.pageRotations,
  });

  useAnnotationStore.setState((state) => {
    const docs = new Map(state.docAnnotations);
    docs.set(docId, groupByPage(afterAnnotations));
    return { docAnnotations: docs };
  });

  useHistoryStore.getState().push(makeMutateDocumentBytesAction(
    docId,
    beforeSourceData,
    mutatedBytes,
    beforeAnnotations,
    afterAnnotations,
    beforePageRotations,
    afterDocState.pageRotations,
    beforePageCount,
    afterDocState.pageCount,
  ));

  useImportJobStore.getState().updateStatus('completed');
  scheduleJobClear(requestId);
  // Show the first inserted page once it is laid out.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      void import('./bookmarkCommands').then(({ goToPage }) => goToPage(docId, insertAfter + 1));
    }));
  }
  return true;
}

function groupByPage(annotations: readonly Annotation[]): DocumentAnnotationState {
  const pages = new Map<number, { pageIndex: number; annotations: Annotation[] }>();
  for (const ann of annotations) {
    let page = pages.get(ann.pageIndex);
    if (!page) {
      page = { pageIndex: ann.pageIndex, annotations: [] };
      pages.set(ann.pageIndex, page);
    }
    page.annotations.push(ann);
  }
  return { pages };
}

/** Clears the overlay after a short delay, unless a newer job replaced it. */
function scheduleJobClear(requestId: number, delayMs = 2000): void {
  setTimeout(() => {
    const store = useImportJobStore.getState();
    if (store.job?.requestId === requestId) store.clearJob();
  }, delayMs);
}

export async function insertPrintoutFromFile(): Promise<void> {
  const docStore = useDocumentStore.getState();
  const activeDocId = docStore.activeDocId;
  if (!activeDocId) return;

  const files = await window.electronAPI.openFile();
  if (files && files.length > 0 && files[0].data) {
    await insertPdfPrintout(activeDocId, new Uint8Array(files[0].data));
  }
}

/** Shown when the converter is missing; the import panel offers a download button for it. */
export const LIBREOFFICE_MISSING_MESSAGE =
  'LibreOffice (free) is needed to convert PowerPoint files and was not found. Install it, then try again — no restart needed.';

export function insertPptxPrintoutFromFile(): Promise<void> {
  return runPptxImport((jobId) => window.electronAPI.pptxStartConversion(jobId));
}

/** Presentation files LibreOffice can turn into PDF printout pages. */
export function isPresentationFile(name: string): boolean {
  return /\.(pptx|ppt|odp)$/i.test(name);
}

export const MAX_DROPPED_PRESENTATION_BYTES = 300 * 1024 * 1024;

/** Drag & drop: convert a dropped presentation and insert it as printout pages. */
export function insertPptxPrintoutFromBytes(data: ArrayBuffer, name: string): Promise<void> {
  return runPptxImport((jobId) => {
    if (!window.electronAPI?.pptxConvertBytes) {
      throw new Error('PowerPoint import by drag and drop needs the updated app (rebuild the Electron main process).');
    }
    if (data.byteLength > MAX_DROPPED_PRESENTATION_BYTES) {
      throw new Error('The presentation is larger than 300 MB.');
    }
    return window.electronAPI.pptxConvertBytes(jobId, data, name);
  });
}

/** Word, Excel, PowerPoint and OpenDocument files LibreOffice can turn into PDF. */
export function isOfficeFile(name: string): boolean {
  return /\.(pptx|ppt|odp|docx|doc|odt|rtf|xlsx|xls|ods)$/i.test(name);
}

/** Convert an Office file to PDF bytes with LibreOffice; null when LibreOffice is missing (the user was told). */
export async function convertOfficeToPdf(data: ArrayBuffer, name: string): Promise<ArrayBuffer | null> {
  const api = window.electronAPI;
  if (!api?.pptxConvertBytes || !api.pptxIsAvailable) {
    throw new Error('Converting Office files needs the desktop app.');
  }
  if (data.byteLength > MAX_DROPPED_PRESENTATION_BYTES) throw new Error('The file is larger than 300 MB.');
  if (!(await api.pptxIsAvailable())) {
    if (api.officePromptLibreOffice) await api.officePromptLibreOffice();
    else notifyUser('error', LIBREOFFICE_MISSING_MESSAGE);
    return null;
  }
  const jobId = `office-${Date.now().toString(36)}`;
  const taskId = useTaskProgressStore.getState().start(`Converting "${name}" to PDF…`, 0);
  // Cancel in the progress panel stops LibreOffice.
  const stop = useTaskProgressStore.subscribe((state) => {
    if (state.task?.id === taskId && state.task.cancelled) void api.pptxCancelConversion?.(jobId).catch(() => {});
  });
  try {
    const result = await api.pptxConvertBytes(jobId, data, name);
    if (useTaskProgressStore.getState().isCancelled(taskId)) return null;
    return result.buffer;
  } catch (error) {
    if (useTaskProgressStore.getState().isCancelled(taskId)) return null;
    throw error;
  } finally {
    stop();
    useTaskProgressStore.getState().finish(taskId);
  }
}

/** Convert an Office file and open it as a new PDF document. */
export async function openOfficeAsDocument(data: ArrayBuffer, name: string): Promise<void> {
  try {
    const pdf = await convertOfficeToPdf(data, name);
    if (!pdf) return;
    const { openDocumentBytes } = await import('../document/openDocumentBytes');
    await openDocumentBytes(name.replace(/\.[^.]+$/, '.pdf'), null, pdf);
  } catch (error) {
    notifyUser('error', `"${name}" could not be converted: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** No document open: convert a dropped presentation and open it as a new PDF. */
export const openPresentationAsDocument = openOfficeAsDocument;

/** A document is open: convert a Word/Excel file and insert its pages (real pages, like a PDF). */
export async function insertOfficePagesFromBytes(data: ArrayBuffer, name: string): Promise<void> {
  try {
    const pdf = await convertOfficeToPdf(data, name);
    if (!pdf) return;
    const { insertPdfPages } = await import('./pageCommands');
    await insertPdfPages(new Uint8Array(pdf), name.replace(/\.[^.]+$/, '.pdf'));
  } catch (error) {
    notifyUser('error', `"${name}" could not be converted: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** File ▸ Open Word, Excel or PowerPoint File… */
export async function openOfficeFileDialog(): Promise<void> {
  const files = await window.electronAPI?.openFile?.('office');
  if (!files) return;
  for (const file of files) await openOfficeAsDocument(file.data, file.name);
}

async function runPptxImport(
  convert: (jobId: string) => Promise<{ buffer: ArrayBuffer; name: string } | null>,
): Promise<void> {
  const docStore = useDocumentStore.getState();
  const activeDocId = docStore.activeDocId;
  if (!activeDocId) return;

  const activeDoc = docStore.documents.get(activeDocId);
  if (!activeDoc || isImportBusy()) return;

  const targetIdentity = { docId: activeDocId, instanceId: activeDoc.instanceId };
  const targetPageIndex = activeDoc.activePageIndex;
  const requestId = nextRequestId++;
  const abortController = new AbortController();

  const importJobStore = useImportJobStore.getState();
  importJobStore.startJob(requestId, targetIdentity, targetPageIndex, abortController);

  if (!window.electronAPI?.pptxIsAvailable) {
    importJobStore.updateStatus('failed', 'PowerPoint import is not available in this build. Rebuild the Electron main process (npm run build:electron).');
    return;
  }

  let isAvailable = false;
  try {
    isAvailable = await window.electronAPI.pptxIsAvailable();
  } catch {
    isAvailable = false;
  }
  if (!isAvailable) {
    useImportJobStore.getState().updateStatus('failed', LIBREOFFICE_MISSING_MESSAGE);
    return;
  }
  if (abortController.signal.aborted) {
    scheduleJobClear(requestId);
    return;
  }

  useImportJobStore.getState().updateStatus('converting');

  try {
    const result = await convert(requestId.toString());
    
    if (abortController.signal.aborted || !result) {
      if (abortController.signal.aborted) scheduleJobClear(requestId);
      else useImportJobStore.getState().clearJob();
      return;
    }

    const pdfData = new Uint8Array(result.buffer);
    
    await runPrintoutPipeline(
      activeDocId,
      pdfData,
      targetIdentity,
      targetPageIndex,
      requestId,
      abortController
    );
  } catch (error) {
    if (abortController.signal.aborted) {
      scheduleJobClear(requestId);
      return;
    }
    console.error('PPTX Conversion failed:', error);
    useImportJobStore.getState().updateStatus('failed', error instanceof Error ? error.message : String(error));
  }
}
