import { useEffect, useState } from 'react';

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

  return { fullScreen, revealed };
}
