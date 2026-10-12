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
 * finger scrolls it. Touch listeners must be non-passive to cancel scrolling,
 * so they are attached directly rather than through React.
 */
export function useStylusScrollGuard(ref: RefObject<HTMLElement>, enabled: boolean): void {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const guard = new StylusScrollGuard();
    const start = (event: TouchEvent) => {
      if (guard.touchStart(event.changedTouches, event.timeStamp) && event.cancelable) event.preventDefault();
    };
    const move = (event: TouchEvent) => {
      if (guard.touchMove(event.touches) && event.cancelable) event.preventDefault();
    };
    const end = (event: TouchEvent) => guard.touchEnd(event.changedTouches, event.timeStamp);
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
  }, [ref, enabled]);
}
