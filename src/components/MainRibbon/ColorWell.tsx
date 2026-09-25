import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { ColorPickerPopup } from '../Properties/ColorPickerPopup';
import styles from './MainRibbon.module.css';

export interface ColorWellProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  onCommit?: (color: string) => void;
  allowTransparent?: boolean;
}

export function ColorWell({
  label,
  value,
  onChange,
  onCommit,
  allowTransparent = false,
}: ColorWellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate popup position when opening
  const openPopup = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Position below the button by default
      let top = rect.bottom + 4;
      let left = rect.left;

      // Clamp to viewport
      const estimatedPopupWidth = 240;
      const estimatedPopupHeight = 300;
      if (left + estimatedPopupWidth > window.innerWidth - 8) {
        left = window.innerWidth - 8 - estimatedPopupWidth;
      }
      if (top + estimatedPopupHeight > window.innerHeight - 8) {
        top = rect.top - estimatedPopupHeight - 4;
      }

      setPopupPosition({ top, left });
    }
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleDocumentClick = (e: MouseEvent) => {
      // Close if click is outside our container AND outside the portal popup
      const target = e.target as Node;
      const popupEl = document.querySelector('[data-colorpicker-popup]');
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        (!popupEl || !popupEl.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener('pointerdown', handleDocumentClick);
    return () => window.removeEventListener('pointerdown', handleDocumentClick);
  }, [isOpen]);

  const popup = isOpen ? ReactDOM.createPortal(
    <div
      data-colorpicker-popup
      style={{
        position: 'fixed',
        top: popupPosition.top,
        left: popupPosition.left,
        zIndex: 20000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ColorPickerPopup 
        currentColor={value} 
        onColorSelect={(c) => {
          onChange(c);
        }}
        onColorCommit={onCommit}
        onClose={() => setIsOpen(false)}
        allowTransparent={allowTransparent}
      />
    </div>,
    document.body
  ) : null;

  return (
    <div className={styles.colorControl} role="group" aria-label={label} ref={containerRef} style={{ position: 'relative' }}>
      <span className={styles.propertyLabel}>{label}</span>
      <button 
        ref={buttonRef}
        className={styles.colorWellButton}
        style={{ 
          backgroundColor: value === 'transparent' ? 'transparent' : value,
          width: 32, 
          height: 32, 
          border: '1px solid #ccc',
          borderRadius: 4,
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden'
        }}
        onClick={openPopup}
        title="Choose color"
      >
        {value === 'transparent' && (
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 2, background: 'red', transform: 'translateY(-50%) rotate(45deg)' }} />
        )}
      </button>

      {popup}
    </div>
  );
}
