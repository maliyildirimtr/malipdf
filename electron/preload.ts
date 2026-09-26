import { contextBridge, ipcRenderer } from 'electron';
import type { OcrLine } from './services/ocr/ocrIpc';
import type { NativeCommandState } from './commandBridge';

// The preload runs in a sandboxed renderer, where require() only resolves
// 'electron' (and a few builtins) — local modules cannot be imported at
// runtime. These must stay equal to electron/commandBridge.ts (a unit test
// checks this).
const COMMAND_EXECUTE_CHANNEL = 'command:execute';
const COMMAND_STATE_CHANNEL = 'command:updateState';
const FULLSCREEN_TOGGLE_CHANNEL = 'window:toggleFullScreen';

// ─── Type definitions for the exposed API ─────────────────────────────────────

export interface OpenedFile {
  filePath: string;
  name: string;
  data: ArrayBuffer;
}

export interface RecoveryAsset {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RecoveryEntry {
  docId: string;
  title: string;
  filePath: string | null;
  savedAt: number;
  pageCount: number;
  annotationCount: number;
}

export interface ElectronAPI {
  // File operations
  openFile: () => Promise<OpenedFile[] | null>;
  saveFile: (defaultName: string) => Promise<string | null>;
  /** Only paths chosen in an Open/Save dialog this session are writable. */
  writeFile: (filePath: string, data: ArrayBuffer) => Promise<boolean>;

  // App info
  getVersion: () => Promise<string>;

  onCommand: (callback: (commandId: unknown, payload?: unknown) => void) => () => void;
  updateCommandStates: (states: NativeCommandState[]) => void;
  toggleFullScreen: () => Promise<boolean>;
  askCloseConfirm: (fileName: string) => Promise<'save' | 'discard' | 'cancel'>;
  askCloseAllConfirm: (fileNames: string[]) => Promise<'save' | 'discard' | 'cancel'>;
  confirmLifecycle: (requestId: string, allow: boolean) => void;

  // Image & Screenshot operations
  openImage: () => Promise<{ name: string; mimeType: string; data: ArrayBuffer } | null>;
  captureScreen: () => Promise<{ success: boolean; data?: ArrayBuffer; mimeType?: string; width?: number; height?: number; error?: string }>;
  captureRegion: () => Promise<{ success: boolean; canceled?: boolean; data?: ArrayBuffer; mimeType?: string; width?: number; height?: number; error?: string }>;
  readClipboardImage: () => Promise<{ data: ArrayBuffer; mimeType: string } | null>;
  writeClipboardImage: (png: ArrayBuffer) => Promise<boolean>;

  // Crash recovery (Auto Save)
  recoveryWrite: (docId: string, meta: string, source: Uint8Array | null, assets: RecoveryAsset[]) => Promise<boolean>;
  recoveryRemove: (docId: string) => Promise<boolean>;
  recoveryList: () => Promise<RecoveryEntry[]>;
  recoveryLoad: (docId: string) => Promise<{ meta: string; source: ArrayBuffer; assets: { id: string; data: ArrayBuffer }[] }>;

  // Files opened from Finder / Explorer / Dock / Open Recent
  onOpenFiles: (callback: (files: Array<{ filePath: string; name: string; data: ArrayBuffer }>) => void) => () => void;
  readyForFiles: () => void;

  // App info / updates
  checkForUpdates: () => Promise<boolean>;
  showAbout: () => Promise<boolean>;
  openCrashReports: () => Promise<boolean>;

  // PPTX Printout
  pptxIsAvailable: () => Promise<boolean>;
  pptxOpenLibreOfficeDownload: () => Promise<boolean>;
  pptxStartConversion: (jobId: string) => Promise<{ buffer: ArrayBuffer; name: string } | null>;
  pptxConvertBytes: (jobId: string, data: ArrayBuffer, name: string) => Promise<{ buffer: ArrayBuffer; name: string }>;
  pptxCancelConversion: (jobId: string) => Promise<void>;
  ocrIsAvailable: () => Promise<boolean>;
  ocrRecognize: (png: ArrayBuffer, languages?: string[]) => Promise<OcrLine[]>;
}

const electronAPI: ElectronAPI = {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  onCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, commandId: unknown, payload?: unknown) => callback(commandId, payload);
    ipcRenderer.on(COMMAND_EXECUTE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(COMMAND_EXECUTE_CHANNEL, listener);
  },
  updateCommandStates: (states) => ipcRenderer.send(COMMAND_STATE_CHANNEL, states),
  toggleFullScreen: () => ipcRenderer.invoke(FULLSCREEN_TOGGLE_CHANNEL),
  askCloseConfirm: (fileName) => ipcRenderer.invoke('dialog:askCloseConfirm', fileName),
  askCloseAllConfirm: (fileNames) => ipcRenderer.invoke('dialog:askCloseAllConfirm', fileNames),
  confirmLifecycle: (requestId, allow) => ipcRenderer.send('app:confirmLifecycle', requestId, allow),

  openImage: () => ipcRenderer.invoke('dialog:openImage'),
  captureScreen: () => ipcRenderer.invoke('screenshot:captureDisplay'),
  captureRegion: () => ipcRenderer.invoke('screenshot:captureRegion'),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),
  writeClipboardImage: (png) => ipcRenderer.invoke('clipboard:writeImage', png),

  recoveryWrite: (docId, meta, source, assets) => ipcRenderer.invoke('recovery:write', docId, meta, source, assets),
  recoveryRemove: (docId) => ipcRenderer.invoke('recovery:remove', docId),
  recoveryList: () => ipcRenderer.invoke('recovery:list'),
  recoveryLoad: (docId) => ipcRenderer.invoke('recovery:load', docId),

  onOpenFiles: (callback) => {
    const listener = (_event: unknown, files: Array<{ filePath: string; name: string; data: ArrayBuffer }>) => callback(files);
    ipcRenderer.on('app:openFiles', listener);
    return () => ipcRenderer.removeListener('app:openFiles', listener);
  },
  readyForFiles: () => ipcRenderer.send('app:readyForFiles'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  showAbout: () => ipcRenderer.invoke('app:showAbout'),
  openCrashReports: () => ipcRenderer.invoke('app:openCrashReports'),

  // PPTX Printout
  pptxIsAvailable: () => ipcRenderer.invoke('pptx:isAvailable'),
  pptxOpenLibreOfficeDownload: () => ipcRenderer.invoke('pptx:openLibreOfficeDownload'),
  pptxStartConversion: (jobId) => ipcRenderer.invoke('pptx:startConversion', jobId),
  pptxConvertBytes: (jobId, data, name) => ipcRenderer.invoke('pptx:convertBytes', jobId, data, name),
  pptxCancelConversion: (jobId) => ipcRenderer.invoke('pptx:cancelConversion', jobId),
  ocrIsAvailable: () => ipcRenderer.invoke('ocr:isAvailable'),
  ocrRecognize: (png, languages) => ipcRenderer.invoke('ocr:recognize', png, languages),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

