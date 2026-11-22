/**
 * Tablet mode: on for iPad, and a setting for touch-screen PCs (Settings and
 * the status bar). It makes buttons bigger and lets the pen draw while a
 * finger scrolls and pinch-zooms ("draw with the pen only").
 */
import { useUIStore } from '../store/uiStore';
import { isIpadApp } from './native';

/** Is the touch layout on right now? */
export function isTabletMode(state = useUIStore.getState()): boolean {
  return isIpadApp() || state.tabletMode;
}

/** A finger scrolls and zooms; only the pen (or mouse) draws. */
export function fingerScrollsNow(state = useUIStore.getState()): boolean {
  return isTabletMode(state) && state.pencilOnly;
}

/** Keeps the `tablet-mode` class on <html> in step with the setting. */
export function setUpTabletModeClass(): void {
  useUIStore.subscribe(
    (state) => isTabletMode(state),
    (on) => document.documentElement.classList.toggle('tablet-mode', on),
    { fireImmediately: true },
  );
}
