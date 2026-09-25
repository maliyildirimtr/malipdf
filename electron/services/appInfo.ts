/**
 * About MaliPDF, version/build number and local crash reports.
 *
 * Crash reports stay on this computer (there is no upload server): native
 * minidumps go to app.getPath('crashDumps') and a readable log to
 * <userData>/logs/crash.log. "Help ▸ Show Crash Reports" opens that folder.
 */
import { app, BrowserWindow, crashReporter, dialog, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { handleTrusted } from '../security';

export interface BuildInfo {
  version: string;
  build: string;
  commit: string;
  date: string;
}

let cachedBuildInfo: BuildInfo | null = null;

export function getBuildInfo(): BuildInfo {
  if (cachedBuildInfo) return cachedBuildInfo;
  let info: Partial<BuildInfo> = {};
  try {
    info = JSON.parse(fs.readFileSync(path.join(__dirname, 'buildInfo.json'), 'utf8'));
  } catch {
    // Development build without generated build info.
  }
  cachedBuildInfo = {
    version: app.getVersion(),
    build: String(info.build ?? 'dev'),
    commit: String(info.commit ?? 'local'),
    date: String(info.date ?? ''),
  };
  return cachedBuildInfo;
}

function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

export function logCrash(kind: string, details: Record<string, unknown>): void {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    const { version, build } = getBuildInfo();
    const line = JSON.stringify({ time: new Date().toISOString(), kind, version, build, platform: process.platform, ...details });
    const file = path.join(logsDir(), 'crash.log');
    // Keep the log small: start over past 1 MB.
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size > 1024 * 1024) fs.writeFileSync(file, '');
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    // Logging must never crash the app.
  }
}

function aboutDetail(): string {
  const info = getBuildInfo();
  return [
    `Version ${info.version} (build ${info.build})`,
    `Commit ${info.commit}${info.date ? ` · ${info.date.slice(0, 10)}` : ''}`,
    '',
    `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    `${process.platform} ${process.arch}`,
    '',
    'Fonts: Liberation (SIL Open Font License).',
  ].join('\n');
}

export async function showAbout(): Promise<void> {
  if (process.platform === 'darwin') {
    app.showAboutPanel();
    return;
  }
  const window = BrowserWindow.getFocusedWindow() ?? undefined;
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: 'About MaliPDF',
    message: 'MaliPDF',
    detail: aboutDetail(),
    buttons: ['OK'],
  };
  await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
}

export function setupAppInfo(isDev: boolean): void {
  const info = getBuildInfo();
  crashReporter.start({ productName: 'MaliPDF', uploadToServer: false, compress: true });

  app.setAboutPanelOptions({
    applicationName: 'MaliPDF',
    applicationVersion: info.version,
    version: `Build ${info.build} · ${info.commit}`,
    copyright: `© ${new Date().getFullYear()} Mehmet Ali Yıldırım`,
    credits: 'Professional PDF annotation & document workspace.',
  });

  process.on('uncaughtException', (error) => {
    logCrash('main-uncaught-exception', { message: error.message, stack: error.stack });
    console.error(error);
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') logCrash('child-process-gone', { ...details });
  });

  handleTrusted('app:showAbout', isDev, async () => {
    await showAbout();
    return true;
  });
  handleTrusted('app:openCrashReports', isDev, async () => {
    fs.mkdirSync(logsDir(), { recursive: true });
    const error = await shell.openPath(logsDir());
    return error === '';
  });
  handleTrusted('app:getBuildInfo', isDev, () => getBuildInfo());
}
