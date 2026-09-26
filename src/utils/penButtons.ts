import type { ToolType } from '../types/annotations';

/**
 * Tool for a pen's extra buttons (Pointer Events: eraser end = button 5 /
 * buttons 32, barrel button = buttons 2), or null for the normal tip.
 */
export function penButtonTool(e: { pointerType: string; button: number; buttons: number }): ToolType | null {
  if (e.pointerType !== 'pen') return null;
  if (e.button === 5 || (e.buttons & 32) !== 0) return 'eraser';
  if (e.button === 2 || (e.buttons & 2) !== 0) return 'lasso';
  return null;
}

