/**
 * Saving a document the user chose in a dialog.
 *
 * Normally the bytes go to a temporary file next to the target and are then
 * renamed over it, so a crash mid-write never leaves a half-written PDF.
 *
 * In the Mac App Store sandbox the app may only touch the file the user picked,
 * not its folder: creating the temporary file fails with EPERM/EACCES. Then the
 * file is written in place (still only the file the user chose).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const NO_FOLDER_ACCESS = new Set(['EPERM', 'EACCES', 'EROFS']);

export async function saveFile(filePath: string, bytes: Uint8Array, fsApi: Pick<typeof fs.promises, 'writeFile' | 'rename' | 'unlink'> = fs.promises): Promise<'atomic' | 'in-place'> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${crypto.randomUUID()}`);
  try {
    await fsApi.writeFile(tempPath, bytes);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (!code || !NO_FOLDER_ACCESS.has(code)) throw error;
    await fsApi.writeFile(filePath, bytes);
    return 'in-place';
  }
  try {
    await fsApi.rename(tempPath, filePath);
    return 'atomic';
  } catch (error) {
    await fsApi.unlink(tempPath).catch(() => {});
    throw error;
  }
}
