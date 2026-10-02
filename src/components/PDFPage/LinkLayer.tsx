/**
 * Links in the PDF page (pdf.js "Link" annotations): a web link opens in the
 * browser after a confirmation, an internal link jumps to its page. Active
 * with the Select and Hand tools; with a pen the links let the ink through.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { pdfRectToScreenBounds, type PageTransform } from '../../pdf/coordinateTransform';
import { getDocumentProxy } from '../../pdf/documentManager';
import { resolvePage } from '../../pdf/outline';
import { goToPage } from '../../commands/bookmarkCommands';
import { useUIStore } from '../../store/uiStore';
import styles from './FormLayer.module.css';

export interface PageLink {
  id: string;
  rect: [number, number, number, number];
  url: string | null;
  dest: string | unknown[] | null;
}

/** Link annotations from pdf.js annotation data. */
export function parseLinks(annotations: readonly Record<string, unknown>[]): PageLink[] {
  const links: PageLink[] = [];
  annotations.forEach((a, index) => {
    if (a.subtype !== 'Link' || !Array.isArray(a.rect) || a.rect.length !== 4) return;
    const url = typeof a.url === 'string' ? a.url : typeof a.unsafeUrl === 'string' ? a.unsafeUrl : null;
    const dest = typeof a.dest === 'string' || Array.isArray(a.dest) ? (a.dest as string | unknown[]) : null;
    if (!url && !dest) return;
    links.push({ id: typeof a.id === 'string' ? a.id : `link-${index}`, rect: a.rect as [number, number, number, number], url, dest });
  });
  return links;
}

const linkCache = new WeakMap<PDFPageProxy, Promise<PageLink[]>>();

function loadLinks(page: PDFPageProxy): Promise<PageLink[]> {
  let links = linkCache.get(page);
  if (!links) {
    links = page.getAnnotations({ intent: 'display' }).then((list) => parseLinks(list as Record<string, unknown>[]), () => []);
    linkCache.set(page, links);
  }
  return links;
}

interface LinkLayerProps {
  page: PDFPageProxy;
  transform: PageTransform;
  docId: string;
  instanceId: number;
}

export function LinkLayer({ page, transform, docId, instanceId }: LinkLayerProps) {
  const [links, setLinks] = useState<PageLink[]>([]);
  const tool = useUIStore((s) => s.temporaryTool ?? s.activeTool);
  const active = tool === 'select' || tool === 'hand';

  useEffect(() => {
    let alive = true;
    void loadLinks(page).then((list) => { if (alive) setLinks(list); });
    return () => { alive = false; };
  }, [page]);

  const placed = useMemo(() => links.map((link) => {
    const [x1, y1, x2, y2] = link.rect;
    return { link, box: pdfRectToScreenBounds({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }, transform) };
  }), [links, transform]);

  if (placed.length === 0) return null;

  const open = async (link: PageLink) => {
    if (link.url) {
      await window.electronAPI?.openLink?.(link.url);
      return;
    }
    const proxy = getDocumentProxy({ docId, instanceId });
    if (!proxy) return;
    const pageIndex = await resolvePage(proxy, link.dest);
    if (pageIndex !== null) goToPage(docId, pageIndex);
  };

  return (
    <div className={`${styles.layer} ${active ? styles.active : ''}`} data-link-layer>
      {placed.map(({ link, box }) => (
        <a
          key={link.id}
          href="#"
          className={styles.link}
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          title={link.url ?? 'Go to page'}
          aria-label={link.url ?? 'Go to page'}
          data-no-translate={link.url ? true : undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void open(link); }}
        />
      ))}
    </div>
  );
}
