/** PDF from Images: one page per picture. */
import { PDFDocument } from 'pdf-lib';

export type ImagePageSize = 'image' | 'a4' | 'letter';

export interface PreparedImage { mimeType: 'image/png' | 'image/jpeg'; width: number; height: number; data: Uint8Array }

const PAPER: Record<Exclude<ImagePageSize, 'image'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Page size and image box for one picture (paper turns to match the picture). */
export function layoutImage(width: number, height: number, size: ImagePageSize, marginPt: number) {
  if (size === 'image') {
    // 1 px = 0.75 pt (96 dpi), limited to a sensible paper size.
    const scale = Math.min(0.75, 1440 / Math.max(width, height));
    const w = width * scale, h = height * scale;
    return { page: [w + marginPt * 2, h + marginPt * 2] as [number, number], box: { x: marginPt, y: marginPt, width: w, height: h } };
  }
  const [pw, ph] = PAPER[size];
  const landscape = width > height;
  const page: [number, number] = landscape ? [ph, pw] : [pw, ph];
  const aw = page[0] - marginPt * 2, ah = page[1] - marginPt * 2;
  const scale = Math.min(aw / width, ah / height);
  const w = width * scale, h = height * scale;
  return { page, box: { x: (page[0] - w) / 2, y: (page[1] - h) / 2, width: w, height: h } };
}

export async function imagesToPdf(images: readonly PreparedImage[], size: ImagePageSize, marginPt: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const image of images) {
    const embedded = image.mimeType === 'image/jpeg' ? await pdf.embedJpg(image.data) : await pdf.embedPng(image.data);
    const { page, box } = layoutImage(image.width, image.height, size, marginPt);
    pdf.addPage(page).drawImage(embedded, box);
  }
  return pdf.save();
}
