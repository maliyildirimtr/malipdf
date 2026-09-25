import { describe, expect, it, beforeEach } from 'vitest';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useAssetStore } from '../../store/assetStore';
import { useHistoryStore } from '../../store/historyStore';
import {
  createInsertTargetSnapshot,
  isInsertTargetValid,
  type InsertTargetSnapshot,
} from '../imageUtils';
import { insertImageFromBytes } from '../../commands/imageCommands';

describe('Async Insert Target Guard', () => {
  beforeEach(() => {
    useDocumentStore.setState({
      documents: new Map([
        [
          'doc-1',
          {
            id: 'doc-1',
            instanceId: 1,
            title: 'Doc 1',
            filePath: '/tmp/doc1.pdf',
            pageCount: 5,
            activePageIndex: 0,
            savedStateId: 's0',
            currentStateId: 's0',
            sourceFingerprint: 'f1',
          } as any,
        ],
        [
          'doc-2',
          {
            id: 'doc-2',
            instanceId: 1,
            title: 'Doc 2',
            filePath: '/tmp/doc2.pdf',
            pageCount: 3,
            activePageIndex: 1,
            savedStateId: 's0',
            currentStateId: 's0',
            sourceFingerprint: 'f2',
          } as any,
        ],
      ]),
      activeDocId: 'doc-1',
      tabOrder: ['doc-1', 'doc-2'],
    });

    useAnnotationStore.setState({ docAnnotations: new Map() });
    useHistoryStore.setState({ histories: new Map() });
    useAssetStore.setState({ docAssets: new Map() });
  });

  it('creates target snapshot reflecting active document and active page', () => {
    const snapshot = createInsertTargetSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.identity).toEqual({ docId: 'doc-1', instanceId: 1 });
    expect(snapshot?.pageIndex).toBe(0);
  });

  it('validates target snapshot when target document remains open and active', () => {
    const snapshot = createInsertTargetSnapshot();
    expect(isInsertTargetValid(snapshot)).toBe(true);
  });

  it('invalidates target when active document is closed before async returns', () => {
    const snapshot = createInsertTargetSnapshot();
    expect(isInsertTargetValid(snapshot)).toBe(true);

    // Close doc-1
    const docs = new Map(useDocumentStore.getState().documents);
    docs.delete('doc-1');
    useDocumentStore.setState({ documents: docs, activeDocId: 'doc-2' });

    // Target is now invalid
    expect(isInsertTargetValid(snapshot)).toBe(false);
  });

  it('invalidates target if document is reloaded with a new instanceId', () => {
    const snapshot = createInsertTargetSnapshot();

    // Reopen doc-1 with new instanceId
    const docs = new Map(useDocumentStore.getState().documents);
    const doc = docs.get('doc-1')!;
    docs.set('doc-1', { ...doc, instanceId: 2 });
    useDocumentStore.setState({ documents: docs });

    expect(isInsertTargetValid(snapshot)).toBe(false);
  });

  it('safely discards async insert when target document was closed during operation', async () => {
    // 1x1 PNG bytes
    const pngBytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0,
      1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0,
      1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]).buffer;

    // Start with doc-1
    expect(useDocumentStore.getState().activeDocId).toBe('doc-1');
    const snapshot = createInsertTargetSnapshot()!;
    expect(snapshot.identity.docId).toBe('doc-1');

    // Simulate closing doc-1 while operation is in-flight
    const docs = new Map(useDocumentStore.getState().documents);
    docs.delete('doc-1');
    useDocumentStore.setState({ documents: docs, activeDocId: 'doc-2' });

    // Target snapshot is now invalid
    expect(isInsertTargetValid(snapshot)).toBe(false);

    // Attempting insert with closed document returns false
    useDocumentStore.setState({ activeDocId: null });
    const result = await insertImageFromBytes(pngBytes, 'image/png');

    expect(result).toBe(false);
    expect(useAnnotationStore.getState().getPageAnnotations('doc-1', 0).length).toBe(0);
    expect(useAnnotationStore.getState().getPageAnnotations('doc-2', 0).length).toBe(0);
  });
});
