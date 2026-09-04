import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import type { Theme } from '../../types/annotations';

export function ThemeToggle() {
  const { theme, setTheme } = useUIStore();

  const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: 'light',  icon: <Sun size={14} />,     label: 'Light' },
    { value: 'dark',   icon: <Moon size={14} />,    label: 'Dark' },
    { value: 'system', icon: <Monitor size={14} />, label: 'System' },
  ];

  const next = options[(options.findIndex((o) => o.value === theme) + 1) % options.length];
  const current = options.find((o) => o.value === theme)!;

  return (
    <button
      className="icon-btn"
      onClick={() => setTheme(next.value)}
      title={`Theme: ${current.label} → ${next.label}`}
      aria-label={`Switch to ${next.label} theme`}
      style={{ flexShrink: 0 }}
    >
      {current.icon}
    </button>
  );
}
