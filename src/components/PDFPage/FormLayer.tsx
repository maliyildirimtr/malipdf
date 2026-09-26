/**
 * Fillable PDF forms: HTML inputs over the page's form fields. Values live in
 * the form store (one undo step per change) and are written into the PDF on
 * save, print and export. Active with the Select, Hand and Text tools; with a
 * pen the fields let the ink through.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { parseFormFields, type FormField, type FormValue } from '../../pdf/formFields';
import { pdfRectToScreenBounds, type PageTransform } from '../../pdf/coordinateTransform';
import { useFormStore } from '../../store/formStore';
import { useHistoryStore } from '../../store/historyStore';
import { useUIStore } from '../../store/uiStore';
import styles from './FormLayer.module.css';

const fieldCache = new WeakMap<PDFPageProxy, Promise<FormField[]>>();

function loadFields(page: PDFPageProxy): Promise<FormField[]> {
  let fields = fieldCache.get(page);
  if (!fields) {
    fields = page.getAnnotations({ intent: 'display' }).then(parseFormFields, () => []);
    fieldCache.set(page, fields);
  }
  return fields;
}

function setFieldValue(docId: string, name: string, next: FormValue, stored: FormValue) {
  const store = useFormStore.getState();
  const before = store.getValue(docId, name);
  const current = before ?? stored;
  if (current === next) return;
  store.setValue(docId, name, next);
  useHistoryStore.getState().push({ type: 'SET_FORM_VALUE', docId, fieldName: name, beforeValue: before, afterValue: next });
}

interface FormLayerProps {
  page: PDFPageProxy;
  transform: PageTransform;
  docId: string;
}

export function FormLayer({ page, transform, docId }: FormLayerProps) {
  const [fields, setFields] = useState<FormField[]>([]);
  const values = useFormStore((s) => s.values.get(docId));
  const tool = useUIStore((s) => s.temporaryTool ?? s.activeTool);
  const active = tool === 'select' || tool === 'hand' || tool === 'text';

  useEffect(() => {
    let alive = true;
    void loadFields(page).then((list) => { if (alive) setFields(list); });
    return () => { alive = false; };
  }, [page]);

  const placed = useMemo(() => fields.map((field) => {
    const [x1, y1, x2, y2] = field.rect;
    const box = pdfRectToScreenBounds({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }, transform);
    return { field, box };
  }), [fields, transform]);

  if (placed.length === 0) return null;

  return (
    <div className={`${styles.layer} ${active ? styles.active : ''}`} data-form-layer>
      {placed.map(({ field, box }) => {
        const value = values?.get(field.name) ?? field.value;
        const autoSize = Math.max(7, Math.min(box.height * 0.62, 14 * transform.scale));
        const fontSize = field.fontSize ? field.fontSize * transform.scale : autoSize;
        const style: React.CSSProperties = {
          left: box.x, top: box.y, width: box.width, height: box.height,
          fontSize, textAlign: field.align,
        };
        const key = field.id;
        const common = {
          style,
          disabled: field.readOnly,
          title: field.name,
          'aria-label': field.name,
          'data-field-name': field.name,
          onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
          onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
        };
        switch (field.kind) {
          case 'text':
            return field.multiLine
              ? <TextField key={key} {...common} multiLine field={field} value={String(value)} onCommit={(v) => setFieldValue(docId, field.name, v, field.value)} />
              : <TextField key={key} {...common} field={field} value={String(value)} onCommit={(v) => setFieldValue(docId, field.name, v, field.value)} />;
          case 'checkbox':
            return (
              <input key={key} {...common} type="checkbox" className={styles.check} checked={value === true}
                onChange={(e) => setFieldValue(docId, field.name, e.target.checked, field.value)} />
            );
          case 'radio':
            return (
              <input key={key} {...common} type="radio" className={`${styles.check} ${styles.radio}`} name={`${docId}:${field.name}`}
                checked={value === field.onValue}
                onChange={() => setFieldValue(docId, field.name, field.onValue ?? '', field.value)} />
            );
          case 'choice':
            return (
              <select key={key} {...common} className={styles.field} value={String(value)}
                onChange={(e) => setFieldValue(docId, field.name, e.target.value, field.value)}>
                {!field.options?.some((o) => o.value === value) && <option value={String(value)}>{String(value)}</option>}
                {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            );
        }
      })}
    </div>
  );
}

/** Text field: typing is local, the value is committed on blur or Enter. */
function TextField({ field, value, onCommit, multiLine, ...rest }: {
  field: FormField; value: string; onCommit: (value: string) => void; multiLine?: boolean;
} & Record<string, unknown>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = {
    ...rest,
    className: `${styles.field} ${multiLine ? styles.multiLine : ''}`,
    value: draft,
    maxLength: field.maxLen,
    spellCheck: false,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => onCommit(draft),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !multiLine) (e.target as HTMLInputElement).blur();
      if (e.key === 'Escape') { setDraft(value); (e.target as HTMLElement).blur(); }
    },
  };
  return multiLine ? <textarea {...props} /> : <input type="text" {...props} />;
}
