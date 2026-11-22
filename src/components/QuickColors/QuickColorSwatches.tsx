/**
 * The four one-tap colours shared by the Focus Mode toolbar and the
 * presentation bar. A click picks a colour; a double-click opens the palette
 * and the chosen colour takes that place (kept between launches).
 */
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useUIStore } from '../../store/uiStore';
import { ColorPickerPopup } from '../Properties/ColorPickerPopup';

/** Names for the default colours (others show their hex code). */
const COLOR_NAMES: Record<string, string> = { '#000000': 'Black', '#e63946': 'Red', '#1d4ed8': 'Blue', '#16a34a': 'Green' };

const PALETTE_WIDTH = 250;
const PALETTE_HEIGHT = 430;

interface Props {
  /** Colour of the tool in use (lower-case hex), to mark the matching swatch. */
  currentColor: string;
  onPick: (color: string) => void;
  /** Where the palette opens: beside a vertical toolbar or above a bottom bar. */
  placement: 'right' | 'left' | 'above';
  className?: string;
  swatchClassName?: string;
  activeClassName?: string;
}

export function QuickColorSwatches({ currentColor, onPick, placement, className, swatchClassName, activeClassName }: Props) {
  const colors = useUIStore((state) => state.focusColors);
  const [editing, setEditing] = useState<{ index: number; top: number; left: number } | null>(null);

  useEffect(() => {
    if (!editing) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-colorpicker-popup], [data-quick-color]')) return;
      setEditing(null);
    };
    // Captured first, so Esc closes the palette and not the presentation.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setEditing(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', escape, true);
    };
  }, [editing]);

  const openPalette = (index: number, button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    const bar = (button.closest('[role="toolbar"], aside') ?? button).getBoundingClientRect();
    let left: number;
    let top: number;
    if (placement === 'above') {
      left = rect.left + rect.width / 2 - PALETTE_WIDTH / 2;
      top = bar.top - PALETTE_HEIGHT - 10;
    } else {
      left = placement === 'right' ? bar.right + 10 : bar.left - PALETTE_WIDTH - 10;
      top = rect.top - 40;
    }
    setEditing({
      index,
      left: Math.max(8, Math.min(left, window.innerWidth - PALETTE_WIDTH - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - PALETTE_HEIGHT - 8)),
    });
  };

  return (
    <div className={className} role="group" aria-label="Colors">
      {colors.map((color, index) => {
        const label = COLOR_NAMES[color] ?? color;
        const selected = currentColor.toLowerCase() === color;
        return (
          <button
            key={index}
            type="button"
            data-quick-color
            className={`${swatchClassName ?? ''} ${selected ? activeClassName ?? '' : ''}`}
            style={{ background: color }}
            aria-label={label}
            aria-pressed={selected}
            title={`${label} — double-click to change`}
            onClick={() => {
              onPick(color);
              useUIStore.getState().addRecentColor(color);
            }}
            onDoubleClick={(event) => openPalette(index, event.currentTarget)}
          />
        );
      })}
      {editing && ReactDOM.createPortal(
        <div
          data-colorpicker-popup
          style={{ position: 'fixed', top: editing.top, left: editing.left, zIndex: 20000 }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ColorPickerPopup
            currentColor={colors[editing.index]}
            onColorSelect={(color) => {
              useUIStore.getState().setFocusColor(editing.index, color);
              onPick(color.toLowerCase());
            }}
            onColorCommit={(color) => useUIStore.getState().addRecentColor(color)}
            onClose={() => setEditing(null)}
          />
        </div>,
        // In a full-screen presentation only the full-screen element is shown.
        document.fullscreenElement ?? document.body,
      )}
    </div>
  );
}
