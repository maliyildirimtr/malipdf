import React, { useRef } from 'react';
import { useUIStore } from '../../store/uiStore';
import { ColorSwatch } from './ColorSwatch';
import { normalizeColor } from '../../constants/palette';
import { Plus, X } from 'lucide-react'; // changed icons to Plus/X since lucide-react uses these names
import styles from './Properties.module.css';

interface FavoritesListProps {
  currentColor: string;
  onColorSelect: (color: string) => void;
}

export function FavoritesList({ currentColor, onColorSelect }: FavoritesListProps) {
  const { favoriteColors, addFavoriteColor, removeFavoriteColor } = useUIStore();
  const inputRef = useRef<HTMLInputElement>(null);
  
  const normCurrent = normalizeColor(currentColor);

  const handleAddClick = () => {
    inputRef.current?.click();
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    addFavoriteColor(newColor);
    onColorSelect(newColor);
  };

  return (
    <div className={styles.paletteContainer}>
      {favoriteColors.map(color => (
        <div key={color} className={styles.favoriteItem}>
          <ColorSwatch
            color={color}
            selected={normalizeColor(color) === normCurrent}
            onClick={() => onColorSelect(color)}
          />
          <button
            type="button"
            className={styles.removeFavoriteBtn}
            onClick={(e) => {
              e.stopPropagation();
              removeFavoriteColor(color);
            }}
            title="Remove favorite"
          >
            <X size={10} strokeWidth={3} />
          </button>
        </div>
      ))}
      
      <button
        type="button"
        onClick={handleAddClick}
        className={styles.addFavoriteBtn}
        title="Add custom color"
      >
        <Plus size={14} strokeWidth={2} />
      </button>
      
      {/* Hidden color input for system color picker */}
      <input
        ref={inputRef}
        type="color"
        style={{ display: 'none' }}
        value={currentColor.startsWith('#') && currentColor.length === 7 ? currentColor : '#000000'}
        onChange={handleColorChange}
      />
    </div>
  );
}
