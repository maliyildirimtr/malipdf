/**
 * The ruler overlay. Drag to move, scroll (or the ↺ ↻ buttons) to rotate,
 * double-click to straighten. Marks are in centimetres at the current zoom.
 */
import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, X } from 'lucide-react';
import { RULER_LENGTH, RULER_THICKNESS, useRulerStore } from '../../store/rulerStore';
import { useDocumentStore } from '../../store/documentStore';
import styles from './Ruler.module.css';

const POINTS_PER_CM = 72 / 2.54;

/** Screen angle (clockwise) → shown angle: counter-clockwise, 0–359, whole degrees. */
export function displayAngle(screenAngle: number): number {
  return ((Math.round(-screenAngle) % 360) + 360) % 360;
}

export function Ruler() {
  const { visible, x, y, angle, moveBy, rotateBy, setAngle, toggle } = useRulerStore();
  const zoom = useDocumentStore((s) => (s.activeDocId ? s.documents.get(s.activeDocId)?.zoom ?? 1 : 1));
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  // Shown counter-clockwise, 0–359° (30° = rising to the right), like a protractor.
  const shownAngle = displayAngle(angle);
  const [draft, setDraft] = useState(String(shownAngle));
  const [editing, setEditing] = useState(false);
  const cancelEdit = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(String(shownAngle));
  }, [shownAngle, editing]);
  if (!visible) return null;

  const commitDraft = () => {
    if (cancelEdit.current) {
      cancelEdit.current = false;
      setEditing(false);
      return;
    }
    const value = Number(draft.replace(',', '.').replace('°', '').trim());
    if (Number.isFinite(value)) setAngle(-value);
    setEditing(false);
  };

  const pxPerCm = POINTS_PER_CM * zoom;
  const ticks: React.ReactNode[] = [];
  const START = 10; // 0 cm mark, a little in from the left end
  for (let i = 0; START + i * (pxPerCm / 10) <= RULER_LENGTH - 4; i++) {
    const pos = START + i * (pxPerCm / 10);
    const major = i % 10 === 0;
    const half = !major && i % 5 === 0;
    ticks.push(
      <div key={i} className={styles.tick} style={{ left: pos, height: major ? 18 : half ? 12 : 7 }} />,
      <div key={`b${i}`} className={styles.tickBottom} style={{ left: pos, height: major ? 18 : half ? 12 : 7 }} />,
    );
    if (major) ticks.push(<span key={`l${i}`} className={styles.label} style={{ left: pos }}>{i / 10}</span>);
  }

  return (
    <div
      className={styles.ruler}
      role="slider"
      aria-label="Ruler"
      aria-valuenow={Math.round(angle)}
      aria-valuetext={`${Math.round(angle)} degrees`}
      tabIndex={0}
      style={{
        width: RULER_LENGTH,
        height: RULER_THICKNESS,
        left: x - RULER_LENGTH / 2,
        top: y - RULER_THICKNESS / 2,
        transform: `rotate(${angle}deg)`,
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, input')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!drag.current || drag.current.id !== e.pointerId) return;
        moveBy(e.clientX - drag.current.x, e.clientY - drag.current.y);
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onWheel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        rotateBy((e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 15 : 1));
      }}
      onDoubleClick={() => setAngle(0)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 15 : 1;
        if (e.key === 'ArrowLeft') rotateBy(-step);
        else if (e.key === 'ArrowRight') rotateBy(step);
        else if (e.key === 'Escape') toggle();
        else return;
        e.preventDefault();
      }}
    >
      {ticks}
      <div className={styles.center}>
        <button type="button" className={styles.button} onClick={() => rotateBy(-15)} title="Rotate left 15°" aria-label="Rotate left">
          <RotateCcw size={12} />
        </button>
        <label className={styles.angleField} style={{ transform: `rotate(${-angle}deg)` }} title="Type an angle and press Enter">
          <input
            className={styles.angleInput}
            value={editing ? draft : String(shownAngle)}
            inputMode="decimal"
            aria-label="Ruler angle in degrees"
            onFocus={(e) => {
              setEditing(true);
              setDraft(String(shownAngle));
              e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              e.stopPropagation(); // typing must not rotate the ruler or trigger tool shortcuts
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                cancelEdit.current = true;
                e.currentTarget.blur();
              }
            }}
          />
          °
        </label>
        <button type="button" className={styles.button} onClick={() => rotateBy(15)} title="Rotate right 15°" aria-label="Rotate right">
          <RotateCw size={12} />
        </button>
        <button type="button" className={styles.button} onClick={toggle} title="Hide ruler" aria-label="Hide ruler">
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
