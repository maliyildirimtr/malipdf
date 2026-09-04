import React from 'react';
import { Check } from 'lucide-react';
import styles from './MainRibbon.module.css';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface ColorWellProps {
  label: string;
  value: string;
  colors: readonly string[];
  onChange: (color: string) => void;
  allowTransparent?: boolean;
}

/**
 * Compact color control shared by tool property shelves.
 * The current-color well opens the native macOS color picker while the
 * adjacent buttons keep the six most useful/recent colors one click away.
 */
export function ColorWell({
  label,
  value,
  colors,
  onChange,
  allowTransparent = false,
}: ColorWellProps) {
  const inputValue = HEX_COLOR.test(value) ? value : '#000000';
  const quickColors = Array.from(new Set(colors.map((color) => color.toLowerCase())))
    .slice(0, 6);

  return (
    <div className={styles.colorControl} role="group" aria-label={label}>
      <span className={styles.propertyLabel}>{label}</span>
      <label
        className={`${styles.currentColorWell} ${value === 'transparent' ? styles.transparentSwatch : ''}`}
        style={value === 'transparent' ? undefined : colorStyle(value)}
        title={`Choose custom ${label.toLowerCase()}`}
      >
        <span className={styles.srOnly}>Choose custom {label.toLowerCase()}</span>
        <input
          className={styles.nativeColorInput}
          type="color"
          value={inputValue}
          aria-label={`Choose custom ${label.toLowerCase()}`}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>

      <div className={styles.quickColors} role="group" aria-label={`Recent ${label.toLowerCase()} colors`}>
        {quickColors.map((color, index) => {
          const selected = value.toLowerCase() === color;
          return (
            <button
              key={color}
              type="button"
              className={`${styles.colorSwatch} ${selected ? styles.colorSwatchActive : ''}`}
              style={colorStyle(color)}
              onClick={() => onChange(color)}
              title={`Use ${color}`}
              aria-label={`Use color ${color}`}
              aria-pressed={selected}
              data-color-index={index}
            >
              {selected && <Check className={styles.swatchCheck} size={11} strokeWidth={3} aria-hidden="true" />}
            </button>
          );
        })}

        {allowTransparent && (
          <button
            type="button"
            className={`${styles.colorSwatch} ${styles.transparentSwatch} ${value === 'transparent' ? styles.colorSwatchActive : ''}`}
            onClick={() => onChange('transparent')}
            title="No fill"
            aria-label="Use no fill"
            aria-pressed={value === 'transparent'}
          >
            {value === 'transparent' && <Check className={styles.swatchCheck} size={11} strokeWidth={3} aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  );
}

function colorStyle(color: string): React.CSSProperties {
  return { '--swatch-color': color } as React.CSSProperties;
}
