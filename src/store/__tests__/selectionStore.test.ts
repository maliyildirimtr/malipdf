import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from '../selectionStore';
import type { DocumentIdentity } from '../../types/documentSession';

describe('selectionStore', () => {
  const identity1: DocumentIdentity = { docId: 'docA', instanceId: 1 };
  const identity2: DocumentIdentity = { docId: 'docA', instanceId: 2 };
  const identity3: DocumentIdentity = { docId: 'docB', instanceId: 1 };

  beforeEach(() => {
    // Reset store state
    useSelectionStore.setState({ docSelections: new Map() });
  });

  it('sets and gets selection for a specific identity', () => {
    const store = useSelectionStore.getState();
    store.selectAnnotation(identity1, 0, 'ann1');

    const sel = useSelectionStore.getState().getSelection(identity1);
    expect(sel).toBeDefined();
    expect(sel?.pageIndex).toBe(0);
    expect(sel?.selectedIds).toEqual(['ann1']);
  });

  it('keeps selections isolated between different instances of the same document', () => {
    const store = useSelectionStore.getState();
    store.selectAnnotation(identity1, 0, 'ann1');
    store.selectAnnotation(identity2, 0, 'ann2');

    const sel1 = useSelectionStore.getState().getSelection(identity1);
    const sel2 = useSelectionStore.getState().getSelection(identity2);

    expect(sel1?.selectedIds).toEqual(['ann1']);
    expect(sel2?.selectedIds).toEqual(['ann2']);
  });

  it('supports multiple selections via setSelection', () => {
    const store = useSelectionStore.getState();
    store.setSelection(identity1, 1, ['ann1', 'ann2']);

    const sel = useSelectionStore.getState().getSelection(identity1);
    expect(sel?.pageIndex).toBe(1);
    expect(sel?.selectedIds).toEqual(['ann1', 'ann2']);
  });

  it('clears selection', () => {
    const store = useSelectionStore.getState();
    store.selectAnnotation(identity1, 0, 'ann1');
    store.clearSelection(identity1);

    const sel = useSelectionStore.getState().getSelection(identity1);
    expect(sel).toBeUndefined();
  });

  it('removes document selection entirely', () => {
    const store = useSelectionStore.getState();
    store.selectAnnotation(identity1, 0, 'ann1');
    store.removeDocument(identity1);

    expect(useSelectionStore.getState().docSelections.has('docA:1')).toBe(false);
  });

  it('does not publish a store update when an empty transient style is cleared', () => {
    useSelectionStore.getState().selectAnnotation(identity1, 0, 'ann1');
    const before = useSelectionStore.getState();

    useSelectionStore.getState().setTransientStyle(identity1, 0, 'ann1', undefined);

    expect(useSelectionStore.getState()).toBe(before);
  });
});
