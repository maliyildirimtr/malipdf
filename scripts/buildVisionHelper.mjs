// Builds the macOS text recognition helper (OCR + handwriting) used by
// electron/services/ocr. Needs Xcode or the Command Line Tools (swiftc).
// On other systems it does nothing: recognition is then unavailable.
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'electron', 'native', 'malipdf-vision.swift');
const output = join(root, 'build', 'native', 'malipdf-vision');

if (process.platform !== 'darwin') {
  console.log('vision helper: skipped (macOS only)');
  process.exit(0);
}
if (existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs && !process.argv.includes('--force')) {
  console.log('vision helper: up to date');
  process.exit(0);
}
mkdirSync(dirname(output), { recursive: true });
try {
  execFileSync('swiftc', ['-O', '-o', output, source], { stdio: 'inherit' });
  console.log(`vision helper: built ${output}`);
} catch {
  console.warn('vision helper: could not build (install Xcode Command Line Tools: xcode-select --install). Text recognition will be unavailable.');
}
