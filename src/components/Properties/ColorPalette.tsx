import React from 'react';
import { FIXED_PALETTE, normalizeColor } from '../../constants/palette';
import { ColorSwatch } from './ColorSwatch';
import styles from './Properties.module.css';

interface ColorPaletteProps {
  currentColor: string;
  onColorSelect: (color: string) => void;
}

export function ColorPalette({ currentColor, onColorSelect }: ColorPaletteProps) {
  const normCurrent = normalizeColor(currentColor);

  return (
    <div className={styles.paletteContainer}>
      {FIXED_PALETTE.map(color => (
        <ColorSwatch
          key={color}
          color={color}
          selected={normalizeColor(color) === normCurrent}
          onClick={() => onColorSelect(color)}
        />
      ))}
    </div>
  );
}
