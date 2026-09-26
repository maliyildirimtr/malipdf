/** PDF tools ▸ Reduce File Size… */
import { activeDocument, mutateDocumentBytes } from './documentBytesCommands';
import { canvasEncoder, compressPdf, type CompressLevel } from '../pdf/compress';
import { useTaskProgressStore } from '../store/taskProgressStore';
import { notifyUser } from '../utils/notify';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function reduceFileSize(level: CompressLevel): Promise<boolean> {
  const doc = activeDocument();
  if (!doc) return false;
  const before = doc.sourceData.byteLength;
  const taskId = useTaskProgressStore.getState().start('Reducing file size…', 1);
  try {
    let recompressed = 0;
    const after = await mutateDocumentBytes(doc, async (pdf) => {
      const report = await compressPdf(pdf, level, canvasEncoder, (done, total) => {
        useTaskProgressStore.getState().update(taskId, total ? done / total : 1, `Reducing file size… image ${Math.min(done + 1, total)} of ${total}`);
      });
      recompressed = report.recompressed;
    }, 'The file could not be made smaller', { useObjectStreams: true });
    if (after === null) return false;
    if (after >= before) {
      // Nothing gained: take the change back so the file stays as it was.
      const { executeUndo } = await import('./historyCommands');
      executeUndo(doc.id);
      notifyUser('info', 'This PDF is already compact — nothing more to save.');
      return false;
    }
    const saved = Math.round((1 - after / before) * 100);
    notifyUser('success', `${formatBytes(before)} → ${formatBytes(after)} (${saved}% smaller, ${recompressed} image${recompressed === 1 ? '' : 's'}). Annotations are added when you save.`);
    return true;
  } finally {
    useTaskProgressStore.getState().finish(taskId);
  }
}
