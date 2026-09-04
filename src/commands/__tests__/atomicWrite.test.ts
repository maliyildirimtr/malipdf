import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Extract the atomic write logic to test it directly
async function atomicWrite(filePath: string, data: ArrayBuffer) {
  const dir = path.dirname(filePath);
  const crypto = require('crypto');
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${crypto.randomUUID()}`);
  try {
    await fs.promises.writeFile(tempPath, Buffer.from(data));
    await fs.promises.rename(tempPath, filePath);
    return true;
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

describe('Atomic Write (Main Process)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('cleans up temp file and throws if rename fails, leaving original intact', async () => {
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockRejectedValue(new Error('Rename failed'));
    
    await expect(atomicWrite('/fake/target.pdf', new ArrayBuffer(10))).rejects.toThrow('Rename failed');
    
    expect(writeFileSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    
    const tempPathWritten = (writeFileSpy.mock.calls[0] as any)[0];
    const tempPathUnlinked = (unlinkSpy.mock.calls[0] as any)[0];
    
    // Unlink targets the exact same temp file we just wrote to
    expect(tempPathWritten).toBe(tempPathUnlinked);
    // Original path was NOT unlinked or truncated
    expect(tempPathUnlinked).not.toBe('/fake/target.pdf');
    expect(tempPathUnlinked).toContain('.target.pdf.tmp-');
  });

  it('returns true and does not unlink on success', async () => {
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);
    
    const result = await atomicWrite('/fake/target.pdf', new ArrayBuffer(10));
    
    expect(result).toBe(true);
    expect(writeFileSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });
});
