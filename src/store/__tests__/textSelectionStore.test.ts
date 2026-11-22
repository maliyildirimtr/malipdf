import { afterEach, describe, expect, it } from 'vitest';
import { selectedPdfText, useTextSelectionStore } from '../textSelectionStore';
import type { TextSelection } from '../../pdf/textSelection';

const selection: TextSelection = { quads: [], text: 'heat engines' };

describe('Select Text', () => {
  afterEach(() => useTextSelectionStore.getState().clear());

  it('copies nothing while the text is still being dragged out', () => {
    useTextSelectionStore.getState().setSelection({ docId: 'd', instanceId: 1, pageIndex: 0, selection, dragging: true });
    expect(selectedPdfText()).toBe('');
  });

  it('copies the selected text once the drag ends, and nothing after it is cleared', () => {
    useTextSelectionStore.getState().setSelection({ docId: 'd', instanceId: 1, pageIndex: 0, selection, dragging: false });
    expect(selectedPdfText()).toBe('heat engines');
    useTextSelectionStore.getState().clear();
    expect(selectedPdfText()).toBe('');
  });
});
