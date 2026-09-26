/**
 * Values typed into PDF form fields, per document (field name → value).
 * Only changed fields are kept; the PDF itself holds the rest.
 */
import { create } from 'zustand';
import type { FormValue } from '../pdf/formFields';

interface FormStore {
  values: Map<string, Map<string, FormValue>>;
  getValue: (docId: string, name: string) => FormValue | undefined;
  setValue: (docId: string, name: string, value: FormValue | undefined) => void;
  getValues: (docId: string) => ReadonlyMap<string, FormValue>;
  clearDocument: (docId: string) => void;
}

const EMPTY = new Map<string, FormValue>();

export const useFormStore = create<FormStore>((set, get) => ({
  values: new Map(),
  getValue: (docId, name) => get().values.get(docId)?.get(name),
  setValue: (docId, name, value) => set((state) => {
    const values = new Map(state.values);
    const doc = new Map(values.get(docId) ?? []);
    if (value === undefined) doc.delete(name); else doc.set(name, value);
    values.set(docId, doc);
    return { values };
  }),
  getValues: (docId) => get().values.get(docId) ?? EMPTY,
  clearDocument: (docId) => set((state) => {
    if (!state.values.has(docId)) return state;
    const values = new Map(state.values);
    values.delete(docId);
    return { values };
  }),
}));
