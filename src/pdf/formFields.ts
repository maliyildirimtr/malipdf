/**
 * PDF forms (AcroForm): read the fields pdf.js finds on a page, and write
 * the values the user typed back into the PDF with pdf-lib on save. The
 * fields stay fillable in other apps.
 */
import {
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFDocument,
  type PDFFont,
} from 'pdf-lib';

export type FormValue = string | boolean;

export interface FormField {
  /** pdf.js annotation id (unique per widget). */
  id: string;
  name: string;
  kind: 'text' | 'checkbox' | 'radio' | 'choice';
  /** [x1, y1, x2, y2] in PDF user space. */
  rect: [number, number, number, number];
  /** Value stored in the PDF. */
  value: FormValue;
  /** Checkbox / radio: the value this widget stands for. */
  onValue?: string;
  options?: { value: string; label: string }[];
  multiLine?: boolean;
  readOnly?: boolean;
  maxLen?: number;
  /** Font size from the field (0 = auto). */
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
}

interface PdfJsWidget {
  id?: string;
  subtype?: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: unknown;
  rect?: number[];
  readOnly?: boolean;
  hidden?: boolean;
  multiLine?: boolean;
  maxLen?: number;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  exportValue?: string;
  buttonValue?: string;
  options?: { exportValue?: string; displayValue?: string }[];
  textAlignment?: number;
  defaultAppearanceData?: { fontSize?: number };
}

/** Fillable fields among a page's pdf.js annotations. */
export function parseFormFields(annotations: readonly unknown[]): FormField[] {
  const out: FormField[] = [];
  for (const raw of annotations) {
    const a = raw as PdfJsWidget;
    if (a.subtype !== 'Widget' || !a.fieldName || !a.rect || a.rect.length !== 4 || a.hidden) continue;
    const rect = a.rect as [number, number, number, number];
    const base = { id: String(a.id ?? `${a.fieldName}-${rect.join(',')}`), name: a.fieldName, rect, readOnly: !!a.readOnly };
    if (a.fieldType === 'Tx') {
      out.push({
        ...base, kind: 'text',
        value: typeof a.fieldValue === 'string' ? a.fieldValue : '',
        multiLine: !!a.multiLine,
        maxLen: a.maxLen && a.maxLen > 0 ? a.maxLen : undefined,
        fontSize: a.defaultAppearanceData?.fontSize ?? 0,
        align: a.textAlignment === 1 ? 'center' : a.textAlignment === 2 ? 'right' : 'left',
      });
    } else if (a.fieldType === 'Btn' && a.checkBox) {
      const on = a.exportValue ?? 'Yes';
      out.push({ ...base, kind: 'checkbox', onValue: on, value: a.fieldValue === on });
    } else if (a.fieldType === 'Btn' && a.radioButton) {
      out.push({ ...base, kind: 'radio', onValue: a.buttonValue ?? '', value: typeof a.fieldValue === 'string' && a.fieldValue !== 'Off' ? a.fieldValue : '' });
    } else if (a.fieldType === 'Ch') {
      const value = Array.isArray(a.fieldValue) ? String(a.fieldValue[0] ?? '') : typeof a.fieldValue === 'string' ? a.fieldValue : '';
      out.push({
        ...base, kind: 'choice', value,
        options: (a.options ?? []).map((o) => ({ value: o.exportValue ?? o.displayValue ?? '', label: o.displayValue ?? o.exportValue ?? '' })),
        fontSize: a.defaultAppearanceData?.fontSize ?? 0,
      });
    }
  }
  return out;
}

/**
 * pdf.js reports a radio button by its appearance state (often "0", "1"),
 * pdf-lib selects by option (the /Opt export value when there is one).
 */
function radioOption(field: PDFRadioGroup, value: string): string | undefined {
  if (!value) return undefined;
  const options = field.getOptions();
  if (options.includes(value)) return value;
  const widgets = field.acroField.getWidgets();
  const index = widgets.findIndex((widget) => widget.getOnValue()?.decodeText() === value);
  return index >= 0 ? options[index] : undefined;
}

/** True when `text` can be drawn with Helvetica (WinAnsi). */
function winAnsi(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\u0000-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/.test(text);
}

/**
 * Write `values` (field name → value) into the PDF's form. `unicodeFont`
 * is used for field appearances when some text is outside WinAnsi.
 * Returns how many fields were changed.
 */
export async function applyFormValues(
  pdfDoc: PDFDocument,
  values: ReadonlyMap<string, FormValue>,
  unicodeFont?: () => Promise<PDFFont | undefined>,
): Promise<number> {
  if (values.size === 0) return 0;
  const form = pdfDoc.getForm();
  let changed = 0;
  let needsUnicode = false;
  for (const [name, value] of values) {
    const field = form.getFieldMaybe(name);
    if (!field) continue;
    if (field instanceof PDFTextField) {
      const text = String(value);
      const max = field.getMaxLength();
      field.setText(max !== undefined ? text.slice(0, max) : text);
      if (!winAnsi(text)) needsUnicode = true;
    } else if (field instanceof PDFCheckBox) {
      if (value === true) field.check(); else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      const option = typeof value === 'string' ? radioOption(field, value) : undefined;
      if (option) field.select(option);
      else if (value === '') field.clear();
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const text = String(value);
      if (text && field.getOptions().includes(text)) field.select(text);
      else if (field instanceof PDFDropdown && text && field.isEditable()) field.select(text);
      else if (!text) field.clear();
      if (!winAnsi(text)) needsUnicode = true;
    } else {
      continue;
    }
    changed++;
  }
  if (changed) {
    const font = needsUnicode && unicodeFont ? await unicodeFont() : undefined;
    try {
      form.updateFieldAppearances(font);
    } catch (error) {
      // Other viewers rebuild appearances from the values.
      console.warn('[Forms] Field appearances could not be updated:', error);
      form.acroForm.dict.set(PDFName.of('NeedAppearances'), pdfDoc.context.obj(true));
    }
  }
  return changed;
}
