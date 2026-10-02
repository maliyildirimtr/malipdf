import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '1.0.1', isPackaged: false, getAppPath: () => '/tmp' },
  BrowserWindow: { fromWebContents: () => null },
  clipboard: { writeText: () => {} },
  shell: { openExternal: async () => {} },
  crashReporter: { start: () => {} },
  dialog: {},
}));
vi.mock('../security', () => ({ handleTrusted: () => {} }));
vi.mock('../i18n/mainLanguage', () => ({ showMessageBox: async () => ({ response: 2 }) }));

const { buildReport, parseCrashLog, scrub } = await import('../services/crashReport');

describe('crash reports', () => {
  it('reads JSON lines and skips broken ones', () => {
    expect(parseCrashLog('{"kind":"a"}\nnot json\n\n{"kind":"b"}\n').map((e) => e.kind)).toEqual(['a', 'b']);
  });

  it('removes the user name from paths', () => {
    expect(scrub('at /Users/mehmet/Documents/x.pdf', '/Users/mehmet')).toBe('at ~/Documents/x.pdf');
    expect(scrub('open /Users/someone/file', '/home/other')).toBe('open /Users/~/file');
  });

  it('builds a short report with the latest entries', () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({ time: `t${i}`, kind: 'renderer-gone', reason: 'crashed', stack: `Error\n at /Users/me/app.js:${i}` }));
    const report = buildReport(entries, '/Users/me');
    expect(report.title).toContain('renderer-gone');
    expect(report.body).toContain('MaliPDF 1.0.1');
    expect(report.body).not.toContain('t0');
    expect(report.body).toContain('t7');
    expect(report.body).not.toContain('/Users/me/');
    expect(report.body.length).toBeLessThanOrEqual(6000);
  });

  it('puts the user\'s note first, without their user name', () => {
    const report = buildReport([], '/Users/me', 'Kalemle yazarken kapandı /Users/me/x.pdf');
    expect(report.body.startsWith('What happened?\nKalemle yazarken kapandı ~/x.pdf')).toBe(true);
    expect(report.title).toBe('MaliPDF problem report (1.0.1)');
  });
});

describe('e-mail report', () => {
  it('opens a mail to the support address with the report', async () => {
    const { reportMailto, SUPPORT_EMAIL } = await import('../services/crashReport');
    const link = reportMailto({ title: 'Crash report: renderer-gone (1.0.1)', body: 'Satır 1\nŞ & ? =' + 'x'.repeat(3000) });
    expect(SUPPORT_EMAIL).toBe('mali@maliyildirimtr.com');
    expect(link.startsWith('mailto:mali@maliyildirimtr.com?subject=Crash%20report')).toBe(true);
    const body = decodeURIComponent(link.split('&body=')[1]);
    expect(body.startsWith('Satır 1\nŞ & ? =')).toBe(true);
    expect(body.length).toBeLessThanOrEqual(1800);
  });
});

describe('gmail fallback', () => {
  it('fills in the address, subject and body', async () => {
    const { gmailComposeUrl } = await import('../services/crashReport');
    const url = new URL(gmailComposeUrl({ title: 'T', body: 'B' }));
    expect(url.hostname).toBe('mail.google.com');
    expect(url.searchParams.get('to')).toBe('mali@maliyildirimtr.com');
    expect(url.searchParams.get('su')).toBe('T');
    expect(url.searchParams.get('body')).toBe('B');
  });
});
