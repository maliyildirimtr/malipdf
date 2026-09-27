import React from 'react';
import styles from './MainRibbon.module.css';

export interface StrokeWidthControlProps {
  value: number;
  options: readonly number[];
  onChange: (value: number) => void;
  label?: string;
}

export function StrokeWidthControl({
  value,
  options,
  onChange,
  label = 'Width',
}: StrokeWidthControlProps) {
  return (
    <label className={styles.compactControl}>
      <span className={styles.propertyLabel}>{label}</span>
      <select
        className={`${styles.compactSelect} ${styles.widthSelect}`}
        value={value}
        aria-label={`${label} in PDF points`}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {options.map((width) => (
          <option key={width} value={width}>{width} pt</option>
        ))}
      </select>
    </label>
  );
}

export interface OpacityControlProps {
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  onCancel?: () => void;
}

export function OpacityControl({ value, onChange, onCommit, onCancel }: OpacityControlProps) {
  // While dragging, the slider shows its own value. For a selected
  // annotation the store only changes on commit, so a slider bound to
  // `value` alone would snap back and never move.
  const [draft, setDraft] = React.useState<number | null>(null);
  const shown = draft ?? value;
  const percentage = Math.round(shown * 100);

  const commit = (next: number) => {
    setDraft(null);
    if (Math.abs(next - value) > 1e-6) onCommit?.(next);
    else onCancel?.();
  };

  return (
    <label className={`${styles.compactControl} ${styles.opacityControl}`}>
      <span className={styles.propertyLabel}>Opacity</span>
      <input
        className={styles.opacitySlider}
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={shown}
        aria-label="Opacity"
        aria-valuetext={`${percentage} percent`}
        onChange={(event) => {
          const next = Number(event.target.value);
          setDraft(next);
          onChange(next);
        }}
        onPointerUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
        onKeyUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
        onPointerCancel={() => { setDraft(null); onCancel?.(); }}
        onBlur={() => { if (draft !== null) commit(draft); }}
      />
      <span className={styles.opacityValue} aria-hidden="true">{percentage}%</span>
    </label>
  );
}
