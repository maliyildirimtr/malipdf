import { type DocumentState, type Annotation } from '../types/annotations';

export function remapDocumentStateForInsertion(
  docState: DocumentState,
  insertAfterIndex: number,
  insertedPageCount: number,
): DocumentState {
  if (insertedPageCount <= 0) return docState;

  // Remap pageRotations
  const newRotations: Record<number, number> = {};
  for (const [key, value] of Object.entries(docState.pageRotations)) {
    const pageIndex = Number(key);
    if (pageIndex > insertAfterIndex) {
      newRotations[pageIndex + insertedPageCount] = value;
    } else {
      newRotations[pageIndex] = value;
    }
  }

  // Active page index shifts only if it was strictly after the insertion point
  let newActivePageIndex = docState.activePageIndex;
  if (newActivePageIndex > insertAfterIndex) {
    newActivePageIndex += insertedPageCount;
  }

  return {
    ...docState,
    pageCount: docState.pageCount + insertedPageCount,
    activePageIndex: newActivePageIndex,
    pageRotations: newRotations,
  };
}

export function remapAnnotationsForInsertion(
  annotations: ReadonlyArray<Annotation>,
  insertAfterIndex: number,
  insertedPageCount: number,
): Annotation[] {
  if (insertedPageCount <= 0) return [...annotations];

  return annotations.map((ann) => {
    if (ann.pageIndex > insertAfterIndex) {
      return {
        ...ann,
        pageIndex: ann.pageIndex + insertedPageCount,
      };
    }
    return ann;
  });
}
