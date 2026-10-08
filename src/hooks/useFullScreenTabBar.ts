import { useEffect, useState } from 'react';
import { useUIStore } from '../store/uiStore';

/** How close to the top edge (px) the pointer must come to show the tab bar. */
const REVEAL_EDGE = 6;
/** The tab bar hides again once the pointer is this far below it (px). */
const HIDE_BELOW = 120;

/**
 * In full screen the tab bar hides, like a browser's: moving the pointer to
 * the top edge slides it in, moving away hides it again.
 */
export function useFullScreenTabBar(): { fullScreen: boolean; revealed: boolean } {
  const [fullScreen, setFullScreen] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    void api?.isFullScreen?.().then(setFullScreen, () => undefined);
    return api?.onFullScreenChange?.((value) => {
      setFullScreen(value);
      setRevealed(false);
    });
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    const onMove = (event: PointerEvent) => {
      if (event.clientY <= REVEAL_EDGE) setRevealed(true);
      else if (event.clientY > HIDE_BELOW) setRevealed(false);
    };
    const onLeave = () => setRevealed(false);
    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [fullScreen]);

  // Esc leaves full screen, when nothing else used the key (a dialog, a text
  // box, a drawing in progress, Focus Mode or a presentation handle it first).
  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const ui = useUIStore.getState();
      if (ui.workspaceMode === 'focus' || ui.presentationOpen) return;
      void window.electronAPI?.setFullScreen?.(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreen]);

  return { fullScreen, revealed };
}
