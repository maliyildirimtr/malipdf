/**
 * Builds a Word (.docx) file from paragraphs and pictures.
 *
 * Only what MaliPDF's conversions need: styled text runs, paragraph spacing /
 * indent / alignment, inline pictures (PNG or JPEG), page breaks and one
 * section per distinct page size. Units are PDF points throughout.
 */
import { createZip, type ZipEntry } from './zip';

export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Font size in points. */
  size?: number;
  font?: string;
  /** Hex colour, e.g. "1a1a2e". */
  color?: string;
}

export type DocxAlign = 'left' | 'center' | 'right' | 'both';

export interface DocxParagraph {
  kind: 'paragraph';
  runs: DocxRun[];
  align?: DocxAlign;
  /** Space above, in points. */
  spaceBefore?: number;
  /** Left indent, in points. */
  indent?: number;
  /** First-line indent (positive) or hanging indent (negative), in points. */
  firstLine?: number;
  pageBreakBefore?: boolean;
}

export interface DocxImage {
  kind: 'image';
  data: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  widthPt: number;
  heightPt: number;
  align?: DocxAlign;
  pageBreakBefore?: boolean;
}

export type DocxBlock = DocxParagraph | DocxImage;

export interface DocxMargins { top: number; right: number; bottom: number; left: number }

export interface DocxSection {
  pageWidthPt: number;
  pageHeightPt: number;
  margins: DocxMargins;
  blocks: DocxBlock[];
}

export interface DocxOptions {
  title?: string;
  /** Default font and size for the Normal style. */
  defaultFont?: string;
  defaultSize?: number;
}

const EMU_PER_PT = 12700;
const twips = (pt: number) => Math.max(0, Math.round(pt * 20));
const halfPoints = (pt: number) => Math.max(2, Math.round(pt * 2));

/** XML text: escaped, without characters XML 1.0 does not allow. */
export function xmlText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function runXml(run: DocxRun): string {
  const props = [
    run.font ? `<w:rFonts w:ascii="${xmlText(run.font)}" w:hAnsi="${xmlText(run.font)}" w:cs="${xmlText(run.font)}"/>` : '',
    run.bold ? '<w:b/>' : '',
    run.italic ? '<w:i/>' : '',
    run.color ? `<w:color w:val="${run.color.replace(/[^0-9a-f]/gi, '').slice(0, 6)}"/>` : '',
    run.size ? `<w:sz w:val="${halfPoints(run.size)}"/><w:szCs w:val="${halfPoints(run.size)}"/>` : '',
  ].join('');
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  // Tabs and line breaks become their own elements.
  const parts = run.text.split(/(\t|\n)/);
  const content = parts.map((part) => {
    if (part === '\t') return '<w:tab/>';
    if (part === '\n') return '<w:br/>';
    if (!part) return '';
    return `<w:t xml:space="preserve">${xmlText(part)}</w:t>`;
  }).join('');
  return `<w:r>${rPr}${content}</w:r>`;
}

function sectionXml(section: DocxSection): string {
  const w = twips(section.pageWidthPt);
  const h = twips(section.pageHeightPt);
  const m = section.margins;
  const orient = w > h ? ' w:orient="landscape"' : '';
  return `<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"${orient}/>`
    + `<w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
}

function paragraphProps(block: DocxBlock, sectPr: string): string {
  const parts: string[] = [];
  if (block.pageBreakBefore) parts.push('<w:pageBreakBefore/>');
  if (block.kind === 'paragraph') {
    if (block.spaceBefore) parts.push(`<w:spacing w:before="${twips(block.spaceBefore)}"/>`);
    if (block.indent || block.firstLine) {
      const first = block.firstLine ?? 0;
      parts.push(`<w:ind w:left="${twips(block.indent ?? 0)}"${first > 0 ? ` w:firstLine="${twips(first)}"` : first < 0 ? ` w:hanging="${twips(-first)}"` : ''}/>`);
    }
  } else {
    // Pictures: no spacing, so a full-page picture fits on its page.
    parts.push('<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>');
  }
  if (block.align && block.align !== 'left') parts.push(`<w:jc w:val="${block.align}"/>`);
  parts.push(sectPr);
  const inner = parts.join('');
  return inner ? `<w:pPr>${inner}</w:pPr>` : '';
}

/** Build the .docx bytes. */
export function buildDocx(sections: readonly DocxSection[], options: DocxOptions = {}): Uint8Array {
  if (sections.length === 0) throw new Error('Nothing to write.');
  const media: ZipEntry[] = [];
  const rels: string[] = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  ];
  let pictureId = 0;

  const imageXml = (image: DocxImage): string => {
    pictureId++;
    const ext = image.mimeType === 'image/png' ? 'png' : 'jpeg';
    const file = `image${pictureId}.${ext}`;
    const relId = `rIdImg${pictureId}`;
    media.push({ name: `word/media/${file}`, data: image.data });
    rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/>`);
    const cx = Math.max(1, Math.round(image.widthPt * EMU_PER_PT));
    const cy = Math.max(1, Math.round(image.heightPt * EMU_PER_PT));
    return '<w:r><w:drawing>'
      + `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
      + `<wp:docPr id="${pictureId}" name="Picture ${pictureId}"/>`
      + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + `<pic:nvPicPr><pic:cNvPr id="${pictureId}" name="${file}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
      + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  };

  const body: string[] = [];
  sections.forEach((section, sectionIndex) => {
    const isLast = sectionIndex === sections.length - 1;
    const blocks = section.blocks.length ? section.blocks : [{ kind: 'paragraph', runs: [] } as DocxParagraph];
    blocks.forEach((block, blockIndex) => {
      // A section's properties sit in its last paragraph (except the final
      // section, whose properties close the body).
      const sectPr = !isLast && blockIndex === blocks.length - 1 ? sectionXml(section) : '';
      const pPr = paragraphProps(block, sectPr);
      const content = block.kind === 'image' ? imageXml(block) : block.runs.map(runXml).join('');
      body.push(`<w:p>${pPr}${content}</w:p>`);
    });
  });
  body.push(sectionXml(sections[sections.length - 1]));

  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<w:body>${body.join('')}</w:body></w:document>`;

  const font = xmlText(options.defaultFont ?? 'Calibri');
  const size = halfPoints(options.defaultSize ?? 11);
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>`
    + `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '</w:styles>';

  const hasPng = media.some((m) => m.name.endsWith('.png'));
  const hasJpeg = media.some((m) => m.name.endsWith('.jpeg'));
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + (hasPng ? '<Default Extension="png" ContentType="image/png"/>' : '')
    + (hasJpeg ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : '')
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '</Types>';

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '</Relationships>';

  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + (options.title ? `<dc:title>${xmlText(options.title)}</dc:title>` : '')
    + '<dc:creator>MaliPDF</dc:creator></cp:coreProperties>';

  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;

  return createZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: documentRels },
    ...media,
  ]);
}
