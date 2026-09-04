import { contextBridge, ipcRenderer } from 'electron';
import {
  COMMAND_EXECUTE_CHANNEL,
  COMMAND_STATE_CHANNEL,
  FULLSCREEN_TOGGLE_CHANNEL,
  NATIVE_ROLE_CHANNEL,
  type NativeCommandState,
  type NativeRole,
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

  onCommand: (callback: (commandId: unknown) => void) => () => void;
  updateCommandStates: (states: NativeCommandState[]) => void;
  executeNativeRole: (role: NativeRole) => Promise<boolean>;
  toggleFullScreen: () => Promise<boolean>;
}

const electronAPI: ElectronAPI = {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  getTempDir: () => ipcRenderer.invoke('app:getTempDir'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  onCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, commandId: unknown) => callback(commandId);
    ipcRenderer.on(COMMAND_EXECUTE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(COMMAND_EXECUTE_CHANNEL, listener);
  },
  updateCommandStates: (states) => ipcRenderer.send(COMMAND_STATE_CHANNEL, states),
  executeNativeRole: (role) => ipcRenderer.invoke(NATIVE_ROLE_CHANNEL, role),
  toggleFullScreen: () => ipcRenderer.invoke(FULLSCREEN_TOGGLE_CHANNEL),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
