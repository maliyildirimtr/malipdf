import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import type { ShapeBorderStyle } from '../../types/annotations';
import styles from './Properties.module.css';

interface BorderStyleControlProps {
  value: ShapeBorderStyle;
  onChange: (value: ShapeBorderStyle) => void;
  onCommit: (value: ShapeBorderStyle) => void;
}

const BORDER_STYLES: { value: ShapeBorderStyle; label: string; dashArray: string }[] = [
  { value: 'solid', label: 'Solid', dashArray: 'none' },
  { value: 'dashed', label: 'Dashed', dashArray: '6, 4' },
  { value: 'dotted', label: 'Dotted', dashArray: '2, 3' },
  { value: 'dash-dot', label: 'Dash-dot', dashArray: '6, 3, 2, 3' },
  { value: 'dash-dot-dot', label: 'Dash-dot-dot', dashArray: '6, 3, 2, 3, 2, 3' },
];

export function BorderStyleControl({ value, onChange, onCommit }: BorderStyleControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const openPopup = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      let top = rect.bottom + 4;
      let left = rect.left;

      const estimatedWidth = 100;
      const estimatedHeight = 180;
      if (left + estimatedWidth > window.innerWidth - 8) {
        left = window.innerWidth - 8 - estimatedWidth;
      }
      if (top + estimatedHeight > window.innerHeight - 8) {
        top = rect.top - estimatedHeight - 4;
      }
      setPopupPosition({ top, left });
    }
    setIsOpen(prev => !prev);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const popupEl = document.querySelector('[data-borderstyle-popup]');
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        (!popupEl || !popupEl.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [isOpen]);

  const selectedStyle = BORDER_STYLES.find(s => s.value === value) || BORDER_STYLES[0];

  const handleSelect = (style: ShapeBorderStyle) => {
    onChange(style);
    onCommit(style);
    setIsOpen(false);
  };

  const popup = isOpen ? ReactDOM.createPortal(
    <div
      data-borderstyle-popup
      style={{
        position: 'fixed',
        top: popupPosition.top,
        left: popupPosition.left,
        zIndex: 20000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className={styles.borderStyleDropdown}>
        {BORDER_STYLES.map((style) => (
          <button
            key={style.value}
            className={`${styles.borderStyleOption} ${value === style.value ? styles.borderStyleSelected : ''}`}
            onClick={() => handleSelect(style.value)}
            title={style.label}
          >
            <svg width="60" height="20" viewBox="0 0 60 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="0" y1="10" x2="60" y2="10" strokeDasharray={style.dashArray} />
            </svg>
          </button>
        ))}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className={styles.borderStyleContainer} ref={containerRef}>
      <button 
        ref={buttonRef}
        className={styles.borderStyleBtn} 
        onClick={openPopup}
        title="Line Style"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="2" y1="12" x2="22" y2="12" strokeDasharray={selectedStyle.dashArray} />
        </svg>
      </button>

      {popup}
    </div>
  );
}
