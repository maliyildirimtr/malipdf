/**
 * iPad input rules for "draw with Apple Pencil only".
 *
 * With the setting on, the Pencil draws and a finger scrolls the document
 * natively (with momentum). A finger still taps with the select, text and
 * note tools. A palm resting on the screen while writing does not scroll.
 */
import { useEffect, type RefObject } from 'react';
import type { ToolType } from '../types/annotations';

/** Tools a finger still uses (taps) when the Pencil does the drawing. */
const FINGER_TAP_TOOLS: ReadonlySet<ToolType> = new Set<ToolType>(['select', 'text', 'note']);

/** A touch within this time after the Pencil lifted is a resting palm. */
export const PALM_AFTER_PENCIL_MS = 600;

/** Should this pointer scroll the page instead of using the tool? */
export function fingerNavigates(pointerType: string, tool: ToolType, pencilOnly: boolean): boolean {
  return pencilOnly && pointerType === 'touch' && !FINGER_TAP_TOOLS.has(tool);
}

type TouchWithType = Touch & { touchType?: 'stylus' | 'direct' };
const isStylus = (touch: Touch) => (touch as TouchWithType).touchType === 'stylus';

/** Decides which touches may scroll: never the Pencil, never a palm next to it. */
export class StylusScrollGuard {
  private pencilDown = false;
  private pencilUpAt = -Infinity;

  /** True when the touch must not scroll (the caller prevents its default). */
  touchStart(touches: ArrayLike<Touch>, timeStamp: number): boolean {
    if (Array.from(touches).some(isStylus)) {
      this.pencilDown = true;
      return true;
    }
    return this.pencilDown || timeStamp - this.pencilUpAt < PALM_AFTER_PENCIL_MS;
  }

  touchMove(touches: ArrayLike<Touch>): boolean {
    return this.pencilDown || Array.from(touches).some(isStylus);
  }

  touchEnd(changed: ArrayLike<Touch>, timeStamp: number): void {
    if (Array.from(changed).some(isStylus)) {
      this.pencilDown = false;
      this.pencilUpAt = timeStamp;
    }
  }
}

/**
 * Keeps the Pencil (and a resting palm) from scrolling the page while a
 * finger scrolls it — EXCEPT when a single finger touches an interactive
 * selection target (e.g. selected image or resize handle), where scrolling is
 * prevented so the finger can smoothly drag or resize the object.
 * Touch listeners must be non-passive to cancel scrolling.
 */
export function useStylusScrollGuard(
  ref: RefObject<HTMLElement>,
  enabled: boolean,
  shouldBlockFingerTouch?: (clientX: number, clientY: number) => boolean,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const guard = new StylusScrollGuard();
    let fingerManipulating = false;

    const start = (event: TouchEvent) => {
      const hasStylusNow = guard.touchStart(event.touches, event.timeStamp)
        || guard.touchStart(event.changedTouches, event.timeStamp);
      if (hasStylusNow) {
        fingerManipulating = false;
        if (event.cancelable) event.preventDefault();
        return;
      }
      // Two or more fingers -> always allow native pinch-zoom / pan
      if (event.touches.length !== 1) {
        fingerManipulating = false;
        return;
      }
      const t = event.touches[0];
      if (t && shouldBlockFingerTouch?.(t.clientX, t.clientY)) {
        fingerManipulating = true;
        if (event.cancelable) event.preventDefault();
      } else {
        fingerManipulating = false;
      }
    };
    const move = (event: TouchEvent) => {
      if (guard.touchMove(event.touches)) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (event.touches.length !== 1) {
        fingerManipulating = false;
        return;
      }
      if (fingerManipulating && event.cancelable) {
        event.preventDefault();
      }
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        fingerManipulating = false;
      }
      // Only clear pencilDown if no stylus touch remains active.
      if (!Array.from(event.touches).some(isStylus)) {
        guard.touchEnd(event.changedTouches, event.timeStamp);
      }
    };
    element.addEventListener('touchstart', start, { passive: false });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', end);
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', end);
    };
  }, [ref, enabled, shouldBlockFingerTouch]);
}
