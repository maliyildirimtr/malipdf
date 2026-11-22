/**
 * Shows the text picked with the Select Text tool on its page, with a small
 * bar to copy it or turn it into a highlight.
 */
import { Copy, Highlighter } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pdfRectToScreenBounds, type PageTransform } from '../../pdf/coordinateTransform';
import type { TextSelection } from '../../pdf/textSelection';
import { copySelectedPdfText, useTextSelectionStore } from '../../store/textSelectionStore';
import styles from './TextSelectionOverlay.module.css';

interface Props {
  docId: string;
  instanceId: number;
  pageIndex: number;
  transform: PageTransform;
  onHighlight: (selection: TextSelection) => void;
}

export function TextSelectionOverlay({ docId, instanceId, pageIndex, transform, onHighlight }: Props) {
  const current = useTextSelectionStore((state) => state.current);
  const [copied, setCopied] = useState(false);
  const here = !!current && current.docId === docId && current.instanceId === instanceId && current.pageIndex === pageIndex;

  // Esc drops the selection.
  useEffect(() => {
    if (!here) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useTextSelectionStore.getState().clear();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [here]);

  if (!here || !current) return null;

  const rects = current.selection.quads.map((quad) => {
    const xs = quad.map((p) => p.x);
    const ys = quad.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return pdfRectToScreenBounds({ x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }, transform);
  });
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const left = Math.min(...rects.map((r) => r.x));
  const barTop = Math.min(bottom + 6, transform.cssHeight - 36);
  const barLeft = Math.max(0, Math.min(left, transform.cssWidth - 190));

  return (
    <div className={styles.layer} aria-hidden={current.dragging}>
      {rects.map((r, i) => (
        <div key={i} className={styles.rect} style={{ left: r.x, top: r.y, width: r.width, height: r.height }} />
      ))}
      {!current.dragging && (
        <div
          className={styles.bar}
          style={{ left: barLeft, top: barTop }}
          role="toolbar"
          aria-label="Selected text"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              void copySelectedPdfText().then((ok) => {
                if (!ok) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
            title="Copy (⌘C)"
          >
            <Copy size={14} aria-hidden="true" />
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => onHighlight(current.selection)}
            title="Highlight the selected text"
          >
            <Highlighter size={14} aria-hidden="true" />
            <span>Highlight</span>
          </button>
        </div>
      )}
    </div>
  );
}
