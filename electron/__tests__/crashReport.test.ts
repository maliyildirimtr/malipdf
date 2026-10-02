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
});
