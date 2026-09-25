import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PptxConversionProvider } from './pptxConversionProvider';

const execFileAsync = promisify(execFile);

// Configurable timeout: 120 seconds for large presentations
export const PPTX_CONVERSION_TIMEOUT_MS = 120000;

export class LibreOfficeProvider implements PptxConversionProvider {
  private executablePath: string | null = null;

  async isAvailable(): Promise<boolean> {
    const exe = await this.findExecutable();
    return exe !== null;
  }

  async convertToPdf(
    inputPath: string,
    outputDir: string,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const exe = await this.findExecutable();
    if (!exe) {
      throw new Error('LibreOffice executable not found on this system.');
    }

    const fileName = path.basename(inputPath);
    const pdfFileName = fileName.replace(/\.[^/.]+$/, '.pdf');
    const outputPath = path.join(outputDir, pdfFileName);

    // Create a unique profile directory for this job to prevent LibreOffice locks or GUI reuse.
    const profileDir = path.join(outputDir, 'libreoffice-profile');
    await fs.promises.mkdir(profileDir, { recursive: true });

    // Format the URI for LibreOffice's -env:UserInstallation argument
    // e.g. -env:UserInstallation=file:///tmp/dir/profile
    const profileUri = `file://${os.platform() === 'win32' ? '/' : ''}${profileDir.replace(/\\/g, '/')}`;

    const args = [
      // LibreOffice only recognises the single-dash form of bootstrap variables.
      `-env:UserInstallation=${profileUri}`,
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      inputPath,
    ];

    return new Promise((resolve, reject) => {
      let isSettled = false;

      const child = spawn(exe, args, {
        shell: false,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      let timeoutId: NodeJS.Timeout | undefined;

      const cleanupSignal = () => {
        if (abortSignal) {
          abortSignal.removeEventListener('abort', onAbort);
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };

      const finish = (error: Error | null) => {
        if (isSettled) return;
        isSettled = true;
        cleanupSignal();

        if (error) {
          reject(error);
        } else {
          // Verify output
          fs.promises.stat(outputPath)
            .then(stats => {
              if (stats.size === 0) {
                reject(new Error(`Output PDF at ${outputPath} is empty (0 bytes). \nStdout: ${stdout}\nStderr: ${stderr}`));
              } else {
                resolve(outputPath);
              }
            })
            .catch(err => {
              reject(new Error(`Failed to find expected PDF output at ${outputPath}. \nStdout: ${stdout}\nStderr: ${stderr}`));
            });
        }
      };

      const onAbort = () => {
        child.kill('SIGKILL');
        finish(new Error('Conversion aborted by user.'));
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          return onAbort();
        }
        abortSignal.addEventListener('abort', onAbort);
      }

      timeoutId = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new Error(`Conversion timed out after ${PPTX_CONVERSION_TIMEOUT_MS}ms.`));
      }, PPTX_CONVERSION_TIMEOUT_MS);

      child.on('error', (err) => {
        finish(err);
      });

      child.on('close', (code, signal) => {
        if (code !== 0) {
          finish(new Error(`LibreOffice exited with code ${code} and signal ${signal}.\nStdout: ${stdout}\nStderr: ${stderr}`));
        } else {
          finish(null);
        }
      });
    });
  }

  private async findExecutable(): Promise<string | null> {
    if (this.executablePath) return this.executablePath;

    const platform = os.platform();
    const commonPaths: string[] = [];

    if (platform === 'darwin') {
      commonPaths.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
    } else if (platform === 'win32') {
      commonPaths.push(
        path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe')
      );
    }

    for (const p of commonPaths) {
      try {
        await fs.promises.access(p, fs.constants.X_OK);
        this.executablePath = p;
        return p;
      } catch {
        // Ignore and try next
      }
    }

    // Try finding it in PATH
    try {
      const command = platform === 'win32' ? 'where' : 'which';
      const exeName = platform === 'win32' ? 'soffice.exe' : 'soffice';
      const { stdout } = await execFileAsync(command, [exeName]);
      const foundPath = stdout.split('\n')[0].trim();
      if (foundPath) {
        this.executablePath = foundPath;
        return foundPath;
      }
    } catch {
      // Ignore
    }

    return null;
  }
}
