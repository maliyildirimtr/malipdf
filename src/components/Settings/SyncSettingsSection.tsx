import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  CloudOff,
  FolderSync,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { useSyncStore } from '../../store/syncStore';
import { useLibraryStore } from '../../store/libraryStore';
import { switchSyncProvider, syncNow } from '../../sync/syncManager';
import type { DetectedCloudFolder, SyncProviderId } from '../../sync/syncTypes';
import { isIpadApp } from '../../platform/native';
import { notifyUser } from '../../utils/notify';
import styles from './SyncSettingsSection.module.css';

export function SyncSettingsSection() {
  const {
    provider,
    status,
    autoSync,
    lastSyncedAt,
    lastError,
    stats,
    folderPath,
    googleClientId,
    googleEmail,
    googleAccessToken,
    setAutoSync,
    setGoogleClientId,
  } = useSyncStore();

  const itemCount = useLibraryStore((s) => s.items.filter((i) => !i.trashedAt).length);
  const folderCount = useLibraryStore((s) => s.folders.length);

  const [detectedFolders, setDetectedFolders] = useState<DetectedCloudFolder[]>([]);
  const [migrateExisting, setMigrateExisting] = useState(true);
  const [googleTokenInput, setGoogleTokenInput] = useState('');
  const [showGoogleConfig, setShowGoogleConfig] = useState(false);

  const isDesktop = Boolean(window.electronAPI?.syncDetectCloudFolders) && !isIpadApp();

  useEffect(() => {
    if (!isDesktop) return;
    void window.electronAPI?.syncDetectCloudFolders?.().then(setDetectedFolders).catch(() => {});
  }, [isDesktop]);

  const handleSelectProvider = async (next: SyncProviderId, extra?: { folderPath?: string; accessToken?: string }) => {
    const ok = await switchSyncProvider(next, {
      migrateExisting,
      folderPath: extra?.folderPath,
      accessToken: extra?.accessToken,
      clientId: googleClientId,
    });
    if (ok) {
      notifyUser('success', next === 'local' ? 'Switched to local device storage' : 'Sync completed');
    }
  };

  const handleChooseCustomFolder = async () => {
    const chosen = await window.electronAPI?.chooseFolder?.('Choose MaliPDF Sync Folder');
    if (!chosen) return;
    await handleSelectProvider('folder', { folderPath: chosen });
  };

  const handleGoogleConnect = async () => {
    const token = googleTokenInput.trim();
    if (token) {
      setGoogleTokenInput('');
      await handleSelectProvider('gdrive', { accessToken: token });
      return;
    }
    if (!googleClientId.trim()) {
      setShowGoogleConfig(true);
      notifyUser('info', 'Enter a Google OAuth Client ID or access token to connect Google Drive.');
      return;
    }
    await handleSelectProvider('gdrive');
  };

  const formatLastSync = (ts: number | null) => {
    if (!ts) return 'Never synced yet';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const providerLabel = (p: SyncProviderId) => {
    switch (p) {
      case 'icloud': return 'iCloud Drive';
      case 'gdrive': return 'Google Drive';
      case 'folder': return 'Cloud / Desktop Folder';
      default: return 'This Device Only';
    }
  };

  return (
    <section className={styles.wrap}>
      <h3>Cloud Sync</h3>
      <p className={styles.lead}>
        Keep your PDFs, folders, and editable handwritten notes in sync across Mac, Windows, iPad, and iPhone — using your own cloud storage with zero server fees.
      </p>

      {/* Active Sync Status Card */}
      <div className={styles.statusCard}>
        <div className={styles.statusLeft}>
          <div className={`${styles.statusIcon} ${provider !== 'local' ? styles.statusIconActive : ''}`}>
            {provider === 'local' ? <CloudOff size={18} /> : status === 'syncing' ? <RefreshCw size={18} className={styles.spin} /> : <CheckCircle2 size={18} />}
          </div>
          <div className={styles.statusMeta}>
            <div className={styles.statusTitle}>{providerLabel(provider)}</div>
            <div className={styles.statusSub}>
              {status === 'syncing'
                ? 'Syncing documents…'
                : provider === 'local'
                  ? `${itemCount} documents stored locally`
                  : `${formatLastSync(lastSyncedAt)} · ↑${stats.uploaded} ↓${stats.downloaded}${stats.conflicts > 0 ? ` · ${stats.conflicts} conflict copy` : ''}`}
            </div>
            {folderPath && (provider === 'folder' || (provider === 'icloud' && isDesktop)) && (
              <div className={styles.pathBadge} data-no-translate>{folderPath}</div>
            )}
            {googleEmail && provider === 'gdrive' && (
              <div className={styles.pathBadge} data-no-translate>{googleEmail}</div>
            )}
          </div>
        </div>
        {provider !== 'local' && (
          <button
            type="button"
            className={styles.syncNowBtn}
            disabled={status === 'syncing'}
            onClick={() => void syncNow().then((ok) => { if (ok) notifyUser('success', 'Sync completed'); })}
          >
            <RefreshCw size={14} className={status === 'syncing' ? styles.spin : ''} />
            <span>Sync Now</span>
          </button>
        )}
      </div>

      {lastError && <div className={styles.errorBox}>{lastError}</div>}

      {/* Migration toggle when switching providers */}
      <label className={styles.migrateRow}>
        <input
          type="checkbox"
          checked={migrateExisting}
          onChange={(e) => setMigrateExisting(e.target.checked)}
        />
        <span>
          Copy existing library ({itemCount} docs, {folderCount} folders) when switching cloud providers
        </span>
      </label>

      {/* Provider cards */}
      <div className={styles.cards}>
        <button
          type="button"
          className={`${styles.card} ${provider === 'local' ? styles.cardActive : ''}`}
          onClick={() => void handleSelectProvider('local')}
        >
          <HardDrive size={19} />
          <div className={styles.cardBody}>
            <div className={styles.cardTitle}>This Device Only</div>
            <div className={styles.cardSub}>Offline storage — no cloud sync</div>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.card} ${provider === 'icloud' ? styles.cardActive : ''}`}
          onClick={() => void handleSelectProvider('icloud')}
        >
          <Cloud size={19} />
          <div className={styles.cardBody}>
            <div className={styles.cardTitle}>iCloud Drive</div>
            <div className={styles.cardSub}>Mac · iPad · iPhone (+ iCloud for Windows)</div>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.card} ${provider === 'gdrive' ? styles.cardActive : ''}`}
          onClick={() => setShowGoogleConfig(true)}
        >
          <Cloud size={19} />
          <div className={styles.cardBody}>
            <div className={styles.cardTitle}>Google Drive</div>
            <div className={styles.cardSub}>iPad · iPhone · Windows · Mac · Android</div>
          </div>
        </button>

        {isDesktop && (
          <button
            type="button"
            className={`${styles.card} ${provider === 'folder' ? styles.cardActive : ''}`}
            onClick={() => void handleChooseCustomFolder()}
          >
            <FolderSync size={19} />
            <div className={styles.cardBody}>
              <div className={styles.cardTitle}>Desktop Cloud Folder…</div>
              <div className={styles.cardSub}>OneDrive, Google Drive Desktop, Dropbox, or any folder</div>
            </div>
          </button>
        )}
      </div>

      {/* Auto-detected desktop cloud folders (Mac & Windows) */}
      {isDesktop && detectedFolders.length > 0 && (
        <div className={styles.detectedBlock}>
          <div className={styles.subHeading}>Detected Cloud Folders on This Computer</div>
          <div className={styles.chipRow}>
            {detectedFolders.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`${styles.chipBtn} ${folderPath === d.path ? styles.chipBtnActive : ''}`}
                onClick={() => void handleSelectProvider(d.id === 'icloud' ? 'icloud' : 'folder', { folderPath: d.path })}
              >
                <FolderSync size={13} />
                <span data-no-translate>{d.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Google Drive Direct Connection Panel */}
      {(showGoogleConfig || provider === 'gdrive') && (
        <div className={styles.gdriveBox}>
          <div className={styles.subHeading}>Google Drive Connection</div>
          <p className={styles.smallNote}>
            Uses Google Drive API v3 (<code>drive.file</code> scope) inside a dedicated <strong>MaliPDF</strong> folder. Switch freely between iCloud Drive and Google Drive anytime without losing notes.
          </p>
          <div className={styles.inputRow}>
            <input
              type="text"
              className={styles.textInput}
              placeholder="Google OAuth Client ID (optional)"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
            />
          </div>
          <div className={styles.inputRow}>
            <input
              type="password"
              className={styles.textInput}
              placeholder="Or paste OAuth Access Token"
              value={googleTokenInput}
              onChange={(e) => setGoogleTokenInput(e.target.value)}
            />
            <button type="button" className={styles.connectBtn} onClick={() => void handleGoogleConnect()}>
              {googleAccessToken ? 'Reconnect' : 'Connect'}
            </button>
          </div>
        </div>
      )}

      {/* Auto-sync toggle */}
      {provider !== 'local' && (
        <label className={styles.migrateRow}>
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(e) => setAutoSync(e.target.checked)}
          />
          <span>Auto-sync when saving documents or switching back to MaliPDF</span>
        </label>
      )}
    </section>
  );
}
