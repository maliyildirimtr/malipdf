import { useCallback, useEffect, useState } from 'react';
import {
  discardRecoveredDocument,
  listRecoveredDocuments,
  restoreRecoveredDocument,
  type RecoveryListEntry,
} from '../../document/recoverDocument';
import { useDocumentStore } from '../../store/documentStore';
import { notifyUser } from '../../utils/notify';
import { SHOW_RECOVERY_EVENT } from './recoveryEvents';
import styles from './RecoveryDialog.module.css';

function formatTime(timestamp: number): string {
  if (!timestamp) return 'unknown time';
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * "Recovered Documents": shown at startup when auto-save snapshots survived a
 * crash, and on demand from File ▸ Recovered Documents….
 */
export function RecoveryDialog() {
  const [entries, setEntries] = useState<RecoveryListEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async (showWhenEmpty: boolean) => {
    // Snapshots of documents that are open right now are not "lost".
    const openIds = new Set(useDocumentStore.getState().documents.keys());
    const list = (await listRecoveredDocuments()).filter((entry) => !openIds.has(entry.docId));
    setEntries(list);
    if (list.length > 0 || showWhenEmpty) setOpen(true);
    return list;
  }, []);

  useEffect(() => {
    // Extra windows do not offer the snapshots of the other windows' documents.
    const secondary = new URLSearchParams(window.location.search).get('secondary') === '1';
    if (!secondary) void refresh(false);
    const onShow = () => void refresh(true);
    window.addEventListener(SHOW_RECOVERY_EVENT, onShow);
    return () => window.removeEventListener(SHOW_RECOVERY_EVENT, onShow);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const act = async (entry: RecoveryListEntry, action: 'restore' | 'discard') => {
    setBusyId(entry.docId);
    try {
      if (action === 'restore') {
        await restoreRecoveredDocument(entry.docId);
        notifyUser('success', `Restored "${entry.title}". Save it to keep the changes.`);
      } else {
        await discardRecoveredDocument(entry.docId);
      }
    } catch (error) {
      notifyUser('error', `Could not ${action} "${entry.title}": ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyId(null);
    }
    const remaining = await refresh(false);
    if (remaining.length === 0) setOpen(false);
  };

  const restoreAll = async () => {
    for (const entry of entries) await act(entry, 'restore');
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <div className={styles.header}>
          <h2 id="recovery-title">Recovered Documents</h2>
          <p>
            {entries.length > 0
              ? 'MaliPDF closed before these documents were saved. Restore them to continue where you left off.'
              : 'There are no unsaved documents to recover.'}
          </p>
        </div>
        {entries.length > 0 && (
          <ul className={styles.list}>
            {entries.map((entry) => (
              <li key={entry.docId} className={styles.row}>
                <div className={styles.info}>
                  <span className={styles.title} data-no-translate>{entry.title}</span>
                  <span className={styles.meta}>
                    {`Auto-saved ${formatTime(entry.savedAt)} · ${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'} · ${entry.annotationCount} annotation${entry.annotationCount === 1 ? '' : 's'}`}
                  </span>
                </div>
                <button type="button" className={styles.secondary} disabled={busyId !== null} onClick={() => void act(entry, 'discard')}>
                  Discard
                </button>
                <button type="button" className={styles.primary} disabled={busyId !== null} onClick={() => void act(entry, 'restore')}>
                  {busyId === entry.docId ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.footer}>
          <button type="button" className={styles.secondary} onClick={() => setOpen(false)}>
            {entries.length > 0 ? 'Decide Later' : 'Close'}
          </button>
          {entries.length > 1 && (
            <button type="button" className={styles.primary} disabled={busyId !== null} onClick={() => void restoreAll()}>
              Restore All
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
