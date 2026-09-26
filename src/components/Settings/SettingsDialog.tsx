/**
 * Settings (⌘,): appearance, pen and tool defaults, and the keyboard
 * shortcuts. Everything here is saved automatically.
 */
import React, { useEffect, useState } from 'react';
import { useUIStore, type PageTheme } from '../../store/uiStore';
import { APP_COMMANDS, TOOL_SHORTCUTS } from '../../commands/commandRegistry';
import { MEASURE_UNITS } from '../../pdf/measure';
import { LANGUAGES, type Language } from '../../../electron/i18n';
import type { MeasureUnit, PenOptions, Theme } from '../../types/annotations';
import styles from './SettingsDialog.module.css';

type Tab = 'appearance' | 'pen' | 'tools' | 'shortcuts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'pen', label: 'Pen & Ink' },
  { id: 'tools', label: 'Tools' },
  { id: 'shortcuts', label: 'Shortcuts' },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? styles.segOn : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Color({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input type="color" className={styles.color} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={`${styles.switch} ${checked ? styles.switchOn : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function Num({ value, min, max, step = 1, unit, onChange, label }: { value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; label: string }) {
  return (
    <span className={styles.num}>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{Number.isInteger(step) ? value : value.toFixed(2)}{unit ? ` ${unit}` : ''}</output>
    </span>
  );
}

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<Tab>('appearance');
  const [confirmReset, setConfirmReset] = useState(false);
  const ui = useUIStore();

  useEffect(() => {
    if (!open) setConfirmReset(false);
  }, [open]);

  if (!open) return null;
  const { toolOptions: t } = ui;
  const pen = (patch: Partial<PenOptions>) => ui.updatePenOptions(patch);

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); }}>
      <div className={styles.dialog} role="dialog" aria-label="Settings">
        <nav className={styles.nav} aria-label="Settings sections">
          <h2>Settings</h2>
          {TABS.map((x) => (
            <button key={x.id} type="button" className={tab === x.id ? styles.navOn : ''} aria-current={tab === x.id} onClick={() => setTab(x.id)}>{x.label}</button>
          ))}
        </nav>
        <div className={styles.body}>
          {tab === 'appearance' && (
            <section>
              <h3>Appearance</h3>
              <Row label="App theme">
                <Segmented<Theme> label="App theme" value={ui.theme} onChange={ui.setTheme}
                  options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
              </Row>
              <Row label="Pages" hint="How PDF pages look on screen. Printing and saving are not affected.">
                <Segmented<PageTheme> label="Page look" value={ui.pageTheme} onChange={ui.setPageTheme}
                  options={[{ value: 'normal', label: 'Normal' }, { value: 'dark', label: 'Night' }, { value: 'sepia', label: 'Sepia' }]} />
              </Row>
              <Row label="Language" hint="Menus, buttons and messages.">
                <div data-no-translate>
                  <Segmented<Language> label="Interface language" value={ui.language} onChange={ui.setLanguage}
                    options={LANGUAGES.map((l) => ({ value: l.value, label: l.label }))} />
                </div>
              </Row>
              <Row label="Sidebar" hint="Show the page sidebar when a document opens.">
                <Toggle label="Show sidebar" checked={ui.sidebarOpen} onChange={(v) => ui.setSidebarOpen(v)} />
              </Row>
            </section>
          )}

          {tab === 'pen' && (
            <section>
              <h3>Pen</h3>
              <Row label="Colour"><Color label="Pen colour" value={t.pen.color} onChange={(color) => pen({ color })} /></Row>
              <Row label="Width"><Num label="Pen width" value={t.pen.width} min={0.5} max={20} step={0.5} unit="pt" onChange={(width) => pen({ width })} /></Row>
              <Row label="Pressure" hint="Line width follows Apple Pencil / stylus pressure.">
                <Toggle label="Pressure" checked={t.pen.pressureSensitive} onChange={(pressureSensitive) => pen({ pressureSensitive })} />
              </Row>
              <Row label="Stabilizer" hint="Smooths out hand tremor.">
                <Segmented label="Stabilizer" value={t.pen.stabilizer ?? 'off'} onChange={(stabilizer) => pen({ stabilizer })}
                  options={[{ value: 'off', label: 'Off' }, { value: 'basic', label: 'Basic' }, { value: 'soft', label: 'Soft' }, { value: 'silky', label: 'Silky' }, { value: 'fluid', label: 'Fluid' }]} />
              </Row>
              <Row label="Hold to shape" hint="Hold the pen still at the end of a line to turn it into a clean shape.">
                <Toggle label="Hold to shape" checked={t.pen.holdToShape ?? false} onChange={(holdToShape) => pen({ holdToShape })} />
              </Row>
              <Row label="Ink to shape" hint="Every finished stroke that looks like a shape becomes one.">
                <Toggle label="Ink to shape" checked={t.pen.inkToShape ?? false} onChange={(inkToShape) => pen({ inkToShape })} />
              </Row>
              <h3>Highlighter</h3>
              <Row label="Colour"><Color label="Highlighter colour" value={t.highlighter.color} onChange={(color) => ui.updateHighlighterOptions({ color })} /></Row>
              <Row label="Width"><Num label="Highlighter width" value={t.highlighter.width} min={4} max={40} unit="pt" onChange={(width) => ui.updateHighlighterOptions({ width })} /></Row>
              <Row label="Opacity"><Num label="Highlighter opacity" value={t.highlighter.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => ui.updateHighlighterOptions({ opacity })} /></Row>
              <h3>Eraser</h3>
              <Row label="Erases">
                <Segmented label="Eraser mode" value={t.eraser.mode} onChange={(mode) => ui.updateEraserOptions({ mode })}
                  options={[{ value: 'stroke', label: 'Part of a line' }, { value: 'object', label: 'Whole objects' }]} />
              </Row>
            </section>
          )}

          {tab === 'tools' && (
            <section>
              <h3>Laser pointer</h3>
              <Row label="Colour"><Color label="Laser colour" value={ui.laserOptions.color} onChange={(color) => ui.updateLaserOptions({ color })} /></Row>
              <Row label="Fade after"><Num label="Laser fade" value={ui.laserOptions.durationMs / 1000} min={0.5} max={5} step={0.5} unit="s" onChange={(s) => ui.updateLaserOptions({ durationMs: s * 1000 })} /></Row>
              <h3>Text</h3>
              <Row label="Size"><Num label="Text size" value={t.text.fontSize} min={8} max={48} unit="pt" onChange={(fontSize) => ui.updateTextOptions({ fontSize })} /></Row>
              <Row label="Colour"><Color label="Text colour" value={t.text.color} onChange={(color) => ui.updateTextOptions({ color })} /></Row>
              <h3>Sticky notes</h3>
              <Row label="Colour"><Color label="Note colour" value={t.note.color} onChange={(color) => ui.updateNoteOptions({ color })} /></Row>
              <h3>Measure</h3>
              <Row label="Scale" hint="Drawing scale for plans and maps.">
                <select className={styles.select} value={t.measure.scale} aria-label="Measure scale" onChange={(e) => ui.updateMeasureOptions({ scale: Number(e.target.value) })}>
                  {[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].map((s) => <option key={s} value={s}>1:{s}</option>)}
                </select>
              </Row>
              <Row label="Unit">
                <select className={styles.select} value={t.measure.unit} aria-label="Measure unit" onChange={(e) => ui.updateMeasureOptions({ unit: e.target.value as MeasureUnit })}>
                  {MEASURE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Row>
              <div className={styles.reset}>
                {confirmReset ? (
                  <>
                    <span>Reset every tool's colour, width and options?</span>
                    <button type="button" className={styles.danger} onClick={() => { ui.resetToolDefaults(); setConfirmReset(false); }}>Reset</button>
                    <button type="button" onClick={() => setConfirmReset(false)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmReset(true)}>Reset Tools to Defaults…</button>
                )}
              </div>
            </section>
          )}

          {tab === 'shortcuts' && (
            <section>
              <h3>Tools</h3>
              <dl className={styles.keys}>
                {TOOL_SHORTCUTS.map((s) => (<React.Fragment key={s.key}><dt>{s.label}</dt><dd><kbd>{s.key}</kbd></dd></React.Fragment>))}
                <dt>Hand (hold)</dt><dd><kbd>Space</kbd></dd>
              </dl>
              <h3>Commands</h3>
              <dl className={styles.keys}>
                {Object.values(APP_COMMANDS).filter((c) => c.shortcut && c.group !== 'tool' && c.availability !== 'unavailable').map((c) => (
                  <React.Fragment key={c.id}><dt>{c.label.replace(/…$/, '')}</dt><dd><kbd>{c.shortcut}</kbd></dd></React.Fragment>
                ))}
              </dl>
            </section>
          )}
        </div>
        <button type="button" className={styles.close} aria-label="Close settings" onClick={() => setOpen(false)}>×</button>
      </div>
    </div>
  );
}
