import { useEffect, useRef } from 'react';
import { useUIStore } from '../store/uiStore';

/**
 * Focus Mode and presentations make the window full screen (like the green
 * button). When both end, the window goes back to how it was before.
 */
export function useImmersiveFullScreen(): void {
  const immersive = useUIStore((s) => s.workspaceMode === 'focus' || s.presentationOpen);
  /** Whether the window was full screen before; null while not immersive. */
  const before = useRef<boolean | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.setFullScreen) return;
    if (immersive && before.current === null) {
      before.current = false;
      void api.setFullScreen(true).then((was) => { before.current = was; }, () => undefined);
    } else if (!immersive && before.current !== null) {
      const was = before.current;
      before.current = null;
      if (!was) void api.setFullScreen(false).catch(() => undefined);
    }
  }, [immersive]);
}
