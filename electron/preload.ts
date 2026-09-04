import { contextBridge, ipcRenderer } from 'electron';
import {
  COMMAND_EXECUTE_CHANNEL,
  COMMAND_STATE_CHANNEL,
  FULLSCREEN_TOGGLE_CHANNEL,
  type NativeCommandState,
} from './commandBridge';

// ─── Type definitions for the exposed API ─────────────────────────────────────

export interface OpenedFile {
  filePath: string;
  name: string;
  data: ArrayBuffer;
}

export interface ElectronAPI {
  // File operations
  openFile: () => Promise<OpenedFile[] | null>;
  saveFile: (defaultName: string) => Promise<string | null>;
  writeFile: (filePath: string, data: ArrayBuffer) => Promise<boolean>;
  readFile: (filePath: string) => Promise<{ name: string; data: ArrayBuffer }>;

  // App info
  getTempDir: () => Promise<string>;
  getVersion: () => Promise<string>;

  onCommand: (callback: (commandId: unknown, payload?: unknown) => void) => () => void;
  updateCommandStates: (states: NativeCommandState[]) => void;
  toggleFullScreen: () => Promise<boolean>;
  askCloseConfirm: (fileName: string) => Promise<'save' | 'discard' | 'cancel'>;
  askCloseAllConfirm: (fileNames: string[]) => Promise<'save' | 'discard' | 'cancel'>;
  confirmLifecycle: (requestId: string, allow: boolean) => void;
}

const electronAPI: ElectronAPI = {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  getTempDir: () => ipcRenderer.invoke('app:getTempDir'),
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
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
