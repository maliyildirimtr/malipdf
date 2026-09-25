import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('Screenshot Window Restoration and Finally Semantics', () => {
  interface MockWindow {
    isVisible: () => boolean;
    isDestroyed: () => boolean;
    hide: () => void;
    show: () => void;
    focus: () => void;
  }

  let mainWindow: MockWindow;
  let isVisibleState: boolean;
  let isCapturingSession: boolean;

  beforeEach(() => {
    isVisibleState = true;
    isCapturingSession = false;
    mainWindow = {
      isVisible: vi.fn(() => isVisibleState),
      isDestroyed: vi.fn(() => false),
      hide: vi.fn(() => {
        isVisibleState = false;
      }),
      show: vi.fn(() => {
        isVisibleState = true;
      }),
      focus: vi.fn(),
    };
  });

  async function executeCaptureFlow(
    captureFn: () => Promise<{ success: boolean; data?: ArrayBuffer; canceled?: boolean; error?: string }>,
  ) {
    if (isCapturingSession) {
      return { success: false, error: 'Capture already in progress' };
    }
    isCapturingSession = true;

    const wasVisible = mainWindow.isVisible();
    try {
      if (wasVisible) {
        mainWindow.hide();
      }
      return await captureFn();
    } finally {
      if (!mainWindow.isDestroyed() && wasVisible) {
        mainWindow.show();
        mainWindow.focus();
      }
      isCapturingSession = false;
    }
  }

  it('restores mainWindow (show and focus) on successful capture', async () => {
    const result = await executeCaptureFlow(async () => {
      expect(mainWindow.hide).toHaveBeenCalledTimes(1);
      expect(mainWindow.isVisible()).toBe(false);
      return { success: true, data: new ArrayBuffer(16) };
    });

    expect(result.success).toBe(true);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    expect(mainWindow.isVisible()).toBe(true);
    expect(isCapturingSession).toBe(false);
  });

  it('restores mainWindow in finally block even when capture throws an exception', async () => {
    await expect(
      executeCaptureFlow(async () => {
        expect(mainWindow.hide).toHaveBeenCalledTimes(1);
        throw new Error('OS Compositor Crash during capture');
      }),
    ).rejects.toThrow('OS Compositor Crash during capture');

    // Window must STILL be restored!
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    expect(mainWindow.isVisible()).toBe(true);
    expect(isCapturingSession).toBe(false);
  });

  it('restores mainWindow when user cancels region selection', async () => {
    const result = await executeCaptureFlow(async () => {
      return { success: false, canceled: true };
    });

    expect(result.canceled).toBe(true);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    expect(mainWindow.isVisible()).toBe(true);
    expect(isCapturingSession).toBe(false);
  });

  it('prevents concurrent re-entrant capture requests', async () => {
    let resolveFirst: () => void;
    const firstPromise = new Promise<{ success: boolean }>((res) => {
      resolveFirst = () => res({ success: true });
    });

    // Start first capture
    const p1 = executeCaptureFlow(() => firstPromise);

    // Attempt second capture while first is still pending
    const p2 = await executeCaptureFlow(async () => ({ success: true }));
    expect(p2.success).toBe(false);
    expect(p2.error).toContain('already in progress');

    // Complete first
    resolveFirst!();
    const r1 = await p1;
    expect(r1.success).toBe(true);
    expect(isCapturingSession).toBe(false);
  });
});
