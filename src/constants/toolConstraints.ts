export interface WidthConstraint {
  min: number;
  max: number;
  default: number;
  step: number;
}

export const TOOL_WIDTH_CONSTRAINTS: Record<string, WidthConstraint> = {
  pen: {
    min: 0.5,
    max: 50,
    default: 3,
    step: 0.5,
  },
  highlighter: {
    min: 5,
    max: 100,
    default: 20,
    step: 1,
  },
  shape: {
    min: 0.5,
    max: 20,
    default: 2,
    step: 0.5,
  },
};
