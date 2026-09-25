import { useDocumentStore } from '../store/documentStore';
import { useAnnotationStore } from '../store/annotationStore';
import { useHistoryStore, makeMutateDocumentBytesAction } from '../store/historyStore';
import { insertBlankPagesAfter, insertPdfPages } from '../document/documentMutator';
import { remapDocumentStateForInsertion, remapAnnotationsForInsertion } from '../pdf/pageRemap';
import { nanoid } from '../utils/nanoid';
import { generatePrintoutPages } from '../pdf/printoutGenerator';
import { useImportJobStore } from '../store/importJobStore';
import { useAssetStore } from '../store/assetStore';

let nextRequestId = 1;

export async function insertPdfPrintout(
  docId: string,
  printoutData: Uint8Array,
): Promise<boolean> {
  const docStore = useDocumentStore.getState();
  const activeDoc = docStore.documents.get(docId);
  if (!activeDoc) return false;

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
  const assetStore = useAssetStore.getState();
  const annotationStore = useAnnotationStore.getState();
  const historyStore = useHistoryStore.getState();

  let generatedPages: import('../pdf/printoutGenerator').PreparedPrintoutPage[] = [];

  try {
    generatedPages = await generatePrintoutPages({
      sourcePdfBytes: printoutData,
      signal: abortController.signal,
      onProgress: () => useImportJobStore.getState().incrementCompleted(),
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      // Handled by cancelJob
      return false;
    }
    console.error('Printout generation failed:', err);
    useImportJobStore.getState().updateStatus('failed', String(err));
    return false;
  }

  // Verification step
  useImportJobStore.getState().updateStatus('committing');
  const currentDocStore = useDocumentStore.getState();
  const currentDoc = currentDocStore.documents.get(docId);
  
  if (!currentDoc || currentDoc.instanceId !== targetIdentity.instanceId) {
    // Document was closed or reloaded differently. Discard.
    useImportJobStore.getState().clearJob();
    return false;
  }

  const beforeSourceData = currentDoc.sourceData;
  const beforePageCount = currentDoc.pageCount;
  const beforePageRotations = currentDoc.pageRotations;
  const beforeAnnotations = Array.from(annotationStore.docAnnotations.get(docId)?.pages.values() ?? [])
    .flatMap(p => p.annotations);

  const newAssetIds: string[] = [];

  try {
    // Register assets first
    for (const page of generatedPages) {
      assetStore.addAsset(targetIdentity, page.asset);
      newAssetIds.push(page.asset.id);
    }

    // Mutate bytes
    const pageSpecs = generatedPages.map(p => ({
      width: p.widthPdfPoints,
      height: p.heightPdfPoints,
    }));
    
    const mutatedBytes = await insertBlankPagesAfter(
      beforeSourceData,
      targetPageIndex,
      pageSpecs
    );

    // Remap state
    const afterDocState = remapDocumentStateForInsertion(currentDoc, targetPageIndex, generatedPages.length);
    let afterAnnotations = remapAnnotationsForInsertion(beforeAnnotations, targetPageIndex, generatedPages.length);

    // Add printout annotations
    const newAnnotations: import('../types/annotations').Annotation[] = [];
    for (let i = 0; i < generatedPages.length; i++) {
      const p = generatedPages[i];
      const insertedIndex = targetPageIndex + 1 + i;
      newAnnotations.push({
        id: nanoid(),
        type: 'image',
        pageIndex: insertedIndex,
        x: 0,
        y: 0,
        width: p.widthPdfPoints,
        height: p.heightPdfPoints,
        assetId: p.asset.id,
      } as import('../types/annotations').ImageAnnotation);
    }
    
    afterAnnotations = [...afterAnnotations, ...newAnnotations];

    // Apply remap immediately
    currentDocStore.updateDocument(docId, {
      sourceData: mutatedBytes,
      sourceRevision: currentDoc.sourceRevision + 1,
      pageCount: afterDocState.pageCount,
      activePageIndex: targetPageIndex + 1, // navigate to first inserted page
      pageRotations: afterDocState.pageRotations,
    });

    useAnnotationStore.setState((state) => {
      const docs = new Map(state.docAnnotations);
      const docState = docs.get(docId) ?? { pages: new Map() };
      
      const newDocState = { pages: new Map() };
      for (const ann of afterAnnotations) {
        if (!newDocState.pages.has(ann.pageIndex)) {
          newDocState.pages.set(ann.pageIndex, { pageIndex: ann.pageIndex, annotations: [] });
        }
        newDocState.pages.get(ann.pageIndex)!.annotations.push(ann);
      }
      docs.set(docId, newDocState);
      return { docAnnotations: docs };
    });

    historyStore.push(makeMutateDocumentBytesAction(
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
    setTimeout(() => useImportJobStore.getState().clearJob(), 2000);
    return true;
  } catch (error) {
    console.error('Commit failed, rolling back:', error);
    
    // Remove newly registered assets
    for (const assetId of newAssetIds) {
      assetStore.removeAsset(targetIdentity, assetId);
    }
    
    useImportJobStore.getState().updateStatus('failed', 'Commit failed');
    return false;
  }
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

export async function insertPptxPrintoutFromFile(): Promise<void> {
  const docStore = useDocumentStore.getState();
  const activeDocId = docStore.activeDocId;
  if (!activeDocId) return;

  const activeDoc = docStore.documents.get(activeDocId);
  if (!activeDoc) return;

  if (!window.electronAPI?.pptxIsAvailable) {
    console.error('PPTX conversion API is not available.');
    return;
  }

  const isAvailable = await window.electronAPI.pptxIsAvailable();
  if (!isAvailable) {
    console.error('LibreOffice is not installed or available for PPTX conversion.');
    return;
  }

  const targetIdentity = { docId: activeDocId, instanceId: activeDoc.instanceId };
  const targetPageIndex = activeDoc.activePageIndex;
  const requestId = nextRequestId++;
  const abortController = new AbortController();

  const importJobStore = useImportJobStore.getState();
  importJobStore.startJob(requestId, targetIdentity, targetPageIndex, abortController);
  importJobStore.updateStatus('converting');

  try {
    const result = await window.electronAPI.pptxStartConversion(requestId.toString());
    
    if (abortController.signal.aborted || !result) {
      if (!abortController.signal.aborted) importJobStore.clearJob();
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
      return;
    }
    console.error('PPTX Conversion failed:', error);
    importJobStore.updateStatus('failed', error instanceof Error ? error.message : String(error));
  }
}
