/**
 * Notebook covers for New Document creation.
 *
 * Each cover renders both:
 * 1) As a crisp inline preview (SVG / Canvas) in the New Document dialog.
 * 2) As a high-resolution Page 1 cover embedded inside the generated PDF
 *    (with the document title printed cleanly on the cover label plate,
 *    supporting full Unicode / Turkish characters).
 */

export type NotebookCoverCategory = 'recommended' | 'gradient' | 'academic' | 'minimal';

export interface NotebookCoverDef {
  id: string;
  label: string;
  category: NotebookCoverCategory;
  /** Primary & secondary colors for gradients / patterns. */
  colors: readonly [string, string, ...string[]];
  pattern: 'gradient' | 'bands' | 'bauhaus' | 'blueprint' | 'nordic' | 'composition' | 'framed';
  /** Whether text on the cover should be light or dark. */
  darkText?: boolean;
  /** Shows a crisp white/cream title label card on the cover. */
  hasLabelPlate?: boolean;
}

export const NOTEBOOK_COVERS: readonly NotebookCoverDef[] = [
  // ── Recommended ──
  {
    id: 'sapphire',
    label: 'MaliPDF Blue',
    category: 'recommended',
    colors: ['#0f2d56', '#1d5d9f', '#3b82d6'],
    pattern: 'framed',
    hasLabelPlate: true,
  },
  {
    id: 'peach-glow',
    label: 'Peach Glow',
    category: 'recommended',
    colors: ['#fde1b4', '#f8a58c', '#ef798a'],
    pattern: 'gradient',
    darkText: true,
  },
  {
    id: 'golden-sun',
    label: 'Golden Sun',
    category: 'recommended',
    colors: ['#ffe033', '#f5b700', '#e59500'],
    pattern: 'gradient',
    darkText: true,
  },
  {
    id: 'berry-wave',
    label: 'Berry Horizon',
    category: 'recommended',
    colors: ['#e11d74', '#b41b6a', '#861965', '#581c5f', '#36194f'],
    pattern: 'bands',
  },

  // ── Gradient ──
  {
    id: 'mint-breeze',
    label: 'Mint Breeze',
    category: 'gradient',
    colors: ['#2dd4bf', '#10b981', '#047857'],
    pattern: 'gradient',
  },
  {
    id: 'ocean-mist',
    label: 'Ocean Mist',
    category: 'gradient',
    colors: ['#38bdf8', '#2563eb', '#1e3a8a'],
    pattern: 'gradient',
  },
  {
    id: 'violet-dusk',
    label: 'Violet Dusk',
    category: 'gradient',
    colors: ['#a78bfa', '#6d28d9', '#3b0764'],
    pattern: 'gradient',
  },
  {
    id: 'butter-cream',
    label: 'Warm Cream',
    category: 'gradient',
    colors: ['#fef9c3', '#f5e6c8', '#e7cfa6'],
    pattern: 'gradient',
    darkText: true,
  },

  // ── Academic & Patterned ──
  {
    id: 'bauhaus-geo',
    label: 'Bauhaus',
    category: 'academic',
    colors: ['#1fb6aa', '#f28475', '#f7ede2', '#264653'],
    pattern: 'bauhaus',
    hasLabelPlate: true,
  },
  {
    id: 'blueprint-grid',
    label: 'Blueprint',
    category: 'academic',
    colors: ['#0c2d57', '#14427a', '#64a6e8'],
    pattern: 'blueprint',
    hasLabelPlate: true,
  },
  {
    id: 'nordic-dots',
    label: 'Nordic Slate',
    category: 'academic',
    colors: ['#8599ad', '#6b8096', '#e2ebf4'],
    pattern: 'nordic',
    hasLabelPlate: true,
  },
  {
    id: 'classic-composition',
    label: 'Composition',
    category: 'academic',
    colors: ['#1f242d', '#333b48', '#d1d5db'],
    pattern: 'composition',
    hasLabelPlate: true,
  },

  // ── Minimal ──
  {
    id: 'graphite-matte',
    label: 'Graphite',
    category: 'minimal',
    colors: ['#272b33', '#1c1f26', '#4b5563'],
    pattern: 'framed',
  },
  {
    id: 'forest-leather',
    label: 'Forest',
    category: 'minimal',
    colors: ['#144535', '#0c2f24', '#c9a66b'],
    pattern: 'framed',
  },
  {
    id: 'terracotta-linen',
    label: 'Terracotta',
    category: 'minimal',
    colors: ['#c85a3a', '#9c3f26', '#f7d6c4'],
    pattern: 'framed',
  },
  {
    id: 'ivory-paper',
    label: 'Ivory Linen',
    category: 'minimal',
    colors: ['#f8f5ee', '#ede7da', '#1d5d9f'],
    pattern: 'framed',
    darkText: true,
  },
];

export const COVER_CATEGORIES: ReadonlyArray<{ id: NotebookCoverCategory; label: string }> = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'academic', label: 'Academic' },
  { id: 'minimal', label: 'Minimal' },
];

export function getNotebookCover(id: string | null | undefined): NotebookCoverDef | null {
  if (!id || id === 'none') return null;
  return NOTEBOOK_COVERS.find((c) => c.id === id) ?? null;
}

/**
 * Draws a notebook cover onto any 2D canvas context. Used both for crisp UI
 * thumbnails and for embedding a high-resolution Page 1 cover into the PDF.
 */
export function drawNotebookCoverOnCanvas(
  ctx: CanvasRenderingContext2D,
  cover: NotebookCoverDef,
  width: number,
  height: number,
  title?: string,
): void {
  ctx.save();

  // 1. Base background / pattern
  if (cover.pattern === 'gradient' || cover.pattern === 'framed') {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, cover.colors[0]);
    grad.addColorStop(0.55, cover.colors[1]);
    grad.addColorStop(1, cover.colors[2] ?? cover.colors[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (cover.pattern === 'bands') {
    const bandCount = cover.colors.length;
    const bandH = height / bandCount;
    for (let i = 0; i < bandCount; i++) {
      ctx.fillStyle = cover.colors[i];
      ctx.beginPath();
      const y = i * bandH;
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(width * 0.5, y - bandH * 0.14, width, y);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();
    }
  } else if (cover.pattern === 'bauhaus') {
    ctx.fillStyle = cover.colors[0];
    ctx.fillRect(0, 0, width, height);
    const cols = 3;
    const rows = 4;
    const cw = width / cols;
    const ch = height / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw;
        const y = r * ch;
        const idx = (r * 3 + c) % cover.colors.length;
        ctx.fillStyle = cover.colors[idx];
        ctx.fillRect(x, y, cw + 0.5, ch + 0.5);

        ctx.fillStyle = cover.colors[(idx + 1) % cover.colors.length];
        ctx.beginPath();
        if ((r + c) % 3 === 0) {
          ctx.arc(x + cw, y + ch, Math.min(cw, ch) * 0.85, Math.PI, Math.PI * 1.5);
          ctx.lineTo(x + cw, y + ch);
        } else if ((r + c) % 3 === 1) {
          ctx.arc(x + cw * 0.5, y + ch * 0.5, Math.min(cw, ch) * 0.34, 0, Math.PI * 2);
        } else {
          ctx.moveTo(x, y);
          ctx.lineTo(x + cw, y);
          ctx.lineTo(x, y + ch);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  } else if (cover.pattern === 'blueprint') {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, cover.colors[0]);
    grad.addColorStop(1, cover.colors[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    const step = Math.max(8, Math.round(width / 16));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = Math.max(0.6, width / 550);
    for (let x = step; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = step; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    // Blueprint engineering corner frame
    const pad = width * 0.08;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = Math.max(1, width / 320);
    ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2);
  } else if (cover.pattern === 'nordic') {
    ctx.fillStyle = cover.colors[0];
    ctx.fillRect(0, 0, width, height);
    const cols = 5;
    const rows = 7;
    const dx = width / cols;
    const dy = height / rows;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = Math.max(0.8, width / 260);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = (c + 0.5) * dx;
        const cy = (r + 0.5) * dy;
        const rad = Math.min(dx, dy) * 0.16;
        // Vertical hairline
        if (r === 0) {
          ctx.beginPath();
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, height);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
        for (let a = 0; a < 4; a++) {
          const ang = (a * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(cx - Math.cos(ang) * rad, cy - Math.sin(ang) * rad);
          ctx.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
          ctx.stroke();
        }
      }
    }
  } else if (cover.pattern === 'composition') {
    ctx.fillStyle = cover.colors[0];
    ctx.fillRect(0, 0, width, height);
    // Deterministic subtle marble speckles
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const count = Math.min(600, Math.round((width * height) / 380));
    for (let i = 0; i < count; i++) {
      const x = rand() * width;
      const y = rand() * height;
      const r = (0.4 + rand() * 1.4) * (width / 180);
      ctx.fillStyle = rand() > 0.35 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 2. Decorative hairline frame for minimal/framed covers
  if (cover.pattern === 'framed') {
    const pad = width * 0.085;
    ctx.strokeStyle = cover.darkText ? 'rgba(29, 93, 159, 0.28)' : 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = Math.max(1, width / 260);
    ctx.strokeRect(pad + width * 0.04, pad, width - pad * 2 - width * 0.04, height - pad * 2);
  }

  // 3. Left notebook spine binding
  const spineW = width * 0.085;
  const spineGrad = ctx.createLinearGradient(0, 0, spineW * 1.4, 0);
  spineGrad.addColorStop(0, 'rgba(0, 0, 0, 0.32)');
  spineGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.18)');
  spineGrad.addColorStop(0.75, 'rgba(255, 255, 255, 0.16)');
  spineGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = spineGrad;
  ctx.fillRect(0, 0, spineW * 1.4, height);

  // 4. Label plate + optional notebook title
  const cleanTitle = title?.replace(/\.pdf$/i, '').trim() ?? '';
  if (cover.hasLabelPlate) {
    const plateW = width * 0.62;
    const plateH = height * 0.21;
    const plateX = spineW + (width - spineW - plateW) / 2;
    const plateY = height * 0.27;
    const r = Math.max(4, width * 0.025);

    ctx.fillStyle = 'rgba(252, 250, 245, 0.96)';
    ctx.beginPath();
    ctx.roundRect(plateX, plateY, plateW, plateH, r);
    ctx.fill();

    ctx.strokeStyle = 'rgba(15, 23, 42, 0.16)';
    ctx.lineWidth = Math.max(0.8, width / 320);
    ctx.stroke();

    // Subtle ruled lines inside the label plate
    const linePad = plateW * 0.12;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
    ctx.lineWidth = Math.max(0.6, width / 450);
    for (let i = 1; i <= 3; i++) {
      const ly = plateY + (plateH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(plateX + linePad, ly);
      ctx.lineTo(plateX + plateW - linePad, ly);
      ctx.stroke();
    }

    if (cleanTitle && width >= 200) {
      ctx.fillStyle = '#0f172a';
      const fontSize = Math.max(14, Math.round(width * 0.046));
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxW = plateW - linePad * 1.4;
      const shown = cleanTitle.length > 26 ? `${cleanTitle.slice(0, 25)}…` : cleanTitle;
      ctx.fillText(shown, plateX + plateW / 2, plateY + plateH * 0.5, maxW);
    }
  } else if (cleanTitle && width >= 200) {
    ctx.fillStyle = cover.darkText ? 'rgba(15, 23, 42, 0.86)' : 'rgba(255, 255, 255, 0.94)';
    const fontSize = Math.max(16, Math.round(width * 0.056));
    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const shown = cleanTitle.length > 26 ? `${cleanTitle.slice(0, 25)}…` : cleanTitle;
    ctx.fillText(shown, spineW + (width - spineW) / 2, height * 0.36, width * 0.72);
  }

  ctx.restore();
}

/**
 * Renders the cover as a high-resolution PNG byte array for embedding as
 * Page 1 of a generated PDF document. Returns null in non-DOM environments.
 */
export async function renderCoverPngBytes(
  coverId: string,
  title: string,
  widthPt: number,
  heightPt: number,
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;
  const cover = getNotebookCover(coverId);
  if (!cover) return null;

  const scale = Math.min(2.2, 1200 / Math.max(widthPt, heightPt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(200, Math.round(widthPt * scale));
  canvas.height = Math.max(200, Math.round(heightPt * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  drawNotebookCoverOnCanvas(ctx, cover, canvas.width, canvas.height, title);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Renders a user-chosen photo as a high-resolution cover Page 1 (center-cropped
 * to fill the page aspect ratio, with a subtle left notebook spine shadow).
 */
export async function renderCustomPhotoCoverPngBytes(
  imageDataUrl: string,
  widthPt: number,
  heightPt: number,
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || !imageDataUrl) return null;

  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = imageDataUrl;
  });
  if (!img || img.naturalWidth <= 0 || img.naturalHeight <= 0) return null;

  const scale = Math.min(2.2, 1200 / Math.max(widthPt, heightPt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(200, Math.round(widthPt * scale));
  canvas.height = Math.max(200, Math.round(heightPt * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Aspect-fill (object-fit: cover) crop
  const targetRatio = canvas.width / canvas.height;
  const imgRatio = img.naturalWidth / img.naturalHeight;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (imgRatio > targetRatio) {
    sw = img.naturalHeight * targetRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / targetRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  // Subtle left book-spine binding
  const spineW = canvas.width * 0.08;
  const spineGrad = ctx.createLinearGradient(0, 0, spineW * 1.35, 0);
  spineGrad.addColorStop(0, 'rgba(0, 0, 0, 0.30)');
  spineGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.14)');
  spineGrad.addColorStop(0.76, 'rgba(255, 255, 255, 0.16)');
  spineGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = spineGrad;
  ctx.fillRect(0, 0, spineW * 1.35, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
