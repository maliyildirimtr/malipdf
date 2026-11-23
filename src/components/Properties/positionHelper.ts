export interface PositionAnchorBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface InspectorSize {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ComputePositionParams {
  anchorBounds: PositionAnchorBounds;
  inspectorSize: InspectorSize;
  viewportSize: ViewportSize;
  margin: number;
  gap: number;
  /** Prefer placing the bar above the anchor (ideal when typing with an on-screen keyboard). */
  preferAbove?: boolean;
}

export interface ComputedPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

export function computeInspectorPosition({
  anchorBounds,
  inspectorSize,
  viewportSize,
  margin,
  gap,
  preferAbove = false,
}: ComputePositionParams): ComputedPosition {
  let top: number;
  let placement: 'above' | 'below';

  if (preferAbove) {
    top = anchorBounds.top - gap - inspectorSize.height;
    placement = 'above';
    if (top < margin) {
      const spaceBelow = viewportSize.height - margin - anchorBounds.bottom;
      const spaceAbove = anchorBounds.top - margin;
      if (spaceBelow >= inspectorSize.height + gap || spaceBelow > spaceAbove) {
        top = anchorBounds.bottom + gap;
        placement = 'below';
      }
    }
  } else {
    top = anchorBounds.bottom + gap;
    placement = 'below';

    // If insufficient space below, try above
    if (top + inspectorSize.height > viewportSize.height - margin) {
      const spaceAbove = anchorBounds.top - margin;
      // We only flip above if it fits, or if there is MORE space above than below
      const spaceBelow = viewportSize.height - margin - anchorBounds.bottom;

      if (spaceAbove >= inspectorSize.height + gap || spaceAbove > spaceBelow) {
        top = anchorBounds.top - gap - inspectorSize.height;
        placement = 'above';
      }
    }
  }

  // Start centered horizontally relative to anchor
  let left = anchorBounds.left + (anchorBounds.width / 2) - (inspectorSize.width / 2);

  // Clamp left
  if (left < margin) {
    left = margin;
  }

  // Clamp right
  if (left + inspectorSize.width > viewportSize.width - margin) {
    left = viewportSize.width - margin - inspectorSize.width;
  }

  // Final vertical clamp just in case
  if (top < margin) {
    top = margin;
  }
  if (top + inspectorSize.height > viewportSize.height - margin) {
    top = viewportSize.height - margin - inspectorSize.height;
  }

  return { left, top, placement };
}
