import React, { useState, useEffect, useRef } from 'react';
import { FIXED_PALETTE, normalizeColor } from '../../constants/palette';
import { useUIStore } from '../../store/uiStore';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../../utils/colorUtils';
import styles from './ColorPickerPopup.module.css';

interface ColorPickerPopupProps {
  currentColor: string;
  onColorSelect: (color: string) => void;
  onColorCommit?: (color: string) => void;
  onClose: () => void;
  allowTransparent?: boolean;
}

export function ColorPickerPopup({
  currentColor,
  onColorSelect,
  onColorCommit,
  onClose,
  allowTransparent = false,
}: ColorPickerPopupProps) {
  const favoriteColors = useUIStore(state => state.favoriteColors);
  const addFavoriteColor = useUIStore(state => state.addFavoriteColor);
  const removeFavoriteColor = useUIStore(state => state.removeFavoriteColor);

  const [expanded, setExpanded] = useState(false);
  
  // Advanced picker state
  const [internalHex, setInternalHex] = useState(currentColor);
  const hexRef = useRef(internalHex);
  hexRef.current = internalHex;
  
  const [hsv, setHsv] = useState(() => {
    const rgb = hexToRgb(currentColor);
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  });

  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  
  // Sync internal state when external color changes (only if not actively interacting with advanced picker to avoid jumping)
  useEffect(() => {
    setInternalHex(currentColor);
    const rgb = hexToRgb(currentColor);
    setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
  }, [currentColor]);

  const handleSelectColor = (color: string) => {
    onColorSelect(color);
    onColorCommit?.(color);
  };

  const handleAddFavorite = () => {
    addFavoriteColor(internalHex);
  };

  const handleRemoveFavorite = () => {
    removeFavoriteColor(internalHex);
  };

  const handleSvPointerDown = (e: React.PointerEvent) => {
    const handleMove = (e2: PointerEvent) => {
      if (!svRef.current) return;
      const rect = svRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e2.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e2.clientY - rect.top) / rect.height));
      const s = x * 100;
      const v = (1 - y) * 100;
      
      const newHsv = { ...hsv, s, v };
      setHsv(newHsv);
      const rgb = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      setInternalHex(hex);
      onColorSelect(hex);
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      onColorCommit?.(hexRef.current);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    handleMove(e.nativeEvent as any);
  };

  const handleHuePointerDown = (e: React.PointerEvent) => {
    const handleMove = (e2: PointerEvent) => {
      if (!hueRef.current) return;
      const rect = hueRef.current.getBoundingClientRect();
      const y = Math.max(0, Math.min(1, (e2.clientY - rect.top) / rect.height));
      const h = (1 - y) * 360;
      
      const newHsv = { ...hsv, h };
      setHsv(newHsv);
      const rgb = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      setInternalHex(hex);
      onColorSelect(hex);
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      onColorCommit?.(hexRef.current);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    handleMove(e.nativeEvent as any);
  };

  const handleRgbChange = (channel: 'r'|'g'|'b', val: string) => {
    let num = parseInt(val, 10);
    if (isNaN(num)) num = 0;
    num = Math.max(0, Math.min(255, num));
    const currentRgb = hexToRgb(internalHex);
    currentRgb[channel] = num;
    const hex = rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b);
    setInternalHex(hex);
    setHsv(rgbToHsv(currentRgb.r, currentRgb.g, currentRgb.b));
    onColorSelect(hex);
    onColorCommit?.(hex);
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInternalHex(val);
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      const rgb = hexToRgb(val);
      setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
      onColorSelect(val);
      onColorCommit?.(val);
    }
  };

  const rgb = hexToRgb(internalHex);

  return (
    <div className={styles.popupContainer} onPointerDown={e => e.stopPropagation()}>
      <div className={styles.leftPanel}>
        <div className={styles.grid}>
          {FIXED_PALETTE.map((c) => (
            <button
              key={c}
              className={`${styles.swatch} ${currentColor === c ? styles.selected : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => handleSelectColor(c)}
              aria-label={`Select color ${c}`}
            />
          ))}
        </div>
        
        <div className={styles.myColorsHeader}>My Colors:</div>
        <div className={styles.grid}>
          {Array.from({ length: 16 }).map((_, i) => {
            const c = favoriteColors[i];
            return c ? (
              <button
                key={`fav-${i}-${c}`}
                className={`${styles.swatch} ${currentColor === c ? styles.selected : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => handleSelectColor(c)}
                aria-label={`Select favorite color ${c}`}
              />
            ) : (
              <div key={`fav-empty-${i}`} className={styles.swatchEmpty} />
            );
          })}
        </div>
        
        <div className={styles.actionsBar}>
          <button className={styles.iconButton} onClick={handleAddFavorite} title="Add to My Colors">+</button>
          <button className={styles.iconButton} onClick={handleRemoveFavorite} title="Remove from My Colors">-</button>
          <div style={{ flex: 1 }} />
          {allowTransparent && (
            <button 
              className={`${styles.iconButton} ${currentColor === 'transparent' ? styles.selected : ''}`} 
              onClick={() => handleSelectColor('transparent')} 
              title="Transparent"
            >
              /
            </button>
          )}
        </div>

        <div className={styles.expandBar}>
          <button className={styles.expandButton} onClick={() => setExpanded(!expanded)}>
            {expanded ? '<' : '>'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className={styles.rightPanel}>
          <div className={styles.spectrumArea}>
            <div 
              className={styles.svSquare} 
              ref={svRef}
              onPointerDown={handleSvPointerDown}
              style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
            >
              <div className={styles.svWhite} />
              <div className={styles.svBlack} />
              <div 
                className={styles.svCursor} 
                style={{ 
                  left: `${hsv.s}%`, 
                  top: `${100 - hsv.v}%` 
                }} 
              />
            </div>
            
            <div 
              className={styles.hueBar}
              ref={hueRef}
              onPointerDown={handleHuePointerDown}
            >
              <div 
                className={styles.hueCursor} 
                style={{ top: `${100 - (hsv.h / 360) * 100}%` }} 
              />
            </div>
            
            <div className={styles.inputsColumn}>
              <div className={styles.previewBox} style={{ backgroundColor: internalHex }} />
              <div className={styles.inputRow}>
                <span>R:</span>
                <input type="number" value={rgb.r} onChange={e => handleRgbChange('r', e.target.value)} />
              </div>
              <div className={styles.inputRow}>
                <span>G:</span>
                <input type="number" value={rgb.g} onChange={e => handleRgbChange('g', e.target.value)} />
              </div>
              <div className={styles.inputRow}>
                <span>B:</span>
                <input type="number" value={rgb.b} onChange={e => handleRgbChange('b', e.target.value)} />
              </div>
              <div className={styles.inputRow}>
                <span>#</span>
                <input type="text" value={internalHex} onChange={handleHexChange} style={{ width: '60px' }} />
              </div>
            </div>
          </div>

          <div className={styles.bottomBar}>
            <button className={styles.okButton} onClick={onClose}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
