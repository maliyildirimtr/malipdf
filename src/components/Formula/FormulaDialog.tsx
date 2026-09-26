import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { errorMessage, notifyUser } from '../../utils/notify';
import styles from './FormulaDialog.module.css';

const SIZES = [12, 14, 16, 20, 24, 32] as const;
const COLORS = ['#1a1a2e', '#e63946', '#1d4ed8', '#16a34a', '#7c3aed'];
const EXAMPLE = 'f(x) = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';

type FormulaModule = typeof import('../../pdf/formula');

/** Insert Formula / Edit Formula: LaTeX in, typeset math on the page out. */
export function FormulaDialog() {
  const state = useUIStore((s) => s.formulaDialog);
  if (!state) return null;
  return <FormulaDialogBody key={state.edit?.annotationId ?? 'new'} />;
}

function FormulaDialogBody() {
  const state = useUIStore((s) => s.formulaDialog)!;
  const setDialog = useUIStore((s) => s.setFormulaDialog);
  const savedStyle = useUIStore((s) => s.formulaStyle);
  const setSavedStyle = useUIStore((s) => s.setFormulaStyle);
  const editing = state.edit;
  const [latex, setLatex] = useState(editing?.latex ?? '');
  const [color, setColor] = useState(editing?.color ?? savedStyle.color);
  const [size, setSize] = useState(editing?.size ?? savedStyle.size);
  const [mod, setMod] = useState<FormulaModule | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    void import('../../pdf/formula').then(async (m) => {
      await m.ensureFormulaStyles();
      if (alive) setMod(m);
    });
    setTimeout(() => inputRef.current?.focus(), 20);
    return () => { alive = false; };
  }, []);

  const preview = useMemo(() => {
    if (!mod) return { html: '', error: '' };
    if (!latex.trim()) return { html: '', error: '' };
    try {
      return { html: mod.formulaHtml(latex), error: '' };
    } catch (error) {
      return { html: '', error: errorMessage(error) };
    }
  }, [mod, latex]);

  const close = () => setDialog(null);

  const insertSnippet = (text: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? latex.length;
    const end = el.selectionEnd ?? latex.length;
    const next = latex.slice(0, start) + text + latex.slice(end);
    setLatex(next);
    requestAnimationFrame(() => {
      el.focus();
      // Put the cursor inside the first {…} of what was inserted.
      const brace = text.indexOf('{');
      const caret = brace >= 0 ? start + brace + 1 : start + text.length;
      const close = brace >= 0 ? text.indexOf('}', brace) : -1;
      el.setSelectionRange(caret, close > brace && brace >= 0 ? start + close : caret);
    });
  };

  const submit = async () => {
    if (busy || !latex.trim() || preview.error) return;
    setBusy(true);
    setSavedStyle({ color, size });
    try {
      const commands = await import('../../commands/imageCommands');
      const ok = editing
        ? await commands.updateFormula(editing.docId, editing.annotationId, editing.pageIndex, { latex, color, size })
        : await commands.insertFormula({ latex, color, size });
      if (ok) close();
    } catch (error) {
      notifyUser('error', `The formula could not be added: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={onKeyDown}>
      <div className={styles.dialog} role="dialog" aria-label={editing ? 'Edit Formula' : 'Insert Formula'}>
        <div className={styles.header}>
          <h2>{editing ? 'Edit Formula' : 'Insert Formula'}</h2>
          <span className={styles.hint}>LaTeX · ⌘↩ to {editing ? 'update' : 'insert'}</span>
        </div>

        <div className={styles.snippets} role="toolbar" aria-label="Quick insert">
          {(mod?.FORMULA_SNIPPETS ?? []).map((s) => (
            <button key={s.title} type="button" title={`${s.title}: ${s.insert}`} onClick={() => insertSnippet(s.insert)}>{s.label}</button>
          ))}
        </div>

        <textarea
          ref={inputRef}
          className={styles.input}
          value={latex}
          spellCheck={false}
          placeholder={EXAMPLE}
          aria-label="Formula in LaTeX"
          onChange={(e) => setLatex(e.target.value)}
        />

        <div className={styles.preview} aria-live="polite" style={{ color, fontSize: `${Math.max(14, size * 1.25)}px` }}>
          {preview.error
            ? <span className={styles.error}>{preview.error}</span>
            : preview.html
              ? <div dangerouslySetInnerHTML={{ __html: preview.html }} />
              : <span className={styles.placeholder}>{mod ? 'The formula appears here.' : 'Loading…'}</span>}
        </div>

        <div className={styles.options}>
          <div className={styles.swatches} role="group" aria-label="Colour">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.swatch} ${color === c ? styles.swatchActive : ''}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <label className={styles.sizeField}>
            Size
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Formula size">
              {SIZES.map((s) => <option key={s} value={s}>{s} pt</option>)}
            </select>
          </label>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={close} disabled={busy}>Cancel</button>
          <button type="button" className={styles.primary} onClick={() => void submit()} disabled={busy || !latex.trim() || !!preview.error || !mod}>
            {busy ? 'Working…' : editing ? 'Update' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  );
}
