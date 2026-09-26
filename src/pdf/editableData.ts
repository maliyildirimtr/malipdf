/**
 * Editable save ("MaliPDF data").
 *
 * Save still flattens annotations into the page content, so every PDF viewer
 * shows them. In addition, the saved file remembers exactly what MaliPDF added
 * to each page (content streams and resource names) plus the live annotation
 * objects (JSON) and image data, in a catalog entry /MaliPDFEditable.
 *
 * When MaliPDF opens such a file it removes its own drawing again (restoring
 * the original pages byte-for-byte in meaning), drops the now-unused objects
 * and gives the annotations back as editable objects. If another program
 * changed the pages in between, the data is ignored and the PDF opens as a
 * normal (flattened) PDF — nothing is ever thrown away silently.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import type { Annotation, Bookmark } from '../types/annotations';
import { removeAppendedBookmarks, type OutlineChange } from './outlineWriter';
import { removeMaliPdfNotes } from './noteExport';

export const EDITABLE_KEY = 'MaliPDFEditable';
export const EDITABLE_VERSION = 1;
const EXPORT_MARKER_KEY = 'MaliPDFExport';
const MARKER_BYTES = new TextEncoder().encode(`/${EDITABLE_KEY}`);
const SUB_DICTS = ['Font', 'XObject', 'ExtGState'] as const;

const N = (name: string) => PDFName.of(name);

export interface EditableAsset {
  id: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  data: Uint8Array;
}

interface PageBefore {
  contents: PDFRef[] | null;
  hadOwnResources: boolean;
  hadAnnots: boolean;
  resources: PDFDict | undefined;
  resourceKeys: Set<string>;
  subKeys: Record<(typeof SUB_DICTS)[number], Set<string> | null>;
}

export type EditableCapture = PageBefore[];

function keysOf(dict: PDFDict | undefined): Set<string> {
  return new Set(dict ? dict.keys().map((key) => key.decodeText()) : []);
}

function contentRefs(context: PDFContext, value: PDFObject | undefined): PDFRef[] | null {
  if (!value) return null;
  const resolved = value instanceof PDFRef ? context.lookup(value) : value;
  if (resolved instanceof PDFArray) {
    return resolved.asArray().filter((item): item is PDFRef => item instanceof PDFRef);
  }
  return value instanceof PDFRef ? [value] : null;
}

function inheritedResources(page: PDFPage): PDFDict | undefined {
  const value = page.node.getInheritableAttribute(N('Resources'));
  return page.doc.context.lookupMaybe(value, PDFDict);
}

/** Call BEFORE drawing anything: remembers each page's original state. */
export function captureEditableState(pdfDoc: PDFDocument): EditableCapture {
  const context = pdfDoc.context;
  return pdfDoc.getPages().map((page) => {
    const resources = inheritedResources(page);
    const subKeys = {} as PageBefore['subKeys'];
    for (const name of SUB_DICTS) {
      const sub = resources ? context.lookupMaybe(resources.get(N(name)), PDFDict) : undefined;
      subKeys[name] = sub ? keysOf(sub) : null;
    }
    return {
      contents: contentRefs(context, page.node.get(N('Contents'))),
      hadOwnResources: page.node.get(N('Resources')) !== undefined,
      hadAnnots: page.node.get(N('Annots')) !== undefined,
      resources,
      resourceKeys: keysOf(resources),
      subKeys,
    };
  });
}

function namesArray(context: PDFContext, names: string[]): PDFArray {
  return context.obj(names.map((name) => N(name))) as PDFArray;
}

/** Call AFTER drawing: stores the restore recipe and the live annotations. */
export function writeEditableData(
  pdfDoc: PDFDocument,
  before: EditableCapture,
  annotations: readonly Annotation[],
  assets: readonly EditableAsset[],
  bookmarks: readonly Bookmark[] = [],
  outline: OutlineChange | null = null,
): void {
  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();
  const records = pages.map((page, index) => {
    const original = before[index];
    const record = context.obj({}) as PDFDict;
    record.set(N('Contents'), original.contents ? context.obj(original.contents) : N('None'));
    record.set(N('Saved'), context.obj(contentRefs(context, page.node.get(N('Contents'))) ?? []));
    record.set(N('OwnResources'), context.obj(original.hadOwnResources));
    record.set(N('HadAnnots'), context.obj(original.hadAnnots));

    const resources = context.lookupMaybe(page.node.get(N('Resources')), PDFDict) ?? original.resources;
    const addedResources = [...keysOf(resources)].filter((key) => !original.resourceKeys.has(key));
    record.set(N('AddedResources'), namesArray(context, addedResources));
    for (const name of SUB_DICTS) {
      const sub = resources ? context.lookupMaybe(resources.get(N(name)), PDFDict) : undefined;
      const beforeKeys = original.subKeys[name];
      const added = sub && beforeKeys ? [...keysOf(sub)].filter((key) => !beforeKeys.has(key)) : [];
      record.set(N(`Added${name}`), namesArray(context, added));
    }
    return record;
  });

  const json = JSON.stringify({
    annotations,
    bookmarks,
    assets: assets.map(({ id, mimeType, width, height }) => ({ id, mimeType, width, height })),
  });
  const data = context.register(context.flateStream(new TextEncoder().encode(json)));
  const assetStreams = assets.map((asset) => context.register(context.flateStream(asset.data)));

  const entry = context.obj({
    Version: PDFNumber.of(EDITABLE_VERSION),
    PageCount: PDFNumber.of(pages.length),
    Pages: context.obj(records),
    Data: data,
    Assets: context.obj(assetStreams),
    Generator: PDFString.of('MaliPDF'),
  }) as PDFDict;
  if (outline) {
    entry.set(N('Outline'), context.obj({
      Had: outline.hadOutlines,
      Ref: outline.outlinesRef,
      Last: outline.oldLast ?? N('None'),
      Count: outline.oldCount ?? N('None'),
    }));
  }
  pdfDoc.catalog.set(N(EDITABLE_KEY), context.register(entry));
}

/** Cheap check so normal PDFs are never parsed twice. */
export function hasEditableMarker(bytes: Uint8Array): boolean {
  const first = MARKER_BYTES[0];
  outer: for (let i = bytes.indexOf(first); i !== -1 && i <= bytes.length - MARKER_BYTES.length; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < MARKER_BYTES.length; j++) {
      if (bytes[i + j] !== MARKER_BYTES[j]) continue outer;
    }
    return true;
  }
  return false;
}

function streamBytes(context: PDFContext, ref: PDFObject | undefined): Uint8Array {
  const stream = context.lookup(ref);
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (stream instanceof PDFStream) return stream.getContents();
  throw new Error('Missing data stream.');
}

function namesOf(dict: PDFDict, key: string): string[] {
  const array = dict.lookupMaybe(N(key), PDFArray);
  return array ? array.asArray().flatMap((item) => (item instanceof PDFName ? [item.decodeText()] : [])) : [];
}

function removeKeys(dict: PDFDict | undefined, keys: string[]): void {
  if (!dict) return;
  for (const key of keys) dict.delete(PDFName.of(key));
}

function sameRefs(a: PDFRef[], b: PDFRef[]): boolean {
  return a.length === b.length && a.every((ref, index) => ref === b[index]);
}

/** Delete every indirect object that is no longer reachable from the trailer. */
export function collectGarbage(context: PDFContext): number {
  const seen = new Set<PDFRef>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt } = context.trailerInfo;
  for (const start of [Root, Info, Encrypt]) if (start) stack.push(start);
  while (stack.length > 0) {
    const object = stack.pop()!;
    if (object instanceof PDFRef) {
      if (seen.has(object)) continue;
      seen.add(object);
      const target = context.lookup(object);
      if (target) stack.push(target);
    } else if (object instanceof PDFDict) {
      for (const value of object.values()) stack.push(value);
    } else if (object instanceof PDFArray) {
      stack.push(...object.asArray());
    } else if (object instanceof PDFStream) {
      stack.push(object.dict);
    }
  }
  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!seen.has(ref)) {
      context.delete(ref);
      removed++;
    }
  }
  return removed;
}

export type EditableOpenResult =
  | { kind: 'none' }
  | { kind: 'changedElsewhere' }
  | { kind: 'restored'; bytes: Uint8Array; annotations: Annotation[]; assets: EditableAsset[]; bookmarks: Bookmark[] };

/**
 * Turn a file saved by MaliPDF back into (original pages + live annotations).
 * Never throws: anything unexpected falls back to opening the file as-is.
 */
export async function extractEditableData(bytes: Uint8Array): Promise<EditableOpenResult> {
  if (!hasEditableMarker(bytes)) return { kind: 'none' };
  try {
    const pdfDoc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
    const context = pdfDoc.context;
    const entry = pdfDoc.catalog.lookupMaybe(N(EDITABLE_KEY), PDFDict);
    if (!entry) return { kind: 'none' };
    const version = entry.lookupMaybe(N('Version'), PDFNumber)?.asNumber();
    const records = entry.lookupMaybe(N('Pages'), PDFArray);
    const pages = pdfDoc.getPages();
    if (version !== EDITABLE_VERSION || !records || records.size() !== pages.length
      || entry.lookupMaybe(N('PageCount'), PDFNumber)?.asNumber() !== pages.length) {
      return { kind: 'changedElsewhere' };
    }

    // 1. Every page must still look exactly as MaliPDF saved it.
    const recordDicts = records.asArray().map((item) => context.lookup(item));
    for (let index = 0; index < pages.length; index++) {
      const record = recordDicts[index];
      if (!(record instanceof PDFDict)) return { kind: 'changedElsewhere' };
      const saved = contentRefs(context, record.get(N('Saved'))) ?? [];
      const current = contentRefs(context, pages[index].node.get(N('Contents'))) ?? [];
      if (!sameRefs(saved, current)) return { kind: 'changedElsewhere' };
    }

    // 2. Read the annotations before touching anything.
    const parsed = JSON.parse(new TextDecoder().decode(streamBytes(context, entry.get(N('Data'))))) as {
      annotations: Annotation[];
      assets: Omit<EditableAsset, 'data'>[];
      bookmarks?: Bookmark[];
    };
    if (!Array.isArray(parsed.annotations) || !Array.isArray(parsed.assets)) return { kind: 'changedElsewhere' };
    const assetRefs = entry.lookupMaybe(N('Assets'), PDFArray)?.asArray() ?? [];
    const assets: EditableAsset[] = parsed.assets.map((asset, index) => ({
      ...asset,
      data: streamBytes(context, assetRefs[index]),
    }));

    // 3. Remove MaliPDF's drawing from every page.
    pages.forEach((page, index) => {
      const record = recordDicts[index] as PDFDict;
      const node = page.node;
      const original = record.get(N('Contents'));
      const refs = original instanceof PDFName ? null : contentRefs(context, original);
      if (!refs) node.delete(N('Contents'));
      else node.set(N('Contents'), refs.length === 1 ? refs[0] : context.obj(refs));

      const cleanResources = (resources: PDFDict | undefined) => {
        if (!resources) return;
        for (const name of SUB_DICTS) {
          removeKeys(context.lookupMaybe(resources.get(N(name)), PDFDict), namesOf(record, `Added${name}`));
        }
        removeKeys(resources, namesOf(record, 'AddedResources'));
      };
      cleanResources(context.lookupMaybe(node.get(N('Resources')), PDFDict));
      if (record.get(N('OwnResources'))?.toString() === 'false') {
        node.delete(N('Resources'));
        cleanResources(inheritedResources(page)); // pdf-lib edited the shared parent dict too
      }
      removeMaliPdfNotes(pdfDoc, page);
      if (record.get(N('HadAnnots'))?.toString() === 'false') {
        const annots = node.lookupMaybe(N('Annots'), PDFArray);
        if (annots && annots.size() === 0) node.delete(N('Annots'));
      }
    });

    // 4. Take MaliPDF's bookmarks out of the table of contents again.
    const outline = entry.lookupMaybe(N('Outline'), PDFDict);
    if (outline) {
      const ref = outline.get(N('Ref'));
      const last = outline.get(N('Last'));
      const count = outline.get(N('Count'));
      if (ref instanceof PDFRef) {
        removeAppendedBookmarks(pdfDoc, {
          hadOutlines: outline.get(N('Had'))?.toString() === 'true',
          outlinesRef: ref,
          oldLast: last instanceof PDFRef ? last : null,
          oldCount: count instanceof PDFNumber ? count.asNumber() : null,
        });
      }
    }

    pdfDoc.catalog.delete(N(EDITABLE_KEY));
    pdfDoc.catalog.delete(N(EXPORT_MARKER_KEY));
    collectGarbage(context);
    const clean = await pdfDoc.save({ updateFieldAppearances: false });
    const bookmarks = Array.isArray(parsed.bookmarks)
      ? parsed.bookmarks.filter((b) => typeof b?.title === 'string' && Number.isInteger(b?.pageIndex) && b.pageIndex >= 0 && b.pageIndex < pages.length)
      : [];
    return { kind: 'restored', bytes: clean, annotations: parsed.annotations, assets, bookmarks };
  } catch (error) {
    console.warn('MaliPDF data could not be read; opening the PDF as-is.', error);
    return { kind: 'changedElsewhere' };
  }
}
