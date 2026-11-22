/**
 * Windows / Linux: the window has no title bar of its own. The tab bar takes
 * its place and the system draws the minimize / maximize / close buttons
 * over its right end; their colours follow the app's light or dark theme.
 */
import { useUIStore } from '../store/uiStore';

const FALLBACK = { dark: '#121214', light: '#e4e4e9' } as const;

function titleBarColor(theme: 'light' | 'dark'): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-titlebar-bg').trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : FALLBACK[theme];
}

export function setUpOverlayTitleBar(): void {
  const api = window.electronAPI;
  if (!api?.setTitleBarColors) return;
  document.documentElement.classList.add('platform-overlay-titlebar');
  const apply = (theme: 'light' | 'dark') => {
    // After the theme attribute is applied, so the colour is the new one.
    requestAnimationFrame(() => api.setTitleBarColors?.({
      color: titleBarColor(theme),
      symbolColor: theme === 'dark' ? '#ffffff' : '#1f1f1f',
    }));
  };
  useUIStore.subscribe((state) => state.resolvedTheme, apply, { fireImmediately: true });
}
