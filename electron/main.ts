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
  nativeImage,
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
import { setupOcrIpc } from './services/ocr/ocrIpc';
import { FolderGrants, writeFilesToFolder } from './services/files/folderWrite';
import { setupRecoveryIpc } from './services/recovery';
import { setupUpdates } from './services/updates';
import { logCrash, setupAppInfo } from './services/appInfo';
import { pdfPathsFromArgv } from './services/openPaths';
import {
  FileAccessGrants,
  handleTrusted,
  installWebContentsPolicy,
  onTrusted,
  requireBinary,
  requireString,
  requireStringArray,
} from './security';

const isDev = process.env.NODE_ENV === 'development';
const APP_NAME = 'MaliPDF';

/** Largest PDF the renderer may ask us to write (sanity limit). */
const MAX_WRITE_BYTES = 2 * 1024 * 1024 * 1024 - 1;
/** Matches the renderer's MAX_IMAGE_FILE_SIZE_BYTES. */
const MAX_IMAGE_FILE_BYTES = 50 * 1024 * 1024;
const fileGrants = new FileAccessGrants();
const folderGrants = new FolderGrants();

/** The window commands, dialogs and opened files go to: the last focused one. */
let mainWindow: BrowserWindow | null = null;

/** Per-window state (MaliPDF can show documents in several windows). */
interface WindowState {
  readyForFiles: boolean;
  allowClose: boolean;
  /** A tab moved here from another window: its recovery snapshot id. */
  restoreId: string | null;
}
const windowStates = new Map<BrowserWindow, WindowState>();

function liveWindows(): BrowserWindow[] {
  return [...windowStates.keys()].filter((w) => !w.isDestroyed());
}

installWebContentsPolicy(isDev);
setupPptxIpc(isDev);
setupOcrIpc(isDev);
setupRecoveryIpc(isDev);
setupAppInfo(isDev);
setupUpdates(isDev);

// One MaliPDF at a time: a second instance would fight over crash-recovery
// snapshots. Launching again just focuses the running window.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    queueOpenPaths(pdfPathsFromArgv(argv.slice(1), workingDirectory));
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// ─── Opening PDFs from Finder / Explorer / Dock ──────────────────────────────
// Double-click (file association), "Open With", dropping on the Dock icon and
// File ▸ Open Recent all arrive here. Files wait until the renderer is ready.
const pendingOpenPaths: string[] = [];
const rendererReadyForFiles = () => !!mainWindow && windowStates.get(mainWindow)?.readyForFiles === true;

function queueOpenPaths(paths: readonly string[]): void {
  if (paths.length === 0) return;
  pendingOpenPaths.push(...paths);
  if (app.isReady() && !mainWindow) createWindow();
  void flushOpenPaths();
}

async function flushOpenPaths(): Promise<void> {
  if (!mainWindow || !rendererReadyForFiles() || pendingOpenPaths.length === 0) return;
  const paths = pendingOpenPaths.splice(0);
  const files: { filePath: string; name: string; data: ArrayBuffer }[] = [];
  const failed: string[] = [];
  for (const filePath of paths) {
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_WRITE_BYTES) throw new Error('Not a readable PDF file.');
      const buffer = await fs.promises.readFile(filePath);
      fileGrants.grantWrite(filePath);
      app.addRecentDocument(filePath);
      files.push({
        filePath,
        name: path.basename(filePath),
        data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      });
    } catch (error) {
      console.warn(`Could not open ${filePath}:`, error);
      failed.push(path.basename(filePath));
    }
  }
  if (files.length > 0) mainWindow?.webContents.send('app:openFiles', files);
  if (failed.length > 0 && mainWindow) {
    void dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: 'Some files could not be opened.',
      detail: failed.join('\n'),
      buttons: ['OK'],
    });
  }
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenPaths([filePath]);
});
if (!isDev) queueOpenPaths(pdfPathsFromArgv(process.argv.slice(1), process.cwd()));

onTrusted('app:readyForFiles', isDev, (event) => {
  const window = BrowserWindow.fromWebContents?.(event.sender);
  const state = window ? windowStates.get(window) : undefined;
  if (!window || !state) return;
  state.readyForFiles = true;
  if (state.restoreId) {
    // A tab that was moved here: the renderer restores it from its snapshot.
    window.webContents.send(COMMAND_EXECUTE_CHANNEL, 'window.restoreMovedTab', state.restoreId);
    state.restoreId = null;
  }
  void flushOpenPaths();
});

app.setName(APP_NAME);
process.title = APP_NAME;


// ─── Close / quit handshake ──────────────────────────────────────────────────
// The renderer owns dirty-document prompts. Closing the window or quitting
// asks it first; it answers through 'app:confirmLifecycle'. The permission
// flags are one-shot and are reset whenever a window is closed, so the app can
// always be quit again afterwards (previously a stale "authorized" request
// blocked every later quit, including SIGTERM from `npm run dev`).
type LifecycleRequestType = 'window-close' | 'quit';
/** Open questions to renderers, by request id. */
const pendingRequests = new Map<string, { type: LifecycleRequestType; window: BrowserWindow }>();
let allowQuit = false;
/** Windows still to be asked during a quit, in order. */
let quitQueue: BrowserWindow[] | null = null;

function rendererCanAnswer(window: BrowserWindow | null | undefined): window is BrowserWindow {
  return !!window
    && !window.isDestroyed()
    && !window.webContents.isDestroyed()
    && !window.webContents.isCrashed();
}

function askWindow(window: BrowserWindow, type: LifecycleRequestType): void {
  for (const request of pendingRequests.values()) {
    if (request.window === window) {
      // A quit supersedes a pending window close; the renderer's answer applies.
      if (type === 'quit') request.type = 'quit';
      return;
    }
  }
  const id = crypto.randomUUID();
  pendingRequests.set(id, { type, window });
  window.webContents.send(COMMAND_EXECUTE_CHANNEL, type === 'quit' ? 'app.requestQuit' : 'app.requestCloseWindow', id);
}

/** Ask the next window during a quit; quit when every window agreed. */
function continueQuit(): void {
  if (!quitQueue) return;
  while (quitQueue.length > 0 && !rendererCanAnswer(quitQueue[0])) quitQueue.shift();
  const next = quitQueue.shift();
  if (next) {
    askWindow(next, 'quit');
    return;
  }
  quitQueue = null;
  allowQuit = true;
  app.quit();
}

/** Carry out a close/quit a renderer approved (or can no longer answer). */
function approve(type: LifecycleRequestType, window: BrowserWindow): void {
  if (type === 'quit') {
    if (!quitQueue) quitQueue = [];
    continueQuit();
    return;
  }
  const state = windowStates.get(window);
  if (state && !window.isDestroyed()) {
    state.allowClose = true;
    window.close();
  }
}

function sendCommand(commandId: string, payload?: unknown) {
  const target = BrowserWindow.getFocusedWindow?.() ?? mainWindow;
  if (target && windowStates.has(target)) target.webContents.send(COMMAND_EXECUTE_CHANNEL, commandId, payload);
}

function createWindow(options: { restoreId?: string } = {}): BrowserWindow {
  // A new window means the app keeps running; any earlier quit permission is void.
  allowQuit = false;
  quitQueue = null;
  const offset = liveWindows().length * 28;
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    ...(() => {
      const bounds = offset && mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds?.() : undefined;
      return bounds ? { x: bounds.x + offset, y: bounds.y + offset } : {};
    })(),
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
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  const state: WindowState = { readyForFiles: false, allowClose: false, restoreId: options.restoreId ?? null };
  windowStates.set(window, state);
  mainWindow = window;
  const secondary = liveWindows().length > 1;

  // Load the app. Extra windows skip the startup recovery prompt: the
  // snapshots belong to documents open in the other windows.
  const query = secondary ? { secondary: '1' } : undefined;
  if (isDev) {
    window.loadURL(`http://localhost:5173${query ? '?secondary=1' : ''}`);
    if (!secondary) window.webContents.openDevTools({ mode: 'detach' });
  } else {
    window.loadFile(path.join(__dirname, '../dist/index.html'), query ? { query } : undefined);
  }

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('focus', () => {
    mainWindow = window;
    // The menu shows the focused window's state.
    window.webContents.send(COMMAND_EXECUTE_CHANNEL, 'window.syncMenu');
  });

  window.on('close', (event) => {
    if (allowQuit || state.allowClose || !rendererCanAnswer(window)) return;
    event.preventDefault();
    askWindow(window, 'window-close');
  });

  // A reload means a new renderer that has to announce itself again.
  window.webContents.on('did-start-loading', () => {
    state.readyForFiles = false;
  });

  window.on('closed', () => {
    windowStates.delete(window);
    for (const [id, request] of pendingRequests) if (request.window === window) pendingRequests.delete(id);
    if (mainWindow === window) mainWindow = BrowserWindow.getFocusedWindow?.() ?? liveWindows()[0] ?? null;
    if (quitQueue) continueQuit();
  });

  // A crashed renderer can never answer; do not trap the user.
  window.webContents.on('render-process-gone', (_event, details) => {
    for (const [id, request] of pendingRequests) {
      if (request.window !== window) continue;
      pendingRequests.delete(id);
      approve(request.type, window);
      return;
    }
    if (details.reason === 'clean-exit') return;
    logCrash('renderer-gone', { reason: details.reason, exitCode: details.exitCode });
    if (window.isDestroyed()) return;
    // Unsaved work is in the auto-save recovery folder; reloading offers it back.
    void dialog.showMessageBox(window, {
      type: 'error',
      title: 'MaliPDF',
      message: 'MaliPDF stopped unexpectedly.',
      detail: 'Reload to continue. Documents with unsaved changes can be restored from the last auto-save.',
      buttons: ['Reload', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (window.isDestroyed()) return;
      if (response === 0) window.webContents.reload();
      else { allowQuit = true; app.quit(); }
    });
  });

  // Navigation, new windows, webviews and permissions are locked down for
  // every web contents in installWebContentsPolicy (electron/security.ts).

  buildMenu();
  return window;
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
      return { label: node.label, role: node.role, enabled: node.enabled, submenu: node.items.map(buildNativeMenuItem) };
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

onTrusted(COMMAND_STATE_CHANNEL, isDev, (event, states: NativeCommandState[]) => {
  // Only the window in front decides what the menu shows.
  if (mainWindow && BrowserWindow.fromWebContents?.(event.sender) !== mainWindow) return;
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

handleTrusted(FULLSCREEN_TOGGLE_CHANNEL, isDev, () => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});

// Open PDF dialog
handleTrusted('dialog:openFile', isDev, async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
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
      // The user chose this file: Save may write back to it.
      fileGrants.grantWrite(filePath);
      app.addRecentDocument(filePath);
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
handleTrusted('dialog:saveFile', isDev, async (_event, defaultName: unknown) => {
  if (!mainWindow) return null;
  const suggested = typeof defaultName === 'string' ? defaultName.slice(0, 1024) : 'Untitled.pdf';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Annotated PDF',
    defaultPath: suggested,
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
  });

  if (result.canceled || !result.filePath) return null;
  fileGrants.grantWrite(result.filePath);
  return result.filePath;
});

// Split PDF: choose a folder, then write the parts into it.
handleTrusted('dialog:chooseFolder', isDev, async (_event, rawTitle: unknown) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: typeof rawTitle === 'string' ? rawTitle.slice(0, 200) : 'Choose a Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  folderGrants.grant(result.filePaths[0]);
  return result.filePaths[0];
});

handleTrusted('fs:writeFilesToFolder', isDev, async (_event, folder: unknown, rawFiles: unknown) => {
  if (!folderGrants.has(folder)) throw new Error('Refusing to write into a folder the user did not choose.');
  if (!Array.isArray(rawFiles) || rawFiles.length === 0 || rawFiles.length > 2000) throw new TypeError('Invalid files.');
  let total = 0;
  const files = rawFiles.map((file) => {
    const entry = file as { name?: unknown; data?: unknown };
    const data = requireBinary(entry?.data, 'data', MAX_WRITE_BYTES);
    total += data.byteLength;
    if (total > MAX_WRITE_BYTES * 4) throw new Error('The files are too large.');
    return { name: typeof entry?.name === 'string' ? entry.name : '', data };
  });
  return writeFilesToFolder(folder, files);
});

// Close confirm dialog
handleTrusted('dialog:askCloseConfirm', isDev, async (_event, rawFileName: unknown) => {
  if (!mainWindow) return 'cancel';
  const fileName = requireString(rawFileName, 'fileName', 1024);
  const result = await dialog.showMessageBox(mainWindow, {
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
handleTrusted('dialog:askCloseAllConfirm', isDev, async (_event, rawFileNames: unknown) => {
  if (!mainWindow) return 'cancel';
  const fileNames = requireStringArray(rawFileNames, 'fileNames');
  const result = await dialog.showMessageBox(mainWindow, {
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

// Write file — only to paths the user picked in an Open/Save dialog.
handleTrusted('fs:writeFile', isDev, async (_event, filePath: unknown, data: unknown) => {
  if (!fileGrants.canWrite(filePath)) {
    throw new Error('Refusing to write a file the user did not choose in a dialog.');
  }
  const bytes = requireBinary(data, 'data', MAX_WRITE_BYTES);
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${crypto.randomUUID()}`);
  try {
    await fs.promises.writeFile(tempPath, bytes);
    await fs.promises.rename(tempPath, filePath);
    return true;
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
});

// Get app version
handleTrusted('app:getVersion', isDev, () => {
  return app.getVersion();
});

// ─── Image & Screenshot Handlers ─────────────────────────────────────────────

const CAPTURE_SETTLE_DELAY_MS = 250;
const REGION_SELECTION_TIMEOUT_MS = 120_000;

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
handleTrusted('dialog:openImage', isDev, async () => {
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
  const { size } = await fs.promises.stat(filePath);
  if (size > MAX_IMAGE_FILE_BYTES) {
    throw new Error(`Image file is larger than ${MAX_IMAGE_FILE_BYTES / 1024 / 1024} MB.`);
  }
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
handleTrusted('clipboard:readImage', isDev, async () => {
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

// Write a PNG to the clipboard (Snapshot tool)
handleTrusted('clipboard:writeImage', isDev, async (_event, raw: unknown) => {
  const png = requireBinary(raw, 'Image', 120 * 1024 * 1024);
  const image = nativeImage.createFromBuffer(Buffer.from(png));
  if (image.isEmpty()) throw new Error('The image could not be copied.');
  clipboard.writeImage(image);
  return true;
});

// Capture Display Screenshot
handleTrusted('screenshot:captureDisplay', isDev, async () => {
  if (isCapturingSession) {
    return { success: false, error: 'Capture already in progress' };
  }
  isCapturingSession = true;

  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied' || status === 'restricted') {
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
handleTrusted('screenshot:captureRegion', isDev, async () => {
  if (isCapturingSession) {
    return { success: false, error: 'Capture already in progress' };
  }
  isCapturingSession = true;

  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied' || status === 'restricted') {
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
        sandbox: true,
        webviewTag: false,
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
    if (process.platform === 'darwin') app.focus({ steal: true });
    overlayWindow.focus();

    // The selection promise alone can hang forever (overlay loses key focus so
    // Esc never arrives, or it is closed), leaving MaliPDF hidden. Cancel on
    // close, on focus loss after it was focused, and after a generous timeout.
    const overlay = overlayWindow;
    const selection: any = await new Promise((resolve) => {
      let settled = false;
      let wasFocused = overlay.isFocused();
      const finish = (value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ canceled: true }), REGION_SELECTION_TIMEOUT_MS);
      overlay.once('closed', () => finish({ canceled: true }));
      overlay.on('focus', () => { wasFocused = true; });
      overlay.on('blur', () => { if (wasFocused) finish({ canceled: true }); });
      overlay.webContents.executeJavaScript('window.waitForSelection()')
        .then(finish, () => finish({ canceled: true }));
    });

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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (event) => {
  if (allowQuit) return;
  // No window (e.g. macOS after closing it) or no live renderer: nothing
  // unsaved can be protected, so quit normally.
  const windows = liveWindows().filter(rendererCanAnswer);
  if (windows.length === 0) {
    allowQuit = true;
    return;
  }
  event.preventDefault();
  if (quitQueue) return; // already asking
  // Ask the focused window first, then the others, one at a time.
  quitQueue = [...windows].sort((a, b) => (a === mainWindow ? -1 : b === mainWindow ? 1 : 0));
  continueQuit();
});

// Terminal signals (Ctrl+C, `concurrently -k`, kill). In development exit
// immediately so no Electron process is ever left behind. In production ask
// the renderer like a normal quit.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (isDev) {
      app.exit(0);
    } else {
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  // Only for normal platform behavior, no persistence handshake here.
  if (process.platform !== 'darwin') app.quit();
});

onTrusted('app:confirmLifecycle', isDev, (_event, requestId: unknown, allow: unknown) => {
  // No timeout: the renderer may be showing Save / Don't Save dialogs for as
  // long as the user needs. Stale or duplicate answers are ignored.
  if (typeof requestId !== 'string') return;
  const request = pendingRequests.get(requestId);
  if (!request) return;
  pendingRequests.delete(requestId);
  if (allow !== true) {
    // User cancelled: a quit stops here, the other windows stay as they are.
    if (request.type === 'quit') quitQueue = null;
    return;
  }
  approve(request.type, request.window);
});

// Move a tab to a new window: the renderer has written a recovery snapshot;
// the new window restores it and the old one then closes the tab.
handleTrusted('window:moveTabToNewWindow', isDev, async (_event, rawId: unknown) => {
  if (typeof rawId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(rawId)) throw new TypeError('Invalid document.');
  createWindow({ restoreId: rawId });
  return true;
});
