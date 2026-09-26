import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeStampText, stampSizePt, STAMP_PRESETS } from '../stamps';
import { findInkBounds } from '../../utils/signaturePad';
import { useUIStore, SIGNATURES_MAX } from '../../store/uiStore';
import { printScale, PRINT_DPI, PRINT_MAX_PIXELS } from '../../commands/printCommands';
import { pdfPathsFromArgv } from '../../../electron/services/openPaths';

describe('stamps', () => {
  it('uppercases with Turkish rules and limits the length', () => {
    expect(normalizeStampText('  onay  verildi ')).toBe('ONAY VERİLDİ');
    expect(normalizeStampText('x'.repeat(100))).toHaveLength(40);
    expect(STAMP_PRESETS.every((p) => normalizeStampText(p.text) === p.text)).toBe(true);
  });

  it('keeps the aspect ratio at a fixed height', () => {
    expect(stampSizePt(400, 100, false)).toEqual({ width: 136, height: 34 });
    expect(stampSizePt(400, 200, true)).toEqual({ width: 96, height: 48 });
  });
});

describe('signature pad', () => {
  it('finds the ink bounding box', () => {
    const ink = new Set(['3,2', '7,5']);
    expect(findInkBounds((x, y) => (ink.has(`${x},${y}`) ? 255 : 0), 10, 10)).toEqual({ x: 3, y: 2, width: 5, height: 4 });
    expect(findInkBounds(() => 0, 10, 10)).toBeNull();
  });
});

describe('saved signatures', () => {
  beforeEach(() => useUIStore.setState({ signatures: [] }));
  const png = 'data:image/png;base64,iVBORw0KGgo=';

  it('keeps the newest few and rejects anything that is not a PNG', () => {
    for (let i = 0; i < SIGNATURES_MAX + 2; i++) expect(useUIStore.getState().addSignature(png)).toBeTruthy();
    expect(useUIStore.getState().signatures).toHaveLength(SIGNATURES_MAX);
    expect(useUIStore.getState().addSignature('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(useUIStore.getState().addSignature('javascript:alert(1)')).toBeNull();
    const id = useUIStore.getState().signatures[0].id;
    useUIStore.getState().removeSignature(id);
    expect(useUIStore.getState().signatures.some((s) => s.id === id)).toBe(false);
  });
});

describe('print', () => {
  it('renders at print resolution but caps huge pages', () => {
    expect(printScale(612, 792)).toBeCloseTo(PRINT_DPI / 72);
    const s = printScale(5000, 5000);
    expect(5000 * s * 5000 * s).toBeLessThanOrEqual(PRINT_MAX_PIXELS + 1);
  });
});

describe('opening files from the command line', () => {
  it('keeps only PDF paths and resolves them', () => {
    expect(pdfPathsFromArgv(['--inspect', 'a.pdf', 'notes.txt', '/x/B.PDF', '.'], '/home/u')).toEqual(['/home/u/a.pdf', '/x/B.PDF']);
  });
});
