/**
 * Visual formula editor (MathLive's <math-field>): click into the formula and
 * type, like Word's equation editor. It reads and writes LaTeX, so it stays
 * in step with the LaTeX field of the dialog.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import styles from './FormulaDialog.module.css';

export interface MathEditorHandle {
  /** Insert LaTeX at the cursor; `#@` takes the selection, `#?` is an empty box. */
  insert: (latex: string) => void;
  focus: () => void;
}

interface MathEditorProps {
  value: string;
  onChange: (latex: string) => void;
  color: string;
  fontSize: number;
  onReady?: () => void;
  onFocus?: () => void;
}

let configured = false;

export const MathEditor = forwardRef<MathEditorHandle, MathEditorProps>(function MathEditor(
  { value, onChange, color, fontSize, onReady, onFocus },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    insert: (latex) => {
      const mf = fieldRef.current;
      if (!mf) return;
      mf.focus();
      // Without a selection every part starts empty (like Word), instead of
      // MathLive pulling the previous symbol into the first box.
      const text = mf.selectionIsCollapsed ? latex.replace(/#@/g, '#?') : latex;
      mf.insert(text, { format: 'latex', selectionMode: 'placeholder', insertionMode: 'replaceSelection', focus: true });
      onChangeRef.current(mf.value);
    },
    focus: () => fieldRef.current?.focus(),
  }), []);

  useEffect(() => {
    let disposed = false;
    void import('mathlive').then(({ MathfieldElement: Field }) => {
      if (disposed || !hostRef.current) return;
      if (!configured) {
        // Fonts come from the KaTeX CSS the dialog already added; no sounds.
        Field.fontsDirectory = null;
        Field.soundsDirectory = null;
        configured = true;
      }
      const mf = new Field();
      mf.smartFence = true;
      mf.mathVirtualKeyboardPolicy = 'manual';
      mf.value = value;
      mf.className = styles.mathField;
      mf.setAttribute('aria-label', 'Formula');
      mf.addEventListener('input', () => onChangeRef.current(mf.value));
      hostRef.current.appendChild(mf);
      fieldRef.current = mf;
      requestAnimationFrame(() => {
        mf.focus();
        onReady?.();
      });
    }).catch((error) => {
      console.error('Visual formula editor unavailable:', error);
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      fieldRef.current?.remove();
      fieldRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep in step with the LaTeX field (without moving the cursor on own edits).
  useEffect(() => {
    const mf = fieldRef.current;
    if (mf && mf.value !== value) mf.setValue(value, { silenceNotifications: true });
  }, [value]);

  useEffect(() => {
    const mf = fieldRef.current;
    if (!mf) return;
    mf.style.color = color;
  }, [color, failed]);

  if (failed) return null;
  return (
    <div
      ref={hostRef}
      className={styles.mathHost}
      style={{ fontSize: `${Math.max(18, Math.round(fontSize * 1.5))}px`, color }}
      onFocus={onFocus}
      onMouseDown={(e) => {
        // A click on the empty area puts the cursor in the formula.
        if (e.target === hostRef.current) {
          e.preventDefault();
          fieldRef.current?.focus();
        }
      }}
    />
  );
});
