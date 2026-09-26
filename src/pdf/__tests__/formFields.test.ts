import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument } from 'pdf-lib';
import { exportAnnotatedPdf } from '../annotationExporter';
import { parseFormFields } from '../formFields';

const fontkitName = '@pdf-lib/fontkit';
const fontkit = await import(/* @vite-ignore */ fontkitName).then((m) => m.default, () => null);
const fonts = fontkit
  ? { fontkit, load: async () => new Uint8Array(readFileSync(resolve(__dirname, '../../assets/fonts/LiberationSans-Regular.ttf'))) }
  : undefined;

export async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  form.createTextField('name').addToPage(page, { x: 50, y: 330, width: 200, height: 22 });
  form.createCheckBox('agree').addToPage(page, { x: 50, y: 290, width: 14, height: 14 });
  const radio = form.createRadioGroup('size');
  radio.addOptionToPage('S', page, { x: 50, y: 250, width: 14, height: 14 });
  radio.addOptionToPage('L', page, { x: 80, y: 250, width: 14, height: 14 });
  const city = form.createDropdown('city');
  city.addOptions(['Ankara', 'İstanbul', 'İzmir']);
  city.addToPage(page, { x: 50, y: 200, width: 120, height: 20 });
  return doc.save();
}

describe('forms', () => {
  it('parses pdf.js widget data', () => {
    const fields = parseFormFields([
      { subtype: 'Widget', id: '1R', fieldType: 'Tx', fieldName: 'name', fieldValue: 'x', rect: [0, 0, 10, 10], textAlignment: 1 },
      { subtype: 'Widget', id: '2R', fieldType: 'Btn', checkBox: true, fieldName: 'agree', fieldValue: 'Yes', exportValue: 'Yes', rect: [0, 0, 5, 5] },
      { subtype: 'Widget', id: '3R', fieldType: 'Btn', radioButton: true, fieldName: 'size', fieldValue: 'Off', buttonValue: 'S', rect: [0, 0, 5, 5] },
      { subtype: 'Widget', id: '4R', fieldType: 'Ch', fieldName: 'city', fieldValue: ['Ankara'], options: [{ exportValue: 'Ankara', displayValue: 'Ankara' }], rect: [0, 0, 5, 5] },
      { subtype: 'Link', rect: [0, 0, 1, 1] },
      { subtype: 'Widget', fieldType: 'Btn', pushButton: true, fieldName: 'btn', rect: [0, 0, 1, 1] },
    ]);
    expect(fields.map((f) => [f.kind, f.name, f.value])).toEqual([
      ['text', 'name', 'x'], ['checkbox', 'agree', true], ['radio', 'size', ''], ['choice', 'city', 'Ankara'],
    ]);
    expect(fields[0].align).toBe('center');
  });

  it('writes values (Turkish text too) and keeps the form fillable', async () => {
    // Radio as pdf.js reports it: the appearance state of the second button.
    const values = new Map<string, string | boolean>([['name', 'Işık Ağaoğlu'], ['agree', true], ['size', '1'], ['city', 'İzmir']]);
    const out = await exportAnnotatedPdf(await formPdf(), new Map(), { formValues: values, fonts, editable: true });
    const form = (await PDFDocument.load(out.data)).getForm();
    expect(form.getTextField('name').getText()).toBe('Işık Ağaoğlu');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
    expect(form.getRadioGroup('size').getSelected()).toBe('L');
    expect(form.getDropdown('city').getSelected()).toEqual(['İzmir']);
  });
});
