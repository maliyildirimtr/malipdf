/**
 * Lightweight Web Audio synthesizer for optional writing-paper sound and
 * subtle tactile UI chimes (Hold-to-Shape snap, Eraser). Zero external assets,
 * 100% offline, and safe no-op in headless/test environments.
 */

let audioCtx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;
let lastWriteTickAt = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 0.12);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

/** Plays a very soft, realistic pencil-on-paper grain pulse while drawing. */
export function playWritingTick(speedPx = 4): void {
  const now = performance.now();
  if (now - lastWriteTickAt < 52) return;
  lastWriteTickAt = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const clampedSpeed = Math.max(1, Math.min(24, speedPx));
    filter.frequency.value = 1750 + clampedSpeed * 55;
    filter.Q.value = 1.6;

    const gain = ctx.createGain();
    const peak = Math.min(0.055, 0.015 + clampedSpeed * 0.0018);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.052);
  } catch {
    // Ignore audio errors on restricted devices
  }
}

/** Subtle crisp two-tone chime when Hold-to-Shape snaps a freehand stroke. */
export function playShapeSnapSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(990, t + 0.075);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.07, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  } catch {
    // Ignore
  }
}

/** Subtle soft brush sweep sound when erasing strokes. */
export function playEraseSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(340, t + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.095);
  } catch {
    // Ignore
  }
}
