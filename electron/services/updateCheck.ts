/**
 * Pure helpers for the GitHub Releases update check (no Electron imports,
 * so they can be unit-tested).
 */

export const RELEASES_REPO = 'maliyildirimtr/malipdf';
export const RELEASES_API_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=20`;
export const RELEASES_PAGE_URL = `https://github.com/${RELEASES_REPO}/releases`;

export interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GithubRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: GithubAsset[];
}

export interface AvailableUpdate {
  version: string;
  title: string;
  notes: string;
  pageUrl: string;
  asset: GithubAsset | null;
}

type Version = { core: number[]; pre: string | null };

function parseVersion(raw: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(raw.trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
}

/** Semver comparison: >0 when a is newer than b. Invalid versions sort lowest. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return va ? 1 : vb ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) return va.core[i] - vb.core[i];
  }
  if (va.pre === vb.pre) return 0;
  if (va.pre === null) return 1; // 1.0.0 > 1.0.0-beta
  if (vb.pre === null) return -1;
  const pa = va.pre.split('.');
  const pb = vb.pre.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : NaN;
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Installer file name produced by .github/workflows/release.yml. */
export function assetNameFor(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'darwin') return arch === 'arm64' ? 'MaliPDF-macOS-Apple-Silicon.dmg' : 'MaliPDF-macOS-Intel.dmg';
  if (platform === 'win32') return 'MaliPDF-Windows-x64-Setup.exe';
  return null;
}

/**
 * Newest non-draft release that is newer than `currentVersion`, or null.
 * Pre-releases count (all MaliPDF releases are currently pre-releases).
 */
export function findUpdate(
  releases: GithubRelease[],
  currentVersion: string,
  platform: NodeJS.Platform,
  arch: string,
): AvailableUpdate | null {
  const candidates = releases
    .filter((release) => !release.draft && parseVersion(release.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const newest = candidates[0];
  if (!newest || compareVersions(newest.tag_name, currentVersion) <= 0) return null;

  const wanted = assetNameFor(platform, arch);
  const asset = newest.assets?.find((candidate) => candidate.name === wanted) ?? null;
  return {
    version: newest.tag_name.replace(/^v/, ''),
    title: newest.name?.trim() || `MaliPDF ${newest.tag_name}`,
    notes: cleanReleaseNotes(newest.body ?? ''),
    pageUrl: isTrustedDownloadUrl(newest.html_url) ? newest.html_url : RELEASES_PAGE_URL,
    asset,
  };
}

/** Markdown release notes → short plain text for a native dialog. */
export function cleanReleaseNotes(markdown: string, maxLength = 1200): string {
  const text = markdown
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return 'No release notes.';
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

/** Only download from GitHub over https. */
export function isTrustedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.githubusercontent.com'));
  } catch {
    return false;
  }
}
