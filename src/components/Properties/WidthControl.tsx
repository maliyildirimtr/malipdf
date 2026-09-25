import React, { useEffect, useRef, useState } from 'react';
import type { WidthConstraint } from '../../constants/toolConstraints';
import styles from './Properties.module.css';

interface WidthControlProps {
  value: number;
  constraint: WidthConstraint;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel?: () => void;
}

const WIDTH_PRESETS = [
  0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 100,
];

function formatValue(value: number): string {
  return value.toLocaleString(undefined, {
    useGrouping: false,
    maximumFractionDigits: 2,
  });
}

function parseValue(value: string): number {
  return Number.parseFloat(value.trim().replace(',', '.'));
}

export function WidthControl({ value, constraint, onChange, onCommit, onCancel }: WidthControlProps) {
  const [inputValue, setInputValue] = useState(() => formatValue(value));
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useRef(`width-presets-${Math.random().toString(36).slice(2)}`);

  const presets = WIDTH_PRESETS.filter(
    preset => preset >= constraint.min && preset <= constraint.max,
  );

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setInputValue(formatValue(value));
    }
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;

    const closeWhenOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeWhenOutside);
    return () => document.removeEventListener('pointerdown', closeWhenOutside);
  }, [isOpen]);

  const commitInput = () => {
    const parsed = parseValue(inputValue);
    if (!Number.isFinite(parsed)) {
      setInputValue(formatValue(value));
      return;
    }

    const clamped = Math.max(constraint.min, Math.min(constraint.max, parsed));
    const normalized = Math.round(clamped * 100) / 100;
    setInputValue(formatValue(normalized));
    onCommit(normalized);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextText = event.target.value;
    setInputValue(nextText);

    const parsed = parseValue(nextText);
    if (Number.isFinite(parsed) && parsed >= constraint.min && parsed <= constraint.max) {
      onChange(parsed);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitInput();
      setIsOpen(false);
      inputRef.current?.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setInputValue(formatValue(value));
      setIsOpen(false);
      onCancel?.();
      inputRef.current?.blur();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  const selectPreset = (preset: number) => {
    setInputValue(formatValue(preset));
    onChange(preset);
    onCommit(preset);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className={styles.widthControlContainer} ref={containerRef}>
      <div className={styles.widthInputWrapper}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          role="combobox"
          aria-label="Line width"
          aria-expanded={isOpen}
          aria-controls={listId.current}
          aria-autocomplete="list"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onClick={(event) => event.currentTarget.select()}
          onBlur={commitInput}
          onKeyDown={handleInputKeyDown}
          className={styles.widthInput}
        />
        <button
          type="button"
          className={styles.widthDropdownButton}
          aria-label="Show line width values"
          aria-expanded={isOpen}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            setIsOpen(open => !open);
            inputRef.current?.focus();
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>

        {isOpen && (
          <div id={listId.current} role="listbox" className={styles.widthDropdown}>
            {presets.map(preset => (
              <button
                type="button"
                role="option"
                aria-selected={Math.abs(value - preset) < 0.001}
                key={preset}
                className={`${styles.widthPresetOption} ${Math.abs(value - preset) < 0.001 ? styles.widthPresetSelected : ''}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => selectPreset(preset)}
              >
                {formatValue(preset)}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className={styles.widthUnit}>pt</span>
    </div>
  );
}
