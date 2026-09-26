import { insertImageFromBytes } from '../../commands/imageCommands';
import { renderStampPng, stampSizePt, type StampSpec } from '../../pdf/stamps';
import { dataUrlToBytes } from '../../utils/assetBytes';
import { SIGNATURE_WIDTH_PT } from '../../utils/signaturePad';
import { notifyUser } from '../../utils/notify';

export async function insertSignature(dataUrl: string): Promise<boolean> {
  const bytes = dataUrlToBytes(dataUrl);
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('The saved signature could not be read.'));
    img.src = dataUrl;
  });
  const width = SIGNATURE_WIDTH_PT;
  const height = Math.max(8, Math.round((size.height / size.width) * width));
  return insertImageFromBytes(bytes.slice().buffer, 'image/png', { width, height });
}

export async function insertStamp(spec: StampSpec): Promise<boolean> {
  try {
    const png = await renderStampPng(spec);
    return insertImageFromBytes(png.bytes, 'image/png', stampSizePt(png.width, png.height, Boolean(spec.subtext)));
  } catch (error) {
    notifyUser('error', `Stamp could not be added: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
