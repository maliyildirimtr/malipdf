import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from '../utils/nanoid';
import type { SyncProviderId, SyncStatus, SyncTombstone } from '../sync/syncTypes';

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
  /**
   * Cloud documents permanently deleted on this device that have not yet been
   * published to the remote manifest. Without them the next sync would bring
   * the document back from the remote copy.
   */
  tombstones: SyncTombstone[];

  setProvider: (provider: SyncProviderId) => void;
  setStatus: (status: SyncStatus, error?: string | null) => void;
  setAutoSync: (enabled: boolean) => void;
  setFolderPath: (path: string | null) => void;
  setGoogleClientId: (clientId: string) => void;
  setGoogleSession: (session: { accessToken: string; expiresAt: number; email?: string | null } | null) => void;
  setGoogleRootFolderId: (id: string | null) => void;
  setCloudOnboardingSeen: (seen: boolean) => void;
  addTombstones: (tombstones: SyncTombstone[]) => void;
  /** Drops tombstones that are now recorded in the remote manifest. */
  clearTombstones: (ids: string[]) => void;
  /**
   * `startedAt` is when the sync began: anything changed while it ran has a
   * later `updatedAt` and is therefore still seen as "changed since last sync".
   */
  recordSyncSuccess: (stats: SyncStats, startedAt: number) => void;
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
      tombstones: [],

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
      addTombstones: (tombstones) =>
        set((s) => {
          const byId = new Map(s.tombstones.map((t) => [t.id, t]));
          for (const t of tombstones) byId.set(t.id, t);
          return { tombstones: Array.from(byId.values()) };
        }),
      clearTombstones: (ids) =>
        set((s) => {
          const drop = new Set(ids);
          return { tombstones: s.tombstones.filter((t) => !drop.has(t.id)) };
        }),
      recordSyncSuccess: (stats, startedAt) =>
        set({
          status: 'synced',
          lastSyncedAt: startedAt,
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
        tombstones: state.tombstones,
      }),
    },
  ),
);
