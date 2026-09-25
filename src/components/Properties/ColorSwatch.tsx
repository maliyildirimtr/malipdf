import React from 'react';
import styles from './Properties.module.css';

interface ColorSwatchProps {
  color: string;
  selected?: boolean;
  onClick: () => void;
  title?: string;
  className?: string;
}

export function ColorSwatch({ color, selected, onClick, title, className = '' }: ColorSwatchProps) {
  const isWhite = color.toLowerCase() === '#ffffff' || color.toLowerCase() === 'white';
  
  return (
    <button
      type="button"
      className={`${styles.colorSwatch} ${selected ? styles.colorSwatchSelected : ''} ${className}`}
      style={{
        backgroundColor: color,
        border: isWhite ? '1px solid #e5e7eb' : 'none',
      }}
      onClick={onClick}
      aria-label={title || `Color ${color}`}
      title={title || color}
    />
  );
}
