// ============================================================
// MALIPDF DOWNLOAD CONFIGURATION
// ============================================================
// Central config for all download links and release metadata.
// Hero and DownloadSection read from here — never hard-code
// release URLs in components. To ship a new release, update
// RELEASE_TAG / version / file sizes below.
// ============================================================

const REPO_URL = 'https://github.com/maliyildirimtr/malipdf';
const RELEASE_TAG = 'v0.9.0-beta.2';
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
  windows: PlatformDownloads;
}

export const downloads: DownloadConfig = {
  version: '0.9.0-beta.2',
  tag: RELEASE_TAG,
  releaseNotesUrl: `${REPO_URL}/releases/tag/${RELEASE_TAG}`,

  macos: {
    label: 'Download for macOS',
    assets: [
      {
        id: 'macos-apple-silicon',
        label: 'Apple Silicon',
        description: 'M1, M2, M3, M4 and later',
        fileName: 'MaliPDF-macOS-Apple-Silicon.dmg',
        url: assetUrl('MaliPDF-macOS-Apple-Silicon.dmg'),
        arch: 'arm64',
        sizeLabel: '~117 MB',
      },
      {
        id: 'macos-intel',
        label: 'Intel Mac',
        description: 'Macs with Intel processors',
        fileName: 'MaliPDF-macOS-Intel.dmg',
        url: assetUrl('MaliPDF-macOS-Intel.dmg'),
        arch: 'x64',
        sizeLabel: '~121 MB',
      },
    ],
  },

  windows: {
    label: 'Download for Windows',
    assets: [
      {
        id: 'windows-x64',
        label: 'Windows x64',
        description: '64-bit installer (.exe)',
        fileName: 'MaliPDF-Windows-x64-Setup.exe',
        url: assetUrl('MaliPDF-Windows-x64-Setup.exe'),
        arch: 'x64',
        sizeLabel: '~92 MB',
      },
    ],
  },
};

/** The single Windows installer (convenience accessor). */
export const windowsInstaller = downloads.windows.assets[0];
