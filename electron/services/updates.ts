/**
 * Auto Update via GitHub Releases.
 *
 * MaliPDF is not code-signed yet, so silent self-install (Squirrel) is not
 * possible on macOS. Instead: check the Releases API, show the release notes,
 * download the right installer into Downloads and open it (DMG mounts / the
 * Windows setup starts). Automatic checks run at most once a day.
 */
import { showMessageBox } from '../i18n/mainLanguage';
import { app, BrowserWindow, dialog, net, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
  findUpdate,
  isTrustedDownloadUrl,
  type AvailableUpdate,
  type GithubRelease,
} from './updateCheck';
import { handleTrusted } from '../security';

const AUTO_CHECK_DELAY_MS = 15_000;
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface UpdatePrefs {
  autoCheck: boolean;
  lastCheck: number;
  skippedVersion: string | null;
}

function prefsPath(): string {
  return path.join(app.getPath('userData'), 'update-preferences.json');
}

function readPrefs(): UpdatePrefs {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    return {
      autoCheck: parsed.autoCheck !== false,
      lastCheck: Number(parsed.lastCheck) || 0,
      skippedVersion: typeof parsed.skippedVersion === 'string' ? parsed.skippedVersion : null,
    };
  } catch {
    return { autoCheck: true, lastCheck: 0, skippedVersion: null };
  }
}

function writePrefs(patch: Partial<UpdatePrefs>): void {
  try {
    fs.writeFileSync(prefsPath(), JSON.stringify({ ...readPrefs(), ...patch }, null, 2));
  } catch (error) {
    console.warn('Could not save update preferences:', error);
  }
}

async function fetchReleases(): Promise<GithubRelease[]> {
  const response = await net.fetch(RELEASES_API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `MaliPDF/${app.getVersion()}` },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Unexpected answer from GitHub.');
  return data as GithubRelease[];
}

let checking = false;
let downloading = false;

function parentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

async function showMessage(options: Electron.MessageBoxOptions) {
  const window = parentWindow();
  return showMessageBox(window, options);
}

/** MaliPDF's Microsoft Store listing (Partner Center → Product identity). */
export const STORE_PRODUCT_ID = '9PMT0XR7DGKH';
export const STORE_PAGE_URL = `ms-windows-store://pdp/?productid=${STORE_PRODUCT_ID}`;

/** Installed from the Microsoft Store (MSIX package): the Store keeps it up to date. */
export function isStoreInstall(): boolean {
  return process.platform === 'win32' && (process as NodeJS.Process & { windowsStore?: boolean }).windowsStore === true;
}

/** manual = the user picked "Check for Updates…" (always answers). */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (isStoreInstall()) {
    // Store installs never download installers; the Store page shows updates.
    if (manual) await shell.openExternal(STORE_PAGE_URL).catch(() => {});
    return;
  }
  if (checking || downloading) return;
  checking = true;
  try {
    const releases = await fetchReleases();
    writePrefs({ lastCheck: Date.now() });
    const update = findUpdate(releases, app.getVersion(), process.platform, process.arch);
    if (!update) {
      if (manual) {
        await showMessage({
          type: 'info',
          title: 'MaliPDF',
          message: 'MaliPDF is up to date.',
          detail: `You have version ${app.getVersion()}, the newest available.`,
          buttons: ['OK'],
        });
      }
      return;
    }
    if (!manual && readPrefs().skippedVersion === update.version) return;
    await offerUpdate(update);
  } catch (error) {
    if (manual) {
      await showMessage({
        type: 'warning',
        title: 'MaliPDF',
        message: 'Could not check for updates.',
        detail: `${error instanceof Error ? error.message : String(error)}\n\nCheck your internet connection or visit ${RELEASES_PAGE_URL}.`,
        buttons: ['OK'],
      });
    } else {
      console.warn('Automatic update check failed:', error);
    }
  } finally {
    checking = false;
  }
}

async function offerUpdate(update: AvailableUpdate): Promise<void> {
  const prefs = readPrefs();
  const canDownload = update.asset !== null && isTrustedDownloadUrl(update.asset.browser_download_url);
  const buttons = canDownload
    ? ['Download and Install', 'Release Notes', 'Skip This Version', 'Later']
    : ['Open Download Page', 'Skip This Version', 'Later'];
  const { response, checkboxChecked } = await showMessage({
    type: 'info',
    title: 'Update Available',
    message: `${update.title} is available.`,
    detail: `You have version ${app.getVersion()}.\n\nWhat's new:\n${update.notes}`,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    checkboxLabel: 'Check for updates automatically',
    checkboxChecked: prefs.autoCheck,
  });
  writePrefs({ autoCheck: checkboxChecked });

  const choice = buttons[response];
  if (choice === 'Download and Install') await downloadAndOpen(update);
  else if (choice === 'Release Notes' || choice === 'Open Download Page') await shell.openExternal(update.pageUrl);
  else if (choice === 'Skip This Version') writePrefs({ skippedVersion: update.version });
}

async function downloadAndOpen(update: AvailableUpdate): Promise<void> {
  const asset = update.asset!;
  const window = parentWindow();
  downloading = true;
  const target = path.join(app.getPath('downloads'), asset.name.replace(/(\.[a-z]+)$/i, `-${update.version}$1`));
  const partial = `${target}.download`;
  try {
    const response = await net.fetch(asset.browser_download_url);
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
    const total = Number(response.headers.get('content-length')) || asset.size || 0;
    const out = fs.createWriteStream(partial);
    const reader = response.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
      if (total > 0) window?.setProgressBar(received / total);
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    if (asset.size && received !== asset.size) throw new Error('The download was incomplete.');
    await fs.promises.rename(partial, target);
    window?.setProgressBar(-1);

    const isMac = process.platform === 'darwin';
    const { response: after } = await showMessage({
      type: 'info',
      title: 'Update Downloaded',
      message: `MaliPDF ${update.version} was downloaded.`,
      detail: isMac
        ? 'The installer will open. Quit MaliPDF, then drag MaliPDF into the Applications folder and replace the old version.'
        : 'The installer will start. MaliPDF will close so the update can be installed. Save your work first.',
      buttons: ['Install Now', 'Show in Folder', 'Later'],
      defaultId: 0,
      cancelId: 2,
    });
    if (after === 0) {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      if (!isMac) app.quit(); // normal quit: the renderer still asks about unsaved documents
    } else if (after === 1) {
      shell.showItemInFolder(target);
    }
  } catch (error) {
    window?.setProgressBar(-1);
    await fs.promises.unlink(partial).catch(() => {});
    await showMessage({
      type: 'warning',
      title: 'MaliPDF',
      message: 'The update could not be downloaded.',
      detail: `${error instanceof Error ? error.message : String(error)}\n\nYou can download it manually from ${update.pageUrl}.`,
      buttons: ['OK'],
    });
  } finally {
    downloading = false;
  }
}

export function setupUpdates(isDev: boolean): void {
  handleTrusted('updates:check', isDev, async () => {
    await checkForUpdates(true);
    return true;
  });
  if (isDev || isStoreInstall()) return; // never nag during development; the Store updates Store installs
  app.whenReady().then(() => {
    setTimeout(() => {
      const prefs = readPrefs();
      if (prefs.autoCheck && Date.now() - prefs.lastCheck > AUTO_CHECK_INTERVAL_MS) void checkForUpdates(false);
    }, AUTO_CHECK_DELAY_MS);
  });
}
