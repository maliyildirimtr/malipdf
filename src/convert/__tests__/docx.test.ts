import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'fs';
import { crc32, createZip } from '../zip';
import { buildDocx, xmlText } from '../docx';
import { groupLines, linesToParagraphs, type PositionedRun } from '../textToParagraphs';

const PAGE = { marginLeft: 72, marginRight: 72, marginTop: 72, pageWidth: 595, pageHeight: 842 };

/** Read entry names and contents back from a stored ZIP. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    expect(crc32(data)).toBe(view.getUint32(at + 14, true));
    out.set(name, data);
    at += 30 + nameLength + size;
  }
  return out;
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('stores entries that can be read back', () => {
    const zip = createZip([{ name: 'a.txt', data: 'hello' }, { name: 'ğüş/b.bin', data: new Uint8Array([1, 2, 3]) }]);
    const files = unzip(zip);
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('hello');
    expect([...files.get('ğüş/b.bin')!]).toEqual([1, 2, 3]);
  });
});

describe('docx', () => {
  it('escapes XML and drops control characters', () => {
    expect(xmlText('a < b & "c" \u0001')).toBe('a &lt; b &amp; &quot;c&quot; ');
  });

  it('writes paragraphs, pictures and sections', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const bytes = buildDocx([
      { pageWidthPt: 595, pageHeightPt: 842, margins: { top: 72, right: 72, bottom: 72, left: 72 }, blocks: [
        { kind: 'paragraph', runs: [{ text: 'Başlık', bold: true, size: 18, font: 'Arial' }], align: 'center' },
        { kind: 'paragraph', runs: [{ text: 'İkinci\tsatır' }], spaceBefore: 12, indent: 20, firstLine: -10 },
      ] },
      { pageWidthPt: 842, pageHeightPt: 595, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [
        { kind: 'image', data: png, mimeType: 'image/png', widthPt: 842, heightPt: 595, pageBreakBefore: true },
      ] },
    ], { title: 'Deneme' });
    const files = unzip(bytes);
    expect([...files.keys()]).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'word/media/image1.png']));
    const xml = new TextDecoder().decode(files.get('word/document.xml'));
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:sz w:val="36"/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:tab/>');
    expect(xml).toContain('w:hanging="200"');
    expect(xml).toContain('w:orient="landscape"');
    // The first section's properties close its last paragraph.
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(new TextDecoder().decode(files.get('word/_rels/document.xml.rels'))).toContain('media/image1.png');
    if (process.env.DOCX_OUT) writeFileSync(process.env.DOCX_OUT, bytes);
  });
});

const run = (text: string, x: number, y: number, size = 12, extra: Partial<PositionedRun> = {}): PositionedRun =>
  ({ text, x, y, width: text.length * size * 0.5, size, ...extra });

describe('text to paragraphs', () => {
  it('joins runs on one baseline into a line, with spaces at gaps', () => {
    const lines = groupLines([run('Hello', 72, 700), run('world', 72 + 5 * 6 + 4, 700), run('Next', 72, 680)]);
    expect(lines).toHaveLength(2);
    const [p] = linesToParagraphs(lines.slice(0, 1), PAGE);
    expect(p.runs.map((r) => r.text).join('')).toBe('Hello world');
  });

  it('makes one paragraph of a wrapped block and joins hyphenated words', () => {
    const full = 'x'.repeat(75);
    const lines = groupLines([
      run(`${full} bilgisa-`, 72, 700),
      run(`yar ${full}`, 72, 685.6),
      run('son satır.', 72, 671.2),
      run('Yeni paragraf', 72, 640),
    ]);
    const paragraphs = linesToParagraphs(lines, PAGE);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].runs[0].text).toContain('bilgisayar');
    expect(paragraphs[1].spaceBefore).toBeGreaterThan(5);
  });

  it('keeps styles as separate runs and detects centred titles', () => {
    const lines = groupLines([
      run('Başlık', 270, 760, 18, { bold: true }),
      run('Normal ', 72, 700), run('kalın', 114, 700, 12, { bold: true }),
    ]);
    const [title, body] = linesToParagraphs(lines, PAGE);
    expect(title.align).toBe('center');
    expect(title.runs[0]).toMatchObject({ bold: true, size: 18 });
    expect(body.runs.map((r) => !!r.bold)).toEqual([false, true]);
  });

  it('starts a new paragraph after a short line', () => {
    const full = 'y'.repeat(80);
    const lines = groupLines([run('Kısa satır.', 72, 700), run(full, 72, 685.6)]);
    expect(linesToParagraphs(lines, PAGE)).toHaveLength(2);
  });
});

describe('lists', () => {
  it('starts a paragraph at each bullet and shows symbol bullets as •', () => {
    const lines = groupLines([
      run('', 90, 700), run('Birinci madde', 108, 700),
      run('', 90, 685.6), run('İkinci madde', 108, 685.6),
      run('1. Numaralı', 90, 671.2),
    ]);
    const paragraphs = linesToParagraphs(lines, PAGE);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].runs.map((r) => r.text).join('')).toBe('• Birinci madde');
  });
});
