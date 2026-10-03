// ============================================================
// MALIPDF DOWNLOAD CONFIGURATION
// ============================================================
// Central config for all download links and release metadata.
// Hero and DownloadSection read from here — never hard-code
// release URLs in components. To ship a new release, update
// RELEASE_TAG / version / file sizes below.
// ============================================================

const REPO_URL = 'https://github.com/maliyildirimtr/malipdf';
const RELEASE_TAG = 'v1.0.0';
const RELEASE_DOWNLOAD_BASE = `${REPO_URL}/releases/download/${RELEASE_TAG}`;

const assetUrl = (fileName: string) => `${RELEASE_DOWNLOAD_BASE}/${fileName}`;

export interface DownloadAsset {
  id: string;
  /** Short name shown in menus, e.g. "Apple Silicon" */
  label: string;
  /** Secondary line, e.g. "M1, M2, M3, M4 and later" */
  description?: string;
  fileName: string;
  url: string;
  arch: string;
  /** Approximate size, e.g. "~117 MB" */
  sizeLabel: string;
}

export interface PlatformDownloads {
  /** Primary button label, e.g. "Download for macOS" */
  label: string;
  /** One or more installers; more than one shows a chooser menu */
  assets: DownloadAsset[];
}

export interface DownloadConfig {
  version: string;
  tag: string;
  releaseNotesUrl: string;
  macos: PlatformDownloads;
}

export const downloads: DownloadConfig = {
  version: '1.0.0',
  tag: RELEASE_TAG,
  releaseNotesUrl: `${REPO_URL}/releases/tag/${RELEASE_TAG}`,

  macos: {
    label: 'Download for macOS',
    assets: [
      {
        id: 'macos-apple-silicon',
        label: 'Apple Silicon',
        description: 'M1, M2, M3, M4 and later',
        fileName: 'MaliPDF-1.0.0-mac-arm64.dmg',
        url: assetUrl('MaliPDF-1.0.0-mac-arm64.dmg'),
        arch: 'arm64',
        sizeLabel: '~170 MB',
      },
    ],
  },
};

/** Windows: Microsoft Store (updates come from the Store). */
export const windowsStore = {
  label: 'Get it from Microsoft Store',
  url: 'https://apps.microsoft.com/detail/9PMT0XR7DGKH',
  storeId: '9PMT0XR7DGKH',
  meta: 'Windows 10 and 11 · x64',
};

/** The public macOS installer. */
export const macosInstaller = downloads.macos.assets[0];
