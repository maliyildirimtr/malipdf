/**
 * Text selected with the Select Text tool (one page at a time), so it can be
 * copied (⌘C / Ctrl+C or the Copy button) or turned into a highlight.
 */
import { create } from 'zustand';
import type { TextSelection } from '../pdf/textSelection';

export interface PageTextSelection {
  docId: string;
  instanceId: number;
  pageIndex: number;
  selection: TextSelection;
  /** Still being dragged out. */
  dragging: boolean;
}

interface TextSelectionStore {
  current: PageTextSelection | null;
  setSelection: (selection: PageTextSelection | null) => void;
  clear: () => void;
}

export const useTextSelectionStore = create<TextSelectionStore>((set) => ({
  current: null,
  setSelection: (current) => set({ current }),
  clear: () => set({ current: null }),
}));

/** The selected text, or '' when nothing is selected. */
export function selectedPdfText(): string {
  const current = useTextSelectionStore.getState().current;
  return current && !current.dragging ? current.selection.text : '';
}

/** Copies the selected text to the clipboard. */
export async function copySelectedPdfText(): Promise<boolean> {
  const text = selectedPdfText();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older shells: fall back to a copy command on a temporary field.
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  }
}
