/**
 * Text recognition (OCR and handwriting) through the macOS Vision helper
 * (electron/native/malipdf-vision.swift, built by scripts/buildVisionHelper.mjs).
 *
 * The renderer sends a PNG; it is written to a private temp folder, the helper
 * reads it and prints JSON, and the folder is removed. Nothing leaves the Mac.
 */
import { app } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { handleTrusted, requireBinary } from '../../security';

const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export interface OcrWord { text: string; box: [number, number, number, number] }
export interface OcrLine { text: string; confidence: number; box: [number, number, number, number]; words: OcrWord[] }

/** Where the helper binary is: next to the app when packaged, in build/native in development. */
export function visionHelperPath(): string | null {
  if (process.platform !== 'darwin') return null;
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'native', 'malipdf-vision')]
    : [path.join(app.getAppPath(), 'build', 'native', 'malipdf-vision')];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

function runHelper(helper: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(helper, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).toString().trim() || 'Text recognition failed.'));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

function requireLanguages(value: unknown): string[] {
  if (value === undefined) return ['tr-TR', 'en-US'];
  if (!Array.isArray(value) || value.length > 8 || !value.every((v) => typeof v === 'string' && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(v))) {
    throw new TypeError('Invalid recognition languages.');
  }
  return value as string[];
}

export function setupOcrIpc(isDev: boolean): void {
  handleTrusted('ocr:isAvailable', isDev, async () => visionHelperPath() !== null);

  handleTrusted('ocr:recognize', isDev, async (_event, rawImage: unknown, rawLanguages: unknown) => {
    const helper = visionHelperPath();
    if (!helper) {
      throw new Error(process.platform === 'darwin'
        ? 'Text recognition is not built yet. Run "npm run build:ocr" once (needs Xcode Command Line Tools).'
        : 'Text recognition is only available on macOS.');
    }
    const image = requireBinary(rawImage, 'Image', MAX_IMAGE_BYTES);
    const languages = requireLanguages(rawLanguages);
    const dir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'malipdf-ocr-'));
    try {
      await fs.promises.chmod(dir, 0o700).catch(() => {});
      const file = path.join(dir, `page-${randomUUID()}.png`);
      await fs.promises.writeFile(file, image, { mode: 0o600 });
      const out = await runHelper(helper, ['--image', file, '--languages', languages.join(',')]);
      const parsed = JSON.parse(out) as { lines?: OcrLine[] };
      return Array.isArray(parsed.lines) ? parsed.lines : [];
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
