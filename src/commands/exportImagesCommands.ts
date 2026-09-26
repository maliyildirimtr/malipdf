/** PDF tools ▸ Export Pages as Images… */
import { useDocumentStore } from '../store/documentStore';
import { useTaskProgressStore } from '../store/taskProgressStore';
import { renderSnapshot } from './snapshotCommands';
import { errorMessage, notifyUser } from '../utils/notify';

export interface ExportImagesOptions {
  format: 'png' | 'jpg';
  dpi: number;
  pages: number[];
}

export async function exportPagesAsImages(options: ExportImagesOptions): Promise<boolean> {
  const store = useDocumentStore.getState();
  const doc = store.activeDocId ? store.documents.get(store.activeDocId) : null;
  const api = window.electronAPI;
  if (!doc || !api?.chooseFolder || !api.writeFilesToFolder || options.pages.length === 0) return false;
  const folder = await api.chooseFolder('Choose where to save the images');
  if (!folder) return false;
  const identity = { docId: doc.id, instanceId: doc.instanceId };
  const base = doc.title.replace(/\.pdf$/i, '');
  const taskId = useTaskProgressStore.getState().start('Exporting images…', options.pages.length);
  try {
    let written = 0;
    // Written in small batches so memory stays low for long documents.
    let batch: { name: string; data: ArrayBuffer; ext: 'png' | 'jpg' }[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      written += (await api.writeFilesToFolder!(folder, batch)).length;
      batch = [];
    };
    for (let i = 0; i < options.pages.length; i++) {
      if (useTaskProgressStore.getState().isCancelled(taskId)) break;
      const pageIndex = options.pages[i];
      useTaskProgressStore.getState().update(taskId, i, `Exporting images… page ${pageIndex + 1}`);
      const canvas = await renderSnapshot(identity, pageIndex, null, doc.pageRotations[pageIndex] ?? 0, options.dpi / 72);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, options.format === 'png' ? 'image/png' : 'image/jpeg', 0.9));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error('Could not make the image.');
      const digits = String(doc.pageCount).length;
      batch.push({ name: `${base} - page ${String(pageIndex + 1).padStart(digits, '0')}`, data: await blob.arrayBuffer(), ext: options.format });
      if (batch.length >= 8) await flush();
    }
    await flush();
    notifyUser('success', `Saved ${written} image${written === 1 ? '' : 's'}.`);
    return written > 0;
  } catch (error) {
    notifyUser('error', `The pages could not be exported: ${errorMessage(error)}`);
    return false;
  } finally {
    useTaskProgressStore.getState().finish(taskId);
  }
}
