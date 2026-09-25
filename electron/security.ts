/**
 * Main-process security boundary.
 *
 * - Every IPC message must come from MaliPDF's own page (dev server in
 *   development, the bundled dist/index.html in production).
 * - The renderer can only write files the user chose in a native dialog (or
 *   opened), never arbitrary paths.
 * - Every argument crossing IPC is validated.
 */
import { app, ipcMain, session, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

export const DEV_SERVER_ORIGIN = 'http://localhost:5173';

type SenderEvent = Pick<IpcMainInvokeEvent | IpcMainEvent, 'senderFrame'>;

const APP_INDEX_PATH = path.join(__dirname, '../dist/index.html');

export function isAppUrl(url: string, isDev: boolean): boolean {
  if (isDev && (url === DEV_SERVER_ORIGIN || url.startsWith(`${DEV_SERVER_ORIGIN}/`))) return true;
  if (!url.startsWith('file:')) return false;
  try {
    // Compare real paths (ignoring #hash / ?query), tolerant of percent-
    // encoding and Unicode normalization differences (e.g. "İ" on macOS).
    const target = fileURLToPath(url.split(/[?#]/)[0]);
    return path.resolve(target).normalize('NFC') === path.resolve(APP_INDEX_PATH).normalize('NFC');
  } catch {
    return false;
  }
}

export function isTrustedSender(event: SenderEvent | null | undefined, isDev: boolean): boolean {
  const url = event?.senderFrame?.url;
  return typeof url === 'string' && isAppUrl(url, isDev);
}

export class UntrustedSenderError extends Error {
  constructor(channel: string) {
    super(`Blocked IPC "${channel}" from an untrusted sender.`);
  }
}

/** ipcMain.handle that rejects messages not sent by the app page. */
export function handleTrusted<Args extends unknown[], R>(
  channel: string,
  isDev: boolean,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => R | Promise<R>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event, isDev)) throw new UntrustedSenderError(channel);
    return handler(event, ...(args as Args));
  });
}

/** ipcMain.on that silently drops messages not sent by the app page. */
export function onTrusted<Args extends unknown[]>(
  channel: string,
  isDev: boolean,
  listener: (event: IpcMainEvent, ...args: Args) => void,
): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event, isDev)) {
      console.warn(`[security] Dropped IPC "${channel}" from an untrusted sender.`);
      return;
    }
    listener(event, ...(args as Args));
  });
}

// ─── Argument validation ─────────────────────────────────────────────────────

export function requireString(value: unknown, name: string, maxLength = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${name} must be a non-empty string (max ${maxLength} chars).`);
  }
  return value;
}

export function requireStringArray(value: unknown, name: string, maxItems = 1000): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${name} must be an array (max ${maxItems} items).`);
  }
  return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

export function requireBinary(value: unknown, name: string, maxBytes: number): Uint8Array {
  let bytes: Uint8Array;
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else throw new TypeError(`${name} must be binary data.`);
  if (bytes.byteLength > maxBytes) throw new RangeError(`${name} exceeds ${Math.round(maxBytes / 1048576)} MB.`);
  return bytes;
}

// ─── File access grants ──────────────────────────────────────────────────────

/**
 * Paths the renderer may write. A path is granted only when the user picked it
 * in a native Open/Save dialog in this session.
 */
export class FileAccessGrants {
  private readonly writable = new Set<string>();

  private static normalize(filePath: string): string {
    return path.resolve(filePath);
  }

  grantWrite(filePath: string): void {
    this.writable.add(FileAccessGrants.normalize(filePath));
  }

  canWrite(filePath: unknown): filePath is string {
    return typeof filePath === 'string'
      && path.isAbsolute(filePath)
      && this.writable.has(FileAccessGrants.normalize(filePath));
  }
}

// ─── Session / web-contents policy ───────────────────────────────────────────

/** Deny every permission request and lock down every web contents created. */
export function installWebContentsPolicy(isDev: boolean): void {
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
  });

  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url, isDev)) event.preventDefault();
    });
  });
}
