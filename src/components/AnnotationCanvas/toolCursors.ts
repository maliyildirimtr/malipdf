/**
 * Tool cursors (icons from MaliPen, redrawn dark with a white halo so they
 * show on white paper and on dark pages alike). Hotspot = the drawing tip.
 */

function svgCursor(paths: string, hotX: number, hotY: number, fallback: string): string {
  const body = paths.replace(/#/g, '%23');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'>`
    + `<g stroke='white' stroke-width='4'>${body}</g><g stroke='#1d1d1f' stroke-width='1.6'>${body}</g></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'")}") ${hotX} ${hotY}, ${fallback}`;
}

export const PEN_CURSOR = svgCursor(
  "<path d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'/><path d='m15 5 4 4'/>", 2, 22, 'crosshair');

export const HIGHLIGHTER_CURSOR = svgCursor(
  "<path d='m9 11-6 6v3h9l3-3'/><path d='m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'/>", 3, 20, 'crosshair');

export const ERASER_CURSOR = svgCursor(
  "<path d='m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21'/><path d='M22 21H7'/><path d='m5 11 9 9'/>", 4, 20, 'cell');

/** A glowing red dot, centred on the pointer. */
export const LASER_CURSOR = `url("data:image/svg+xml,${[
  "%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E",
  "%3Ccircle cx='12' cy='12' r='9' fill='%23ff2d2d' fill-opacity='0.18'/%3E",
  "%3Ccircle cx='12' cy='12' r='5.5' fill='%23ff2d2d' fill-opacity='0.35'/%3E",
  "%3Ccircle cx='12' cy='12' r='3.5' fill='%23ff2d2d' stroke='white' stroke-width='1'/%3E",
  '%3C/svg%3E',
].join('')}") 12 12, crosshair`;
