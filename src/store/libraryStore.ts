/**
 * Zustand store for the MaliPDF Document Library (iPadOS, Phone & Desktop Home).
 *
 * Supports two strictly isolated storage scopes:
 * - `'local'` ("This Device" / "Cihazım"): stays strictly on the device and is
 *   NEVER automatically uploaded to cloud storage.
 * - `'cloud'` ("Cloud" / "Bulut"): automatically syncs with the user's connected
 *   cloud provider (iCloud Drive, Google Drive, or Desktop Cloud Folder).
 */

import { create } from 'zustand';
import { nanoid } from '../utils/nanoid';
import {
  CLOUD_CACHE_PREFIX,
  DOCUMENTS_PREFIX,
  PREVIEW_PREFIX,
  deleteLibraryPdfBytes,
  ensurePdfExtension,
  getScope,
  listIpadDocumentsFolder,
  loadLibraryMeta,
  readLibraryPdfBytes,
  renameLibraryPdfFile,
  renderPdfCoverThumbnail,
  sanitizeFileName,
  saveLibraryMeta,
  writeLibraryPdfBytes,
  type CoverThemeId,
  type FolderColorId,
  type LibraryDocument,
  type LibraryFolder,
  type LibraryStorageScope,
} from '../platform/ipadLibrary';
import { isIpadApp } from '../platform/native';
import { useDocumentStore } from './documentStore';
import { useUIStore } from './uiStore';
import { openDocumentBytes } from '../document/openDocumentBytes';
import { generateNewDocument } from '../document/newDocumentGenerator';
import { notifyUser } from '../utils/notify';

export type LibrarySection = 'home' | 'favorites' | 'recent' | 'recovered' | 'trash' | 'folder';
export type LibraryCategory = 'all' | 'pdf' | 'notebook';
export type LibrarySortBy = 'updatedAt' | 'title' | 'lastOpenedAt' | 'sizeBytes';
export type LibrarySortDir = 'asc' | 'desc';
export type LibraryViewMode = 'grid' | 'list';
export type TabletActiveView = 'library' | 'workspace';

const SCOPE_STORAGE_KEY = 'malipdf-library-scope-v1';

function readInitialScope(): LibraryStorageScope {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(SCOPE_STORAGE_KEY) === 'cloud') {
      return 'cloud';
    }
  } catch {
    // ignore
  }
  return 'local';
}

function triggerCloudSync(delayMs = 250): void {
  void import('../sync/syncManager').then((m) => m.scheduleAutoSync(delayMs)).catch(() => {});
}

export function prefixForScope(scope: LibraryStorageScope): string {
  if (scope === 'cloud') {
    return isIpadApp() ? `${DOCUMENTS_PREFIX}${CLOUD_CACHE_PREFIX}` : CLOUD_CACHE_PREFIX;
  }
  return isIpadApp() ? DOCUMENTS_PREFIX : PREVIEW_PREFIX;
}

export interface UpsertLibraryDocInput {
  title: string;
  filePath?: string | null;
  bytes: Uint8Array;
  kind?: 'pdf' | 'notebook';
  folderId?: string | null;
  scope?: LibraryStorageScope;
  coverTheme?: CoverThemeId;
  pageCount?: number;
  writeBytes?: boolean;
}

interface LibraryStore {
  initialized: boolean;
  loading: boolean;
  storageScope: LibraryStorageScope;
  activeView: TabletActiveView;
  activeSection: LibrarySection;
  activeFolderId: string | null;
  categoryFilter: LibraryCategory;
  sortBy: LibrarySortBy;
  sortDir: LibrarySortDir;
  viewMode: LibraryViewMode;
  searchQuery: string;

  folders: LibraryFolder[];
  items: LibraryDocument[];

  setStorageScope: (scope: LibraryStorageScope) => void;
  setActiveView: (view: TabletActiveView) => void;
  setActiveSection: (section: LibrarySection, folderId?: string | null) => void;
  setCategoryFilter: (filter: LibraryCategory) => void;
  setSort: (sortBy: LibrarySortBy, sortDir?: LibrarySortDir) => void;
  toggleSortDir: () => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSearchQuery: (query: string) => void;

  initialize: (forceRefresh?: boolean) => Promise<void>;
  refresh: () => Promise<void>;

  createFolder: (name: string, color?: FolderColorId, parentId?: string | null, scope?: LibraryStorageScope) => Promise<LibraryFolder>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  setFolderColor: (folderId: string, color: FolderColorId) => Promise<void>;
  toggleFolderFavorite: (folderId: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;

  upsertDocument: (input: UpsertLibraryDocInput) => Promise<LibraryDocument>;
  recordDocumentSaved: (filePath: string, title: string, bytes: Uint8Array, pageCount?: number) => Promise<void>;
  openLibraryDocument: (itemId: string) => Promise<void>;
  createQuickNote: (folderId?: string | null) => Promise<void>;
  renameDocument: (itemId: string, newName: string) => Promise<void>;
  moveDocument: (itemId: string, folderId: string | null) => Promise<void>;
  moveDocuments: (itemIds: string[], folderId: string | null) => Promise<void>;
  transferDocumentsScope: (itemIds: string[], targetScope: LibraryStorageScope, mode: 'move' | 'copy') => Promise<number>;
  duplicateDocument: (itemId: string) => Promise<LibraryDocument | null>;
  toggleFavorite: (itemId: string) => Promise<void>;
  trashDocument: (itemId: string) => Promise<void>;
  trashDocuments: (itemIds: string[]) => Promise<void>;
  restoreDocument: (itemId: string) => Promise<void>;
  permanentlyDeleteDocument: (itemId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  readDocumentBytes: (itemId: string) => Promise<Uint8Array | null>;
}

function makeUniqueFilePath(title: string, existingPaths: Set<string>, scope: LibraryStorageScope = 'local'): string {
  const safe = ensurePdfExtension(sanitizeFileName(title));
  const prefix = prefixForScope(scope);
  if (!existingPaths.has(prefix + safe)) return prefix + safe;

  const stem = safe.replace(/\.pdf$/i, '');
  for (let n = 2; n < 1000; n++) {
    const candidate = `${prefix}${stem} ${n}.pdf`;
    if (!existingPaths.has(candidate)) return candidate;
  }
  return `${prefix}${stem}-${nanoid(6)}.pdf`;
}

async function persistCurrent(get: () => LibraryStore): Promise<void> {
  const { folders, items } = get();
  await saveLibraryMeta({ version: 1, folders, items });
}

export const useLibraryStore = create<LibraryStore>()((set, get) => ({
  initialized: false,
  loading: false,
  storageScope: readInitialScope(),
  activeView: 'library',
  activeSection: 'home',
  activeFolderId: null,
  categoryFilter: 'all',
  sortBy: 'updatedAt',
  sortDir: 'desc',
  viewMode: 'grid',
  searchQuery: '',

  folders: [],
  items: [],

  setStorageScope: (storageScope) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SCOPE_STORAGE_KEY, storageScope);
      }
    } catch {
      // ignore
    }
    set({
      storageScope,
      activeSection: 'home',
      activeFolderId: null,
    });
  },

  setActiveView: (activeView) => set({ activeView }),

  setActiveSection: (activeSection, folderId = null) =>
    set({
      activeSection,
      activeFolderId: activeSection === 'folder' ? folderId : null,
    }),

  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),

  setSort: (sortBy, sortDir) =>
    set((state) => ({
      sortBy,
      sortDir: sortDir ?? (state.sortBy === sortBy ? (state.sortDir === 'asc' ? 'desc' : 'asc') : sortBy === 'title' ? 'asc' : 'desc'),
    })),

  toggleSortDir: () =>
    set((state) => ({ sortDir: state.sortDir === 'asc' ? 'desc' : 'asc' })),

  setViewMode: (viewMode) => set({ viewMode }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  initialize: async (forceRefresh = false) => {
    if (get().initialized && !forceRefresh) return;
    set({ loading: true });
    try {
      const meta = await loadLibraryMeta();
      let items = [...meta.items];
      const folders = [...meta.folders];

      // On iPad, reconcile ONLY local items with top-level "On My iPad › MaliPDF".
      // Cloud-scoped items live under Documents/Cloud/ and are managed by syncManager.
      if (isIpadApp()) {
        const diskEntries = await listIpadDocumentsFolder();
        const diskMap = new Map(diskEntries.map((entry) => [entry.filePath, entry]));
        const knownPaths = new Set(items.map((item) => item.filePath));

        items = items
          .filter((item) => {
            if (getScope(item) === 'cloud') return true;
            return !item.filePath.startsWith(DOCUMENTS_PREFIX) || diskMap.has(item.filePath);
          })
          .map((item) => {
            if (getScope(item) === 'cloud') return item;
            const disk = diskMap.get(item.filePath);
            if (!disk) return item;
            return {
              ...item,
              sizeBytes: disk.sizeBytes || item.sizeBytes,
              updatedAt: Math.max(item.updatedAt, disk.mtime || 0),
            };
          });

        // Register any PDFs copied directly via iPadOS Files app into "On My iPad › MaliPDF" as local.
        for (const disk of diskEntries) {
          if (knownPaths.has(disk.filePath)) continue;
          items.push({
            id: nanoid(),
            title: disk.name,
            filePath: disk.filePath,
            folderId: null,
            scope: 'local',
            kind: 'pdf',
            favorite: false,
            trashedAt: null,
            pageCount: 1,
            sizeBytes: disk.sizeBytes,
            createdAt: disk.mtime,
            updatedAt: disk.mtime,
            lastOpenedAt: 0,
          });
        }
      }

      set({ folders, items, initialized: true, loading: false });
      await persistCurrent(get);

      // Lazily generate thumbnails for items missing one (non-blocking).
      const missingThumbs = items.filter((item) => !item.thumbnail && !item.trashedAt).slice(0, 12);
      for (const item of missingThumbs) {
        const bytes = await readLibraryPdfBytes(item.filePath);
        if (!bytes) continue;
        const rendered = await renderPdfCoverThumbnail(bytes);
        if (!rendered) continue;
        set((state) => ({
          items: state.items.map((x) =>
            x.id === item.id
              ? { ...x, thumbnail: rendered.dataUrl, pageCount: rendered.pageCount }
              : x,
          ),
        }));
        await persistCurrent(get);
      }
    } catch (error) {
      console.error('Failed to initialize library:', error);
      set({ initialized: true, loading: false });
    }
  },

  refresh: async () => {
    await get().initialize(true);
  },

  createFolder: async (name, color = 'blue', parentId = null, scopeOverride) => {
    const trimmed = name.trim() || 'New Folder';
    const now = Date.now();
    const targetScope = scopeOverride ?? get().storageScope;
    const folder: LibraryFolder = {
      id: nanoid(),
      name: trimmed,
      color,
      parentId,
      scope: targetScope,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ folders: [folder, ...state.folders] }));
    await persistCurrent(get);
    if (targetScope === 'cloud') triggerCloudSync();
    return folder;
  },

  renameFolder: async (folderId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const target = get().folders.find((f) => f.id === folderId);
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, name: trimmed, updatedAt: Date.now() } : f,
      ),
    }));
    await persistCurrent(get);
    if (target && getScope(target) === 'cloud') triggerCloudSync();
  },

  setFolderColor: async (folderId, color) => {
    const target = get().folders.find((f) => f.id === folderId);
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, color, updatedAt: Date.now() } : f,
      ),
    }));
    await persistCurrent(get);
    if (target && getScope(target) === 'cloud') triggerCloudSync();
  },

  toggleFolderFavorite: async (folderId) => {
    const target = get().folders.find((f) => f.id === folderId);
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, favorite: !f.favorite, updatedAt: Date.now() } : f,
      ),
    }));
    await persistCurrent(get);
    if (target && getScope(target) === 'cloud') triggerCloudSync();
  },

  deleteFolder: async (folderId) => {
    const target = get().folders.find((f) => f.id === folderId);
    set((state) => ({
      folders: state.folders.filter((f) => f.id !== folderId && f.parentId !== folderId),
      items: state.items.map((item) =>
        item.folderId === folderId ? { ...item, folderId: null, updatedAt: Date.now() } : item,
      ),
      activeSection: state.activeFolderId === folderId ? 'home' : state.activeSection,
      activeFolderId: state.activeFolderId === folderId ? null : state.activeFolderId,
    }));
    await persistCurrent(get);
    if (target && getScope(target) === 'cloud') triggerCloudSync();
  },

  upsertDocument: async ({
    title,
    filePath,
    bytes,
    kind = 'pdf',
    folderId,
    scope,
    coverTheme,
    pageCount,
    writeBytes = true,
  }) => {
    const state = get();
    const existingByPath = filePath
      ? state.items.find((item) => item.filePath === filePath)
      : undefined;

    const inferredFromPath: LibraryStorageScope | undefined = filePath
      ? (filePath.startsWith(CLOUD_CACHE_PREFIX) || filePath.startsWith(`${DOCUMENTS_PREFIX}${CLOUD_CACHE_PREFIX}`)
        ? 'cloud'
        : undefined)
      : undefined;

    const targetScope: LibraryStorageScope = scope
      ?? (existingByPath ? getScope(existingByPath) : undefined)
      ?? inferredFromPath
      ?? state.storageScope;

    const existingPaths = new Set(state.items.map((i) => i.filePath));
    const isManagedVirtual = Boolean(
      filePath && (
        filePath.startsWith(DOCUMENTS_PREFIX)
        || filePath.startsWith(PREVIEW_PREFIX)
        || filePath.startsWith(CLOUD_CACHE_PREFIX)
      ),
    );
    const resolvedPath = existingByPath?.filePath
      ?? (isManagedVirtual && filePath ? filePath : makeUniqueFilePath(title, existingPaths, targetScope));

    if (writeBytes) {
      await writeLibraryPdfBytes(resolvedPath, bytes);
    }

    const rendered = await renderPdfCoverThumbnail(bytes);
    const now = Date.now();
    const resolvedTitle = ensurePdfExtension(sanitizeFileName(title));

    if (existingByPath) {
      const updated: LibraryDocument = {
        ...existingByPath,
        title: resolvedTitle,
        scope: targetScope,
        folderId: folderId !== undefined ? folderId : existingByPath.folderId,
        sizeBytes: bytes.byteLength,
        pageCount: rendered?.pageCount ?? pageCount ?? existingByPath.pageCount,
        thumbnail: rendered?.dataUrl ?? existingByPath.thumbnail,
        updatedAt: now,
        lastOpenedAt: now,
        trashedAt: null,
      };
      set((s) => ({
        items: s.items.map((i) => (i.id === existingByPath.id ? updated : i)),
      }));
      await persistCurrent(get);
      if (targetScope === 'cloud') triggerCloudSync();
      return updated;
    }

    const activeFolderMatchesScope = state.activeSection === 'folder'
      && state.activeFolderId
      && state.folders.some((f) => f.id === state.activeFolderId && getScope(f) === targetScope);

    const targetFolder = folderId !== undefined
      ? folderId
      : activeFolderMatchesScope
        ? state.activeFolderId
        : null;

    const created: LibraryDocument = {
      id: nanoid(),
      title: resolvedTitle,
      filePath: resolvedPath,
      folderId: targetFolder,
      scope: targetScope,
      kind,
      coverTheme,
      favorite: false,
      trashedAt: null,
      pageCount: rendered?.pageCount ?? pageCount ?? 1,
      sizeBytes: bytes.byteLength,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      thumbnail: rendered?.dataUrl,
    };

    set((s) => ({ items: [created, ...s.items] }));
    await persistCurrent(get);
    if (targetScope === 'cloud') triggerCloudSync();
    return created;
  },

  recordDocumentSaved: async (filePath, title, bytes, pageCount) => {
    const isVirtual = filePath.startsWith(PREVIEW_PREFIX) || filePath.startsWith(CLOUD_CACHE_PREFIX);
    if (!get().initialized && !isIpadApp() && !isVirtual) return;
    // On Desktop, if the user saves a normal OS file outside the Library and it isn't already in Library, don't force it in.
    if (!isIpadApp() && !isVirtual && !get().items.some((i) => i.filePath === filePath)) return;
    await get().upsertDocument({
      title,
      filePath,
      bytes,
      pageCount,
      writeBytes: !isIpadApp() || isVirtual,
    });
  },

  openLibraryDocument: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return;

    const docStore = useDocumentStore.getState();
    const existingTab = [...docStore.documents.values()].find((d) => d.filePath === item.filePath);
    if (existingTab) {
      docStore.setActiveDocument(existingTab.id);
      useUIStore.getState().setDesktopLibraryOpen(false);
      set((state) => ({
        activeView: 'workspace',
        items: state.items.map((i) => (i.id === itemId ? { ...i, lastOpenedAt: Date.now() } : i)),
      }));
      await persistCurrent(get);
      return;
    }

    const bytes = await readLibraryPdfBytes(item.filePath);
    if (!bytes) {
      notifyUser('error', `Could not load "${item.title}".`);
      return;
    }

    await openDocumentBytes(item.title, item.filePath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    useUIStore.getState().setDesktopLibraryOpen(false);
    set((state) => ({
      activeView: 'workspace',
      items: state.items.map((i) => (i.id === itemId ? { ...i, lastOpenedAt: Date.now() } : i)),
    }));
    await persistCurrent(get);
  },

  createQuickNote: async (folderId) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const title = `Quick Note ${stamp}.pdf`;

    const pdfBytes = await generateNewDocument({
      widthPt: 595.28,
      heightPt: 841.89,
      background: {
        type: 'lined',
        spacingMm: 8,
        color: '#94a3b8',
        opacity: 0.75,
        weight: 'normal',
      },
      pageCount: 1,
    });

    const saved = await get().upsertDocument({
      title,
      bytes: pdfBytes,
      kind: 'notebook',
      scope: get().storageScope,
      folderId: folderId ?? (get().activeSection === 'folder' ? get().activeFolderId : null),
      pageCount: 1,
    });

    await openDocumentBytes(
      saved.title,
      saved.filePath,
      pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer,
      { restoreEditable: false },
    );
    useUIStore.getState().setDesktopLibraryOpen(false);
    set({ activeView: 'workspace' });
  },

  renameDocument: async (itemId, newName) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return;
    const cleanTitle = ensurePdfExtension(sanitizeFileName(newName));
    if (cleanTitle === item.title) return;

    const itemScope = getScope(item);
    const existingPaths = new Set(get().items.filter((i) => i.id !== itemId).map((i) => i.filePath));
    const nextPath = makeUniqueFilePath(cleanTitle, existingPaths, itemScope);

    await renameLibraryPdfFile(item.filePath, nextPath);

    const docStore = useDocumentStore.getState();
    for (const doc of docStore.documents.values()) {
      if (doc.filePath === item.filePath) {
        docStore.updateDocument(doc.id, { filePath: nextPath, title: cleanTitle });
      }
    }

    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, title: cleanTitle, filePath: nextPath, updatedAt: Date.now() } : i,
      ),
    }));
    await persistCurrent(get);
    if (itemScope === 'cloud') triggerCloudSync();
  },

  moveDocument: async (itemId, folderId) => {
    const item = get().items.find((i) => i.id === itemId);
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, folderId, updatedAt: Date.now() } : i,
      ),
    }));
    await persistCurrent(get);
    if (item && getScope(item) === 'cloud') triggerCloudSync();
  },

  moveDocuments: async (itemIds, folderId) => {
    const ids = new Set(itemIds);
    const touchesCloud = get().items.some((i) => ids.has(i.id) && getScope(i) === 'cloud');
    set((state) => ({
      items: state.items.map((i) =>
        ids.has(i.id) ? { ...i, folderId, updatedAt: Date.now() } : i,
      ),
    }));
    await persistCurrent(get);
    if (touchesCloud) triggerCloudSync();
  },

  transferDocumentsScope: async (itemIds, targetScope, mode) => {
    let transferred = 0;
    for (const id of itemIds) {
      const item = get().items.find((i) => i.id === id);
      if (!item || getScope(item) === targetScope) continue;
      const bytes = await readLibraryPdfBytes(item.filePath);
      if (!bytes) continue;

      const existingPaths = new Set(get().items.map((i) => i.filePath));
      const destPath = makeUniqueFilePath(item.title, existingPaths, targetScope);
      await writeLibraryPdfBytes(destPath, bytes);

      const now = Date.now();
      if (mode === 'copy') {
        const cloned: LibraryDocument = {
          ...item,
          id: nanoid(),
          filePath: destPath,
          folderId: null,
          scope: targetScope,
          createdAt: now,
          updatedAt: now,
          trashedAt: null,
        };
        set((s) => ({ items: [cloned, ...s.items] }));
      } else if (targetScope === 'cloud') {
        // Move Local -> Cloud: remove local file, promote item to cloud scope
        await deleteLibraryPdfBytes(item.filePath);
        const docStore = useDocumentStore.getState();
        for (const doc of docStore.documents.values()) {
          if (doc.filePath === item.filePath) {
            docStore.updateDocument(doc.id, { filePath: destPath });
          }
        }
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, filePath: destPath, folderId: null, scope: 'cloud', updatedAt: now } : i,
          ),
        }));
      } else {
        // Move Cloud -> Local: create clean local copy & mark cloud entry trashed so sync deletes it remotely
        const localCopy: LibraryDocument = {
          ...item,
          id: nanoid(),
          filePath: destPath,
          folderId: null,
          scope: 'local',
          createdAt: now,
          updatedAt: now,
          trashedAt: null,
        };
        const docStore = useDocumentStore.getState();
        for (const doc of docStore.documents.values()) {
          if (doc.filePath === item.filePath) {
            docStore.updateDocument(doc.id, { filePath: destPath });
          }
        }
        await deleteLibraryPdfBytes(item.filePath);
        set((s) => ({
          items: [
            localCopy,
            ...s.items.map((i) => (i.id === id ? { ...i, trashedAt: now, updatedAt: now } : i)),
          ],
        }));
      }
      transferred++;
    }
    if (transferred > 0) {
      await persistCurrent(get);
      triggerCloudSync(120);
    }
    return transferred;
  },

  duplicateDocument: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return null;
    const bytes = await readLibraryPdfBytes(item.filePath);
    if (!bytes) return null;

    const stem = item.title.replace(/\.pdf$/i, '');
    return get().upsertDocument({
      title: `${stem} Copy.pdf`,
      bytes,
      kind: item.kind,
      scope: getScope(item),
      folderId: item.folderId,
      coverTheme: item.coverTheme,
      pageCount: item.pageCount,
    });
  },

  toggleFavorite: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, favorite: !i.favorite, updatedAt: Date.now() } : i,
      ),
    }));
    await persistCurrent(get);
    if (item && getScope(item) === 'cloud') triggerCloudSync();
  },

  trashDocument: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, trashedAt: Date.now(), updatedAt: Date.now(), favorite: false } : i,
      ),
    }));
    await persistCurrent(get);
    if (item && getScope(item) === 'cloud') triggerCloudSync();
  },

  trashDocuments: async (itemIds) => {
    const ids = new Set(itemIds);
    const touchesCloud = get().items.some((i) => ids.has(i.id) && getScope(i) === 'cloud');
    const now = Date.now();
    set((state) => ({
      items: state.items.map((i) =>
        ids.has(i.id) ? { ...i, trashedAt: now, updatedAt: now, favorite: false } : i,
      ),
    }));
    await persistCurrent(get);
    if (touchesCloud) triggerCloudSync();
  },

  restoreDocument: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, trashedAt: null, updatedAt: Date.now() } : i,
      ),
    }));
    await persistCurrent(get);
    if (item && getScope(item) === 'cloud') triggerCloudSync();
  },

  permanentlyDeleteDocument: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    const wasCloud = item ? getScope(item) === 'cloud' : false;
    if (item) {
      await deleteLibraryPdfBytes(item.filePath);
    }
    set((state) => ({
      items: state.items.filter((i) => i.id !== itemId),
    }));
    await persistCurrent(get);
    if (wasCloud) triggerCloudSync();
  },

  emptyTrash: async () => {
    const currentScope = get().storageScope;
    const trashed = get().items.filter((i) => i.trashedAt !== null && getScope(i) === currentScope);
    for (const item of trashed) {
      await deleteLibraryPdfBytes(item.filePath);
    }
    const trashedIds = new Set(trashed.map((i) => i.id));
    set((state) => ({
      items: state.items.filter((i) => !trashedIds.has(i.id)),
    }));
    await persistCurrent(get);
    if (currentScope === 'cloud' && trashed.length > 0) triggerCloudSync();
  },

  readDocumentBytes: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return null;
    return readLibraryPdfBytes(item.filePath);
  },
}));
