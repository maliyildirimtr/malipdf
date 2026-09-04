import React from 'react';
import {
  ArrowRight, Check, ChevronRight, Circle, CircleDot, Combine, Crop,
  Eraser, FileDown, FilePlus2, FileText, Focus, FolderOpen, Fullscreen,
  Hand, HelpCircle, Highlighter, LayoutList, LassoSelect, Maximize2,
  Minus, MousePointer2, PanelLeft, Pen, Pentagon, Printer, Redo2,
  RotateCcw, RotateCw, Ruler, Save, SaveAll, Scan, Scissors, Search,
  Sigma, Sparkles, Square, Stamp, Trash2, Type, Undo2, WandSparkles,
  X, ZoomIn, ZoomOut, type LucideIcon,
} from 'lucide-react';
import {
  APPLICATION_MENUS,
  APP_COMMANDS,
  executeMenuItem,
  findTypeaheadMenuIndex,
  getMenuNodeLabel,
  moveMenuIndex,
  resolveMenuItemState,
  type AppCommandId,
  type CommandIconId,
  type MenuNode,
  type MenuPresentationContext,
} from '../../commands';
import { useDocumentStore } from '../../store/documentStore';
import { useHistoryStore } from '../../store/historyStore';
import { useUIStore } from '../../store/uiStore';
import styles from './ApplicationMenu.module.css';

interface ApplicationMenuProps {
  onCommand: (commandId: AppCommandId) => void;
  canExecute: (commandId: AppCommandId) => boolean;
}

export function ApplicationMenu({ onCommand, canExecute }: ApplicationMenuProps) {
  const rootRef = React.useRef<HTMLElement>(null);
  const triggerRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
  const [focusedTopIndex, setFocusedTopIndex] = React.useState(0);
  const activeDocId = useDocumentStore((state) => state.activeDocId);
  const histories = useHistoryStore((state) => state.histories);
  const { activeTool, sidebarOpen, activeSidebarPanel, workspaceMode, selection } = useUIStore();
  const history = activeDocId ? histories.get(activeDocId) : undefined;
  const context: MenuPresentationContext = {
    hasDocument: activeDocId !== null,
    canUndo: (history?.undoStack.length ?? 0) > 0,
    canRedo: (history?.redoStack.length ?? 0) > 0,
    hasSelection: selection.selectedIds.size > 0,
    activeTool,
    sidebarOpen,
    activeSidebarPanel,
    workspaceMode,
  };

  const closeMenus = React.useCallback((restoreFocus = false) => {
    const previous = openMenuId;
    setOpenMenuId(null);
    if (restoreFocus && previous) requestAnimationFrame(() => triggerRefs.current.get(previous)?.focus());
  }, [openMenuId]);

  React.useEffect(() => {
    if (!openMenuId) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenus(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [closeMenus, openMenuId]);

  function openMenu(id: string, focusFirst: boolean) {
    setOpenMenuId(id);
    if (focusFirst) requestAnimationFrame(() => focusFirstMenuItem(id));
  }

  function moveTop(direction: -1 | 1, open = openMenuId !== null) {
    const next = (focusedTopIndex + direction + APPLICATION_MENUS.length) % APPLICATION_MENUS.length;
    setFocusedTopIndex(next);
    const id = APPLICATION_MENUS[next].id;
    triggerRefs.current.get(id)?.focus();
    if (open) openMenu(id, true);
  }

  function runItem(item: Extract<MenuNode, { kind: 'command' | 'nativeRole' }>) {
    const ran = executeMenuItem(
      item,
      context,
      (commandId) => canExecute(commandId) && onCommand(commandId),
      (role) => void window.electronAPI?.executeNativeRole(role),
    );
    if (ran) closeMenus(false);
  }

  return (
    <nav ref={rootRef} className={styles.menuBar} role="menubar" aria-label="Application menu">
      {APPLICATION_MENUS.map((menu, index) => {
        const open = openMenuId === menu.id;
        return (
          <div className={styles.topMenu} key={menu.id}>
            <button
              ref={(element) => {
                if (element) triggerRefs.current.set(menu.id, element);
                else triggerRefs.current.delete(menu.id);
              }}
              type="button"
              role="menuitem"
              className={`${styles.menuTrigger} ${open ? styles.menuTriggerOpen : ''}`}
              tabIndex={index === focusedTopIndex ? 0 : -1}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={`application-menu-${menu.id}`}
              onFocus={() => setFocusedTopIndex(index)}
              onPointerEnter={() => openMenuId && openMenu(menu.id, false)}
              onClick={() => open ? closeMenus(false) : openMenu(menu.id, false)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') { event.preventDefault(); moveTop(1); }
                else if (event.key === 'ArrowLeft') { event.preventDefault(); moveTop(-1); }
                else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault(); openMenu(menu.id, true);
                } else if (event.key === 'Escape' && open) { event.preventDefault(); closeMenus(true); }
              }}
            >
              {menu.label}
            </button>
            {open && (
              <MenuLevel
                id={`application-menu-${menu.id}`}
                items={menu.items}
                context={context}
                runItem={runItem}
                onClose={() => closeMenus(true)}
                onNavigateTop={(direction) => moveTop(direction, true)}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

function MenuLevel({ id, items, context, runItem, onClose, onNavigateTop, nested = false, onCloseSubmenu }: {
  id: string;
  items: readonly MenuNode[];
  context: MenuPresentationContext;
  runItem: (item: Extract<MenuNode, { kind: 'command' | 'nativeRole' }>) => void;
  onClose: () => void;
  onNavigateTop: (direction: -1 | 1) => void;
  nested?: boolean;
  onCloseSubmenu?: () => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const typeaheadRef = React.useRef('');
  const typeaheadTimerRef = React.useRef<number | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = React.useState<string | null>(null);

  React.useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
  }, []);

  const focusSubmenu = (submenuId: string) => requestAnimationFrame(() => {
    const submenu = listRef.current?.querySelector<HTMLElement>(`[data-submenu-panel="${submenuId}"]`);
    getDirectMenuItems(submenu).find(isEnabledMenuElement)?.focus();
  });

  return (
    <div
      ref={listRef}
      id={id}
      className={`${styles.menu} ${nested ? styles.submenu : ''}`}
      role="menu"
      aria-label={id}
      data-submenu-panel={nested ? id : undefined}
      onKeyDown={(event) => {
        if ((event.target as Element).closest('[role="menu"]') !== event.currentTarget) return;
        const elements = getDirectMenuItems(event.currentTarget);
        const enabled = elements.map(isEnabledMenuElement);
        const currentIndex = elements.indexOf(document.activeElement as HTMLElement);
        let nextIndex = -1;
        if (event.key === 'ArrowDown') nextIndex = moveMenuIndex(enabled, currentIndex, 'next');
        else if (event.key === 'ArrowUp') nextIndex = moveMenuIndex(enabled, currentIndex, 'previous');
        else if (event.key === 'Home') nextIndex = moveMenuIndex(enabled, currentIndex, 'first');
        else if (event.key === 'End') nextIndex = moveMenuIndex(enabled, currentIndex, 'last');
        else if (event.key === 'Escape') { event.preventDefault(); nested ? onCloseSubmenu?.() : onClose(); return; }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); nested ? onCloseSubmenu?.() : onNavigateTop(-1); return; }
        else if (event.key === 'ArrowRight') {
          const current = elements[currentIndex];
          const submenuId = current?.dataset.submenuId;
          event.preventDefault();
          if (submenuId) { setOpenSubmenuId(submenuId); focusSubmenu(submenuId); }
          else if (!nested) onNavigateTop(1);
          return;
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          typeaheadRef.current += event.key;
          if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
          typeaheadTimerRef.current = window.setTimeout(() => { typeaheadRef.current = ''; }, 650);
          const match = findTypeaheadMenuIndex(elements.map((element) => element.dataset.menuLabel ?? ''), enabled, currentIndex, typeaheadRef.current);
          if (match >= 0) { event.preventDefault(); elements[match]?.focus(); }
          return;
        }
        if (nextIndex >= 0) { event.preventDefault(); elements[nextIndex]?.focus(); }
      }}
    >
      {items.map((item, index) => {
        if (item.kind === 'separator') return <div key={`separator-${index}`} className={styles.separator} role="separator" />;
        if (item.kind === 'submenu') {
          const open = openSubmenuId === item.id;
          return (
            <div key={item.id} className={styles.submenuRow} onPointerEnter={() => setOpenSubmenuId(item.id)}>
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                tabIndex={-1}
                aria-haspopup="menu"
                aria-expanded={open}
                data-menu-item="true"
                data-menu-label={item.label}
                data-submenu-id={item.id}
                onClick={() => { setOpenSubmenuId(item.id); focusSubmenu(item.id); }}
              >
                <span className={styles.iconColumn} />
                <span className={styles.label}>{item.label}</span>
                <span className={styles.shortcut} />
                <ChevronRight size={13} className={styles.submenuArrow} aria-hidden="true" />
              </button>
              {open && (
                <MenuLevel
                  id={item.id}
                  items={item.items}
                  context={context}
                  runItem={runItem}
                  onClose={onClose}
                  onNavigateTop={onNavigateTop}
                  nested
                  onCloseSubmenu={() => {
                    setOpenSubmenuId(null);
                    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-submenu-id="${item.id}"]`)?.focus());
                  }}
                />
              )}
            </div>
          );
        }

        const state = item.kind === 'command'
          ? resolveMenuItemState(item, context)
          : { enabled: item.enabled !== false, checked: false, role: 'menuitem' as const };
        const definition = item.kind === 'command' ? APP_COMMANDS[item.commandId] : null;
        const nativeItem = item.kind === 'nativeRole' ? item : null;
        const label = getMenuNodeLabel(item);
        const Icon = definition ? COMMAND_ICONS[definition.icon] ?? Circle : nativeRoleIcon(nativeItem!.role);
        return (
          <button
            key={item.kind === 'command' ? item.commandId : item.role}
            type="button"
            role={state.role}
            aria-checked={state.role === 'menuitem' ? undefined : state.checked}
            aria-disabled={!state.enabled}
            tabIndex={-1}
            className={`${styles.menuItem} ${!state.enabled ? styles.menuItemDisabled : ''}`}
            data-menu-item="true"
            data-menu-label={label}
            onClick={() => state.enabled && runItem(item)}
          >
            <span className={styles.iconColumn} aria-hidden="true">
              {state.checked ? <Check size={14} strokeWidth={2.2} /> : <Icon size={14} strokeWidth={1.8} />}
            </span>
            <span className={styles.label}>{label}</span>
            <kbd className={styles.shortcut}>{definition?.shortcut ?? nativeItem?.shortcut ?? ''}</kbd>
            <span className={styles.submenuArrow} />
          </button>
        );
      })}
    </div>
  );
}

function getDirectMenuItems(root: Element | null | undefined): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[data-menu-item="true"]'))
    .filter((element) => element.closest('[role="menu"]') === root);
}
function isEnabledMenuElement(element: HTMLElement): boolean { return element.getAttribute('aria-disabled') !== 'true'; }
function focusFirstMenuItem(menuId: string) {
  const menu = document.getElementById(`application-menu-${menuId}`);
  getDirectMenuItems(menu).find(isEnabledMenuElement)?.focus();
}
function nativeRoleIcon(role: string): LucideIcon {
  if (role === 'cut') return Scissors;
  if (role === 'minimize') return Minus;
  if (role === 'zoom') return Maximize2;
  return Square;
}

const COMMAND_ICONS: Partial<Record<CommandIconId, LucideIcon>> = {
  newDocument: FilePlus2, combine: Combine, open: FolderOpen, save: Save, saveAs: Save,
  template: Sparkles, saveAll: SaveAll, export: FileDown, close: X, closeAll: X,
  properties: FileText, print: Printer, undo: Undo2, redo: Redo2, selectAll: MousePointer2,
  delete: Trash2, select: MousePointer2, extractText: Type, hand: Hand, zoom: ZoomIn,
  pen: Pen, highlighter: Highlighter, eraser: Eraser, text: Type, stamp: Stamp,
  line: Minus, arrow: ArrowRight, rectangle: Square, ellipse: Circle, polygon: Pentagon,
  dimension: Ruler, lasso: LassoSelect, snapshot: Scan, crop: Crop, measure: Ruler,
  formula: Sigma, laserPointer: WandSparkles, pointer: CircleDot, sidebar: PanelLeft,
  zoomIn: ZoomIn, zoomOut: ZoomOut, actualSize: Scan, fitWidth: Maximize2,
  fitPage: Square, layout: LayoutList, rotateLeft: RotateCcw, rotateRight: RotateCw,
  annotations: FileText, toolbar: LayoutList, fullscreen: Fullscreen, focus: Focus,
  favorites: Sparkles, toolStyles: WandSparkles, help: HelpCircle,
};
