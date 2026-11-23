/**
 * window.electronAPI for the iPad app.
 *
 * The renderer talks to the desktop shell through window.electronAPI. On iPad
 * the same interface is provided here on top of Capacitor plugins, so the rest
 * of the app runs unchanged:
 *
 * - Documents are saved in the app's Documents folder, which the Files app
 *   shows as "On My iPad › MaliPDF". Paths look like "Documents/Name.pdf".
 * - Files are picked with the system file picker (<input type="file">).
 * - Sharing and printing go through the share sheet.
 * - Desktop-only features (screen capture, PowerPoint conversion, updates,
 *   extra windows) report themselves as unavailable.
 */
import { askConfirm, askFileName, askSaveChanges } from './ipadDialogs';
import { base64ToBytes, bytesToBase64, callNative, onNative, toArrayBuffer } from './native';

type ElectronAPI = Window['electronAPI'];
type CommandListener = (commandId: unknown, payload?: unknown) => void;
type OpenedFile = { filePath: string; name: string; data: ArrayBuffer };

const DOCUMENTS = 'DOCUMENTS';
const LIBRARY = 'LIBRARY';
const CACHE = 'CACHE';
const DOCUMENTS_PREFIX = 'Documents/';
const RECOVERY_DIR = 'Recovery';

const commandListeners = new Set<CommandListener>();

/** Runs an app command, as a desktop menu item would. */
export function runIpadCommand(commandId: string, payload?: unknown): void {
  for (const listener of commandListeners) listener(commandId, payload);
}

// ── Files ───────────────────────────────────────────────────────────────────

const Filesystem = {
  write: (path: string, directory: string, data: Uint8Array | string, utf8 = false) =>
    callNative('Filesystem', 'writeFile', {
      path, directory, recursive: true,
      data: typeof data === 'string' ? data : bytesToBase64(data),
      ...(utf8 ? { encoding: 'utf8' } : {}),
    }),
  readBytes: async (path: string, directory?: string): Promise<Uint8Array> => {
    const result = await callNative<{ data: string }>('Filesystem', 'readFile', directory ? { path, directory } : { path });
    return base64ToBytes(result.data);
  },
  readText: async (path: string, directory: string): Promise<string> => {
    const result = await callNative<{ data: string }>('Filesystem', 'readFile', { path, directory, encoding: 'utf8' });
    return result.data;
  },
  stat: (path: string, directory: string) =>
    callNative<{ size: number; type: string }>('Filesystem', 'stat', { path, directory }).catch(() => null),
  list: (path: string, directory: string) =>
    callNative<{ files: Array<{ name: string; type?: string } | string> }>('Filesystem', 'readdir', { path, directory })
      .then((r) => r.files.map((f) => (typeof f === 'string' ? { name: f, type: undefined } : f)))
      .catch(() => [] as Array<{ name: string; type?: string }>),
  remove: (path: string, directory: string) =>
    callNative('Filesystem', 'rmdir', { path, directory, recursive: true }).catch(() => undefined),
  uri: (path: string, directory: string) =>
    callNative<{ uri: string }>('Filesystem', 'getUri', { path, directory }).then((r) => r.uri),
};

/** Characters the Files app does not allow in names. */
function safeName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').trim();
  return cleaned || 'Untitled';
}

function withExtension(name: string, ext: string): string {
  return new RegExp(`\\.${ext}$`, 'i').test(name) ? name : `${name}.${ext}`;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Relative path inside Documents, or null for any other path. */
function documentsPath(filePath: string): string | null {
  return filePath.startsWith(DOCUMENTS_PREFIX) ? filePath.slice(DOCUMENTS_PREFIX.length) : null;
}

/**
 * Where a picked file is saved. A file with the same name and size in the
 * MaliPDF folder is taken to be that file (opened from "On My iPad"); an
 * unrelated file of the same name gets a numbered name instead.
 */
async function savePathForPicked(name: string, size: number): Promise<string> {
  const ext = /\.([^.]+)$/.exec(name)?.[1] ?? 'pdf';
  const stem = name.replace(/\.[^.]+$/, '');
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? safeName(name) : `${safeName(stem)} ${n}.${ext}`;
    const existing = await Filesystem.stat(candidate, DOCUMENTS);
    if (!existing || existing.size === size) return DOCUMENTS_PREFIX + candidate;
  }
  return DOCUMENTS_PREFIX + safeName(name);
}

/** Shows the system file picker. Resolves with the picked files, or null. */
function pickFiles(accept: string, multiple: boolean): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    // Avoid display:none — iPadOS WKWebView can ignore programmatic .click() on hidden inputs.
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    let settled = false;
    const finish = (files: File[] | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(input.files?.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

const PDF_ACCEPT = 'application/pdf,.pdf';
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/heic,image/heif,image/webp,image/gif';

const isPdfName = (name: string) => /\.pdf$/i.test(name);

async function openPickedFiles(kind: 'pdf' | 'any' | 'office' = 'pdf'): Promise<OpenedFile[] | null> {
  if (kind === 'office') {
    await askConfirm(
      'Opening Word, Excel and PowerPoint files is not available on iPad. Export them as PDF first.',
      'OK',
    );
    return null;
  }
  const files = await pickFiles(kind === 'any' ? `${PDF_ACCEPT},${IMAGE_ACCEPT}` : PDF_ACCEPT, true);
  if (!files) return null;
  const opened: OpenedFile[] = [];
  for (const file of files) {
    const data = await file.arrayBuffer();
    // Opened documents get a save location; inserted pages and images need none.
    const filePath = kind === 'any' && isPdfName(file.name) ? await savePathForPicked(file.name, data.byteLength) : '';
    opened.push({ filePath, name: file.name, data });
  }
  return opened;
}

async function pickImages(multiple: boolean) {
  const files = await pickFiles(IMAGE_ACCEPT, multiple);
  if (!files) return null;
  return Promise.all(files.map(async (file) => ({
    name: file.name,
    mimeType: file.type || 'image/png',
    data: await file.arrayBuffer(),
  })));
}

async function chooseSavePath(defaultName: string, kind: 'pdf' | 'docx' = 'pdf'): Promise<string | null> {
  const suggested = withExtension(safeName(baseName(defaultName)), kind);
  const typed = await askFileName('Save As', suggested);
  if (!typed) return null;
  const name = withExtension(safeName(typed), kind);
  if (await Filesystem.stat(name, DOCUMENTS)) {
    const replace = await askConfirm(`"${name}" already exists. Replace it?`, 'Replace');
    if (!replace) return null;
  }
  return DOCUMENTS_PREFIX + name;
}

async function writeDocument(filePath: string, data: ArrayBuffer | Uint8Array): Promise<boolean> {
  const relative = documentsPath(filePath);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Any other path (e.g. from another device's recovery data) saves into MaliPDF.
  await Filesystem.write(relative ?? safeName(baseName(filePath)), DOCUMENTS, bytes);
  return true;
}

/** Opens the share sheet for a PDF (send, save to Files, print…). */
export async function sharePdf(name: string, data: ArrayBuffer | Uint8Array): Promise<boolean> {
  const fileName = withExtension(safeName(baseName(name)), 'pdf');
  const path = `Share/${fileName}`;
  await Filesystem.write(path, CACHE, data instanceof Uint8Array ? data : new Uint8Array(data));
  const uri = await Filesystem.uri(path, CACHE);
  try {
    await callNative('Share', 'share', { title: fileName, files: [uri] });
  } catch (error) {
    // Closing the share sheet without choosing anything is not an error.
    if (!/cancel/i.test(String((error as Error)?.message ?? error))) throw error;
  }
  return true;
}

// ── Crash recovery (Library/Recovery/<docId>/…) ─────────────────────────────

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function recoveryWrite(
  docId: string,
  meta: string,
  source: Uint8Array | null,
  assets: { id: string; data: Uint8Array }[],
): Promise<boolean> {
  if (!SAFE_ID.test(docId)) throw new TypeError('Invalid document id.');
  const dir = `${RECOVERY_DIR}/${docId}`;
  if (source) await Filesystem.write(`${dir}/source.pdf`, LIBRARY, source);
  for (const asset of assets) {
    if (!SAFE_ID.test(asset.id)) continue;
    const assetPath = `${dir}/assets/${asset.id}.bin`;
    if (!(await Filesystem.stat(assetPath, LIBRARY))) await Filesystem.write(assetPath, LIBRARY, asset.data);
  }
  // Written last: a snapshot only counts once its metadata is complete.
  await Filesystem.write(`${dir}/meta.json`, LIBRARY, meta, true);
  return true;
}

async function recoveryList() {
  const entries = await Filesystem.list(RECOVERY_DIR, LIBRARY);
  const result: Awaited<ReturnType<ElectronAPI['recoveryList']>> = [];
  for (const entry of entries) {
    if (!SAFE_ID.test(entry.name)) continue;
    try {
      const meta = JSON.parse(await Filesystem.readText(`${RECOVERY_DIR}/${entry.name}/meta.json`, LIBRARY));
      if (!(await Filesystem.stat(`${RECOVERY_DIR}/${entry.name}/source.pdf`, LIBRARY))) continue;
      result.push({
        docId: entry.name,
        title: String(meta.title ?? 'Untitled.pdf'),
        filePath: typeof meta.filePath === 'string' ? meta.filePath : null,
        savedAt: Number(meta.savedAt) || 0,
        pageCount: Number(meta.pageCount) || 0,
        annotationCount: Array.isArray(meta.annotations) ? meta.annotations.length : 0,
      });
    } catch {
      // Incomplete snapshot: ignore.
    }
  }
  return result.sort((a, b) => b.savedAt - a.savedAt);
}

async function recoveryLoad(docId: string) {
  if (!SAFE_ID.test(docId)) throw new TypeError('Invalid document id.');
  const dir = `${RECOVERY_DIR}/${docId}`;
  const meta = await Filesystem.readText(`${dir}/meta.json`, LIBRARY);
  const source = await Filesystem.readBytes(`${dir}/source.pdf`, LIBRARY);
  const parsed = JSON.parse(meta) as { assets?: { id: string }[] };
  const assets: { id: string; data: ArrayBuffer }[] = [];
  for (const asset of parsed.assets ?? []) {
    if (!SAFE_ID.test(asset.id)) continue;
    const bytes = await Filesystem.readBytes(`${dir}/assets/${asset.id}.bin`, LIBRARY).catch(() => null);
    if (bytes) assets.push({ id: asset.id, data: toArrayBuffer(bytes) });
  }
  return { meta, source: toArrayBuffer(source), assets };
}

// ── Files opened from other apps ("Open in MaliPDF") ────────────────────────

async function readOpenedUrl(url: string): Promise<OpenedFile | null> {
  if (!/^file:/i.test(url)) return null;
  const name = decodeURIComponent(baseName(url.split('?')[0]));
  if (!isPdfName(name)) return null;
  const bytes = await Filesystem.readBytes(url);
  const data = toArrayBuffer(bytes);
  return { filePath: await savePathForPicked(name, data.byteLength), name, data };
}

// ── The API ─────────────────────────────────────────────────────────────────

const unavailable = { success: false, error: 'Not available on iPad.' } as const;

export function createIpadBridge(): ElectronAPI {
  let openFilesListener: ((files: OpenedFile[]) => void) | null = null;
  const pendingOpens: OpenedFile[] = [];
  const deliver = (file: OpenedFile | null) => {
    if (!file) return;
    if (openFilesListener) openFilesListener([file]);
    else pendingOpens.push(file);
  };
  onNative('App', 'appUrlOpen', (event: { url?: string }) => {
    if (event?.url) void readOpenedUrl(event.url).then(deliver).catch((error) => console.error('Open failed:', error));
  });

  return {
    openFile: (kind) => openPickedFiles(kind),
    saveFile: (defaultName, kind) => chooseSavePath(defaultName, kind),
    writeFile: (filePath, data) => writeDocument(filePath, data),
    getVersion: () => callNative<{ version: string }>('App', 'getInfo').then((info) => info.version).catch(() => ''),
    onCommand: (callback) => {
      commandListeners.add(callback);
      return () => { commandListeners.delete(callback); };
    },
    updateCommandStates: () => {},
    toggleFullScreen: async () => false,
    setFullScreen: async () => false,
    isFullScreen: async () => false,
    askCloseConfirm: (fileName) => askSaveChanges([fileName]),
    askCloseAllConfirm: (fileNames) => askSaveChanges(fileNames),
    confirmLifecycle: () => {},
    openImage: () => pickImages(false).then((images) => images?.[0] ?? null),
    openImages: () => pickImages(true),
    captureScreen: async () => ({ ...unavailable }),
    captureRegion: async () => ({ ...unavailable }),
    readClipboardImage: async () => {
      const clip = await callNative<{ type?: string; value?: string }>('Clipboard', 'read').catch(() => null);
      if (!clip?.value || !/^image\//.test(clip.type ?? '') && !/^data:image\//.test(clip.value)) return null;
      const mimeType = /^data:([^;,]+)/.exec(clip.value)?.[1] ?? clip.type ?? 'image/png';
      return { data: toArrayBuffer(base64ToBytes(clip.value)), mimeType };
    },
    chooseFolder: async (title) => {
      const name = await askFileName(title ?? 'Folder name', 'MaliPDF Export');
      return name ? DOCUMENTS_PREFIX + safeName(name) : null;
    },
    writeFilesToFolder: async (folder, files) => {
      const relative = documentsPath(folder) ?? safeName(baseName(folder));
      const written: string[] = [];
      for (const file of files) {
        const name = file.ext ? withExtension(safeName(file.name), file.ext) : safeName(file.name);
        await Filesystem.write(`${relative}/${name}`, DOCUMENTS, new Uint8Array(file.data));
        written.push(`${DOCUMENTS_PREFIX}${relative}/${name}`);
      }
      return written;
    },
    setLanguage: () => {},
    recoveryWrite,
    recoveryRemove: async (docId) => {
      if (SAFE_ID.test(docId)) await Filesystem.remove(`${RECOVERY_DIR}/${docId}`, LIBRARY);
      return true;
    },
    recoveryList,
    recoveryLoad,
    onOpenFiles: (callback) => {
      openFilesListener = callback;
      if (pendingOpens.length) callback(pendingOpens.splice(0));
      return () => { if (openFilesListener === callback) openFilesListener = null; };
    },
    readyForFiles: () => {
      void callNative<{ url?: string } | null>('App', 'getLaunchUrl')
        .then((launch) => (launch?.url ? readOpenedUrl(launch.url) : null))
        .then(deliver)
        .catch(() => {});
    },
    checkForUpdates: async () => false,
    showAbout: async () => false,
    openCrashReports: async () => false,
    pptxIsAvailable: async () => false,
    pptxStartConversion: async () => null,
    pptxCancelConversion: async () => {},
    openLink: async (url) => {
      if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) return false;
      await callNative('Browser', 'open', { url }).catch(() => window.open(url, '_blank'));
      return true;
    },
    logRendererError: async (error) => {
      console.error('[MaliPDF]', error.message, error.stack ?? '');
      return true;
    },
    sharePdf,
  };
}
