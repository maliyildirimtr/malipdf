import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  MenuItemConstructorOptions,
  screen,
  desktopCapturer,
  clipboard,
  systemPreferences,
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
import { setupPptxIpc } from './services/pptx/pptxIpc';

const isDev = process.env.NODE_ENV === 'development';
const APP_NAME = 'MaliPDF';

setupPptxIpc();

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

// ─── Image & Screenshot Handlers ─────────────────────────────────────────────

const CAPTURE_SETTLE_DELAY_MS = 250;

function compositorDelay(ms = CAPTURE_SETTLE_DELAY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let isCapturingSession = false;

function getTargetDisplay(): Electron.Display {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return screen.getDisplayMatching(mainWindow.getBounds());
  }
  return screen.getPrimaryDisplay();
}

// Open Image File Dialog
ipcMain.handle('dialog:openImage', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Insert Image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const buffer = await fs.promises.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  let mimeType = 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
  else if (ext === '.webp') mimeType = 'image/webp';

  return {
    name: path.basename(filePath),
    mimeType,
    data: buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
  };
});

// Read Clipboard Image
ipcMain.handle('clipboard:readImage', async () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const pngBuffer = image.toPNG();
  return {
    mimeType: 'image/png',
    data: pngBuffer.buffer.slice(
      pngBuffer.byteOffset,
      pngBuffer.byteOffset + pngBuffer.byteLength,
    ) as ArrayBuffer,
  };
});

// Capture Display Screenshot
ipcMain.handle('screenshot:captureDisplay', async () => {
  if (isCapturingSession) {
    return { success: false, error: 'Capture already in progress' };
  }
  isCapturingSession = true;

  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied') {
      isCapturingSession = false;
      return { success: false, error: 'Screen recording permission denied in macOS System Settings.' };
    }
  }

  const targetDisplay = getTargetDisplay();
  const physicalWidth = Math.round(targetDisplay.bounds.width * targetDisplay.scaleFactor);
  const physicalHeight = Math.round(targetDisplay.bounds.height * targetDisplay.scaleFactor);
  const wasVisible = mainWindow?.isVisible() ?? false;

  try {
    if (mainWindow && wasVisible) {
      mainWindow.hide();
      await compositorDelay(CAPTURE_SETTLE_DELAY_MS);
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: physicalWidth, height: physicalHeight },
      fetchWindowIcons: false,
    });

    let matchedSource = sources.find((s) => s.display_id === String(targetDisplay.id));
    if (!matchedSource && sources.length > 0) {
      matchedSource = sources[0];
    }

    if (!matchedSource || matchedSource.thumbnail.isEmpty()) {
      return { success: false, error: 'Failed to capture display image.' };
    }

    const thumbnail = matchedSource.thumbnail;
    const pngBuffer = thumbnail.toPNG();
    const size = thumbnail.getSize();

    return {
      success: true,
      data: pngBuffer.buffer.slice(
        pngBuffer.byteOffset,
        pngBuffer.byteOffset + pngBuffer.byteLength,
      ) as ArrayBuffer,
      mimeType: 'image/png',
      width: size.width,
      height: size.height,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Screenshot failed' };
  } finally {
    if (mainWindow && !mainWindow.isDestroyed() && wasVisible) {
      mainWindow.show();
      mainWindow.focus();
    }
    isCapturingSession = false;
  }
});

// Capture Region Screenshot via Temporary Full-Display Overlay Window
ipcMain.handle('screenshot:captureRegion', async () => {
  if (isCapturingSession) {
    return { success: false, error: 'Capture already in progress' };
  }
  isCapturingSession = true;

  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied') {
      isCapturingSession = false;
      return { success: false, error: 'Screen recording permission denied in macOS System Settings.' };
    }
  }

  const targetDisplay = getTargetDisplay();
  const physicalWidth = Math.round(targetDisplay.bounds.width * targetDisplay.scaleFactor);
  const physicalHeight = Math.round(targetDisplay.bounds.height * targetDisplay.scaleFactor);
  const wasVisible = mainWindow?.isVisible() ?? false;

  let thumbnail: Electron.NativeImage | null = null;
  let overlayWindow: BrowserWindow | null = null;

  try {
    if (mainWindow && wasVisible) {
      mainWindow.hide();
      await compositorDelay(CAPTURE_SETTLE_DELAY_MS);
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: physicalWidth, height: physicalHeight },
      fetchWindowIcons: false,
    });

    let matchedSource = sources.find((s) => s.display_id === String(targetDisplay.id));
    if (!matchedSource && sources.length > 0) {
      matchedSource = sources[0];
    }

    if (!matchedSource || matchedSource.thumbnail.isEmpty()) {
      return { success: false, error: 'Failed to capture display image.' };
    }

    thumbnail = matchedSource.thumbnail;
    const bitmapSize = thumbnail.getSize();
    const dataUrl = thumbnail.toDataURL();

    overlayWindow = new BrowserWindow({
      x: targetDisplay.bounds.x,
      y: targetDisplay.bounds.y,
      width: targetDisplay.bounds.width,
      height: targetDisplay.bounds.height,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: '#000000',
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });

    overlayWindow.setAlwaysOnTop(true, 'screen-saver');

    const overlayHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; cursor: crosshair; }
  #snapshot { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
  #tint { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.35); pointer-events: none; }
  #selection {
    position: absolute;
    display: none;
    border: 2px solid #3b82f6;
    background: transparent;
    box-shadow: 0 0 0 99999px rgba(0,0,0,0.4);
    pointer-events: none;
  }
  #hud {
    position: absolute;
    bottom: -28px;
    left: 0;
    padding: 3px 7px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 11px;
    font-weight: 500;
    color: #fff;
    background: rgba(15, 23, 42, 0.9);
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
  }
  #guide {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: #f1f5f9;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 20px;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
</style>
</head>
<body>
  <img id="snapshot" src="${dataUrl}">
  <div id="tint"></div>
  <div id="selection"><span id="hud">0 × 0</span></div>
  <div id="guide">Drag to select region • Press Esc to cancel</div>
  <script>
    let resolveSelection = null;
    window.waitForSelection = function() {
      return new Promise(function(resolve) {
        resolveSelection = resolve;
      });
    };

    let isDragging = false;
    let startX = 0, startY = 0;
    const selEl = document.getElementById('selection');
    const hudEl = document.getElementById('hud');
    const tintEl = document.getElementById('tint');

    window.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      tintEl.style.display = 'none';
      selEl.style.display = 'block';
      selEl.style.left = startX + 'px';
      selEl.style.top = startY + 'px';
      selEl.style.width = '0px';
      selEl.style.height = '0px';
      hudEl.textContent = '0 × 0';
    });

    window.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      const curX = e.clientX;
      const curY = e.clientY;
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);

      selEl.style.left = x + 'px';
      selEl.style.top = y + 'px';
      selEl.style.width = w + 'px';
      selEl.style.height = h + 'px';
      hudEl.textContent = Math.round(w) + ' × ' + Math.round(h);
    });

    window.addEventListener('mouseup', function(e) {
      if (!isDragging) return;
      isDragging = false;
      const curX = e.clientX;
      const curY = e.clientY;
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);

      if (w < 4 || h < 4) {
        selEl.style.display = 'none';
        tintEl.style.display = 'block';
        return;
      }

      if (resolveSelection) {
        resolveSelection({ canceled: false, x: x, y: y, width: w, height: h });
      }
    });

    window.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (resolveSelection) {
          resolveSelection({ canceled: true });
        }
      }
    });
  </script>
</body>
</html>`;

    await overlayWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(overlayHtml));
    overlayWindow.show();
    overlayWindow.focus();

    const selection: any = await overlayWindow.webContents.executeJavaScript('window.waitForSelection()');

    if (!selection || selection.canceled) {
      return { success: false, canceled: true };
    }

    const scaleX = bitmapSize.width / targetDisplay.bounds.width;
    const scaleY = bitmapSize.height / targetDisplay.bounds.height;

    let cropX = Math.round(selection.x * scaleX);
    let cropY = Math.round(selection.y * scaleY);
    let cropW = Math.round(selection.width * scaleX);
    let cropH = Math.round(selection.height * scaleY);

    cropX = Math.max(0, Math.min(cropX, bitmapSize.width - 1));
    cropY = Math.max(0, Math.min(cropY, bitmapSize.height - 1));
    cropW = Math.max(1, Math.min(cropW, bitmapSize.width - cropX));
    cropH = Math.max(1, Math.min(cropH, bitmapSize.height - cropY));

    const cropped = thumbnail.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
    const pngBuffer = cropped.toPNG();

    return {
      success: true,
      data: pngBuffer.buffer.slice(
        pngBuffer.byteOffset,
        pngBuffer.byteOffset + pngBuffer.byteLength,
      ) as ArrayBuffer,
      mimeType: 'image/png',
      width: cropW,
      height: cropH,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Region capture failed' };
  } finally {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
    if (mainWindow && !mainWindow.isDestroyed() && wasVisible) {
      mainWindow.show();
      mainWindow.focus();
    }
    isCapturingSession = false;
  }
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
