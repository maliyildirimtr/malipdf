/**
 * Crash recovery storage (Auto Save).
 *
 * While a document has unsaved changes the renderer periodically sends a
 * snapshot here: PDF bytes, annotations (JSON) and the image assets they use.
 * Snapshots live in <userData>/recovery/<docId>/ and are deleted when the
 * document is saved or closed normally — so whatever is left at startup is
 * from a crash or a forced quit and is offered as "Recovered Documents".
 */
import { app, webContents } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { handleTrusted, requireBinary } from '../security';

const META_FILE = 'session.json';
const SOURCE_FILE = 'source.pdf';
const ASSET_DIR = 'assets';
const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
const MAX_ASSET_BYTES = 60 * 1024 * 1024;
const MAX_META_CHARS = 200 * 1024 * 1024;

export interface RecoveryAssetInput {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  data: ArrayBuffer | Uint8Array;
}

export interface RecoveryEntry {
  docId: string;
  title: string;
  filePath: string | null;
  savedAt: number;
  pageCount: number;
  annotationCount: number;
}

function recoveryRoot(): string {
  return path.join(app.getPath('userData'), 'recovery');
}

function requireDocId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new TypeError('Invalid document id.');
  }
  return value;
}

function requireAssetId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new TypeError('Invalid asset id.');
  }
  return value;
}

async function writeAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const temp = `${filePath}.tmp-${crypto.randomUUID()}`;
  try {
    await fs.promises.writeFile(temp, data, { mode: 0o600 });
    await fs.promises.rename(temp, filePath);
  } catch (error) {
    await fs.promises.unlink(temp).catch(() => {});
    throw error;
  }
}

/** Which window (web contents id) keeps each snapshot up to date. */
const owners = new Map<string, number>();

function ownedByAnotherLiveWindow(docId: string, requester: number): boolean {
  const owner = owners.get(docId);
  if (owner === undefined || owner === requester) return false;
  const contents = webContents.fromId(owner);
  return !!contents && !contents.isDestroyed();
}

export function setupRecoveryIpc(isDev: boolean): void {
  handleTrusted('recovery:write', isDev, async (
    event,
    rawDocId: unknown,
    rawMeta: unknown,
    rawSource: unknown,
    rawAssets: unknown,
  ) => {
    const docId = requireDocId(rawDocId);
    if (typeof rawMeta !== 'string' || rawMeta.length > MAX_META_CHARS) throw new TypeError('Invalid snapshot.');
    JSON.parse(rawMeta); // must be valid JSON

    const dir = path.join(recoveryRoot(), docId);
    await fs.promises.mkdir(path.join(dir, ASSET_DIR), { recursive: true, mode: 0o700 });

    // PDF bytes are only sent when they changed since the last snapshot.
    if (rawSource !== null && rawSource !== undefined) {
      await writeAtomic(path.join(dir, SOURCE_FILE), requireBinary(rawSource, 'source', MAX_SOURCE_BYTES));
    }
    if (Array.isArray(rawAssets)) {
      for (const asset of rawAssets as RecoveryAssetInput[]) {
        const assetPath = path.join(dir, ASSET_DIR, `${requireAssetId(asset?.id)}.bin`);
        const exists = await fs.promises.stat(assetPath).then(() => true, () => false);
        if (!exists) await writeAtomic(assetPath, requireBinary(asset.data, 'asset', MAX_ASSET_BYTES));
      }
    }
    // Written last: a snapshot only counts once its metadata is complete.
    await writeAtomic(path.join(dir, META_FILE), rawMeta);
    if (event?.sender) owners.set(docId, event.sender.id);
    return true;
  });

  handleTrusted('recovery:remove', isDev, async (_event, rawDocId: unknown) => {
    const docId = requireDocId(rawDocId);
    owners.delete(docId);
    await fs.promises.rm(path.join(recoveryRoot(), docId), { recursive: true, force: true });
    return true;
  });

  handleTrusted('recovery:list', isDev, async (event): Promise<RecoveryEntry[]> => {
    const root = recoveryRoot();
    const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
    const result: RecoveryEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.name)) continue;
      // Open in another window right now: not lost.
      if (event?.sender && ownedByAnotherLiveWindow(entry.name, event.sender.id)) continue;
      try {
        const meta = JSON.parse(await fs.promises.readFile(path.join(root, entry.name, META_FILE), 'utf8'));
        await fs.promises.access(path.join(root, entry.name, SOURCE_FILE));
        result.push({
          docId: entry.name,
          title: String(meta.title ?? 'Untitled.pdf'),
          filePath: typeof meta.filePath === 'string' ? meta.filePath : null,
          savedAt: Number(meta.savedAt) || 0,
          pageCount: Number(meta.pageCount) || 0,
          annotationCount: Array.isArray(meta.annotations) ? meta.annotations.length : 0,
        });
      } catch {
        // Incomplete snapshot (crash while writing the first one): ignore.
      }
    }
    return result.sort((a, b) => b.savedAt - a.savedAt);
  });

  handleTrusted('recovery:load', isDev, async (_event, rawDocId: unknown) => {
    const docId = requireDocId(rawDocId);
    const dir = path.join(recoveryRoot(), docId);
    const meta = await fs.promises.readFile(path.join(dir, META_FILE), 'utf8');
    const source = await fs.promises.readFile(path.join(dir, SOURCE_FILE));
    const parsed = JSON.parse(meta) as { assets?: { id: string }[] };
    const assets: { id: string; data: ArrayBuffer }[] = [];
    for (const asset of parsed.assets ?? []) {
      const id = requireAssetId(asset.id);
      const bytes = await fs.promises.readFile(path.join(dir, ASSET_DIR, `${id}.bin`)).catch(() => null);
      if (bytes) assets.push({ id, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
    }
    return {
      meta,
      source: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer,
      assets,
    };
  });
}
