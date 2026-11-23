/**
 * iPadOS Home Library — tactile document manager inspired by modern iPadOS
 * note-taking apps, wired directly to MaliPDF's PDF engine and library store.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FilePlus,
  FileText,
  FolderInput,
  FolderPlus,
  History,
  Home,
  ImagePlus,
  LayoutGrid,
  List,
  Menu,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Share,
  Star,
  Sun,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  FOLDER_COLORS,
  displayDocName,
  type FolderColorId,
  type LibraryDocument,
  type LibraryFolder,
} from '../../platform/ipadLibrary';
import { isIpadApp } from '../../platform/native';
import { useLibraryStore, type LibraryCategory, type LibrarySortBy } from '../../store/libraryStore';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import { openDocumentBytes } from '../../document/openDocumentBytes';
import { SHOW_RECOVERY_EVENT } from '../RecoveryDialog/recoveryEvents';
import { notifyUser } from '../../utils/notify';
import appIconUrl from '../../assets/app-icon.png';
import styles from './TabletLibrary.module.css';

// ── Glossy iPadOS Folder Glyph ──────────────────────────────────────────────

function FolderGlyph({ color, size = 46 }: { color: FolderColorId; size?: number }) {
  const palette = FOLDER_COLORS.find((c) => c.id === color) ?? FOLDER_COLORS[0];
  return (
    <svg width={size} height={Math.round(size * 0.86)} viewBox="0 0 48 42" fill="none" aria-hidden="true">
      <path
        d="M4 9C4 6.23858 6.23858 4 9 4H17.2C18.6 4 19.9 4.7 20.7 5.8L22.5 8.4C23.1 9.2 24.1 9.7 25.1 9.7H39C41.7614 9.7 44 11.9386 44 14.7V33C44 35.7614 41.7614 38 39 38H9C6.23858 38 4 35.7614 4 33V9Z"
        fill={palette.hex}
      />
      <path
        d="M4 14C4 12.3431 5.34315 11 7 11H41C42.6569 11 44 12.3431 44 14V33C44 35.7614 41.7614 38 39 38H9C6.23858 38 4 35.7614 4 33V14Z"
        fill={palette.lightHex}
        fillOpacity="0.34"
      />
    </svg>
  );
}

function SmallFolderIcon({ color }: { color: FolderColorId }) {
  return <FolderGlyph color={color} size={20} />;
}

// ── Date & size formatting ──────────────────────────────────────────────────

function formatDate(timestamp: number, language: string): string {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat(language === 'tr' ? 'tr-TR' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Context Menu state types ────────────────────────────────────────────────

type ContextMenuState =
  | { kind: 'doc'; item: LibraryDocument; x: number; y: number }
  | { kind: 'folder'; folder: LibraryFolder; x: number; y: number }
  | { kind: 'sort'; x: number; y: number }
  | null;

type ModalState =
  | { kind: 'newFolder' }
  | { kind: 'editFolder'; folder: LibraryFolder }
  | { kind: 'renameDoc'; item: LibraryDocument }
  | { kind: 'moveDocs'; itemIds: string[] }
  | null;

// ── Main Component ──────────────────────────────────────────────────────────

export function TabletLibrary() {
  const {
    folders,
    items,
    loading,
    activeSection,
    activeFolderId,
    categoryFilter,
    sortBy,
    sortDir,
    viewMode,
    searchQuery,
    initialize,
    refresh,
    setActiveView,
    setActiveSection,
    setCategoryFilter,
    setSort,
    setViewMode,
    setSearchQuery,
    createFolder,
    renameFolder,
    setFolderColor,
    toggleFolderFavorite,
    deleteFolder,
    upsertDocument,
    openLibraryDocument,
    createQuickNote,
    renameDocument,
    moveDocuments,
    duplicateDocument,
    toggleFavorite,
    trashDocument,
    trashDocuments,
    restoreDocument,
    permanentlyDeleteDocument,
    emptyTrash,
    readDocumentBytes,
  } = useLibraryStore();

  const {
    resolvedTheme,
    setTheme,
    language,
    setSettingsOpen,
    setNewDocumentDialogOpen,
    setImagesToPdfOpen,
    setTabletMode,
  } = useUIStore();

  const activeDocId = useDocumentStore((s) => s.activeDocId);
  const activeDoc = useDocumentStore((s) => (s.activeDocId ? s.documents.get(s.activeDocId) ?? null : null));

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [modalText, setModalText] = useState('');
  const [modalColor, setModalColor] = useState<FolderColorId>('blue');
  const [creatingQuick, setCreatingQuick] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Close popovers on outside click / Escape
  useEffect(() => {
    if (!menu && !fabOpen) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-lib-popover="true"]')) return;
      setMenu(null);
      setFabOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setFabOpen(false);
        setModal(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, fabOpen]);

  // Reset selection when navigating sections
  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [activeSection, activeFolderId]);

  const activeFolder = useMemo(
    () => (activeFolderId ? folders.find((f) => f.id === activeFolderId) ?? null : null),
    [folders, activeFolderId],
  );

  const favoritesCount = useMemo(
    () => items.filter((i) => !i.trashedAt && i.favorite).length + folders.filter((f) => f.favorite).length,
    [items, folders],
  );

  const trashCount = useMemo(
    () => items.filter((i) => i.trashedAt !== null).length,
    [items],
  );

  // Filtered folders for the current view
  const visibleFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list: LibraryFolder[] = [];
    if (activeSection === 'home') {
      list = folders.filter((f) => f.parentId === null);
    } else if (activeSection === 'favorites') {
      list = folders.filter((f) => f.favorite);
    } else if (activeSection === 'folder' && activeFolderId) {
      list = folders.filter((f) => f.parentId === activeFolderId);
    }
    if (q) {
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, activeSection, activeFolderId, searchQuery]);

  // Filtered & sorted documents for the current view
  const visibleDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = items.filter((item) => {
      if (activeSection === 'trash') return item.trashedAt !== null;
      if (item.trashedAt !== null) return false;
      if (activeSection === 'home') return item.folderId === null;
      if (activeSection === 'folder') return item.folderId === activeFolderId;
      if (activeSection === 'favorites') return item.favorite;
      if (activeSection === 'recent') return true;
      return true;
    });

    if (categoryFilter !== 'all') {
      list = list.filter((item) => item.kind === categoryFilter);
    }

    if (q) {
      list = list.filter((item) => displayDocName(item.title).toLowerCase().includes(q));
    }

    const effectiveSortBy: LibrarySortBy = activeSection === 'recent' ? 'lastOpenedAt' : sortBy;
    const dir = activeSection === 'recent' ? -1 : sortDir === 'asc' ? 1 : -1;

    return [...list].sort((a, b) => {
      if (effectiveSortBy === 'title') {
        return a.title.localeCompare(b.title) * dir;
      }
      if (effectiveSortBy === 'sizeBytes') {
        return ((a.sizeBytes || 0) - (b.sizeBytes || 0)) * dir;
      }
      if (effectiveSortBy === 'lastOpenedAt') {
        return ((a.lastOpenedAt || a.updatedAt) - (b.lastOpenedAt || b.updatedAt)) * dir;
      }
      return (a.updatedAt - b.updatedAt) * dir;
    });
  }, [items, activeSection, activeFolderId, categoryFilter, searchQuery, sortBy, sortDir]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleImportPdfs = async () => {
    setFabOpen(false);
    if (isIpadApp() && window.electronAPI?.openFile) {
      const files = await window.electronAPI.openFile('pdf');
      if (!files?.length) return;
      for (const file of files) {
        const bytes = new Uint8Array(file.data);
        const saved = await upsertDocument({
          title: file.name,
          filePath: file.filePath || undefined,
          bytes,
          kind: 'pdf',
        });
        await openDocumentBytes(saved.title, saved.filePath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      }
      setActiveView('workspace');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (!files.length) return;
    let openedAny = false;
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') continue;
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const saved = await upsertDocument({
        title: file.name,
        bytes,
        kind: 'pdf',
      });
      await openDocumentBytes(
        saved.title,
        saved.filePath,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
      openedAny = true;
    }
    if (openedAny) setActiveView('workspace');
  };

  const handleQuickNote = async () => {
    if (creatingQuick) return;
    setFabOpen(false);
    setCreatingQuick(true);
    try {
      await createQuickNote();
    } catch (error) {
      notifyUser('error', `Could not create note: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCreatingQuick(false);
    }
  };

  const handleShareDoc = async (item: LibraryDocument) => {
    setMenu(null);
    const bytes = await readDocumentBytes(item.id);
    if (!bytes) {
      notifyUser('error', 'Could not read document.');
      return;
    }
    if (window.electronAPI?.sharePdf) {
      await window.electronAPI.sharePdf(item.title, bytes);
      return;
    }
    // Browser download fallback
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.title;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const toggleSelectDoc = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openContextAt = (
    event: React.MouseEvent,
    state: Exclude<ContextMenuState, null>,
  ) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(window.innerWidth - 228, Math.max(12, rect.left - 160));
    const y = Math.min(window.innerHeight - 280, Math.max(12, rect.bottom + 6));
    setMenu({ ...state, x, y } as ContextMenuState);
  };

  const openNewFolderModal = () => {
    setFabOpen(false);
    setModalText('');
    setModalColor('blue');
    setModal({ kind: 'newFolder' });
  };

  const openEditFolderModal = (folder: LibraryFolder) => {
    setMenu(null);
    setModalText(folder.name);
    setModalColor(folder.color);
    setModal({ kind: 'editFolder', folder });
  };

  const openRenameDocModal = (item: LibraryDocument) => {
    setMenu(null);
    setModalText(displayDocName(item.title));
    setModal({ kind: 'renameDoc', item });
  };

  const submitModal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!modal) return;
    if (modal.kind === 'newFolder') {
      const parentId = activeSection === 'folder' ? activeFolderId : null;
      await createFolder(modalText || 'New Folder', modalColor, parentId);
    } else if (modal.kind === 'editFolder') {
      await renameFolder(modal.folder.id, modalText);
      await setFolderColor(modal.folder.id, modalColor);
    } else if (modal.kind === 'renameDoc') {
      await renameDocument(modal.item.id, modalText);
    }
    setModal(null);
  };

  const folderDocCount = (folderId: string) =>
    items.filter((i) => !i.trashedAt && i.folderId === folderId).length;

  const sectionHeading = (() => {
    if (activeSection === 'folder' && activeFolder) return activeFolder.name;
    if (activeSection === 'favorites') return 'Favorites';
    if (activeSection === 'recent') return 'Recent';
    if (activeSection === 'trash') return 'Trash';
    return 'Home Folder';
  })();

  const sortLabel = sortBy === 'title' ? 'Name' : sortBy === 'sizeBytes' ? 'Size' : 'Date';

  return (
    <div className={styles.shell}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* ── Top Bar: Brand + Centered Liquid Glass Filter Pill ── */}
      <header className={styles.topBar}>
        <div className={styles.brandArea}>
          <button
            type="button"
            className={styles.menuDrawerBtn}
            aria-label="Open library menu"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <Menu size={20} />
          </button>
          <div className={styles.brandBadge}>
            <img src={appIconUrl} alt="MaliPDF" className={styles.brandIconImg} draggable={false} />
          </div>
          <span className={styles.brandTitle} data-no-translate>MaliPDF</span>
        </div>

        <div className={styles.segmentedWrap}>
          <div className={styles.segmentedPill} role="tablist" aria-label="Document categories">
            {([
              { id: 'all', label: 'All', icon: LayoutGrid },
              { id: 'pdf', label: 'PDFs', icon: FileText },
              { id: 'notebook', label: 'Notebooks', icon: BookOpen },
            ] as ReadonlyArray<{ id: LibraryCategory; label: string; icon: typeof FileText }>).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={categoryFilter === id}
                className={`${styles.segmentedBtn} ${categoryFilter === id ? styles.segmentedBtnActive : ''}`}
                onClick={() => setCategoryFilter(id)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.topRightArea}>
          {activeDocId && activeDoc && (
            <button
              type="button"
              className={styles.returnDocBtn}
              onClick={() => setActiveView('workspace')}
              title={activeDoc.title}
            >
              <FileText size={15} />
              <span className={styles.returnDocTitle} data-no-translate>
                {displayDocName(activeDoc.title)}
              </span>
              <ChevronRight size={15} />
            </button>
          )}
        </div>
      </header>

      {/* ── Main Body: Left Sidebar + Elevated Rounded Content Panel ── */}
      <div className={styles.body}>
        {drawerOpen && (
          <div className={styles.drawerBackdrop} onClick={() => setDrawerOpen(false)} />
        )}

        <aside className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ''}`}>
          <nav className={styles.navGroup} aria-label="Library sections">
            <button
              type="button"
              className={`${styles.navItem} ${activeSection === 'home' ? styles.navItemActive : ''}`}
              onClick={() => { setActiveSection('home'); setDrawerOpen(false); }}
            >
              <Home size={18} />
              <span className={styles.navItemLabel}>Home Folder</span>
            </button>
            <button
              type="button"
              className={`${styles.navItem} ${activeSection === 'favorites' ? styles.navItemActive : ''}`}
              onClick={() => { setActiveSection('favorites'); setDrawerOpen(false); }}
            >
              <Star size={18} />
              <span className={styles.navItemLabel}>Favorites</span>
              {favoritesCount > 0 && <span className={styles.navBadge}>{favoritesCount}</span>}
            </button>
            <button
              type="button"
              className={`${styles.navItem} ${activeSection === 'recent' ? styles.navItemActive : ''}`}
              onClick={() => { setActiveSection('recent'); setDrawerOpen(false); }}
            >
              <Clock size={18} />
              <span className={styles.navItemLabel}>Recent</span>
            </button>
            <button
              type="button"
              className={styles.navItem}
              onClick={() => {
                setDrawerOpen(false);
                window.dispatchEvent(new CustomEvent(SHOW_RECOVERY_EVENT));
              }}
            >
              <History size={18} />
              <span className={styles.navItemLabel}>Recovered</span>
            </button>
            <button
              type="button"
              className={`${styles.navItem} ${activeSection === 'trash' ? styles.navItemActive : ''}`}
              onClick={() => { setActiveSection('trash'); setDrawerOpen(false); }}
            >
              <Trash2 size={18} />
              <span className={styles.navItemLabel}>Trash</span>
              {trashCount > 0 && <span className={styles.navBadge}>{trashCount}</span>}
            </button>
          </nav>

          <div className={styles.treeHeader}>
            <span>Folders</span>
            <button
              type="button"
              className={styles.treeAddBtn}
              aria-label="New Folder"
              title="New Folder"
              onClick={openNewFolderModal}
            >
              <Plus size={15} />
            </button>
          </div>

          <div className={styles.treeList}>
            {folders.length === 0 ? (
              <div className={styles.treeEmpty}>No folders yet</div>
            ) : (
              folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={`${styles.navItem} ${activeSection === 'folder' && activeFolderId === folder.id ? styles.navItemActive : ''}`}
                  onClick={() => {
                    setActiveSection('folder', folder.id);
                    setDrawerOpen(false);
                  }}
                >
                  <SmallFolderIcon color={folder.color} />
                  <span className={styles.navItemLabel} data-no-translate>{folder.name}</span>
                  <ChevronRight size={14} opacity={0.55} />
                </button>
              ))
            )}
          </div>

          <div className={styles.sidebarFooter}>
            {!isIpadApp() && (
              <button
                type="button"
                className={styles.desktopSwitchBtn}
                onClick={() => setTabletMode(false)}
              >
                <Monitor size={16} />
                <span>Desktop Mode</span>
              </button>
            )}
            <button
              type="button"
              className={styles.navItem}
              onClick={() => { setSettingsOpen(true); setDrawerOpen(false); }}
            >
              <Settings size={18} />
              <span className={styles.navItemLabel}>Settings</span>
            </button>
            <button
              type="button"
              className={styles.navItem}
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              <span className={styles.navItemLabel}>
                {resolvedTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </span>
            </button>
          </div>
        </aside>

        {/* ── Elevated Frosted Document Panel ── */}
        <main className={styles.panel}>
          <div className={styles.panelHeader}>
            <div className={styles.panelTitleRow}>
              {activeSection === 'folder' && activeFolder && (
                <button
                  type="button"
                  className={styles.breadcrumbBack}
                  onClick={() => setActiveSection('home')}
                >
                  <ChevronLeft size={16} />
                  <span>Home Folder</span>
                </button>
              )}
              <h1 className={styles.panelTitle} data-no-translate={activeSection === 'folder' ? '' : undefined}>
                {sectionHeading}
              </h1>
              <button
                type="button"
                className={styles.headerIconBtn}
                aria-label="Refresh library"
                title="Refresh"
                onClick={() => void refresh()}
              >
                <RefreshCw size={17} className={loading ? 'animate-spin' : undefined} />
              </button>
              {activeSection !== 'trash' && (
                <button
                  type="button"
                  className={styles.headerIconBtn}
                  aria-label="New Folder"
                  title="New Folder"
                  onClick={openNewFolderModal}
                >
                  <Plus size={20} />
                </button>
              )}
            </div>

            <div className={styles.panelControls}>
              <div className={styles.searchBox}>
                <Search size={15} opacity={0.6} />
                <input
                  type="search"
                  className={styles.searchInput}
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className={styles.treeAddBtn}
                    aria-label="Clear search"
                    onClick={() => setSearchQuery('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {activeSection !== 'recent' && (
                <button
                  type="button"
                  className={styles.sortBtn}
                  data-lib-popover="true"
                  onClick={(e) => openContextAt(e, { kind: 'sort', x: 0, y: 0 })}
                >
                  {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                  <span>{sortLabel}</span>
                </button>
              )}

              <button
                type="button"
                className={styles.headerIconBtn}
                aria-label={viewMode === 'grid' ? 'List view' : 'Grid view'}
                title={viewMode === 'grid' ? 'List view' : 'Grid view'}
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              >
                {viewMode === 'grid' ? <List size={19} /> : <LayoutGrid size={19} />}
              </button>

              {activeSection === 'trash' && trashCount > 0 && (
                <button
                  type="button"
                  className={styles.dangerPillBtn}
                  onClick={() => void emptyTrash()}
                >
                  <Trash2 size={14} />
                  <span>Empty Trash</span>
                </button>
              )}
            </div>
          </div>

          <div className={styles.panelScroll}>
            {/* ── FOLDERS Section ── */}
            {visibleFolders.length > 0 && activeSection !== 'trash' && activeSection !== 'recent' && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionTitle}>
                    <FolderPlus size={14} />
                    <span>Folders</span>
                  </span>
                </div>
                <div className={styles.folderGrid}>
                  {visibleFolders.map((folder) => {
                    const count = folderDocCount(folder.id);
                    return (
                      <div
                        key={folder.id}
                        className={styles.folderCard}
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveSection('folder', folder.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveSection('folder', folder.id); }}
                      >
                        <div className={styles.folderGlyph}>
                          <FolderGlyph color={folder.color} />
                        </div>
                        <div className={styles.folderMeta}>
                          <div className={styles.folderName} data-no-translate>{folder.name}</div>
                          <div className={styles.folderSub}>
                            {formatDate(folder.updatedAt, language)} · {count}
                          </div>
                        </div>
                        <button
                          type="button"
                          className={`${styles.folderStarBtn} ${folder.favorite ? styles.folderStarBtnActive : ''}`}
                          aria-label="Toggle favorite"
                          onClick={(e) => { e.stopPropagation(); void toggleFolderFavorite(folder.id); }}
                        >
                          <Star size={15} fill={folder.favorite ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          type="button"
                          className={styles.folderMenuBtn}
                          aria-label="Folder actions"
                          data-lib-popover="true"
                          onClick={(e) => openContextAt(e, { kind: 'folder', folder, x: 0, y: 0 })}
                        >
                          <ChevronDown size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── DOCUMENTS / NOTES Section ── */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>
                  <FileText size={14} />
                  <span>{categoryFilter === 'notebook' ? 'Notebooks' : categoryFilter === 'pdf' ? 'PDFs' : 'Documents'}</span>
                </span>
                {visibleDocs.length > 0 && activeSection !== 'trash' && (
                  <button
                    type="button"
                    className={`${styles.selectToggleBtn} ${selectMode ? styles.selectToggleBtnActive : ''}`}
                    onClick={() => {
                      setSelectMode((v) => !v);
                      setSelectedIds(new Set());
                    }}
                  >
                    {selectMode ? 'Done' : 'Select'}
                  </button>
                )}
              </div>

              {visibleDocs.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>
                    {activeSection === 'trash' ? (
                      <Trash2 size={30} />
                    ) : activeSection === 'favorites' ? (
                      <Star size={30} />
                    ) : (
                      <FileText size={30} />
                    )}
                  </div>
                  <div className={styles.emptyTitle}>
                    {activeSection === 'trash'
                      ? 'Trash is empty'
                      : activeSection === 'favorites'
                        ? 'No favorites yet'
                        : searchQuery
                          ? 'No matching documents'
                          : 'Your workspace is ready'}
                  </div>
                  <p className={styles.emptySubtitle}>
                    {activeSection === 'trash'
                      ? 'Deleted documents appear here so you can restore them anytime.'
                      : activeSection === 'favorites'
                        ? 'Tap the star on any document or folder to pin it here.'
                        : 'Create a lined, grid, or Cornell notebook or import a PDF from Files to start annotating with Apple Pencil.'}
                  </p>
                  {activeSection !== 'trash' && activeSection !== 'favorites' && !searchQuery && (
                    <div className={styles.emptyActions}>
                      <button
                        type="button"
                        className={styles.primaryActionBtn}
                        onClick={() => setNewDocumentDialogOpen(true)}
                      >
                        <FilePlus size={18} />
                        <span>New Notebook</span>
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryActionBtn}
                        onClick={() => void handleImportPdfs()}
                      >
                        <Upload size={18} />
                        <span>Import PDF</span>
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryActionBtn}
                        onClick={() => void handleQuickNote()}
                      >
                        <Zap size={18} />
                        <span>Quick Note</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : viewMode === 'grid' ? (
                <div className={styles.docGrid}>
                  {visibleDocs.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <div key={item.id} className={styles.docCardWrap}>
                        <div
                          className={`${styles.docCover} ${isSelected ? styles.docCoverSelected : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (selectMode) toggleSelectDoc(item.id);
                            else if (activeSection !== 'trash') void openLibraryDocument(item.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            if (selectMode) toggleSelectDoc(item.id);
                            else if (activeSection !== 'trash') void openLibraryDocument(item.id);
                          }}
                        >
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className={styles.docThumbImg} draggable={false} />
                          ) : (
                            <div className={styles.docPlaceholder}>
                              <FileText size={32} opacity={0.45} />
                            </div>
                          )}

                          {selectMode && (
                            <span className={`${styles.selectCheck} ${isSelected ? styles.selectCheckActive : ''}`}>
                              {isSelected && <Check size={14} strokeWidth={3} />}
                            </span>
                          )}

                          {activeSection !== 'trash' && !selectMode && (
                            <button
                              type="button"
                              className={`${styles.cardStarBtn} ${item.favorite ? styles.cardStarBtnActive : ''}`}
                              aria-label="Toggle favorite"
                              onClick={(e) => {
                                e.stopPropagation();
                                void toggleFavorite(item.id);
                              }}
                            >
                              <Star size={14} fill={item.favorite ? 'currentColor' : 'none'} />
                            </button>
                          )}

                          <span className={styles.docKindBadge} data-no-translate>
                            {item.pageCount > 1 ? `${item.pageCount} p` : item.kind === 'notebook' ? 'NOTE' : 'PDF'}
                          </span>
                        </div>

                        <div className={styles.docFooter}>
                          <div className={styles.docFooterText}>
                            <div className={styles.docTitle} data-no-translate>
                              {displayDocName(item.title)}
                            </div>
                            <div className={styles.docDate}>
                              {formatDate(item.updatedAt, language)}
                            </div>
                          </div>
                          <button
                            type="button"
                            className={styles.docMenuBtn}
                            aria-label="Document actions"
                            data-lib-popover="true"
                            onClick={(e) => openContextAt(e, { kind: 'doc', item, x: 0, y: 0 })}
                          >
                            <ChevronDown size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.docList}>
                  {visibleDocs.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={styles.docListRow}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (selectMode) toggleSelectDoc(item.id);
                          else if (activeSection !== 'trash') void openLibraryDocument(item.id);
                        }}
                      >
                        {selectMode && (
                          <span className={`${styles.selectCheck} ${isSelected ? styles.selectCheckActive : ''}`} style={{ position: 'static' }}>
                            {isSelected && <Check size={14} strokeWidth={3} />}
                          </span>
                        )}
                        <div className={styles.docListThumb}>
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className={styles.docThumbImg} />
                          ) : (
                            <div className={styles.docPlaceholder}><FileText size={16} /></div>
                          )}
                        </div>
                        <div className={styles.docListMain}>
                          <div className={styles.docListTitle} data-no-translate>{displayDocName(item.title)}</div>
                          <div className={styles.docListSub}>
                            {formatDate(item.updatedAt, language)}
                            {item.pageCount ? ` · ${item.pageCount} p` : ''}
                            {item.sizeBytes ? ` · ${formatSize(item.sizeBytes)}` : ''}
                          </div>
                        </div>
                        {activeSection !== 'trash' && (
                          <button
                            type="button"
                            className={`${styles.folderStarBtn} ${item.favorite ? styles.folderStarBtnActive : ''}`}
                            style={{ position: 'static' }}
                            onClick={(e) => { e.stopPropagation(); void toggleFavorite(item.id); }}
                          >
                            <Star size={16} fill={item.favorite ? 'currentColor' : 'none'} />
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.docMenuBtn}
                          data-lib-popover="true"
                          onClick={(e) => openContextAt(e, { kind: 'doc', item, x: 0, y: 0 })}
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* ── Multi-Selection Action Pill ── */}
          {selectMode && selectedIds.size > 0 && (
            <div className={styles.selectionBar}>
              <span className={styles.selectionCount}>{selectedIds.size}</span>
              <button
                type="button"
                className={styles.sortBtn}
                onClick={() => setModal({ kind: 'moveDocs', itemIds: Array.from(selectedIds) })}
              >
                <FolderInput size={15} />
                <span>Move</span>
              </button>
              <button
                type="button"
                className={styles.dangerPillBtn}
                onClick={async () => {
                  await trashDocuments(Array.from(selectedIds));
                  setSelectedIds(new Set());
                  setSelectMode(false);
                }}
              >
                <Trash2 size={15} />
                <span>Delete</span>
              </button>
            </div>
          )}

          {/* ── Bottom-Right Floating Action Button (FAB) Cluster ── */}
          {activeSection !== 'trash' && !selectMode && (
            <div className={styles.fabCluster} data-lib-popover="true">
              {fabOpen && (
                <div className={styles.fabMenu} role="menu">
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setFabOpen(false);
                      setNewDocumentDialogOpen(true);
                    }}
                  >
                    <FilePlus size={18} />
                    <span>New Notebook…</span>
                  </button>
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => void handleQuickNote()}
                  >
                    <Zap size={18} />
                    <span>Quick Note</span>
                  </button>
                  <div className={styles.menuDivider} />
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => void handleImportPdfs()}
                  >
                    <Upload size={18} />
                    <span>Import PDF…</span>
                  </button>
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setFabOpen(false);
                      setImagesToPdfOpen(true);
                    }}
                  >
                    <ImagePlus size={18} />
                    <span>New PDF from Images…</span>
                  </button>
                  <div className={styles.menuDivider} />
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={openNewFolderModal}
                  >
                    <FolderPlus size={18} />
                    <span>New Folder</span>
                  </button>
                </div>
              )}

              <button
                type="button"
                className={styles.fabSecondary}
                aria-label="Import PDF"
                title="Import PDF"
                onClick={() => void handleImportPdfs()}
              >
                <Upload size={20} />
              </button>

              <div className={styles.fabRow}>
                <button
                  type="button"
                  className={`${styles.fabPrimary} ${fabOpen ? styles.fabPrimaryOpen : ''}`}
                  aria-label="Create new"
                  aria-expanded={fabOpen}
                  onClick={() => setFabOpen((v) => !v)}
                >
                  <Plus size={28} strokeWidth={2.4} />
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── Floating Context Popover Menus ── */}
      {menu && (
        <div
          className={styles.popoverMenu}
          style={{ left: menu.x, top: menu.y }}
          data-lib-popover="true"
          role="menu"
        >
          {menu.kind === 'sort' && (
            <>
              {([
                { id: 'updatedAt', label: 'Date Modified' },
                { id: 'title', label: 'Name' },
                { id: 'lastOpenedAt', label: 'Last Opened' },
                { id: 'sizeBytes', label: 'Size' },
              ] as ReadonlyArray<{ id: LibrarySortBy; label: string }>).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setSort(opt.id);
                    setMenu(null);
                  }}
                >
                  <Check size={16} opacity={sortBy === opt.id ? 1 : 0} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </>
          )}

          {menu.kind === 'folder' && (
            <>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => openEditFolderModal(menu.folder)}
              >
                <Pencil size={16} />
                <span>Rename</span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  void toggleFolderFavorite(menu.folder.id);
                  setMenu(null);
                }}
              >
                <Star size={16} />
                <span>{menu.folder.favorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
              </button>
              <div className={styles.menuDivider} />
              <button
                type="button"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  void deleteFolder(menu.folder.id);
                  setMenu(null);
                }}
              >
                <Trash2 size={16} />
                <span>Delete Folder</span>
              </button>
            </>
          )}

          {menu.kind === 'doc' && activeSection !== 'trash' && (
            <>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenu(null);
                  void openLibraryDocument(menu.item.id);
                }}
              >
                <FileText size={16} />
                <span>Open</span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => openRenameDocModal(menu.item)}
              >
                <Pencil size={16} />
                <span>Rename</span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenu(null);
                  setModal({ kind: 'moveDocs', itemIds: [menu.item.id] });
                }}
              >
                <FolderInput size={16} />
                <span>Move to Folder…</span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenu(null);
                  void duplicateDocument(menu.item.id);
                }}
              >
                <Copy size={16} />
                <span>Duplicate</span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => void handleShareDoc(menu.item)}
              >
                <Share size={16} />
                <span>Share</span>
              </button>
              <div className={styles.menuDivider} />
              <button
                type="button"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  setMenu(null);
                  void trashDocument(menu.item.id);
                }}
              >
                <Trash2 size={16} />
                <span>Move to Trash</span>
              </button>
            </>
          )}

          {menu.kind === 'doc' && activeSection === 'trash' && (
            <>
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenu(null);
                  void restoreDocument(menu.item.id);
                }}
              >
                <RotateCcw size={16} />
                <span>Restore</span>
              </button>
              <button
                type="button"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => {
                  setMenu(null);
                  void permanentlyDeleteDocument(menu.item.id);
                }}
              >
                <Trash2 size={16} />
                <span>Delete Permanently</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Clean iPadOS Modals (New/Edit Folder, Rename Doc, Move to Folder) ── */}
      {modal && (
        <div
          className={styles.modalBackdrop}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null); }}
        >
          {modal.kind === 'moveDocs' ? (
            <div className={styles.modalCard} role="dialog" aria-modal="true">
              <h2 className={styles.modalTitle}>Move to Folder</h2>
              <div className={styles.moveFolderList}>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={async () => {
                    await moveDocuments(modal.itemIds, null);
                    setModal(null);
                    setSelectMode(false);
                    setSelectedIds(new Set());
                  }}
                >
                  <Home size={18} />
                  <span>Home Folder</span>
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className={styles.menuItem}
                    onClick={async () => {
                      await moveDocuments(modal.itemIds, folder.id);
                      setModal(null);
                      setSelectMode(false);
                      setSelectedIds(new Set());
                    }}
                  >
                    <SmallFolderIcon color={folder.color} />
                    <span data-no-translate>{folder.name}</span>
                  </button>
                ))}
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.secondaryActionBtn} onClick={() => setModal(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <form className={styles.modalCard} onSubmit={submitModal} role="dialog" aria-modal="true">
              <h2 className={styles.modalTitle}>
                {modal.kind === 'newFolder'
                  ? 'New Folder'
                  : modal.kind === 'editFolder'
                    ? 'Edit Folder'
                    : 'Rename Document'}
              </h2>
              <input
                type="text"
                className={styles.modalInput}
                autoFocus
                placeholder={modal.kind === 'renameDoc' ? 'Document name' : 'Folder name'}
                value={modalText}
                onChange={(e) => setModalText(e.target.value)}
              />
              {(modal.kind === 'newFolder' || modal.kind === 'editFolder') && (
                <div className={styles.colorRow}>
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`${styles.colorDot} ${modalColor === c.id ? styles.colorDotSelected : ''}`}
                      style={{ background: c.hex }}
                      aria-label={c.label}
                      onClick={() => setModalColor(c.id)}
                    />
                  ))}
                </div>
              )}
              <div className={styles.modalActions}>
                <button type="button" className={styles.secondaryActionBtn} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button type="submit" className={styles.primaryActionBtn}>
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
