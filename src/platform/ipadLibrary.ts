/**
 * Storage and cover-thumbnail layer for the iPadOS / Tablet document library.
 *
 * - Inside the iPad app (`isIpadApp()`), PDFs are stored in Capacitor's
 *   DOCUMENTS directory ("On My iPad › MaliPDF") and metadata lives in
 *   LIBRARY/malipdf-library.json.
 * - In browser / desktop Tablet Mode preview, PDFs are stored in IndexedDB
 *   and metadata in localStorage so the full library experience works offline
 *   and persists across reloads.
 */

import { base64ToBytes, bytesToBase64, callNative, isIpadApp } from './native';
import { loadPdfDocument } from '../pdf/renderer';

const DOCUMENTS = 'DOCUMENTS';
const LIBRARY = 'LIBRARY';
const META_FILE = 'malipdf-library.json';
const LOCAL_META_KEY = 'malipdf-ipad-library-meta-v1';
const IDB_NAME = 'malipdf_tablet_library_v1';
const IDB_STORE = 'files';

export const DOCUMENTS_PREFIX = 'Documents/';
export const PREVIEW_PREFIX = 'Library/';

export type FolderColorId =
  | 'coral'
  | 'blue'
  | 'amber'
  | 'emerald'
  | 'violet'
  | 'teal'
  | 'rose'
  | 'slate';

export const FOLDER_COLORS: ReadonlyArray<{ id: FolderColorId; hex: string; lightHex: string; label: string }> = [
  { id: 'blue', hex: '#2265a8', lightHex: '#68a6e2', label: 'Blue' },
  { id: 'teal', hex: '#14b8a6', lightHex: '#2dd4bf', label: 'Teal' },
  { id: 'violet', hex: '#7c3aed', lightHex: '#a78bfa', label: 'Violet' },
  { id: 'emerald', hex: '#10b981', lightHex: '#34d399', label: 'Emerald' },
  { id: 'amber', hex: '#f59e0b', lightHex: '#fbbf24', label: 'Amber' },
  { id: 'coral', hex: '#ef5350', lightHex: '#ff6b6b', label: 'Coral' },
  { id: 'rose', hex: '#ec4899', lightHex: '#f472b6', label: 'Rose' },
  { id: 'slate', hex: '#64748b', lightHex: '#94a3b8', label: 'Slate' },
];

export type CoverThemeId =
  | 'none'
  | 'graphite'
  | 'mint'
  | 'cream'
  | 'cobalt'
  | 'terracotta';

export interface LibraryFolder {
  id: string;
  name: string;
  color: FolderColorId;
  parentId: string | null;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryDocument {
  id: string;
  title: string;
  /** Storage path: "Documents/Name.pdf" on iPad, "Library/<id>.pdf" in browser preview. */
  filePath: string;
  folderId: string | null;
  kind: 'pdf' | 'notebook';
  coverTheme?: CoverThemeId;
  favorite: boolean;
  trashedAt: number | null;
  pageCount: number;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  /** Cached JPEG data URL of page 1. */
  thumbnail?: string;
}

export interface LibraryMetadata {
  version: 1;
  folders: LibraryFolder[];
  items: LibraryDocument[];
}

export const EMPTY_LIBRARY_META: LibraryMetadata = {
  version: 1,
  folders: [],
  items: [],
};

// ── IndexedDB helper (browser / desktop preview) ────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open library database'));
    });
  }
  return dbPromise;
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => {
        const val = req.result;
        if (!val) resolve(null);
        else if (val instanceof Uint8Array) resolve(val);
        else if (val instanceof ArrayBuffer) resolve(new Uint8Array(val));
        else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbPut(key: string, bytes: Uint8Array): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes.slice(0), key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback silently if storage quota or private mode blocks IDB.
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

// ── File path helpers ───────────────────────────────────────────────────────

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').trim();
  return cleaned || 'Untitled';
}

export function ensurePdfExtension(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

export function displayDocName(title: string): string {
  return title.replace(/\.pdf$/i, '');
}

function relativeDocumentsPath(filePath: string): string {
  if (filePath.startsWith(DOCUMENTS_PREFIX)) {
    return filePath.slice(DOCUMENTS_PREFIX.length);
  }
  return sanitizeFileName(filePath.split(/[\\/]/).pop() || filePath);
}

// ── Native + Web storage operations ─────────────────────────────────────────

export async function loadLibraryMeta(): Promise<LibraryMetadata> {
  if (isIpadApp()) {
    try {
      const res = await callNative<{ data: string }>('Filesystem', 'readFile', {
        path: META_FILE,
        directory: LIBRARY,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(res.data) as Partial<LibraryMetadata>;
      return {
        version: 1,
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };
    } catch {
      return { ...EMPTY_LIBRARY_META, folders: [], items: [] };
    }
  }

  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_META_KEY) : null;
    if (!raw) return { ...EMPTY_LIBRARY_META, folders: [], items: [] };
    const parsed = JSON.parse(raw) as Partial<LibraryMetadata>;
    return {
      version: 1,
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { ...EMPTY_LIBRARY_META, folders: [], items: [] };
  }
}

export async function saveLibraryMeta(meta: LibraryMetadata): Promise<void> {
  const serialized = JSON.stringify(meta);
  if (isIpadApp()) {
    try {
      await callNative('Filesystem', 'writeFile', {
        path: META_FILE,
        directory: LIBRARY,
        recursive: true,
        encoding: 'utf8',
        data: serialized,
      });
    } catch (error) {
      console.error('Failed to persist iPad library metadata:', error);
    }
    return;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_META_KEY, serialized);
    }
  } catch (error) {
    // If thumbnail data URLs exceed localStorage quota, strip oldest thumbnails and retry.
    try {
      const slim: LibraryMetadata = {
        ...meta,
        items: meta.items.map((item) => ({ ...item, thumbnail: undefined })),
      };
      localStorage.setItem(LOCAL_META_KEY, JSON.stringify(slim));
    } catch {
      console.error('Failed to persist local library metadata:', error);
    }
  }
}

export async function writeLibraryPdfBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  if (isIpadApp()) {
    await callNative('Filesystem', 'writeFile', {
      path: relativeDocumentsPath(filePath),
      directory: DOCUMENTS,
      recursive: true,
      data: bytesToBase64(bytes),
    });
    return;
  }
  await idbPut(filePath, bytes);
}

export async function readLibraryPdfBytes(filePath: string): Promise<Uint8Array | null> {
  if (isIpadApp()) {
    try {
      const res = await callNative<{ data: string }>('Filesystem', 'readFile', {
        path: relativeDocumentsPath(filePath),
        directory: DOCUMENTS,
      });
      return base64ToBytes(res.data);
    } catch {
      return null;
    }
  }
  return idbGet(filePath);
}

export async function deleteLibraryPdfBytes(filePath: string): Promise<void> {
  if (isIpadApp()) {
    try {
      await callNative('Filesystem', 'deleteFile', {
        path: relativeDocumentsPath(filePath),
        directory: DOCUMENTS,
      });
    } catch {
      // File may already be deleted
    }
    return;
  }
  await idbDelete(filePath);
}

export async function renameLibraryPdfFile(oldPath: string, newPath: string): Promise<void> {
  if (oldPath === newPath) return;
  if (isIpadApp()) {
    try {
      await callNative('Filesystem', 'rename', {
        from: relativeDocumentsPath(oldPath),
        to: relativeDocumentsPath(newPath),
        directory: DOCUMENTS,
        toDirectory: DOCUMENTS,
      });
      return;
    } catch {
      // Fall back to copy + delete
      const bytes = await readLibraryPdfBytes(oldPath);
      if (bytes) {
        await writeLibraryPdfBytes(newPath, bytes);
        await deleteLibraryPdfBytes(oldPath);
      }
      return;
    }
  }
  const bytes = await idbGet(oldPath);
  if (bytes) {
    await idbPut(newPath, bytes);
    await idbDelete(oldPath);
  }
}

export interface DiskPdfEntry {
  name: string;
  filePath: string;
  sizeBytes: number;
  mtime: number;
}

/** Scans "On My iPad › MaliPDF" for PDFs (including ones added via the Files app). */
export async function listIpadDocumentsFolder(): Promise<DiskPdfEntry[]> {
  if (!isIpadApp()) return [];
  try {
    const res = await callNative<{
      files: Array<{ name: string; type?: string; size?: number; mtime?: number } | string>;
    }>('Filesystem', 'readdir', { path: '', directory: DOCUMENTS });

    const out: DiskPdfEntry[] = [];
    for (const entry of res.files ?? []) {
      const name = typeof entry === 'string' ? entry : entry.name;
      const type = typeof entry === 'string' ? undefined : entry.type;
      if (type === 'directory' || !/\.pdf$/i.test(name)) continue;
      out.push({
        name,
        filePath: DOCUMENTS_PREFIX + name,
        sizeBytes: typeof entry === 'string' ? 0 : Number(entry.size) || 0,
        mtime: typeof entry === 'string' ? Date.now() : Number(entry.mtime) || Date.now(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ── PDF Page-1 cover thumbnail rendering ────────────────────────────────────

export async function renderPdfCoverThumbnail(
  bytes: Uint8Array,
  targetWidth = 300,
): Promise<{ dataUrl: string; pageCount: number } | null> {
  if (typeof document === 'undefined') return null;
  let proxy: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;
  try {
    proxy = await loadPdfDocument(bytes);
    const pageCount = proxy.numPages;
    const page = await proxy.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.max(0.2, targetWidth / Math.max(1, baseViewport.width)));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const task = page.render({ canvasContext: ctx, viewport });
    await task.promise;
    page.cleanup();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    canvas.width = 0;
    canvas.height = 0;
    return { dataUrl, pageCount };
  } catch {
    return null;
  } finally {
    if (proxy) {
      await proxy.destroy().catch(() => {});
    }
  }
}
