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
    webContents = {
      send: vi.fn(),
      openDevTools: vi.fn(),
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
    it('prevents quit and starts handshake, handles timeout, ignores stale allows', () => {
      // 1. Initial quit attempt
      const quitEvent = { preventDefault: vi.fn() };
      mockApp.emit('before-quit', quitEvent);
      
      expect(quitEvent.preventDefault).toHaveBeenCalled();
      
      // A command is sent to the renderer with a UUID request ID
      const sendCommandArgs = (MockBrowserWindow as any)._lastInstance.webContents.send.mock.calls.find((c: any) => c[0] === 'command:execute' && c[1] === 'app.requestQuit');
      expect(sendCommandArgs).toBeDefined();
      const requestId = sendCommandArgs[2];
      expect(requestId).toHaveLength(36);

      // 2. Timeout simulation -> stays running
      vi.advanceTimersByTime(5000);
      
      // 3. Stale allow after timeout -> ignored
      confirmLifecycleHandler(null, requestId, true);
      expect(mockApp.quit).not.toHaveBeenCalled();
      
      // 4. Start a new quit attempt
      const quitEvent2 = { preventDefault: vi.fn() };
      mockApp.emit('before-quit', quitEvent2);
      
      const newSendCommandArgs = (MockBrowserWindow as any)._lastInstance.webContents.send.mock.calls.filter((c: any) => c[0] === 'command:execute' && c[1] === 'app.requestQuit')[1];
      const newRequestId = newSendCommandArgs[2];
      
      // 5. Cancel response -> stays running
      confirmLifecycleHandler(null, newRequestId, false);
      expect(mockApp.quit).not.toHaveBeenCalled();
      
      // 6. Another quit attempt
      const quitEvent3 = { preventDefault: vi.fn() };
      mockApp.emit('before-quit', quitEvent3);
      const finalRequestId = (MockBrowserWindow as any)._lastInstance.webContents.send.mock.calls.filter((c: any) => c[0] === 'command:execute' && c[1] === 'app.requestQuit')[2][2];

      // 7. Successful allow -> app.quit() is called again
      confirmLifecycleHandler(null, finalRequestId, true);
      expect(mockApp.quit).toHaveBeenCalledTimes(1);
    });
  });
});
