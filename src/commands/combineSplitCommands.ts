/**
 * Combine Files (several PDFs → one new document) and Split Document
 * (one document → several PDFs in a folder).
 */
import { useDocumentStore } from '../store/documentStore';
import { useTaskProgressStore } from '../store/taskProgressStore';
import { openDocumentBytes } from '../document/openDocumentBytes';
import type { SplitPart } from '../document/splitPlan';
import { errorMessage, notifyUser } from '../utils/notify';

/** Merge PDFs in the given order. */
export async function mergePdfs(files: readonly { name: string; data: ArrayBuffer | Uint8Array }[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const file of files) {
    let src;
    try {
      src = await PDFDocument.load(file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data));
    } catch (error) {
      throw new Error(`${file.name} could not be read (${errorMessage(error)}).`);
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  return out.save();
}

/** Pick PDFs and open them combined as a new document. */
export async function combineFiles(): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.openFile) return false;
  const files = await api.openFile();
  if (!files || files.length === 0) return false;
  if (files.length === 1) {
    notifyUser('info', 'Choose two or more PDFs to combine (⌘-click to pick several).');
    return false;
  }
  // Finder returns the files sorted by name; keep that order.
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  try {
    const bytes = await mergePdfs(ordered);
    const first = ordered[0].name.replace(/\.pdf$/i, '');
    await openDocumentBytes(`${first} + ${ordered.length - 1} more.pdf`, null, bytes.buffer as ArrayBuffer);
    notifyUser('success', `Combined ${ordered.length} files. Use Save As to keep the result.`);
    return true;
  } catch (error) {
    notifyUser('error', `The files could not be combined: ${errorMessage(error)}`);
    return false;
  }
}

/** Write each part of the active document as its own PDF into a chosen folder. */
export async function splitDocument(parts: readonly SplitPart[]): Promise<boolean> {
  const store = useDocumentStore.getState();
  const doc = store.activeDocId ? store.documents.get(store.activeDocId) : null;
  const api = window.electronAPI;
  if (!doc || !api?.chooseFolder || !api.writeFilesToFolder || parts.length === 0) return false;
  const folder = await api.chooseFolder('Choose where to save the parts');
  if (!folder) return false;
  const progress = useTaskProgressStore.getState();
  const taskId = progress.start('Splitting…', parts.length);
  try {
    const { buildPagesPdf } = await import('./pageCommands');
    const base = doc.title.replace(/\.pdf$/i, '');
    const files: { name: string; data: ArrayBuffer }[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (useTaskProgressStore.getState().isCancelled(taskId)) return false;
      useTaskProgressStore.getState().update(taskId, i, `Splitting… part ${i + 1} of ${parts.length}`);
      const data = await buildPagesPdf(doc, parts[i].pages);
      files.push({ name: `${base} (${parts[i].label})`, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer });
    }
    const written = await api.writeFilesToFolder(folder, files);
    notifyUser('success', `Saved ${written.length} PDF${written.length === 1 ? '' : 's'}.`);
    return true;
  } catch (error) {
    notifyUser('error', `The document could not be split: ${errorMessage(error)}`);
    return false;
  } finally {
    useTaskProgressStore.getState().finish(taskId);
  }
}
