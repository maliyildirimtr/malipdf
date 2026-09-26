/**
 * Split PDF: write several new PDFs into a folder the user chose in a dialog.
 * Only plain file names are accepted (no paths), always ending in .pdf, and
 * an existing file is never overwritten — a " (2)" style suffix is added.
 */
import fs from 'fs';
import path from 'path';

const MAX_NAME = 180;

export type OutputExtension = 'pdf' | 'png' | 'jpg';
const EXTENSIONS: readonly OutputExtension[] = ['pdf', 'png', 'jpg'];

export function outputExtension(raw: unknown): OutputExtension {
  return EXTENSIONS.includes(raw as OutputExtension) ? (raw as OutputExtension) : 'pdf';
}

/** A safe file name from any user-derived text, always ending in `.ext`. */
export function safeFileName(raw: unknown, ext: OutputExtension = 'pdf'): string {
  let name = typeof raw === 'string' ? raw : '';
  name = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '').replace(new RegExp(`\\.${ext}$`, 'i'), '').trim();
  if (!name) name = 'Document';
  if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME).trim();
  return `${name}.${ext}`;
}

/** A safe PDF file name from any user-derived text. */
export function safePdfFileName(raw: unknown): string {
  return safeFileName(raw, 'pdf');
}

/** `name`, or `name (2).pdf`, `name (3).pdf`… whichever is free. */
export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error('Too many files with the same name.');
}

/** Folders the user picked in a dialog this session. */
export class FolderGrants {
  private readonly folders = new Set<string>();
  grant(folder: string): void { this.folders.add(path.resolve(folder)); }
  has(folder: unknown): folder is string {
    return typeof folder === 'string' && path.isAbsolute(folder) && this.folders.has(path.resolve(folder));
  }
}

export interface FolderFile { name: string; data: Uint8Array; ext?: OutputExtension }

/** Write `files` into `folder` (already granted). Returns the names used. */
export async function writeFilesToFolder(folder: string, files: readonly FolderFile[]): Promise<string[]> {
  const written: string[] = [];
  const used = new Set<string>();
  for (const file of files) {
    const name = uniqueName(safeFileName(file.name, file.ext ?? 'pdf'), (candidate) =>
      used.has(candidate.toLowerCase()) || fs.existsSync(path.join(folder, candidate)));
    used.add(name.toLowerCase());
    const target = path.join(folder, name);
    if (path.dirname(target) !== path.resolve(folder)) throw new Error('Invalid file name.');
    await fs.promises.writeFile(target, file.data, { flag: 'wx' });
    written.push(name);
  }
  return written;
}
