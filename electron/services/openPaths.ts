import path from 'path';

/**
 * PDF paths passed on the command line (Windows "Open with", file
 * association, or a second launch). Flags and the app path are ignored.
 */
export function pdfPathsFromArgv(argv: readonly string[], cwd: string): string[] {
  return argv
    .filter((arg) => !arg.startsWith('-') && /\.pdf$/i.test(arg))
    .map((arg) => path.resolve(cwd, arg));
}
