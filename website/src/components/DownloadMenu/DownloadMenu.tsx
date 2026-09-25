import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { PlatformDownloads } from '../../config/downloads';
import './DownloadMenu.css';

interface DownloadMenuProps {
  platform: PlatformDownloads;
  /** Classes for the trigger button (reuse the existing .btn styles) */
  buttonClassName: string;
  /** Visible trigger content (icon + label) */
  children: ReactNode;
  ariaLabel?: string;
  /** Visual context the menu sits on */
  tone?: 'light' | 'navy';
  className?: string;
}

/**
 * Accessible disclosure menu that lets the visitor pick one of several
 * installers (e.g. Apple Silicon vs Intel) for the same platform.
 * - Enter / Space / ArrowDown on the trigger opens it and focuses the first item
 * - ArrowUp / ArrowDown / Home / End move between items
 * - Escape closes and returns focus to the trigger
 * - Clicking/tapping outside or tabbing away closes it
 */
export function DownloadMenu({
  platform,
  buttonClassName,
  children,
  ariaLabel,
  tone = 'light',
  className = '',
}: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const focusOnOpen = useRef<number | null>(null);
  const menuId = useId();
  const buttonId = useId();

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const openAndFocus = (index: number | null) => {
    focusOnOpen.current = index;
    setOpen(true);
  };

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter(Boolean) as HTMLAnchorElement[];
    if (!items.length) return;
    const next = (index + items.length) % items.length;
    items[next].focus();
  };

  // Move focus into the menu after it renders (keyboard opens)
  useEffect(() => {
    if (open && focusOnOpen.current !== null) {
      focusItem(focusOnOpen.current);
      focusOnOpen.current = null;
    }
  }, [open]);

  // Close on outside pointer / focus leaving the component
  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const handleFocus = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('focusin', handleFocus);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('focusin', handleFocus);
    };
  }, [open, close]);

  const handleButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (open) {
      close();
      return;
    }
    // event.detail === 0 → activated via keyboard (Enter / Space)
    openAndFocus(event.detail === 0 ? 0 : null);
  };

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openAndFocus(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAndFocus(platform.assets.length - 1);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(platform.assets.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case ' ':
        // Space activates the focused link like Enter does
        if (current >= 0) {
          event.preventDefault();
          itemRefs.current[current]?.click();
        }
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className={`download-menu download-menu--${tone}${open ? ' is-open' : ''} ${className}`.trim()}
    >
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className={`${buttonClassName} download-menu__trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={handleButtonClick}
        onKeyDown={handleButtonKeyDown}
      >
        {children}
        <svg
          className="download-menu__chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <ul
        id={menuId}
        role="menu"
        aria-labelledby={buttonId}
        className="download-menu__list"
        hidden={!open}
        onKeyDown={handleMenuKeyDown}
      >
        {platform.assets.map((asset, index) => (
          <li key={asset.id} role="none">
            <a
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="menuitem"
              href={asset.url}
              download={asset.fileName}
              className="download-menu__item"
              tabIndex={-1}
              onClick={() => close()}
            >
              <span className="download-menu__item-text">
                <span className="download-menu__item-label">{asset.label}</span>
                {asset.description && (
                  <span className="download-menu__item-desc">{asset.description}</span>
                )}
              </span>
              <span className="download-menu__item-size">{asset.sizeLabel}</span>
              <svg
                className="download-menu__item-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
