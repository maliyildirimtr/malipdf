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
import {
  COMMAND_EXECUTE_CHANNEL,
  COMMAND_STATE_CHANNEL,
  FULLSCREEN_TOGGLE_CHANNEL,
  NATIVE_ROLE_CHANNEL,
  type NativeCommandState,
  type NativeRole,
} from './commandBridge';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

function sendCommand(commandId: string) {
  mainWindow?.webContents.send(COMMAND_EXECUTE_CHANNEL, commandId);
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),

    // File menu
    {
      label: 'File',
      submenu: [
        { label: 'New Document…', accelerator: 'CmdOrCtrl+N', enabled: false },
        { label: 'Combine Files…', enabled: false },
        {
          id: 'file.open',
          label: 'Open PDF…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendCommand('file.open'),
        },
        { type: 'separator' },
        {
          id: 'file.save',
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          enabled: false,
          click: () => sendCommand('file.save'),
        },
        {
          id: 'file.saveAs',
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          enabled: false,
          click: () => sendCommand('file.saveAs'),
        },
        { label: 'Save as Template…', enabled: false },
        { label: 'Save All', enabled: false },
        { type: 'separator' },
        {
          id: 'file.export',
          label: 'Export PDF…',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendCommand('file.export'),
        },
        { type: 'separator' },
        { id: 'file.close', label: 'Close', accelerator: 'CmdOrCtrl+W', click: () => sendCommand('file.close') },
        { id: 'file.closeAll', label: 'Close All', accelerator: 'Alt+CmdOrCtrl+W', click: () => sendCommand('file.closeAll') },
        { type: 'separator' },
        { label: 'Document Properties…', enabled: false },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', enabled: false },
        ...(!isMac ? [{ type: 'separator' as const }, { role: 'quit' as const }] : []),
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        {
          id: 'history.undo',
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendCommand('history.undo'),
        },
        {
          id: 'history.redo',
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => sendCommand('history.redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        {
          id: 'edit.selectAll',
          label: 'Select All Annotations',
          accelerator: 'CmdOrCtrl+A',
          enabled: false,
          click: () => sendCommand('edit.selectAll'),
        },
        {
          id: 'edit.deleteSelected',
          label: 'Delete Selected',
          accelerator: 'Delete',
          enabled: false,
          click: () => sendCommand('edit.deleteSelected'),
        },
      ],
    },

    // Tools menu
    {
      label: 'Tools',
      submenu: [
        {
          id: 'tool.hand',
          type: 'checkbox',
          label: 'Hand',
          accelerator: 'H',
          registerAccelerator: false,
          click: () => sendCommand('tool.hand'),
        },
        {
          id: 'tool.select',
          type: 'checkbox',
          label: 'Select',
          accelerator: 'V',
          registerAccelerator: false,
          click: () => sendCommand('tool.select'),
        },
        { type: 'separator' },
        {
          id: 'tool.pen',
          type: 'checkbox',
          label: 'Pen',
          accelerator: 'P',
          registerAccelerator: false,
          click: () => sendCommand('tool.pen'),
        },
        {
          id: 'tool.highlighter',
          type: 'checkbox',
          label: 'Highlighter',
          accelerator: 'M',
          registerAccelerator: false,
          click: () => sendCommand('tool.highlighter'),
        },
        {
          id: 'tool.eraser',
          type: 'checkbox',
          label: 'Eraser',
          accelerator: 'E',
          registerAccelerator: false,
          click: () => sendCommand('tool.eraser'),
        },
        {
          id: 'tool.text',
          type: 'checkbox',
          label: 'Text',
          accelerator: 'T',
          registerAccelerator: false,
          click: () => sendCommand('tool.text'),
        },
        { type: 'separator' },
        {
          id: 'tool.rectangle',
          type: 'checkbox',
          label: 'Rectangle',
          accelerator: 'R',
          registerAccelerator: false,
          click: () => sendCommand('tool.rectangle'),
        },
        {
          id: 'tool.ellipse',
          type: 'checkbox',
          label: 'Ellipse',
          accelerator: 'C',
          registerAccelerator: false,
          click: () => sendCommand('tool.ellipse'),
        },
        {
          id: 'tool.line',
          type: 'checkbox',
          label: 'Line',
          accelerator: 'L',
          registerAccelerator: false,
          click: () => sendCommand('tool.line'),
        },
        {
          id: 'tool.arrow',
          type: 'checkbox',
          label: 'Arrow',
          accelerator: 'A',
          registerAccelerator: false,
          click: () => sendCommand('tool.arrow'),
        },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        {
          id: 'view.zoomIn',
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Equal',
          click: () => sendCommand('view.zoomIn'),
        },
        {
          id: 'view.zoomOut',
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+Minus',
          click: () => sendCommand('view.zoomOut'),
        },
        {
          id: 'view.actualSize',
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => sendCommand('view.actualSize'),
        },
        {
          id: 'view.fitWidth',
          label: 'Fit Width',
          accelerator: 'CmdOrCtrl+6',
          click: () => sendCommand('view.fitWidth'),
        },
        {
          id: 'view.fitPage',
          label: 'Fit Page',
          accelerator: 'CmdOrCtrl+5',
          click: () => sendCommand('view.fitPage'),
        },
        { type: 'separator' },
        {
          id: 'view.rotateCW',
          label: 'Rotate View Right',
          accelerator: 'CmdOrCtrl+]',
          click: () => sendCommand('view.rotateCW'),
        },
        {
          id: 'view.rotateCCW',
          label: 'Rotate View Left',
          accelerator: 'CmdOrCtrl+[',
          click: () => sendCommand('view.rotateCCW'),
        },
        { type: 'separator' },
        {
          id: 'view.sidebar',
          type: 'checkbox',
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendCommand('view.sidebar'),
        },
        {
          id: 'view.focusMode',
          type: 'checkbox',
          label: 'Focus Mode',
          accelerator: 'Alt+CmdOrCtrl+F',
          click: () => sendCommand('view.focusMode'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' },
        {
          id: 'view.nativeFullscreen',
          label: 'Enter Native Full Screen',
          accelerator: isMac ? 'Ctrl+Command+F' : 'F11',
          click: () => sendCommand('view.nativeFullscreen'),
        },
      ],
    },

    // Window uses native platform roles rather than renderer business logic.
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },

    // Help
    {
      role: 'help',
      submenu: [
        {
          label: 'MaliPDF Help',
          enabled: false,
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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

ipcMain.handle(NATIVE_ROLE_CHANNEL, (_event, role: NativeRole) => {
  if (!mainWindow) return false;
  switch (role) {
    case 'cut': mainWindow.webContents.cut(); break;
    case 'copy': mainWindow.webContents.copy(); break;
    case 'paste': mainWindow.webContents.paste(); break;
    case 'minimize': mainWindow.minimize(); break;
    case 'zoom': mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); break;
    case 'bringAllToFront': app.focus({ steal: true }); break;
    default: return false;
  }
  return true;
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

// Write file
ipcMain.handle(
  'fs:writeFile',
  async (_event, filePath: string, data: ArrayBuffer) => {
    await fs.promises.writeFile(filePath, Buffer.from(data));
    return true;
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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
