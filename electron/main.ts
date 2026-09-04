import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  MenuItemConstructorOptions,
} from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import {
  COMMAND_EXECUTE_CHANNEL,
  COMMAND_STATE_CHANNEL,
  FULLSCREEN_TOGGLE_CHANNEL,
  type NativeCommandState,
} from './commandBridge';
import {
  createNativeMenuSchema,
  type NativeMenuNode,
} from './nativeMenuSchema';

const isDev = process.env.NODE_ENV === 'development';
const APP_NAME = 'MaliPDF';

app.setName(APP_NAME);
process.title = APP_NAME;

let mainWindow: BrowserWindow | null = null;

let activeCloseRequest: {
  id: string;
  type: 'window-close' | 'quit';
  status: 'pending';
  timeoutId?: NodeJS.Timeout;
} | null = null;

function sendCommand(commandId: string, payload?: unknown) {
  mainWindow?.webContents.send(COMMAND_EXECUTE_CHANNEL, commandId, payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'MaliPDF',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#1a1a1a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    // If there is an active request that was authorized, we let it close.
    if (activeCloseRequest?.status === 'pending') {
      event.preventDefault();
      return;
    }
    
    // If not authorized yet, we start a new handshake
    if (!activeCloseRequest) {
      event.preventDefault();
      const requestId = crypto.randomUUID();
      activeCloseRequest = { id: requestId, type: 'window-close', status: 'pending' };
      activeCloseRequest.timeoutId = setTimeout(() => {
        // Timeout -> CANCEL CLOSE -> KEEP WINDOW OPEN
        if (activeCloseRequest?.id === requestId) {
          activeCloseRequest = null;
        }
      }, 5000);
      sendCommand('app.requestCloseWindow', requestId);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = createNativeMenuSchema(isMac, isDev).map((menu) => ({
    label: menu.label,
    role: menu.role,
    submenu: menu.items.map(buildNativeMenuItem),
  }));

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function buildNativeMenuItem(node: NativeMenuNode): MenuItemConstructorOptions {
  switch (node.kind) {
    case 'separator':
      return { type: 'separator' };
    case 'role':
      return { role: node.role };
    case 'label':
      return { label: node.label, enabled: false };
    case 'submenu':
      return { label: node.label, enabled: node.enabled, submenu: node.items.map(buildNativeMenuItem) };
    case 'command':
      return {
        id: node.commandId,
        label: node.label,
        accelerator: node.accelerator,
        enabled: node.enabled ?? true,
        type: node.type,
        registerAccelerator: node.registerAccelerator,
        click: () => sendCommand(node.commandId),
      };
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.on(COMMAND_STATE_CHANNEL, (_event, states: NativeCommandState[]) => {
  const menu = Menu.getApplicationMenu();
  if (!menu || !Array.isArray(states)) return;
  for (const state of states) {
    if (!state || typeof state.commandId !== 'string') continue;
    const item = menu.getMenuItemById(state.commandId);
    if (!item) continue;
    item.enabled = state.enabled === true;
    if (item.type === 'checkbox' || item.type === 'radio') item.checked = state.checked === true;
  }
});

ipcMain.handle(FULLSCREEN_TOGGLE_CHANNEL, () => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});

// Open PDF dialog
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open PDF',
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  // Read all selected files
  const files = await Promise.all(
    result.filePaths.map(async (filePath) => {
      const buffer = await fs.promises.readFile(filePath);
      return {
        filePath,
        name: path.basename(filePath),
        data: buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer,
      };
    }),
  );

  return files;
});

// Save dialog (for export)
ipcMain.handle('dialog:saveFile', async (_event, defaultName: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export Annotated PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
  });

  return result.canceled ? null : result.filePath;
});

// Close confirm dialog
ipcMain.handle('dialog:askCloseConfirm', async (_event, fileName: string) => {
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved Changes',
    message: `Save changes to "${fileName}" before closing?`,
    detail: 'Your changes will be lost if you don\'t save them.',
  });
  
  if (result.response === 0) return 'save';
  if (result.response === 1) return 'discard';
  return 'cancel';
});

// Close ALL confirm dialog
ipcMain.handle('dialog:askCloseAllConfirm', async (_event, fileNames: string[]) => {
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    buttons: ['Save All', 'Discard All', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved Changes',
    message: `${fileNames.length} documents have unsaved changes.`,
    detail: `The following documents have unsaved changes:\n\n${fileNames.map(f => `• ${f}`).join('\n')}\n\nYour changes will be lost if you don't save them.`,
  });
  if (result.response === 0) return 'save';
  if (result.response === 1) return 'discard';
  return 'cancel';
});

// Write file
ipcMain.handle(
  'fs:writeFile',
  async (_event, filePath: string, data: ArrayBuffer) => {
    const dir = path.dirname(filePath);
    const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${crypto.randomUUID()}`);
    try {
      await fs.promises.writeFile(tempPath, Buffer.from(data));
      await fs.promises.rename(tempPath, filePath);
      return true;
    } catch (error) {
      await fs.promises.unlink(tempPath).catch(() => {});
      throw error;
    }
  },
);

// Read file (for drag-dropped files by path)
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const buffer = await fs.promises.readFile(filePath);
  return {
    name: path.basename(filePath),
    data: buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
  };
});

// Get temp directory
ipcMain.handle('app:getTempDir', () => {
  return os.tmpdir();
});

// Get app version
ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

let isQuitting = false;
let isWindowClosing = false;

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (event) => {
  // If there is an active request that was authorized, let it quit
  if (activeCloseRequest?.type === 'quit' && activeCloseRequest.status !== 'pending') {
    return;
  }
  
  event.preventDefault();
  
  if (!activeCloseRequest) {
    const requestId = crypto.randomUUID();
    activeCloseRequest = { id: requestId, type: 'quit', status: 'pending' };
    activeCloseRequest.timeoutId = setTimeout(() => {
      // Timeout -> CANCEL CLOSE -> KEEP APP OPEN
      if (activeCloseRequest?.id === requestId) {
        activeCloseRequest = null;
      }
    }, 5000);
    sendCommand('app.requestQuit', requestId);
  }
});

app.on('window-all-closed', () => {
  // Only for normal platform behavior, no persistence handshake here.
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('app:confirmLifecycle', (_event, requestId: string, allow: boolean) => {
  if (activeCloseRequest?.id !== requestId || activeCloseRequest.status !== 'pending') {
    // Stale or duplicate ALLOW message, ignore.
    return;
  }
  
  const type = activeCloseRequest.type;
  clearTimeout(activeCloseRequest.timeoutId);
  
  if (!allow) {
    // Renderer cancelled the close sequence.
    activeCloseRequest = null;
    return;
  }
  
  // ALLOW: open guard and re-trigger
  activeCloseRequest.status = 'authorized' as any;
  
  if (type === 'quit') {
    app.quit();
  } else {
    mainWindow?.close();
  }
});
