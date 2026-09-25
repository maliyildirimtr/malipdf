import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { LibreOfficeProvider } from './libreOfficeProvider';

const provider = new LibreOfficeProvider();

// Job Registry
const activeJobs = new Map<string, { abortController: AbortController, tempDir: string }>();

// 500 MB output guard
const MAX_CONVERTED_PDF_BYTES = 500 * 1024 * 1024;

export function setupPptxIpc() {
  ipcMain.handle('pptx:isAvailable', async () => {
    return await provider.isAvailable();
  });

  ipcMain.handle('pptx:startConversion', async (event, jobId: string) => {
    if (activeJobs.has(jobId)) {
      throw new Error(`Job ID ${jobId} is already active.`);
    }

    // 1. Validate Provider
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
      throw new Error('PowerPoint to PDF conversion is not available on this system (LibreOffice not found).');
    }

    // 2. User selects PPTX file
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: 'Insert PowerPoint Printout',
      filters: [{ name: 'PowerPoint Presentations', extensions: ['pptx'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const inputPath = result.filePaths[0];

    // 3. Setup Temp Directory
    const tempDir = path.join(app.getPath('temp'), `malipdf-pptx-${randomUUID()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Copy the file to temp dir to prevent lock issues and guarantee path safety
    const safeInputFileName = `input-${randomUUID()}.pptx`;
    const safeInputPath = path.join(tempDir, safeInputFileName);
    await fs.promises.copyFile(inputPath, safeInputPath);

    const abortController = new AbortController();
    activeJobs.set(jobId, { abortController, tempDir });

    try {
      // 4. Convert
      const pdfPath = await provider.convertToPdf(safeInputPath, tempDir, abortController.signal);

      // 5. Read output and validate size
      const stats = await fs.promises.stat(pdfPath);
      if (stats.size > MAX_CONVERTED_PDF_BYTES) {
        throw new Error(`Converted PDF exceeds the 500MB size limit (was ${Math.round(stats.size / 1024 / 1024)}MB).`);
      }

      const pdfBuffer = await fs.promises.readFile(pdfPath);

      // Return raw ArrayBuffer to renderer
      return { buffer: pdfBuffer.buffer, name: path.basename(inputPath) };
    } finally {
      activeJobs.delete(jobId);
      // Best-effort cleanup
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.error(`Failed to cleanup temp directory ${tempDir}:`, err);
      }
    }
  });

  ipcMain.handle('pptx:cancelConversion', async (_event, jobId: string) => {
    const job = activeJobs.get(jobId);
    if (job) {
      job.abortController.abort();
      activeJobs.delete(jobId);
      // We don't remove temp dir here immediately because the convertToPdf
      // finally block will handle it once the aborted process exits.
    }
  });
}
