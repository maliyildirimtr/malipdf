/**
 * Cross-device sync folder access (iCloud Drive / OneDrive / Dropbox / a
 * folder the user picked).
 *
 * The renderer only names a folder and a plain file name. The main process
 * decides whether that folder may be touched: it must be a folder the user
 * picked in a dialog this session, or one of the detected cloud folders. Paths
 * are compared after resolving symlinks, so another spelling of the same
 * folder works but a renderer cannot widen access to an arbitrary path.
 */
import fs from 'fs';
import path from 'path';
import { saveFile } from '../saveFile';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Real path of `p`; for a not-yet-created folder, the real path of its parent + its name. */
async function realPathOrIntended(p: string): Promise<string> {
  try {
    return await fs.promises.realpath(p);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(await realPathOrIntended(parent), path.basename(p));
  }
}

function normalizeForCompare(p: string): string {
  // Windows and default macOS volumes are case-insensitive.
  return process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;
}

/**
 * Returns the resolved folder when it is one of `allowed` (folders the user
 * picked + detected cloud folders), otherwise throws.
 */
export async function authorizeSyncFolder(folder: unknown, allowed: readonly string[]): Promise<string> {
  if (typeof folder !== 'string' || folder.length === 0 || folder.length > 2048 || !path.isAbsolute(folder)) {
    throw new TypeError('Invalid sync folder.');
  }
  const resolved = path.resolve(folder);
  const real = normalizeForCompare(await realPathOrIntended(resolved));
  for (const candidate of allowed) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    const allowedReal = normalizeForCompare(await realPathOrIntended(path.resolve(candidate)).catch(() => path.resolve(candidate)));
    if (allowedReal === real) return resolved;
  }
  throw new Error('Sync folder is not authorized.');
}

/**
 * A single file name that is safe on every platform the sync folder may be
 * shared with (a name Windows cannot store would break the other devices).
 */
export function isValidSyncFileName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return false; // includes ':' (NTFS streams)
  if (/[. ]$/.test(name)) return false; // Windows strips trailing dots / spaces
  if (WINDOWS_RESERVED.test(name)) return false;
  return true;
}

function syncTarget(folder: string, name: unknown): string {
  if (!isValidSyncFileName(name)) throw new TypeError('Invalid sync file name.');
  const target = path.join(folder, name);
  if (path.dirname(target) !== path.resolve(folder)) throw new TypeError('Invalid sync file name.');
  return target;
}

/** Refuses to follow a symlink planted in the sync folder (it could point anywhere). */
async function refuseSymlink(target: string): Promise<boolean> {
  try {
    const st = await fs.promises.lstat(target);
    if (st.isSymbolicLink()) throw new Error('Refusing to use a symbolic link in the sync folder.');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function readSyncFile(folder: string, name: unknown): Promise<Uint8Array | null> {
  const target = syncTarget(folder, name);
  if (!(await refuseSymlink(target))) return null;
  try {
    return await fs.promises.readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Writes via a temp file + rename, so another device (or a crash) never sees
 * a half-written manifest or PDF: a truncated library-sync.json would
 * otherwise stop every device from syncing.
 */
export async function writeSyncFile(folder: string, name: unknown, bytes: Uint8Array): Promise<void> {
  const target = syncTarget(folder, name);
  await refuseSymlink(target);
  await fs.promises.mkdir(folder, { recursive: true });
  await saveFile(target, bytes);
}

export async function deleteSyncFile(folder: string, name: unknown): Promise<void> {
  const target = syncTarget(folder, name);
  if (!(await refuseSymlink(target))) return;
  await fs.promises.rm(target, { force: true });
}

export async function listSyncFolder(folder: string): Promise<Array<{ name: string; size: number; updatedAt: number }>> {
  await fs.promises.mkdir(folder, { recursive: true });
  const entries = await fs.promises.readdir(folder, { withFileTypes: true });
  const out: Array<{ name: string; size: number; updatedAt: number }> = [];
  for (const e of entries) {
    // withFileTypes does not follow symlinks: a link is not a file here.
    if (!e.isFile() || !isValidSyncFileName(e.name)) continue;
    try {
      const st = await fs.promises.lstat(path.join(folder, e.name));
      out.push({ name: e.name, size: st.size, updatedAt: Math.round(st.mtimeMs) });
    } catch {
      // Skip transient cloud placeholder
    }
  }
  return out;
}

/**
 * The user-picked sync folder survives a restart only through this file, which
 * only the main process writes (after the folder passed authorization), so the
 * renderer still cannot authorize a path on its own.
 */
export async function loadRememberedSyncFolder(file: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8')) as { folder?: unknown };
    return typeof parsed.folder === 'string' && path.isAbsolute(parsed.folder) ? parsed.folder : null;
  } catch {
    return null;
  }
}

export async function rememberSyncFolder(file: string, folder: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await saveFile(file, new TextEncoder().encode(JSON.stringify({ folder })));
}
