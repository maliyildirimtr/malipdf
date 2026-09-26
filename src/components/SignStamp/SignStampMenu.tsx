/** Ribbon menu: saved signatures and rubber stamps. */
import React, { useEffect, useRef, useState } from 'react';
import { PenLine, Plus, X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { STAMP_COLORS, STAMP_PRESETS, normalizeStampText, todayLabel } from '../../pdf/stamps';
import { SignatureDialog } from './SignatureDialog';
import { insertSignature, insertStamp } from './signStampActions';
import { OPEN_SIGN_MENU_EVENT } from './signStampEvents';
import ribbonStyles from '../MainRibbon/MainRibbon.module.css';
import styles from './SignStamp.module.css';

export function SignStampMenu({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [withDate, setWithDate] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customColor, setCustomColor] = useState<string>(STAMP_COLORS.blue);
  const signatures = useUIStore((s) => s.signatures);
  const removeSignature = useUIStore((s) => s.removeSignature);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOpen = () => enabled && setOpen(true);
    window.addEventListener(OPEN_SIGN_MENU_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SIGN_MENU_EVENT, onOpen);
  }, [enabled]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const stamp = (text: string, color: string) => {
    setOpen(false);
    void insertStamp({ text, color, subtext: withDate ? todayLabel() : undefined });
  };

  return (
    <div className={ribbonStyles.customizeRoot} ref={rootRef}>
      <button
        type="button"
        className={ribbonStyles.commandButton}
        title="Signature & Stamps"
        aria-label="Signature & Stamps"
        aria-expanded={open}
        disabled={!enabled}
        onClick={() => setOpen((v) => !v)}
        data-toolbar-control="true"
      >
        <PenLine size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div className={`${ribbonStyles.customizePanel} ${styles.menu}`} role="dialog" aria-label="Signature and stamps">
          <div className={ribbonStyles.customizeTitle}>Signatures</div>
          <div className={styles.signatureGrid}>
            {signatures.map((signature) => (
              <div key={signature.id} className={styles.signatureTile}>
                <button
                  type="button"
                  className={styles.signatureButton}
                  onClick={() => {
                    setOpen(false);
                    void insertSignature(signature.dataUrl);
                  }}
                  title="Insert this signature"
                >
                  <img src={signature.dataUrl} alt="Saved signature" />
                </button>
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => removeSignature(signature.id)}
                  title="Delete signature"
                  aria-label="Delete signature"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.newSignature}
              onClick={() => {
                setOpen(false);
                setDrawing(true);
              }}
            >
              <Plus size={14} /> New Signature…
            </button>
          </div>

          <div className={ribbonStyles.customizeTitle}>Stamps</div>
          <div className={styles.stampGrid}>
            {STAMP_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={styles.stampChip}
                style={{ color: preset.color, borderColor: preset.color }}
                onClick={() => stamp(preset.text, preset.color)}
              >
                {preset.text}
              </button>
            ))}
          </div>
          <label className={ribbonStyles.customizeItem}>
            <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />
            Add today's date ({todayLabel()})
          </label>
          <form
            className={styles.customRow}
            onSubmit={(event) => {
              event.preventDefault();
              if (normalizeStampText(customText)) stamp(customText, customColor);
            }}
          >
            <input
              className={styles.customInput}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Custom stamp text"
              maxLength={40}
              aria-label="Custom stamp text"
            />
            <select className={styles.customSelect} value={customColor} onChange={(e) => setCustomColor(e.target.value)} aria-label="Stamp color">
              {Object.entries(STAMP_COLORS).map(([name, value]) => (
                <option key={name} value={value}>{name[0].toUpperCase() + name.slice(1)}</option>
              ))}
            </select>
            <button type="submit" className={styles.primary} disabled={!normalizeStampText(customText)}>Add</button>
          </form>
        </div>
      )}
      {drawing && (
        <SignatureDialog
          onClose={() => setDrawing(false)}
          onSaved={(dataUrl) => {
            setDrawing(false);
            void insertSignature(dataUrl);
          }}
        />
      )}
    </div>
  );
}
