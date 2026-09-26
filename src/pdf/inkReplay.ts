/**
 * Ink Replay: plays a page's annotations back in the order they were made,
 * strokes growing at (roughly) the speed they were drawn.
 */
import type { Annotation } from '../types/annotations';

export interface ReplayItem {
  annotation: Annotation;
  start: number;    // ms from the start of the replay
  duration: number; // ms (0 = appears at once)
}

export const REPLAY_GAP_MS = 180;
export const REPLAY_MIN_STROKE_MS = 120;
export const REPLAY_MAX_STROKE_MS = 2500;

function strokeDuration(annotation: Annotation): number {
  if (annotation.type !== 'stroke' && annotation.type !== 'highlight') return 0;
  const points = annotation.points;
  if (points.length < 2) return REPLAY_MIN_STROKE_MS;
  const recorded = points[points.length - 1].timestamp - points[0].timestamp;
  if (!Number.isFinite(recorded) || recorded <= 0) return 400;
  return Math.max(REPLAY_MIN_STROKE_MS, Math.min(REPLAY_MAX_STROKE_MS, recorded));
}

export function buildReplayPlan(annotations: readonly Annotation[]): ReplayItem[] {
  const ordered = annotations
    .map((annotation, index) => ({ annotation, index }))
    .filter(({ annotation }) => !annotation.hidden)
    .sort((a, b) => (a.annotation.createdAt - b.annotation.createdAt) || (a.index - b.index));
  let clock = 0;
  return ordered.map(({ annotation }) => {
    const duration = strokeDuration(annotation);
    const item = { annotation, start: clock, duration };
    clock += duration + REPLAY_GAP_MS;
    return item;
  });
}

export function replayLength(plan: readonly ReplayItem[]): number {
  const last = plan[plan.length - 1];
  return last ? last.start + last.duration : 0;
}

/** What is visible `elapsed` ms into the replay. */
export function replayFrame(plan: readonly ReplayItem[], elapsed: number): {
  done: Annotation[];
  partial: Annotation | null;
  finished: boolean;
} {
  const done: Annotation[] = [];
  let partial: Annotation | null = null;
  for (const item of plan) {
    if (elapsed < item.start) break;
    if (elapsed >= item.start + item.duration) {
      done.push(item.annotation);
      continue;
    }
    const ann = item.annotation;
    if (ann.type === 'stroke' || ann.type === 'highlight') {
      const t0 = ann.points[0].timestamp;
      const recorded = ann.points[ann.points.length - 1].timestamp - t0;
      const progress = (elapsed - item.start) / item.duration;
      const cutoff = recorded > 0 ? t0 + progress * recorded : null;
      const count = cutoff === null
        ? Math.max(1, Math.ceil(progress * ann.points.length))
        : ann.points.filter((p) => p.timestamp <= cutoff).length;
      const minimum = ann.type === 'highlight' ? 2 : 1;
      if (count >= minimum) partial = { ...ann, points: ann.points.slice(0, count) } as Annotation;
    }
    break;
  }
  return { done, partial, finished: elapsed >= replayLength(plan) };
}
