import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mocks = vi.hoisted(() => {
  const EventEmitter = require('events');
  
  const mApp = new EventEmitter() as any;
  mApp.setName = vi.fn();
  mApp.getVersion = vi.fn().mockReturnValue('1.0.0');
  mApp.quit = vi.fn();
  mApp.whenReady = vi.fn().mockResolvedValue(undefined);

  const mIpcMain = {
    on: vi.fn(),
    handle: vi.fn(),
  };

  const mDialog = {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  };

  const mMenu = {
    buildFromTemplate: vi.fn(),
    setApplicationMenu: vi.fn(),
    getApplicationMenu: vi.fn(),
  };

  class mBrowserWindow extends EventEmitter {
    static _lastInstance: any;
    constructor() {
      super();
      mBrowserWindow._lastInstance = this;
    }
    static getAllWindows() { return []; }
    isFullScreen = vi.fn();
    setFullScreen = vi.fn();
    loadFile = vi.fn();
    loadURL = vi.fn();
    show = vi.fn();
    close = vi.fn();
    destroyed = false;
    isDestroyed = () => this.destroyed;
    webContents = {
      send: vi.fn(),
      openDevTools: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      isDestroyed: () => false,
      isCrashed: () => false,
    };
  }
  
  const mFs = {
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
      unlink: vi.fn(),
    }
  };

  return {
    mockApp: mApp,
    mockIpcMain: mIpcMain,
    mockDialog: mDialog,
    mockMenu: mMenu,
    MockBrowserWindow: mBrowserWindow,
    mockFs: mFs,
  };
});

vi.mock('electron', () => ({
  app: mocks.mockApp,
  ipcMain: mocks.mockIpcMain,
  dialog: mocks.mockDialog,
  Menu: mocks.mockMenu,
  BrowserWindow: mocks.MockBrowserWindow,
}));

const { mockApp, mockIpcMain, MockBrowserWindow, mockFs } = mocks;

vi.mock('fs', () => ({
  default: mocks.mockFs,
}));

// Load main.ts
import '../../../electron/main';

let writeFileHandler: any;
let confirmLifecycleHandler: any;

describe('Electron Main Process Guard & Lifecycle', () => {
  beforeAll(async () => {
    writeFileHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === 'fs:writeFile')![1];
    confirmLifecycleHandler = mockIpcMain.on.mock.calls.find((c: any) => c[0] === 'app:confirmLifecycle')![1];
    // Flush app.whenReady() so createWindow is called
    await Promise.resolve();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe('Atomic Write (fs:writeFile)', () => {
    it('uses a unique UUID suffix, unlinks on failure, does not touch original', async () => {
      const writeFileSpy = mockFs.promises.writeFile.mockResolvedValue(undefined);
      const renameSpy = mockFs.promises.rename.mockRejectedValue(new Error('Rename fail'));
      const unlinkSpy = mockFs.promises.unlink.mockResolvedValue(undefined);
      
      const buffer = new ArrayBuffer(10);
      
      await expect(writeFileHandler(null, '/foo/bar.pdf', buffer)).rejects.toThrow('Rename fail');
      
      expect(writeFileSpy).toHaveBeenCalledTimes(1);
      const writtenTempPath = writeFileSpy.mock.calls[0][0];
      
      expect(writtenTempPath).toContain('/foo/.bar.pdf.tmp-');
      // Should be 36 chars long suffix (uuid v4)
      const parts = writtenTempPath.split('.tmp-');
      expect(parts[1].length).toBe(36);

      expect(renameSpy).toHaveBeenCalledWith(writtenTempPath, '/foo/bar.pdf');
      
      // Cleanup was called on the EXACT temp file, NOT the target
      expect(unlinkSpy).toHaveBeenCalledWith(writtenTempPath);
      expect(unlinkSpy).toHaveBeenCalledTimes(1);
    });

    it('returns true on success and does not unlink', async () => {
      mockFs.promises.writeFile.mockResolvedValue(undefined);
      mockFs.promises.rename.mockResolvedValue(undefined);
      const unlinkSpy = mockFs.promises.unlink.mockResolvedValue(undefined);
      
      const result = await writeFileHandler(null, '/foo/bar.pdf', new ArrayBuffer(10));
      expect(result).toBe(true);
      expect(unlinkSpy).not.toHaveBeenCalled();
    });
  });

  describe('App Quit Guard', () => {
    const quitRequests = () => (MockBrowserWindow as any)._lastInstance.webContents.send.mock.calls
      .filter((c: any) => c[0] === 'command:execute' && c[1] === 'app.requestQuit');
    const closeRequests = () => (MockBrowserWindow as any)._lastInstance.webContents.send.mock.calls
      .filter((c: any) => c[0] === 'command:execute' && c[1] === 'app.requestCloseWindow');

    it('can still quit after the window was closed (macOS keeps the app alive)', () => {
      const win = (MockBrowserWindow as any)._lastInstance;
      const closeEvent = { preventDefault: vi.fn() };
      win.emit('close', closeEvent);
      expect(closeEvent.preventDefault).toHaveBeenCalled();
      const closeId = closeRequests().at(-1)[2];
      confirmLifecycleHandler(null, closeId, true);
      expect(win.close).toHaveBeenCalled();

      // Window actually goes away.
      win.emit('close', { preventDefault: vi.fn() });
      win.destroyed = true;
      win.emit('closed');

      // Quit (Cmd+Q / SIGTERM) must not be blocked by the old request.
      const quitEvent = { preventDefault: vi.fn() };
      mockApp.emit('before-quit', quitEvent);
      expect(quitEvent.preventDefault).not.toHaveBeenCalled();
    });
    it('asks the renderer, waits without a timeout, ignores stale answers, then quits', () => {
      // The previous test closed the window; macOS re-creates it on activate.
      mockApp.emit('activate');
      const quitEvent = { preventDefault: vi.fn() };
      mockApp.emit('before-quit', quitEvent);
      expect(quitEvent.preventDefault).toHaveBeenCalled();
      const requestId = quitRequests()[0][2];
      expect(requestId).toHaveLength(36);

      // A second quit while waiting does not start another request.
      mockApp.emit('before-quit', { preventDefault: vi.fn() });
      expect(quitRequests()).toHaveLength(1);

      // The user may take a long time in the Save dialog: no timeout.
      vi.advanceTimersByTime(60_000);

      // Stale / foreign ids are ignored.
      confirmLifecycleHandler(null, 'not-the-request', true);
      expect(mockApp.quit).not.toHaveBeenCalled();

      // Cancel keeps the app running and clears the request.
      confirmLifecycleHandler(null, requestId, false);
      expect(mockApp.quit).not.toHaveBeenCalled();

      // A new attempt, allowed -> app.quit(), and the follow-up before-quit passes.
      mockApp.emit('before-quit', { preventDefault: vi.fn() });
      const secondId = quitRequests()[1][2];
      confirmLifecycleHandler(null, secondId, true);
      expect(mockApp.quit).toHaveBeenCalledTimes(1);
      const finalEvent = { preventDefault: vi.fn() };
      mockApp.emit('before-quit', finalEvent);
      expect(finalEvent.preventDefault).not.toHaveBeenCalled();
    });

  });
});
