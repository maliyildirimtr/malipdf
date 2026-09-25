import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LibreOfficeProvider } from '../libreOfficeProvider';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      promises: {
        ...actual.promises,
        access: vi.fn(),
        mkdir: vi.fn(),
        stat: vi.fn(),
      },
    }
  };
});

describe('LibreOfficeProvider', () => {
  let provider: LibreOfficeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LibreOfficeProvider();
    
    // Mock access to return true for the first hardcoded path
    vi.mocked(fs.promises.access).mockResolvedValue(undefined);
  });

  it('isAvailable returns true if executable is found', async () => {
    const available = await provider.isAvailable();
    expect(available).toBe(true);
  });

  it('converts pptx to pdf and resolves with output path', async () => {
    const mockChildProcess = new EventEmitter() as any;
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.kill = vi.fn();
    
    vi.mocked(spawn).mockReturnValue(mockChildProcess);

    const conversionPromise = provider.convertToPdf('/tmp/input.pptx', '/tmp/out');

    // Mock fs.promises.stat to return a valid size
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1024 } as fs.Stats);

    // Wait a tick for spawn to be called after async getExecutablePath
    setTimeout(() => {
      mockChildProcess.emit('close', 0, null);
    }, 0);

    const result = await conversionPromise;
    expect(result).toBe(path.join('/tmp/out', 'input.pdf'));
    
    // Verify spawn args include the unique profile
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.stringContaining('--env:UserInstallation='),
        '--headless',
        '--nologo',
        '--convert-to',
        'pdf',
        '/tmp/input.pptx'
      ]),
      expect.any(Object)
    );
  });

  it('aborts conversion if signal is aborted', async () => {
    const mockChildProcess = new EventEmitter() as any;
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.kill = vi.fn();
    
    vi.mocked(spawn).mockReturnValue(mockChildProcess);

    const abortController = new AbortController();
    
    const conversionPromise = provider.convertToPdf('/tmp/input.pptx', '/tmp/out', abortController.signal);
    
    abortController.abort();

    await expect(conversionPromise).rejects.toThrow('Conversion aborted by user.');
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('rejects if output file is empty', async () => {
    const mockChildProcess = new EventEmitter() as any;
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.kill = vi.fn();
    
    vi.mocked(spawn).mockReturnValue(mockChildProcess);

    const conversionPromise = provider.convertToPdf('/tmp/input.pptx', '/tmp/out');

    // Mock fs.promises.stat to return size 0
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 0 } as fs.Stats);

    setTimeout(() => {
      mockChildProcess.emit('close', 0, null);
    }, 0);

    await expect(conversionPromise).rejects.toThrow(/is empty/);
  });
});
