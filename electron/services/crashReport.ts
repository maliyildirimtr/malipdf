/**
 * Sending crash reports — without a server.
 *
 * Crashes are logged locally (appInfo.logCrash). After a crash, the next start
 * asks whether to report it; "Report a Problem…" in the Help menu does the
 * same at any time (an in-app dialog, ProblemReportDialog). A report opens
 * a ready e-mail to SUPPORT_EMAIL in the user's mail app (or Gmail in the
 * browser when there is no mail app); the user sees it and sends it. It can
 * also be copied to the clipboard. Nothing is sent without the user doing so. Documents
 * are never included; home-folder paths are shortened to "~".
 */
import { app, clipboard, shell, type BrowserWindow } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleTrusted } from '../security';
import { getBuildInfo, logCrash } from './appInfo';

/** Where e-mailed problem reports go. Change it here (one place). */
export const SUPPORT_EMAIL = 'mali@maliyildirimtr.com';
/** Mail apps cut long mailto: links; keep the e-mail body shorter than the GitHub one. */
const MAX_MAIL_BODY = 1800;
const MAX_BODY = 6000;
const MAX_ENTRIES = 5;

function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}
const crashLog = () => path.join(logsDir(), 'crash.log');
const offeredFile = () => path.join(logsDir(), 'reported.json');

export interface CrashEntry { time?: string; kind?: string; [key: string]: unknown }

/** Crash log lines (JSON per line); bad lines are skipped. */
export function parseCrashLog(text: string): CrashEntry[] {
  return text.split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line);
      return value && typeof value === 'object' ? [value as CrashEntry] : [];
    } catch {
      return [];
    }
  });
}

/** Paths under the home folder become "~/…" so the report does not carry the user name. */
export function scrub(text: string, home = os.homedir()): string {
  let out = text;
  if (home && home.length > 1) out = out.split(home).join('~');
  return out.replace(/\/Users\/[^/\s"]+/g, '/Users/~').replace(/C:\\\\?Users\\\\?[^\\\s"]+/gi, 'C:\\Users\\~');
}

export function buildReport(entries: readonly CrashEntry[], home = os.homedir(), note = ''): { title: string; body: string } {
  const info = getBuildInfo();
  const recent = entries.slice(-MAX_ENTRIES);
  const lines = [
    'What happened?',
    note.trim() ? scrub(note.trim().slice(0, 1000), home) : '(not described)',
    '',
    'Details',
    `- MaliPDF ${info.version} (build ${info.build}, ${info.commit})`,
    `- ${process.platform} ${os.release()} ${process.arch} · Electron ${process.versions.electron}`,
    '',
  ];
  if (recent.length) {
    lines.push('Error log (latest)', '----');
    for (const entry of recent) {
      const { stack, ...rest } = entry;
      lines.push(scrub(JSON.stringify(rest), home));
      if (typeof stack === 'string') lines.push(scrub(stack.split('\n').slice(0, 8).join('\n'), home));
    }
  }
  let body = lines.join('\n');
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 4)}\n…`;
  const kind = recent.length ? String(recent[recent.length - 1].kind ?? 'crash') : 'problem';
  return { title: recent.length ? `MaliPDF problem report: ${kind} (${info.version})` : `MaliPDF problem report (${info.version})`, body };
}

function readEntries(fromByte = 0): { entries: CrashEntry[]; size: number } {
  try {
    const bytes = fs.readFileSync(crashLog());
    const start = fromByte > 0 && fromByte <= bytes.length ? fromByte : 0;
    return { entries: parseCrashLog(bytes.subarray(start).toString('utf8')), size: bytes.length };
  } catch {
    return { entries: [], size: 0 };
  }
}

/** Kinds that mean the app (or a window) actually went down. */
const CRASH_KINDS = new Set(['main-uncaught-exception', 'renderer-gone', 'child-process-gone']);

function offeredSize(): number {
  try {
    const value = JSON.parse(fs.readFileSync(offeredFile(), 'utf8'));
    return typeof value.size === 'number' ? value.size : 0;
  } catch {
    return 0;
  }
}

function markOffered(size: number): void {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.writeFileSync(offeredFile(), JSON.stringify({ size }));
  } catch {
    // Not critical.
  }
}

/** mailto: link with the report as subject and body. */
export function reportMailto(report: { title: string; body: string }): string {
  const body = report.body.length > MAX_MAIL_BODY ? `${report.body.slice(0, MAX_MAIL_BODY - 2)}\n…` : report.body;
  // encodeURIComponent, not URLSearchParams: mail apps expect %20, not "+".
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(report.title)}&body=${encodeURIComponent(body)}`;
}

/** Gmail's web compose page, for people without a mail app. */
export function gmailComposeUrl(report: { title: string; body: string }): string {
  const body = report.body.length > MAX_MAIL_BODY ? `${report.body.slice(0, MAX_MAIL_BODY - 2)}\n…` : report.body;
  return `https://mail.google.com/mail/?${new URLSearchParams({ view: 'cm', fs: '1', to: SUPPORT_EMAIL, su: report.title, body }).toString()}`;
}

/** Whether a mail app handles mailto: links here. */
function hasMailApp(): boolean {
  try {
    return app.getApplicationNameForProtocol('mailto:').trim() !== '';
  } catch {
    return true; // unknown: just try
  }
}

/** Crash entries the startup prompt is about (kept until the dialog asks for them). */
let pendingEntries: CrashEntry[] | null = null;

function reportFor(afterCrash: boolean, note: string): { title: string; body: string } {
  const entries = afterCrash && pendingEntries ? pendingEntries : readEntries().entries;
  return buildReport(entries, os.homedir(), note);
}

/** At startup: ask the window to show the report dialog for crashes logged since the last offer. */
export async function offerPendingCrashReport(window: BrowserWindow | null): Promise<void> {
  const offered = offeredSize();
  const all = readEntries();
  // The log restarts past 1 MB; then everything in it is new.
  const fresh = all.size < offered ? all.entries : readEntries(offered).entries;
  markOffered(all.size);
  if (!fresh.some((entry) => CRASH_KINDS.has(String(entry.kind)))) return;
  pendingEntries = fresh;
  window?.webContents.send('app:showProblemReport', { afterCrash: true });
}

const noteOf = (raw: unknown) => (typeof raw === 'string' ? raw.slice(0, 2000) : '');

/** Renderer errors arrive here (rate-limited) so they appear in reports too. */
let rendererErrors = 0;
export function setupCrashReporting(isDev: boolean): void {
  // The report as it will be sent (shown in the dialog).
  handleTrusted('app:problemReport', isDev, async (_event, rawAfterCrash: unknown, rawNote: unknown) => {
    const report = reportFor(rawAfterCrash === true, noteOf(rawNote));
    return { ...report, to: SUPPORT_EMAIL };
  });
  // Open it as an e-mail. 'noMailApp' → the dialog offers Gmail / copying.
  handleTrusted('app:sendProblemReport', isDev, async (_event, rawAfterCrash: unknown, rawNote: unknown, rawVia: unknown) => {
    const report = reportFor(rawAfterCrash === true, noteOf(rawNote));
    if (rawVia === 'gmail') {
      await shell.openExternal(gmailComposeUrl(report));
      return 'opened';
    }
    if (!hasMailApp()) return 'noMailApp';
    try {
      await shell.openExternal(reportMailto(report));
      return 'opened';
    } catch {
      return 'noMailApp';
    }
  });
  handleTrusted('app:copyProblemReport', isDev, async (_event, rawAfterCrash: unknown, rawNote: unknown) => {
    const report = reportFor(rawAfterCrash === true, noteOf(rawNote));
    clipboard.writeText(`To: ${SUPPORT_EMAIL}\nSubject: ${report.title}\n\n${report.body}`);
    return true;
  });
  handleTrusted('app:logRendererError', isDev, async (_event, raw: unknown) => {
    if (rendererErrors >= 20 || !raw || typeof raw !== 'object') return false;
    rendererErrors++;
    const { message, stack } = raw as { message?: unknown; stack?: unknown };
    logCrash('renderer-error', {
      message: typeof message === 'string' ? message.slice(0, 500) : 'Unknown error',
      stack: typeof stack === 'string' ? stack.slice(0, 2000) : undefined,
    });
    return true;
  });
}
