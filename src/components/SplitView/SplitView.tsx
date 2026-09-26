/**
 * Side-by-side view: a second pane next to the main document that shows any
 * open document (or another part of the same one) — questions and the answer
 * key, a lecture and its notes. The pane is for reading: it scrolls and zooms
 * on its own and shows the annotations; drawing happens in the main view.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { X, ZoomIn, ZoomOut, ArrowLeftRight } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { useUIStore } from '../../store/uiStore';
import { loadPdfDocument } from '../../pdf/renderer';
import { createPageTransform } from '../../pdf/coordinateTransform';
import { renderAnnotations } from '../../pdf/annotationRenderer';
import type { Annotation } from '../../types/annotations';
import styles from './SplitView.module.css';

const EMPTY: Annotation[] = [];
const MIN_WIDTH = 260;

export function SplitView() {
  const split = useUIStore((s) => s.splitView);
  if (!split) return null;
  return <SplitPane key={split.docId} docId={split.docId} />;
}

function SplitPane({ docId }: { docId: string }) {
  const setSplit = useUIStore((s) => s.setSplitView);
  const pageTheme = useUIStore((s) => s.pageTheme);
  const doc = useDocumentStore((s) => s.documents.get(docId));
  const docs = useDocumentStore((s) => s.documents);
  const tabOrder = useDocumentStore((s) => s.tabOrder);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<{ width: number; height: number }[]>([]);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(() => Math.round(window.innerWidth * 0.42));
  const [bodyWidth, setBodyWidth] = useState(400);
  const [currentPage, setCurrentPage] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Our own pdf.js copy: the main view may evict or reload its pages any time.
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    let loaded: PDFDocumentProxy | null = null;
    void loadPdfDocument(doc.sourceData.slice()).then(async (proxy) => {
      loaded = proxy;
      if (!alive) { void proxy.destroy(); return; }
      const sizes: { width: number; height: number }[] = [];
      for (let i = 1; i <= proxy.numPages; i++) {
        const page = await proxy.getPage(i);
        const v = page.getViewport({ scale: 1, rotation: page.rotate + (doc.pageRotations[i - 1] ?? 0) });
        sizes.push({ width: v.width, height: v.height });
      }
      if (!alive) return;
      setPdf(proxy);
      setPageSizes(sizes);
    }).catch((error) => console.error('Side-by-side view could not load the document:', error));
    return () => {
      alive = false;
      setPdf(null);
      void loaded?.destroy();
    };
    // Reload when the pages change (insert, delete, rotate, OCR…).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, doc?.sourceRevision, doc?.sourceData]);

  // Close when the document closes.
  useEffect(() => {
    if (!doc) setSplit(null);
  }, [doc, setSplit]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBodyWidth(el.clientWidth));
    observer.observe(el);
    setBodyWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const maxPageWidth = Math.max(1, ...pageSizes.map((s) => s.width));
  const scale = ((bodyWidth - 32) / maxPageWidth) * zoom;

  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const pages = el.querySelectorAll<HTMLElement>('[data-split-page]');
    const mid = el.scrollTop + el.clientHeight / 3;
    let n = 1;
    pages.forEach((p) => { if (p.offsetTop <= mid) n = Number(p.dataset.splitPage); });
    setCurrentPage(n);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const move = (ev: PointerEvent) => setWidth(Math.max(MIN_WIDTH, Math.min(window.innerWidth - 360, startWidth + (startX - ev.clientX))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!doc) return null;

  return (
    <aside className={styles.pane} style={{ width }} aria-label="Side-by-side view" data-split-view>
      <div className={styles.divider} onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Resize side-by-side view" />
      <div className={styles.header}>
        <select className={styles.docSelect} value={docId} aria-label="Document shown on the right"
          onChange={(e) => setSplit({ docId: e.target.value })}>
          {tabOrder.map((id) => {
            const d = docs.get(id);
            return d ? <option key={id} value={id} data-no-translate>{d.title}</option> : null;
          })}
        </select>
        <span className={styles.pageInfo}>{currentPage} / {pageSizes.length || doc.pageCount}</span>
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.3, +(z / 1.2).toFixed(2)))}><ZoomOut size={15} /></button>
        <button type="button" title="Fit width" aria-label="Fit width" onClick={() => setZoom(1)}><ArrowLeftRight size={15} /></button>
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(5, +(z * 1.2).toFixed(2)))}><ZoomIn size={15} /></button>
        <button type="button" title="Close side-by-side view" aria-label="Close side-by-side view" onClick={() => setSplit(null)}><X size={15} /></button>
      </div>
      <div className={styles.body} ref={bodyRef} onScroll={onScroll}>
        {pdf && pageSizes.map((size, i) => (
          <SplitPage key={`${doc.sourceRevision}-${i}`} pdf={pdf} docId={docId} pageIndex={i}
            width={size.width * scale} height={size.height * scale} scale={scale}
            rotation={doc.pageRotations[i] ?? 0} theme={pageTheme} root={bodyRef} />
        ))}
      </div>
    </aside>
  );
}

function SplitPage({ pdf, docId, pageIndex, width, height, scale, rotation, theme, root }: {
  pdf: PDFDocumentProxy; docId: string; pageIndex: number; width: number; height: number; scale: number;
  rotation: number; theme: string; root: React.RefObject<HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pdfCanvas = useRef<HTMLCanvasElement>(null);
  const inkCanvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const annotations = useAnnotationStore((s) => s.docAnnotations.get(docId)?.pages.get(pageIndex)?.annotations ?? EMPTY);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: root.current, rootMargin: '600px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible || page) return;
    let alive = true;
    void pdf.getPage(pageIndex + 1).then((p) => { if (alive) setPage(p); }, () => {});
    return () => { alive = false; };
  }, [visible, page, pdf, pageIndex]);

  const transform = useMemo(() => (page ? createPageTransform(page, { scale, displayRotation: rotation }) : null), [page, scale, rotation]);

  // Page image (debounced so zooming stays smooth).
  useEffect(() => {
    const canvas = pdfCanvas.current;
    if (!visible || !transform || !page || !canvas) return;
    let task: RenderTask | null = null;
    const timer = setTimeout(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(transform.cssWidth * dpr);
      canvas.height = Math.round(transform.cssHeight * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport: transform.viewport, transform: [dpr, 0, 0, dpr, 0, 0] });
      task.promise.catch(() => {});
    }, 60);
    return () => { clearTimeout(timer); task?.cancel(); };
  }, [visible, transform, page]);

  // Annotations on top.
  useEffect(() => {
    const canvas = inkCanvas.current;
    if (!visible || !transform || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(transform.cssWidth * dpr);
    canvas.height = Math.round(transform.cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const doc = useDocumentStore.getState().documents.get(docId);
    renderAnnotations(ctx, annotations.filter((a) => !a.hidden), transform, dpr, doc ? { docId, instanceId: doc.instanceId } : undefined);
  }, [visible, transform, annotations, docId]);

  const themeClass = theme === 'dark' ? styles.dark : theme === 'sepia' ? styles.sepia : '';
  return (
    <div ref={ref} className={`${styles.page} ${themeClass}`} style={{ width, height }} data-split-page={pageIndex + 1}>
      {visible && <canvas ref={pdfCanvas} className={styles.layer} style={{ width, height }} />}
      {visible && <canvas ref={inkCanvas} className={styles.layer} style={{ width, height }} />}
    </div>
  );
}
