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
  const percentage = Math.round(value * 100);

  return (
    <label className={`${styles.compactControl} ${styles.opacityControl}`}>
      <span className={styles.propertyLabel}>Opacity</span>
      <input
        className={styles.opacitySlider}
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={value}
        aria-label="Opacity"
        aria-valuetext={`${percentage} percent`}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
        onPointerCancel={() => onCancel?.()}
        onBlur={(event) => onCommit?.(Number(event.target.value))}
      />
      <span className={styles.opacityValue} aria-hidden="true">{percentage}%</span>
    </label>
  );
}
