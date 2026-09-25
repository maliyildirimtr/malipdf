// ============================================================
// MALIPDF DOWNLOAD CONFIGURATION
// ============================================================
// Central config for all download links and release metadata.
// Update this file when new releases are available.
// ============================================================

export interface DownloadAsset {
  label: string;
  url: string | null;        // null = not yet available
  available: boolean;
  comingSoon?: boolean;
  version?: string;
  arch?: string;
  sizeLabel?: string;        // e.g. "48 MB"
  releaseNotesUrl?: string;
}

export interface DownloadConfig {
  version: string | null;
  releaseDate: string | null;
  releaseNotesUrl: string | null;
  macos: DownloadAsset;
  windows: DownloadAsset;
}

export const downloads: DownloadConfig = {
  // Set version when releases are ready:
  version: null,
  releaseDate: null,
  releaseNotesUrl: null,

  macos: {
    label: 'Download for macOS',
    url: null,               // TODO: Add real URL when available
    available: false,
    comingSoon: true,
    version: undefined,
    arch: undefined,         // e.g. "Universal (Apple Silicon + Intel)"
    sizeLabel: undefined,
  },

  windows: {
    label: 'Windows',
    url: null,               // TODO: Add real URL when available
    available: false,
    comingSoon: true,
    version: undefined,
    arch: undefined,
    sizeLabel: undefined,
  },
};
