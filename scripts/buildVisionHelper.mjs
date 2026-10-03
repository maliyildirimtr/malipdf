// Builds the macOS text recognition helper (OCR + handwriting) used by
// electron/services/ocr. Needs Xcode or the Command Line Tools (swiftc).
// On other systems it does nothing: recognition is then unavailable.
// The helper is universal (arm64 + x86_64): the Mac App Store build is one
// universal app, and electron-builder can only merge the arm64 and x64 apps
// when this binary is the same universal file in both.
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'electron', 'native', 'malipdf-vision.swift');
const output = join(root, 'build', 'native', 'malipdf-vision');

if (process.platform !== 'darwin') {
  console.log('vision helper: skipped (macOS only)');
  process.exit(0);
}
function isUniversal(file) {
  try {
    const archs = execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/);
    return archs.includes('arm64') && archs.includes('x86_64');
  } catch {
    return false;
  }
}

if (existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs && isUniversal(output) && !process.argv.includes('--force')) {
  console.log('vision helper: up to date');
  process.exit(0);
}
mkdirSync(dirname(output), { recursive: true });
try {
  const parts = [];
  for (const arch of ['arm64', 'x86_64']) {
    const part = `${output}-${arch}`;
    execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos11`, '-o', part, source], { stdio: 'inherit' });
    parts.push(part);
  }
  execFileSync('lipo', ['-create', '-output', output, ...parts], { stdio: 'inherit' });
  for (const part of parts) rmSync(part, { force: true });
  console.log(`vision helper: built ${output} (universal)`);
} catch {
  console.warn('vision helper: could not build (install Xcode Command Line Tools: xcode-select --install). Text recognition will be unavailable.');
}
