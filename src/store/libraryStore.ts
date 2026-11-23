/**
 * Zustand store for the iPadOS / Tablet document library (Home screen).
 *
 * Manages folders, documents, favorites, recents, trash, search/sort/filter
 * state, and switching between the Library and the active Document Workspace.
 */

import { create } from 'zustand';
import { nanoid } from '../utils/nanoid';
import {
  DOCUMENTS_PREFIX,
  PREVIEW_PREFIX,
  deleteLibraryPdfBytes,
  ensurePdfExtension,
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
} from '../platform/ipadLibrary';
import { isIpadApp } from '../platform/native';
import { useDocumentStore } from './documentStore';
import { openDocumentBytes } from '../document/openDocumentBytes';
import { generateNewDocument } from '../document/newDocumentGenerator';
import { notifyUser } from '../utils/notify';

export type LibrarySection = 'home' | 'favorites' | 'recent' | 'recovered' | 'trash' | 'folder';
export type LibraryCategory = 'all' | 'pdf' | 'notebook';
export type LibrarySortBy = 'updatedAt' | 'title' | 'lastOpenedAt' | 'sizeBytes';
export type LibrarySortDir = 'asc' | 'desc';
export type LibraryViewMode = 'grid' | 'list';
export type TabletActiveView = 'library' | 'workspace';

export interface UpsertLibraryDocInput {
  title: string;
  filePath?: string | null;
  bytes: Uint8Array;
  kind?: 'pdf' | 'notebook';
  folderId?: string | null;
  coverTheme?: CoverThemeId;
  pageCount?: number;
  writeBytes?: boolean;
}

interface LibraryStore {
  initialized: boolean;
  loading: boolean;
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

  setActiveView: (view: TabletActiveView) => void;
  setActiveSection: (section: LibrarySection, folderId?: string | null) => void;
  setCategoryFilter: (filter: LibraryCategory) => void;
  setSort: (sortBy: LibrarySortBy, sortDir?: LibrarySortDir) => void;
  toggleSortDir: () => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSearchQuery: (query: string) => void;

  initialize: (forceRefresh?: boolean) => Promise<void>;
  refresh: () => Promise<void>;

  createFolder: (name: string, color?: FolderColorId, parentId?: string | null) => Promise<LibraryFolder>;
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
  duplicateDocument: (itemId: string) => Promise<LibraryDocument | null>;
  toggleFavorite: (itemId: string) => Promise<void>;
  trashDocument: (itemId: string) => Promise<void>;
  trashDocuments: (itemIds: string[]) => Promise<void>;
  restoreDocument: (itemId: string) => Promise<void>;
  permanentlyDeleteDocument: (itemId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  readDocumentBytes: (itemId: string) => Promise<Uint8Array | null>;
}

function makeUniqueFilePath(title: string, existingPaths: Set<string>): string {
  const safe = ensurePdfExtension(sanitizeFileName(title));
  const prefix = isIpadApp() ? DOCUMENTS_PREFIX : PREVIEW_PREFIX;
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

      // On iPad, reconcile with real files in "On My iPad › MaliPDF".
      if (isIpadApp()) {
        const diskEntries = await listIpadDocumentsFolder();
        const diskMap = new Map(diskEntries.map((entry) => [entry.filePath, entry]));
        const knownPaths = new Set(items.map((item) => item.filePath));

        // Update existing entries with disk metadata; keep trashed items only if still on disk.
        items = items
          .filter((item) => !item.filePath.startsWith(DOCUMENTS_PREFIX) || diskMap.has(item.filePath))
          .map((item) => {
            const disk = diskMap.get(item.filePath);
            if (!disk) return item;
            return {
              ...item,
              sizeBytes: disk.sizeBytes || item.sizeBytes,
              updatedAt: Math.max(item.updatedAt, disk.mtime || 0),
            };
          });

        // Register any PDFs copied directly via iPadOS Files app.
        for (const disk of diskEntries) {
          if (knownPaths.has(disk.filePath)) continue;
          items.push({
            id: nanoid(),
            title: disk.name,
            filePath: disk.filePath,
            folderId: null,
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

  createFolder: async (name, color = 'blue', parentId = null) => {
    const trimmed = name.trim() || 'New Folder';
    const now = Date.now();
    const folder: LibraryFolder = {
      id: nanoid(),
      name: trimmed,
      color,
      parentId,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ folders: [folder, ...state.folders] }));
    await persistCurrent(get);
    return folder;
  },

  renameFolder: async (folderId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, name: trimmed, updatedAt: Date.now() } : f,
      ),
    }));
    await persistCurrent(get);
  },

  setFolderColor: async (folderId, color) => {
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, color, updatedAt: Date.now() } : f,
      ),
    }));
    await persistCurrent(get);
  },

  toggleFolderFavorite: async (folderId) => {
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === folderId ? { ...f, favorite: !f.favorite } : f,
      ),
    }));
    await persistCurrent(get);
  },

  deleteFolder: async (folderId) => {
    set((state) => ({
      folders: state.folders.filter((f) => f.id !== folderId && f.parentId !== folderId),
      items: state.items.map((item) =>
        item.folderId === folderId ? { ...item, folderId: null } : item,
      ),
      activeSection: state.activeFolderId === folderId ? 'home' : state.activeSection,
      activeFolderId: state.activeFolderId === folderId ? null : state.activeFolderId,
    }));
    await persistCurrent(get);
  },

  upsertDocument: async ({
    title,
    filePath,
    bytes,
    kind = 'pdf',
    folderId,
    coverTheme,
    pageCount,
    writeBytes = true,
  }) => {
    const state = get();
    const existingByPath = filePath
      ? state.items.find((item) => item.filePath === filePath)
      : undefined;

    const existingPaths = new Set(state.items.map((i) => i.filePath));
    const resolvedPath = existingByPath?.filePath
      ?? (filePath && (filePath.startsWith(DOCUMENTS_PREFIX) || filePath.startsWith(PREVIEW_PREFIX))
        ? filePath
        : makeUniqueFilePath(title, existingPaths));

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
      return updated;
    }

    const targetFolder = folderId !== undefined
      ? folderId
      : state.activeSection === 'folder'
        ? state.activeFolderId
        : null;

    const created: LibraryDocument = {
      id: nanoid(),
      title: resolvedTitle,
      filePath: resolvedPath,
      folderId: targetFolder,
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
    return created;
  },

  recordDocumentSaved: async (filePath, title, bytes, pageCount) => {
    // Only touch the library if initialized or running on iPad / preview path.
    if (!get().initialized && !isIpadApp() && !filePath.startsWith(PREVIEW_PREFIX)) return;
    await get().upsertDocument({
      title,
      filePath,
      bytes,
      pageCount,
      writeBytes: !isIpadApp(), // On iPad, window.electronAPI.writeFile already wrote Documents/
    });
  },

  openLibraryDocument: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return;

    // If already open in a tab, switch directly to it.
    const docStore = useDocumentStore.getState();
    const existingTab = [...docStore.documents.values()].find((d) => d.filePath === item.filePath);
    if (existingTab) {
      docStore.setActiveDocument(existingTab.id);
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
      folderId: folderId ?? (get().activeSection === 'folder' ? get().activeFolderId : null),
      pageCount: 1,
    });

    await openDocumentBytes(
      saved.title,
      saved.filePath,
      pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer,
      { restoreEditable: false },
    );
    set({ activeView: 'workspace' });
  },

  renameDocument: async (itemId, newName) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return;
    const cleanTitle = ensurePdfExtension(sanitizeFileName(newName));
    if (cleanTitle === item.title) return;

    const existingPaths = new Set(get().items.filter((i) => i.id !== itemId).map((i) => i.filePath));
    const nextPath = makeUniqueFilePath(cleanTitle, existingPaths);

    await renameLibraryPdfFile(item.filePath, nextPath);

    // Also update any open tab pointing to this file.
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
  },

  moveDocument: async (itemId, folderId) => {
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, folderId, updatedAt: Date.now() } : i,
      ),
    }));
    await persistCurrent(get);
  },

  moveDocuments: async (itemIds, folderId) => {
    const ids = new Set(itemIds);
    set((state) => ({
      items: state.items.map((i) =>
        ids.has(i.id) ? { ...i, folderId, updatedAt: Date.now() } : i,
      ),
    }));
    await persistCurrent(get);
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
      folderId: item.folderId,
      coverTheme: item.coverTheme,
      pageCount: item.pageCount,
    });
  },

  toggleFavorite: async (itemId) => {
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, favorite: !i.favorite } : i,
      ),
    }));
    await persistCurrent(get);
  },

  trashDocument: async (itemId) => {
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, trashedAt: Date.now(), favorite: false } : i,
      ),
    }));
    await persistCurrent(get);
  },

  trashDocuments: async (itemIds) => {
    const ids = new Set(itemIds);
    const now = Date.now();
    set((state) => ({
      items: state.items.map((i) =>
        ids.has(i.id) ? { ...i, trashedAt: now, favorite: false } : i,
      ),
    }));
    await persistCurrent(get);
  },

  restoreDocument: async (itemId) => {
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, trashedAt: null } : i,
      ),
    }));
    await persistCurrent(get);
  },

  permanentlyDeleteDocument: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    if (item) {
      await deleteLibraryPdfBytes(item.filePath);
    }
    set((state) => ({
      items: state.items.filter((i) => i.id !== itemId),
    }));
    await persistCurrent(get);
  },

  emptyTrash: async () => {
    const trashed = get().items.filter((i) => i.trashedAt !== null);
    for (const item of trashed) {
      await deleteLibraryPdfBytes(item.filePath);
    }
    set((state) => ({
      items: state.items.filter((i) => i.trashedAt === null),
    }));
    await persistCurrent(get);
  },

  readDocumentBytes: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return null;
    return readLibraryPdfBytes(item.filePath);
  },
}));
