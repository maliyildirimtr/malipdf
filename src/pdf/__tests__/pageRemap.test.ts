import { describe, it, expect } from 'vitest';
import { remapDocumentStateForInsertion, remapAnnotationsForInsertion } from '../pageRemap';
import { type DocumentState, type Annotation } from '../../types/annotations';

describe('pageRemap', () => {
  describe('remapDocumentStateForInsertion', () => {
    it('shifts pageRotations correctly', () => {
      const docState = {
        activePageIndex: 0,
        pageCount: 3,
        pageRotations: { 0: 90, 1: 180, 2: 270 },
        sourceRevision: 1,
      } as unknown as DocumentState;

      const remapped = remapDocumentStateForInsertion(docState, 0, 2);
      expect(remapped.pageCount).toBe(5);
      expect(remapped.activePageIndex).toBe(0);
      expect(remapped.pageRotations).toEqual({ 0: 90, 3: 180, 4: 270 });
    });

    it('shifts activePageIndex if it was after the insertion point', () => {
      const docState = {
        activePageIndex: 2,
        pageCount: 3,
        pageRotations: {},
      } as unknown as DocumentState;

      const remapped = remapDocumentStateForInsertion(docState, 0, 2);
      expect(remapped.activePageIndex).toBe(4);
    });

    it('does not shift activePageIndex if it is at the insertion point', () => {
      const docState = {
        activePageIndex: 1,
        pageCount: 3,
        pageRotations: {},
      } as unknown as DocumentState;

      const remapped = remapDocumentStateForInsertion(docState, 1, 2);
      expect(remapped.activePageIndex).toBe(1);
    });
  });

  describe('remapAnnotationsForInsertion', () => {
    it('shifts pageIndex of annotations correctly', () => {
      const annotations: Annotation[] = [
        { id: '1', pageIndex: 0 } as Annotation,
        { id: '2', pageIndex: 1 } as Annotation,
        { id: '3', pageIndex: 2 } as Annotation,
      ];

      const remapped = remapAnnotationsForInsertion(annotations, 0, 2);
      expect(remapped).toEqual([
        { id: '1', pageIndex: 0 },
        { id: '2', pageIndex: 3 },
        { id: '3', pageIndex: 4 },
      ]);
    });
  });
});
