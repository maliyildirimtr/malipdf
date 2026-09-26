/**
 * Formula tool: LaTeX → typeset math (KaTeX, works offline) → PNG image
 * annotation. The LaTeX source is kept on the annotation, so a double-click
 * opens it again for editing.
 *
 * KaTeX (npm package `katex`, MIT) lays out HTML. To turn it into an image
 * the HTML is put inside an
 * SVG <foreignObject> together with KaTeX's CSS and fonts (as data URLs),
 * drawn onto a canvas at high resolution and saved as PNG.
 */
import katex from 'katex';
import katexCss from 'katex/dist/katex.min.css?raw';

export interface FormulaStyle {
  /** Text size in PDF points. */
  size: number;
  color: string;
}

export interface RenderedFormula {
  png: Uint8Array;
  /** Size on the page in PDF points. */
  width: number;
  height: number;
}

/** Pixels per PDF point in the PNG (4× keeps it sharp when zoomed in or printed). */
const RASTER_SCALE = 4;
const PADDING_PT = 4;

// In a build these are data: URLs already (vite.config.ts inlines .woff2);
// in development they are URLs and get fetched once.
const fontLoaders = import.meta.glob('../../node_modules/katex/dist/fonts/*.woff2', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;

async function asDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:font/woff2;base64,${btoa(binary)}`;
}

let cssPromise: Promise<string> | null = null;

/** KaTeX CSS with every font inlined (only the woff2 files are bundled). */
export function formulaCss(): Promise<string> {
  cssPromise ??= (async () => {
    const fonts = new Map<string, string>();
    await Promise.all(Object.entries(fontLoaders).map(async ([path, load]) => {
      fonts.set(path.split('/').pop()!.replace(/\.woff2$/, ''), await asDataUrl(await load()));
    }));
    return katexCss.replace(/src:url\(fonts\/([^)]+)\.woff2\)[^;}]*/g, (_match, name: string) => {
      const data = fonts.get(name);
      return data ? `src:url(${data}) format("woff2")` : 'src:local("serif")';
    });
  })();
  return cssPromise;
}

/** Adds KaTeX's CSS to the page once (for the live preview in the dialog). */
export async function ensureFormulaStyles(): Promise<void> {
  if (document.getElementById('malipdf-katex-css')) return;
  const style = document.createElement('style');
  style.id = 'malipdf-katex-css';
  style.textContent = await formulaCss();
  document.head.appendChild(style);
  // Wait for the fonts, so measuring is right the first time.
  await document.fonts?.ready;
}

/** KaTeX HTML for `latex`; throws a readable error when it does not parse. */
export function formulaHtml(latex: string): string {
  const source = latex.trim();
  if (!source) throw new Error('Type a formula first.');
  try {
    return katex.renderToString(source, { displayMode: true, throwOnError: true, output: 'html', strict: 'ignore', trust: false, maxSize: 50, maxExpand: 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/, '') : String(error);
    throw new Error(message);
  }
}

/** Typeset `latex` and draw it into a PNG. */
export async function renderFormula(latex: string, style: FormulaStyle): Promise<RenderedFormula> {
  const html = formulaHtml(latex);
  await ensureFormulaStyles();
  const css = await formulaCss();

  // Measure in the page (1 CSS px = 1 PDF point at this font size).
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;font-size:${style.size}px;color:${style.color};line-height:1.2;white-space:nowrap;`;
  host.innerHTML = html;
  const math = host.firstElementChild as HTMLElement | null;
  if (math) math.style.margin = '0';
  document.body.appendChild(host);
  host.getBoundingClientRect(); // lay out, so the fonts it needs start loading
  await document.fonts?.ready;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const box = (math ?? host).getBoundingClientRect();
  const inner = math?.querySelector('.katex') as HTMLElement | null;
  const innerBox = inner?.getBoundingClientRect() ?? box;
  const width = Math.ceil(innerBox.width + PADDING_PT * 2 + 1);
  const height = Math.ceil(box.height + PADDING_PT * 2);
  const content = new XMLSerializer().serializeToString(inner ?? host);
  host.remove();
  if (!(width > 0 && height > 0)) throw new Error('The formula came out empty.');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * RASTER_SCALE}" height="${height * RASTER_SCALE}" viewBox="0 0 ${width} ${height}">`
    + `<style>${css.replace(/</g, '\\3c ')}</style>`
    + `<foreignObject x="0" y="0" width="${width}" height="${height}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="padding:${PADDING_PT}px;font-size:${style.size}px;color:${style.color};line-height:1.2;white-space:nowrap;display:flex;align-items:center;height:${height - PADDING_PT * 2}px">${content}</div>`
    + '</foreignObject></svg>';

  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  // Fonts inside an SVG image load after the image itself: give them a moment.
  await new Promise((resolve) => setTimeout(resolve, 250));

  const canvas = document.createElement('canvas');
  canvas.width = width * RASTER_SCALE;
  canvas.height = height * RASTER_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the formula.');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not draw the formula.');
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/** Common building blocks for the dialog's quick-insert buttons. */
export const FORMULA_SNIPPETS: readonly { label: string; insert: string; title: string }[] = [
  { label: 'a/b', insert: '\\frac{a}{b}', title: 'Fraction' },
  { label: 'x²', insert: '^{2}', title: 'Power' },
  { label: 'xₙ', insert: '_{n}', title: 'Subscript' },
  { label: '√', insert: '\\sqrt{x}', title: 'Square root' },
  { label: 'Σ', insert: '\\sum_{i=1}^{n}', title: 'Sum' },
  { label: '∫', insert: '\\int_{a}^{b}', title: 'Integral' },
  { label: 'lim', insert: '\\lim_{x \\to \\infty}', title: 'Limit' },
  { label: 'Ā', insert: '\\overline{A}', title: 'NOT (overline)' },
  { label: '·', insert: '\\cdot ', title: 'AND (dot)' },
  { label: '⊕', insert: '\\oplus ', title: 'XOR' },
  { label: '→', insert: '\\rightarrow ', title: 'Arrow' },
  { label: '≤', insert: '\\leq ', title: 'Less or equal' },
  { label: '≠', insert: '\\neq ', title: 'Not equal' },
  { label: 'α', insert: '\\alpha ', title: 'Alpha' },
  { label: 'π', insert: '\\pi ', title: 'Pi' },
  { label: '[ ]', insert: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', title: 'Matrix' },
];
