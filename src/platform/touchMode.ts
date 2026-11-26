/**
 * Tablet mode: on for iPad, when previewed with `?ipad=1`, and as a setting
 * for touch-screen PCs (Settings and the status bar). It enables the iPadOS
 * library & touch workspace and lets the pen draw while a finger scrolls and
 * pinch-zooms ("draw with the pen only").
 */
import { useUIStore } from '../store/uiStore';
import { isIpadApp, isIphoneDevice } from './native';

/** True when launched with ?ipad=1, ?tablet=1, or ?iphone=1 for browser preview. */
export function isIpadPreviewUrl(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('ipad') === '1' || params.get('tablet') === '1' || params.get('iphone') === '1';
  } catch {
    return false;
  }
}

/** Is the touch / iPadOS & iOS layout on right now? */
export function isTabletMode(state = useUIStore.getState()): boolean {
  return isIpadApp() || state.tabletMode || isIpadPreviewUrl();
}

/** A finger scrolls and zooms; only the pen (or mouse) draws. Disabled on iPhone (no Apple Pencil). */
export function fingerScrollsNow(state = useUIStore.getState()): boolean {
  if (isIphoneDevice()) return false;
  return isTabletMode(state) && state.pencilOnly;
}

/** Keeps the `tablet-mode` class on <html> in step with the setting. */
export function setUpTabletModeClass(): void {
  if (isIpadPreviewUrl() && !useUIStore.getState().tabletMode) {
    useUIStore.getState().setTabletMode(true);
  }
  useUIStore.subscribe(
    (state) => isTabletMode(state),
    (on) => document.documentElement.classList.toggle('tablet-mode', on),
    { fireImmediately: true },
  );
}
