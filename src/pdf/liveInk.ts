/**
 * Incremental ("wet / dry") geometry for the stroke being drawn.
 *
 * The committed stroke is drawn by inkGeometry (penShape / uniformStrokeOutline
 * after stabilizePoints). Re-running those over the whole stroke on every
 * pointer event costs O(n) per frame, O(n²) per stroke: a long Apple Pencil
 * line rebuilds and fills a path of tens of thousands of commands every frame.
 *
 * LiveInkBuilder produces exactly the same outline, split in two parts:
 *  - dry: pieces that can no longer change (later points do not affect them).
 *    They are drawn once onto a canvas that is never cleared during the stroke.
 *  - wet: the short tail near the pen (last points, stabilizer catch-up and
 *    the predicted points). It is redrawn on every event.
 * Every stage below mirrors its full-stroke counterpart in inkGeometry.ts
 * operation for operation, so dry + wet === the full outline (see
 * liveInk.test.ts) and the stroke does not change at pen-up.
 *
 * Opacity is not applied here: both layers are drawn opaque and the caller
 * applies the stroke's opacity to the group, so overlapping pieces never
 * darken (same look as one ctx.fill of the full outline).
 */
import type { InputPoint } from '../types/annotations';
import {
  STABILIZER_STREAMLINE,
  circlePath,
  hasRealPressure,
  mid,
  pressureWidth,
  pushCapsuleTrapezoid,
  quadToCubic,
  type InkStabilizer,
  type PathCommand,
} from './inkGeometry';

type XY = { x: number; y: number };

export interface LiveInkStyle {
  kind: 'pen' | 'highlighter';
  /** Line width in the coordinate space of the points (screen px). */
  width: number;
  smooth: boolean;
  /** The pen's pressure option (used only when the input has real pressure). */
  pressure: boolean;
  stabilizer?: InkStabilizer;
}

export interface LiveInkFrame {
  /** 'fill' → fill the commands; 'stroke' → stroke them with style.width, round caps/joins. */
  mode: 'fill' | 'stroke';
  /** The dry layer must be cleared before drawing `dry` (first frame or geometry mode change). */
  reset: boolean;
  /** New permanent pieces (append to the dry layer). */
  dry: PathCommand[];
  /** The whole provisional tail (replaces the previous wet layer). */
  wet: PathCommand[];
}

type GeometryKind = 'pressure' | 'uniform' | 'center' | 'highlight';

// ─── Streaming stages (each mirrors a loop in inkGeometry.ts) ────────────────

/** Mirrors sampleSmoothed(): quadratic midpoint curve, curvature-adaptive subdivision. */
class SmoothSampler {
  private count = 0;
  private a: InputPoint | null = null;
  private b: InputPoint | null = null;
  private from: InputPoint | null = null;
  constructor(private readonly smooth: boolean) {}

  clone(): SmoothSampler {
    const c = new SmoothSampler(this.smooth);
    c.count = this.count; c.a = this.a; c.b = this.b; c.from = this.from;
    return c;
  }

  push(q: InputPoint, out: (p: InputPoint) => void): void {
    if (!this.smooth) { out(q); return; }
    this.count++;
    if (this.count === 1) { this.a = q; return; }
    if (this.count === 2) { this.b = q; return; }
    const a = this.a!;
    const control = this.b!;
    if (this.count === 3) {
      out(a);
      this.from = { ...mid(a, control), pressure: (a.pressure + control.pressure) / 2, timestamp: 0 };
      out(this.from);
    }
    const from = this.from!;
    const to: InputPoint = { ...mid(control, q), pressure: (control.pressure + q.pressure) / 2, timestamp: 0 };
    const dx1 = control.x - from.x, dy1 = control.y - from.y;
    const dx2 = to.x - control.x, dy2 = to.y - control.y;
    const l1 = Math.hypot(dx1, dy1);
    const l2 = Math.hypot(dx2, dy2);
    const length = l1 + l2;
    let angleSteps = 1;
    if (l1 > 1e-4 && l2 > 1e-4) {
      const cosA = Math.max(-1, Math.min(1, (dx1 * dx2 + dy1 * dy2) / (l1 * l2)));
      const turnAngle = Math.acos(cosA);
      angleSteps = Math.ceil(turnAngle / 0.16);
    }
    const lenSteps = Math.ceil(length / 1.2);
    const steps = Math.max(1, Math.min(18, Math.max(lenSteps, angleSteps)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const ka = (1 - t) * (1 - t);
      const kb = 2 * (1 - t) * t;
      const kc = t * t;
      out({
        x: ka * from.x + kb * control.x + kc * to.x,
        y: ka * from.y + kb * control.y + kc * to.y,
        pressure: ka * from.pressure + kb * control.pressure + kc * to.pressure,
        timestamp: 0,
      });
    }
    this.from = to;
    this.a = control;
    this.b = q;
  }

  finish(out: (p: InputPoint) => void): void {
    if (!this.smooth) return;
    if (this.count === 1) out(this.a!);
    else if (this.count === 2) { out(this.a!); out(this.b!); }
    else if (this.count >= 3) out(this.b!);
  }
}

/**
 * Mirrors buildCapsuleOutline() fed by the 1e-6 duplicate filter and the
 * radius smoothing of pressureOutline() / uniformStrokeOutline().
 * A piece is emitted only once the radius it uses can no longer change.
 */
class CapsuleStream {
  // duplicate filter (compares with the previous unfiltered sample)
  private prevRaw: XY | null = null;
  // radius smoothing
  private r = 0;
  private started = false;
  // de-jitter + pieces
  private pending: { p: XY; r: number } | null = null; // last sample (isLast is unknown yet)
  private kept = 0;
  private last: XY | null = null;   // last kept point
  private lastR = 0;
  private prevKept: XY | null = null;
  private prevKeptR = 0;

  constructor(
    /** true → radius follows pressure (pressureOutline); false → constantR (uniformStrokeOutline). */
    private readonly pressure: boolean,
    private readonly constantR: number,
    private readonly baseWidth: number,
    private readonly roundEndCaps: boolean,
  ) {}

  clone(): CapsuleStream {
    const c = new CapsuleStream(this.pressure, this.constantR, this.baseWidth, this.roundEndCaps);
    c.prevRaw = this.prevRaw; c.r = this.r; c.started = this.started; c.pending = this.pending;
    c.kept = this.kept; c.last = this.last; c.lastR = this.lastR; c.prevKept = this.prevKept; c.prevKeptR = this.prevKeptR;
    return c;
  }

  push(p: InputPoint, out: PathCommand[]): void {
    const prevRaw = this.prevRaw;
    this.prevRaw = p;
    if (prevRaw && !(Math.hypot(p.x - prevRaw.x, p.y - prevRaw.y) > 1e-6)) return;
    let radius: number;
    if (this.pressure) {
      if (!this.started) this.r = pressureWidth(this.baseWidth, p.pressure) / 2;
      this.r = this.r * 0.6 + (pressureWidth(this.baseWidth, p.pressure) / 2) * 0.4;
      radius = Math.max(this.r, this.baseWidth * 0.05);
    } else {
      radius = this.constantR;
    }
    this.started = true;
    if (this.pending) this.consider(this.pending.p, this.pending.r, false, out);
    this.pending = { p, r: radius };
  }

  private consider(curr: XY, r: number, isLast: boolean, out: PathCommand[]): void {
    if (this.kept === 0) {
      this.keep(curr, r, out);
      return;
    }
    const prev = this.last!;
    const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const rMin = Math.min(this.lastR, r);
    const minStep = Math.max(0.05, rMin * 0.12);
    if (dist >= minStep || (isLast && dist > 1e-4)) {
      this.keep(curr, r, out);
    } else if (isLast) {
      this.lastR = Math.max(this.lastR, r);
    }
  }

  private keep(p: XY, r: number, out: PathCommand[]): void {
    // The previous kept point's radius is final now: emit what uses it.
    if (this.kept === 1 && this.roundEndCaps) pushCircle(out, this.last!, this.lastR);
    if (this.kept >= 2) {
      pushCapsuleTrapezoid(out, this.prevKept!, this.last!, this.prevKeptR, this.lastR);
      pushCircle(out, this.last!, this.lastR);
    }
    this.prevKept = this.last;
    this.prevKeptR = this.lastR;
    this.last = p;
    this.lastR = r;
    this.kept++;
  }

  finish(out: PathCommand[]): void {
    if (this.pending) {
      // buildCapsuleOutline: a single sample is a circle with its own radius.
      if (this.kept === 0) {
        pushCircle(out, this.pending.p, this.pending.r);
        return;
      }
      this.consider(this.pending.p, this.pending.r, true, out);
    }
    if (this.kept === 1) {
      pushCircle(out, this.last!, this.lastR);
    } else if (this.kept >= 2) {
      pushCapsuleTrapezoid(out, this.prevKept!, this.last!, this.prevKeptR, this.lastR);
      if (this.roundEndCaps) pushCircle(out, this.last!, this.lastR);
    }
  }
}

/** Mirrors centerlinePath(); every piece starts with a moveTo so it can be stroked on its own. */
class CenterlineStream {
  private count = 0;
  private a: XY | null = null;
  private b: XY | null = null;
  private current: XY | null = null;
  constructor(private readonly smooth: boolean) {}

  clone(): CenterlineStream {
    const c = new CenterlineStream(this.smooth);
    c.count = this.count; c.a = this.a; c.b = this.b; c.current = this.current;
    return c;
  }

  private lineTo(p: XY, out: PathCommand[]) {
    out.push({ op: 'M', x: this.current!.x, y: this.current!.y }, { op: 'L', x: p.x, y: p.y });
    this.current = p;
  }

  push(q: XY, out: PathCommand[]): void {
    this.count++;
    if (!this.smooth) {
      // Lines: the first point may still turn out to be a single dot (moveTo only).
      if (this.count === 1) { this.a = q; this.current = q; return; }
      this.lineTo(q, out);
      return;
    }
    if (this.count === 1) { this.a = q; return; }
    if (this.count === 2) { this.b = q; return; }
    const control = this.b!;
    if (this.count === 3) {
      this.current = this.a;
      this.lineTo(mid(this.a!, control), out);
    }
    const next = mid(control, q);
    out.push({ op: 'M', x: this.current!.x, y: this.current!.y }, quadToCubic(this.current!, control, next));
    this.current = next;
    this.a = control;
    this.b = q;
  }

  finish(out: PathCommand[]): void {
    if (!this.smooth) {
      if (this.count === 1) out.push({ op: 'M', x: this.a!.x, y: this.a!.y });
      return;
    }
    if (this.count === 1) {
      out.push({ op: 'M', x: this.a!.x, y: this.a!.y });
    } else if (this.count === 2) {
      out.push({ op: 'M', x: this.a!.x, y: this.a!.y }, { op: 'L', x: this.b!.x, y: this.b!.y });
    } else if (this.count >= 3) {
      this.lineTo(this.b!, out);
    }
  }
}

function pushCircle(out: PathCommand[], p: XY, r: number) {
  for (const c of circlePath(p.x, p.y, r)) out.push(c);
}

/** Sampler + capsule outline, or the centre line. */
class Pipeline {
  constructor(
    private readonly sampler: SmoothSampler | null,
    private readonly capsule: CapsuleStream | null,
    private readonly center: CenterlineStream | null,
  ) {}

  static create(kind: GeometryKind, style: LiveInkStyle): Pipeline {
    if (kind === 'center') return new Pipeline(null, null, new CenterlineStream(style.smooth));
    if (kind === 'highlight') {
      return new Pipeline(new SmoothSampler(true), new CapsuleStream(false, Math.max(0.25, style.width / 2), style.width, false), null);
    }
    if (kind === 'uniform') {
      return new Pipeline(new SmoothSampler(style.smooth), new CapsuleStream(false, Math.max(0.25, style.width / 2), style.width, true), null);
    }
    return new Pipeline(new SmoothSampler(style.smooth), new CapsuleStream(true, 0, style.width, true), null);
  }

  clone(): Pipeline {
    return new Pipeline(this.sampler?.clone() ?? null, this.capsule?.clone() ?? null, this.center?.clone() ?? null);
  }

  push(q: InputPoint, out: PathCommand[]): void {
    if (this.center) { this.center.push(q, out); return; }
    this.sampler!.push(q, (s) => this.capsule!.push(s, out));
  }

  finish(out: PathCommand[]): void {
    if (this.center) { this.center.finish(out); return; }
    this.sampler!.finish((s) => this.capsule!.push(s, out));
    this.capsule!.finish(out);
  }
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/** Width (screen px) from which a uniform pen stroke is filled as capsules (annotationRenderer). */
export const UNIFORM_FILL_MIN_WIDTH = 3.5;

export class LiveInkBuilder {
  private kind: GeometryKind | null = null;
  private pipeline: Pipeline | null = null;
  /** Stabilizer EMA of the input points (x, y only; index 0 is the first point). */
  private ema: XY[] = [];
  /** Stabilized points already fed to the pipeline. */
  private fed = 0;
  private readonly streamline: number;

  constructor(private readonly style: LiveInkStyle) {
    this.streamline = style.kind === 'pen' ? (STABILIZER_STREAMLINE[style.stabilizer ?? 'off'] ?? 0) : 0;
  }

  /**
   * `points`: the stroke so far (append-only between calls).
   * `predicted`: predicted points after it (drawn, never kept).
   */
  update(points: readonly InputPoint[], predicted: readonly InputPoint[] = []): LiveInkFrame {
    const style = this.style;
    const total = points.length + predicted.length;

    let kind: GeometryKind;
    if (style.kind === 'highlighter') kind = 'highlight';
    else if (style.pressure && hasRealPressure(points)) kind = 'pressure';
    else kind = style.width >= UNIFORM_FILL_MIN_WIDTH ? 'uniform' : 'center';
    const mode = kind === 'center' ? 'stroke' : 'fill';

    let reset = false;
    if (kind !== this.kind) {
      this.kind = kind;
      this.pipeline = Pipeline.create(kind, style);
      this.fed = 0;
      reset = true;
    }
    const dry: PathCommand[] = [];
    const wet: PathCommand[] = [];
    if (total === 0 || (style.kind === 'highlighter' && total < 2)) return { mode, reset, dry, wet };
    if (style.kind === 'pen' && total === 1) {
      // penShape: a single point is a dot of the nominal width.
      const p = points[0] ?? predicted[0];
      return { mode: 'fill', reset, dry, wet: circlePath(p.x, p.y, style.width / 2) };
    }

    const input = (p: InputPoint): InputPoint => (kind === 'uniform' || kind === 'highlight' ? { x: p.x, y: p.y, pressure: 0.5, timestamp: 0 } : p);

    // ── Stabilizer (mirrors stabilizePoints) ──
    const s = this.streamline;
    const t = 0.15 + (1 - s) * 0.85;
    for (let i = this.ema.length; i < points.length; i++) {
      if (i === 0) { this.ema.push({ x: points[0].x, y: points[0].y }); continue; }
      const prev = this.ema[i - 1];
      const p = points[i];
      this.ema.push({ x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t });
    }
    // Stabilized points that later input can no longer change.
    const P = points.length;
    const stable = s > 0 ? (P >= 4 ? P - 2 : 0) : P;
    const w = 0.14 + s * 0.12;
    const center = 1 - 2 * w;
    const pipeline = this.pipeline!;
    for (let j = this.fed; j < stable; j++) {
      let q: InputPoint;
      if (s <= 0 || j === 0) q = points[j];
      else {
        const p0 = this.ema[j - 1], p1 = this.ema[j], p2 = this.ema[j + 1];
        q = { ...points[j], x: p0.x * w + p1.x * center + p2.x * w, y: p0.y * w + p1.y * center + p2.y * w };
      }
      pipeline.push(input(q), dry);
    }
    this.fed = Math.max(this.fed, stable);

    // ── Wet tail ──
    const tail = pipeline.clone();
    for (const q of this.stabilizedTail(points, predicted, stable)) tail.push(input(q), wet);
    tail.finish(wet);
    return { mode, reset, dry, wet };
  }

  /** Stabilized points from index `from` to the end of points + predicted. */
  private stabilizedTail(points: readonly InputPoint[], predicted: readonly InputPoint[], from: number): InputPoint[] {
    const P = points.length;
    const N = P + predicted.length;
    const raw = (i: number) => (i < P ? points[i] : predicted[i - P]);
    const s = this.streamline;
    if (s <= 0 || N < 3) {
      const out: InputPoint[] = [];
      for (let i = from; i < N; i++) out.push(raw(i));
      return out;
    }
    const t = 0.15 + (1 - s) * 0.85;
    // EMA values for predicted points continue the chain of the real ones.
    const emaAt: XY[] = [];
    const ema = (i: number): XY => {
      if (i < P) return this.ema[i];
      const k = i - P;
      if (emaAt[k]) return emaAt[k];
      const prev = ema(i - 1);
      const p = raw(i);
      return (emaAt[k] = { x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t });
    };
    // out = [raw0, ema1 … ema(N-2), catch-up…, raw(N-1)] from index lo.
    const lo = Math.max(0, from - 1);
    const win: InputPoint[] = [];
    for (let j = lo; j <= N - 2; j++) win.push(j === 0 ? raw(0) : { ...raw(j), ...ema(j) });
    const last = raw(N - 1);
    const prev = ema(N - 2);
    const gap = Math.hypot(last.x - prev.x, last.y - prev.y);
    if (gap > 0.5) {
      const prev2 = N - 3 === 0 ? raw(0) : ema(N - 3);
      const ctrlX = prev.x + (prev.x - prev2.x) * 0.45;
      const ctrlY = prev.y + (prev.y - prev2.y) * 0.45;
      const steps = Math.min(8, Math.ceil(gap / 2));
      for (let k = 1; k < steps; k++) {
        const u = k / steps;
        const a = (1 - u) * (1 - u);
        const b = 2 * (1 - u) * u;
        const c = u * u;
        win.push({ ...last, x: a * prev.x + b * ctrlX + c * last.x, y: a * prev.y + b * ctrlY + c * last.y });
      }
    }
    win.push(last);
    const L = lo + win.length;
    const at = (j: number) => win[j - lo];
    const out: InputPoint[] = [];
    if (L < 4) {
      for (let j = from; j < L; j++) out.push(at(j));
      return out;
    }
    const w = 0.14 + s * 0.12;
    const center = 1 - 2 * w;
    for (let j = from; j < L; j++) {
      if (j === 0 || j === L - 1) { out.push(at(j)); continue; }
      const p0 = at(j - 1), p1 = at(j), p2 = at(j + 1);
      out.push({ ...p1, x: p0.x * w + p1.x * center + p2.x * w, y: p0.y * w + p1.y * center + p2.y * w });
    }
    return out;
  }
}

/**
 * A 2D context in low-latency mode (`desynchronized`) when the browser offers
 * it, else a normal one. Must be the first getContext() call on the canvas.
 * Set localStorage "malipdf.ink.lowLatency" to "off" to opt out.
 */
export function lowLatencyContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  let allowed = true;
  try {
    allowed = globalThis.localStorage?.getItem('malipdf.ink.lowLatency') !== 'off';
  } catch {
    // storage blocked: keep the default
  }
  if (allowed) {
    try {
      const ctx = canvas.getContext('2d', { desynchronized: true }) as CanvasRenderingContext2D | null;
      if (ctx) return ctx;
    } catch {
      // unsupported option: fall through
    }
  }
  return canvas.getContext('2d');
}

/** Whether a context actually runs desynchronized (front-buffer / low-latency). */
export function isDesynchronized(ctx: CanvasRenderingContext2D): boolean {
  try {
    return (ctx.getContextAttributes?.() as { desynchronized?: boolean } | undefined)?.desynchronized === true;
  } catch {
    return false;
  }
}
