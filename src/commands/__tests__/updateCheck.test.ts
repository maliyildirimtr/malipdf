import { describe, expect, it } from 'vitest';
import {
  RELEASES_PAGE_URL,
  assetNameFor,
  cleanReleaseNotes,
  compareVersions,
  findUpdate,
  isTrustedDownloadUrl,
  type GithubRelease,
} from '../../../electron/services/updateCheck';

const release = (tag: string, extra: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  html_url: `https://github.com/maliyildirimtr/malipdf/releases/tag/${tag}`,
  body: '## Changes\n* **Search** added\n* [Docs](https://x.y)',
  prerelease: true,
  assets: [
    { name: 'MaliPDF-macOS-Apple-Silicon.dmg', browser_download_url: `https://github.com/maliyildirimtr/malipdf/releases/download/${tag}/MaliPDF-macOS-Apple-Silicon.dmg`, size: 10 },
    { name: 'MaliPDF-Windows-x64-Setup.exe', browser_download_url: `https://github.com/maliyildirimtr/malipdf/releases/download/${tag}/MaliPDF-Windows-x64-Setup.exe`, size: 10 },
  ],
  ...extra,
});

describe('update check', () => {
  it('compares semantic versions', () => {
    expect(compareVersions('v0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', 'v0.1.0')).toBe(0);
    expect(compareVersions('nonsense', '0.0.1')).toBeLessThan(0);
  });

  it('finds the newest non-draft release newer than the running one', () => {
    const releases = [release('v0.1.0'), release('v0.3.0', { draft: true }), release('v0.2.1'), release('latest-build')];
    const update = findUpdate(releases, '0.1.0', 'darwin', 'arm64')!;
    expect(update.version).toBe('0.2.1');
    expect(update.asset?.name).toBe('MaliPDF-macOS-Apple-Silicon.dmg');
    expect(update.notes).toBe('Changes\n• Search added\n• Docs');
    expect(findUpdate(releases, '0.2.1', 'darwin', 'arm64')).toBeNull();
  });

  it('picks the installer for the platform, or none', () => {
    expect(assetNameFor('darwin', 'x64')).toBe('MaliPDF-macOS-Intel.dmg');
    expect(assetNameFor('win32', 'x64')).toBe('MaliPDF-Windows-x64-Setup.exe');
    expect(assetNameFor('linux', 'x64')).toBeNull();
    expect(findUpdate([release('v1.0.0')], '0.1.0', 'darwin', 'x64')!.asset).toBeNull();
  });

  it('only trusts GitHub https URLs', () => {
    expect(isTrustedDownloadUrl('https://github.com/a/b/releases/download/v1/x.dmg')).toBe(true);
    expect(isTrustedDownloadUrl('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isTrustedDownloadUrl('http://github.com/x')).toBe(false);
    expect(isTrustedDownloadUrl('https://github.com.evil.com/x')).toBe(false);
    expect(findUpdate([release('v2.0.0', { html_url: 'https://evil.com' })], '1.0.0', 'win32', 'x64')!.pageUrl).toBe(RELEASES_PAGE_URL);
  });

  it('shortens long release notes', () => {
    expect(cleanReleaseNotes('')).toBe('No release notes.');
    expect(cleanReleaseNotes('a'.repeat(50), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});
