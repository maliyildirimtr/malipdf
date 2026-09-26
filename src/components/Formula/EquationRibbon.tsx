/**
 * Word-style equation ribbon for the Formula dialog: a symbol gallery (with
 * categories) and structure menus — Fraction, Script, Radical, Integral,
 * Large Operator, Bracket, Function, Accent, Limit and Log, Operator, Matrix.
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import katex from 'katex';
import { STRUCTURES, SYMBOL_GROUPS, type FormulaItem, type Structure } from '../../pdf/formulaCatalog';
import styles from './FormulaDialog.module.css';

/** Inline KaTeX rendering of a catalog entry (cached). */
const texCache = new Map<string, string>();
export const Tex = memo(function Tex({ latex, display = false }: { latex: string; display?: boolean }) {
  const key = `${display ? 'D' : 'I'}${latex}`;
  let html = texCache.get(key);
  if (html === undefined) {
    html = katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: 'ignore' });
    texCache.set(key, html);
  }
  return <span className={styles.tex} dangerouslySetInnerHTML={{ __html: html }} />;
});

export interface EquationRibbonProps {
  /** Insert `latex` at the cursor of the formula field. */
  onInsert: (latex: string) => void;
  /** Tells the dialog a menu is open (so Escape closes the menu first). */
  onMenuChange?: (open: boolean) => void;
}

type OpenMenu = { kind: 'symbols' } | { kind: 'structure'; id: string } | null;

export function EquationRibbon({ onInsert, onMenuChange }: EquationRibbonProps) {
  const [open, setOpenState] = useState<OpenMenu>(null);
  const [groupId, setGroupId] = useState(SYMBOL_GROUPS[0].id);
  const rootRef = useRef<HTMLDivElement>(null);
  const group = SYMBOL_GROUPS.find((g) => g.id === groupId) ?? SYMBOL_GROUPS[0];

  const setOpen = (next: OpenMenu) => {
    setOpenState(next);
    onMenuChange?.(next !== null);
  };

  // Close a menu when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const menu = rootRef.current?.querySelector('[data-equation-menu]');
      const trigger = rootRef.current?.querySelector('[data-menu-open="true"]');
      if (menu?.contains(e.target as Node) || trigger?.contains(e.target as Node)) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(null);
      }
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (item: FormulaItem) => {
    onInsert(item.latex);
    setOpen(null);
  };

  // Keep the focus (and selection) in the formula field while clicking the ribbon.
  const keepFocus = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('select')) return;
    e.preventDefault();
  };

  return (
    <div className={styles.ribbon} ref={rootRef} onMouseDown={keepFocus}>
      <div className={styles.ribbonGroup}>
        <button type="button" className={styles.textButton} title="Normal text inside the formula" onClick={() => onInsert('\\text{text}')}>
          <span className={styles.textButtonIcon}>ab</span>
          <span>Text</span>
        </button>
      </div>

      <div className={styles.ribbonGroup}>
        <div className={styles.gallery} role="group" aria-label={`Symbols: ${group.label}`}>
          <div className={styles.galleryGrid}>
            {group.items.map((item) => (
              <SymbolButton key={item.title + item.latex} item={item} onPick={pick} />
            ))}
          </div>
          <button
            type="button"
            className={styles.galleryMore}
            data-menu-open={open?.kind === 'symbols'}
            aria-label="More symbols"
            aria-expanded={open?.kind === 'symbols'}
            title="More symbols and categories"
            onClick={() => setOpen(open?.kind === 'symbols' ? null : { kind: 'symbols' })}
          >
            <ChevronDown size={14} />
          </button>
        </div>
        {open?.kind === 'symbols' && (
          <div className={`${styles.menu} ${styles.symbolMenu}`} data-equation-menu role="menu" aria-label="Symbols">
            <select className={styles.menuSelect} value={groupId} aria-label="Symbol category" onChange={(e) => setGroupId(e.target.value)}>
              {SYMBOL_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <div className={styles.symbolMenuGrid}>
              {group.items.map((item) => (
                <SymbolButton key={item.title + item.latex} item={item} onPick={pick} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={`${styles.ribbonGroup} ${styles.structures}`}>
        {STRUCTURES.map((structure) => (
          <StructureButton
            key={structure.id}
            structure={structure}
            open={open?.kind === 'structure' && open.id === structure.id}
            onToggle={() => setOpen(open?.kind === 'structure' && open.id === structure.id ? null : { kind: 'structure', id: structure.id })}
            onPick={pick}
          />
        ))}
      </div>
    </div>
  );
}

function SymbolButton({ item, onPick }: { item: FormulaItem; onPick: (item: FormulaItem) => void }) {
  return (
    <button type="button" className={styles.symbol} title={`${item.title}  ${item.latex}`} aria-label={item.title} onClick={() => onPick(item)}>
      <Tex latex={item.latex} />
    </button>
  );
}

function StructureButton({ structure, open, onToggle, onPick }: {
  structure: Structure;
  open: boolean;
  onToggle: () => void;
  onPick: (item: FormulaItem) => void;
}) {
  return (
    <div className={styles.structureWrap}>
      <button
        type="button"
        className={`${styles.structure} ${open ? styles.structureOpen : ''}`}
        data-menu-open={open}
        aria-haspopup="menu"
        aria-expanded={open}
        title={structure.label}
        onClick={onToggle}
      >
        <span className={styles.structureIcon}><Tex latex={structure.icon} /></span>
        <span className={styles.structureLabel}>{structure.label}<ChevronDown size={11} /></span>
      </button>
      {open && (
        <div className={`${styles.menu} ${styles.structureMenu}`} data-equation-menu role="menu" aria-label={structure.label}>
          {structure.sections.map((section) => (
            <section key={section.label}>
              <h3 className={styles.menuHeading}>{section.label}</h3>
              <div className={styles.templateGrid}>
                {section.items.map((item) => (
                  <button key={item.title + item.latex} type="button" role="menuitem" className={styles.template} title={item.title} aria-label={item.title} onClick={() => onPick(item)}>
                    <Tex latex={item.latex} display />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
