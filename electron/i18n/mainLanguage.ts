/**
 * Main-process side of the interface language: the current language (sent by
 * the renderer from Settings) and localized wrappers for native dialogs.
 */
import { dialog, type BrowserWindow, type MessageBoxOptions, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { translate, type Language } from './index';

let current: Language = 'en';

export function getLanguage(): Language {
  return current;
}

/** Returns true when the language actually changed. */
export function setLanguage(language: Language): boolean {
  if (language === current) return false;
  current = language;
  return true;
}

export function t(text: string): string {
  return translate(current, text);
}

function localizeFilters<T extends { filters?: Electron.FileFilter[] }>(options: T): T {
  return options.filters ? { ...options, filters: options.filters.map((f) => ({ ...f, name: t(f.name) })) } : options;
}

export function showMessageBox(window: BrowserWindow | null | undefined, options: MessageBoxOptions) {
  const localized: MessageBoxOptions = {
    ...options,
    title: options.title && t(options.title),
    message: t(options.message),
    detail: options.detail && t(options.detail),
    buttons: options.buttons?.map(t),
    checkboxLabel: options.checkboxLabel && t(options.checkboxLabel),
  };
  return window ? dialog.showMessageBox(window, localized) : dialog.showMessageBox(localized);
}

export function showOpenDialog(window: BrowserWindow, options: OpenDialogOptions) {
  return dialog.showOpenDialog(window, localizeFilters({ ...options, title: options.title && t(options.title) }));
}

export function showSaveDialog(window: BrowserWindow, options: SaveDialogOptions) {
  return dialog.showSaveDialog(window, localizeFilters({ ...options, title: options.title && t(options.title) }));
}
