import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from '../utils/nanoid';
import type { SyncProviderId, SyncStatus } from '../sync/syncTypes';

export interface SyncStats {
  uploaded: number;
  downloaded: number;
  conflicts: number;
}

interface SyncStoreState {
  deviceId: string;
  provider: SyncProviderId;
  status: SyncStatus;
  autoSync: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
  stats: SyncStats;

  /** Desktop Folder / Cloud Drive local folder path (Mac & Windows). */
  folderPath: string | null;
  /** Optional Google OAuth Web/iOS Client ID for direct Google Drive API v3 sync. */
  googleClientId: string;
  googleAccessToken: string | null;
  googleTokenExpiresAt: number | null;
  googleEmail: string | null;
  googleRootFolderId: string | null;
  cloudOnboardingSeen: boolean;

  setProvider: (provider: SyncProviderId) => void;
  setStatus: (status: SyncStatus, error?: string | null) => void;
  setAutoSync: (enabled: boolean) => void;
  setFolderPath: (path: string | null) => void;
  setGoogleClientId: (clientId: string) => void;
  setGoogleSession: (session: { accessToken: string; expiresAt: number; email?: string | null } | null) => void;
  setGoogleRootFolderId: (id: string | null) => void;
  setCloudOnboardingSeen: (seen: boolean) => void;
  recordSyncSuccess: (stats: SyncStats) => void;
}

export const useSyncStore = create<SyncStoreState>()(
  persist(
    (set) => ({
      deviceId: `dev-${nanoid(10)}`,
      provider: 'local',
      status: 'idle',
      autoSync: true,
      lastSyncedAt: null,
      lastError: null,
      stats: { uploaded: 0, downloaded: 0, conflicts: 0 },
      folderPath: null,
      googleClientId: '',
      googleAccessToken: null,
      googleTokenExpiresAt: null,
      googleEmail: null,
      googleRootFolderId: null,
      cloudOnboardingSeen: false,

      setProvider: (provider) => set({ provider, lastError: null }),
      setStatus: (status, error = null) => set({ status, lastError: error }),
      setAutoSync: (autoSync) => set({ autoSync }),
      setFolderPath: (folderPath) => set({ folderPath }),
      setGoogleClientId: (googleClientId) => set({ googleClientId: googleClientId.trim() }),
      setGoogleSession: (session) =>
        set({
          googleAccessToken: session?.accessToken ?? null,
          googleTokenExpiresAt: session?.expiresAt ?? null,
          googleEmail: session?.email ?? null,
          ...(session ? {} : { googleRootFolderId: null }),
        }),
      setGoogleRootFolderId: (googleRootFolderId) => set({ googleRootFolderId }),
      setCloudOnboardingSeen: (cloudOnboardingSeen) => set({ cloudOnboardingSeen }),
      recordSyncSuccess: (stats) =>
        set({
          status: 'synced',
          lastSyncedAt: Date.now(),
          lastError: null,
          stats,
        }),
    }),
    {
      name: 'malipdf-sync-v1',
      partialize: (state) => ({
        deviceId: state.deviceId,
        provider: state.provider,
        autoSync: state.autoSync,
        lastSyncedAt: state.lastSyncedAt,
        folderPath: state.folderPath,
        googleClientId: state.googleClientId,
        googleAccessToken: state.googleAccessToken,
        googleTokenExpiresAt: state.googleTokenExpiresAt,
        googleEmail: state.googleEmail,
        googleRootFolderId: state.googleRootFolderId,
        cloudOnboardingSeen: state.cloudOnboardingSeen,
      }),
    },
  ),
);
