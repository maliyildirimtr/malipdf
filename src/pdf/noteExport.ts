/**
 * Sticky notes are saved as real PDF comments (/Text annotations), so Acrobat,
 * Preview and other apps show them as notes. Each one carries an appearance
 * stream with MaliPDF's icon and a /MaliPDFNote marker, so an editable save
 * can take them out again when the file is reopened in MaliPDF.
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFString, type PDFDocument, type PDFPage } from 'pdf-lib';
import { NOTE_ICON_SIZE, type NoteAnnotation } from '../types/annotations';
import { NOTE_ICON_PATHS, NOTE_ICON_STROKE, noteShade } from './noteIcon';

export const NOTE_MARKER = 'MaliPDFNote';

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xf5c400;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round((c / 255) * 1000) / 1000) as [number, number, number];
}

const num = (value: number) => String(Math.round(value * 1000) / 1000);

/** Content stream that draws the icon in a SIZE × SIZE box (y up). */
export function noteIconContent(color: string, size = NOTE_ICON_SIZE): string {
  const fill = rgb(color).map(num).join(' ');
  const dark = rgb(noteShade(color)).map(num).join(' ');
  const ops: string[] = [`${num(NOTE_ICON_STROKE * size)} w 1 J 1 j`, `${dark} RG`];
  for (const part of NOTE_ICON_PATHS) {
    part.points.forEach(([u, v], i) => ops.push(`${num(u * size)} ${num((1 - v) * size)} ${i === 0 ? 'm' : 'l'}`));
    if (part.role === 'body') ops.push('h', `${fill} rg`, 'B');
    else if (part.role === 'fold') ops.push('h', `${dark} rg`, 'f');
    else ops.push('S');
  }
  return ops.join('\n');
}

/** Add `note` to `page` as a /Text annotation. */
export function addNoteAnnotation(pdfDoc: PDFDocument, page: PDFPage, note: NoteAnnotation): void {
  const context = pdfDoc.context;
  const rect = [note.x, note.y, note.x + NOTE_ICON_SIZE, note.y + NOTE_ICON_SIZE];
  const appearance = context.stream(noteIconContent(note.color), {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, NOTE_ICON_SIZE, NOTE_ICON_SIZE],
    Resources: {},
  });
  const dict = context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: rect,
    Name: 'Note',
    F: 4 | 8 | 16, // Print, NoZoom, NoRotate
    C: rgb(note.color),
    CA: Math.max(0, Math.min(1, note.opacity)),
    Open: false,
    AP: { N: context.register(appearance) },
  }) as PDFDict;
  dict.set(PDFName.of('Contents'), PDFHexString.fromText(note.content));
  dict.set(PDFName.of('NM'), PDFString.of(note.id));
  dict.set(PDFName.of('M'), PDFString.fromDate(new Date(note.updatedAt)));
  dict.set(PDFName.of(NOTE_MARKER), context.obj(true));
  page.node.addAnnot(context.register(dict));
}

/** Remove the notes MaliPDF added to a page (editable reopen). */
export function removeMaliPdfNotes(pdfDoc: PDFDocument, page: PDFPage): void {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return;
  for (let i = annots.size() - 1; i >= 0; i--) {
    const annot = pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
    if (annot?.get(PDFName.of(NOTE_MARKER))?.toString() === 'true') annots.remove(i);
  }
}
