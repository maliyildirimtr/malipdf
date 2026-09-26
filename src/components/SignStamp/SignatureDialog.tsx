/** Draw a signature once; it is saved on this computer for reuse. */
import React, { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { canvasToTrimmedPng } from '../../utils/signaturePad';
import { notifyUser } from '../../utils/notify';
import styles from './SignStamp.module.css';

const INK_COLORS = [
  { label: 'Black', value: '#111111' },
  { label: 'Blue', value: '#1d3fbf' },
];

export function SignatureDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState(INK_COLORS[0].value);
  const [width, setWidth] = useState(3);
  const [empty, setEmpty] = useState(true);
  const addSignature = useUIStore((s) => s.addSignature);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ratio = Math.min(3, window.devicePixelRatio || 1) * 2;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const point = (event: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = point(event);
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(drawing.current.x, drawing.current.y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    setEmpty(false);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const events = 'getCoalescedEvents' in event.nativeEvent ? event.nativeEvent.getCoalescedEvents() : [];
    const points = (events.length ? events : [event.nativeEvent]).map((e) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure };
    });
    for (const next of points) {
      const pressure = event.pointerType === 'pen' && next.pressure > 0 ? 0.5 + next.pressure : 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * pressure;
      ctx.beginPath();
      ctx.moveTo(drawing.current.x, drawing.current.y);
      const mid = { x: (drawing.current.x + next.x) / 2, y: (drawing.current.y + next.y) / 2 };
      ctx.quadraticCurveTo(drawing.current.x, drawing.current.y, mid.x, mid.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
      drawing.current = next;
    }
  };

  const stop = () => {
    drawing.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  };

  const save = () => {
    const dataUrl = canvasToTrimmedPng(canvasRef.current!, 12);
    if (!dataUrl) return;
    if (!addSignature(dataUrl)) {
      notifyUser('error', 'The signature is too large to save.');
      return;
    }
    onSaved(dataUrl);
  };

  return (
    <div className={styles.overlay} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="signature-title">
        <div className={styles.dialogHeader}>
          <h2 id="signature-title">New Signature</h2>
          <p>Sign in the box with your mouse, trackpad or pen. It is saved on this computer only.</p>
        </div>
        <div className={styles.padWrap}>
          <canvas
            ref={canvasRef}
            className={styles.pad}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stop}
            onPointerCancel={stop}
            aria-label="Signature pad"
          />
          <div className={styles.padLine} aria-hidden="true" />
        </div>
        <div className={styles.dialogFooter}>
          <div className={styles.inkOptions}>
            {INK_COLORS.map((ink) => (
              <button
                key={ink.value}
                type="button"
                className={`${styles.inkSwatch} ${color === ink.value ? styles.inkSwatchActive : ''}`}
                style={{ background: ink.value }}
                onClick={() => setColor(ink.value)}
                title={ink.label}
                aria-label={`${ink.label} ink`}
                aria-pressed={color === ink.value}
              />
            ))}
            <label className={styles.widthLabel}>
              Thickness
              <input type="range" min={1.5} max={6} step={0.5} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
            </label>
          </div>
          <button type="button" className={styles.secondary} onClick={clear} disabled={empty}>Clear</button>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.primary} onClick={save} disabled={empty}>Save and Insert</button>
        </div>
      </div>
    </div>
  );
}
