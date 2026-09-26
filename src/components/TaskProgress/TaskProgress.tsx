import { useTaskProgressStore } from '../../store/taskProgressStore';

/** Bottom-right progress panel for long tasks (OCR, merge, split). */
export function TaskProgressPanel() {
  const task = useTaskProgressStore((s) => s.task);
  const cancel = useTaskProgressStore((s) => s.cancel);
  if (!task) return null;
  const pct = task.total > 0 ? Math.round((task.done / task.total) * 100) : 0;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', right: 16, bottom: 40, zIndex: 9000, width: 300, padding: '10px 12px',
        borderRadius: 10, background: 'var(--color-bg-elevated, #26262b)', color: 'var(--color-text-primary, #f2f2f2)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)', font: '12px system-ui, -apple-system, sans-serif',
        border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.label}</span>
        <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{task.done} / {task.total}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(127,127,127,0.25)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-accent, #0a84ff)', transition: 'width 200ms' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          type="button"
          onClick={cancel}
          disabled={task.cancelled}
          style={{ height: 24, padding: '0 10px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        >
          {task.cancelled ? 'Stopping…' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
