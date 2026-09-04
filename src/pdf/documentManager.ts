/**
 * Owns pdf.js document instances and their page-resource cache.
 * Every operation is guarded by a concrete DocumentIdentity generation.
 */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { loadPdfDocument, loadPage, type LoadedPage } from './renderer';
import { CANVAS_MEMORY_POLICY } from './canvasMemory';
import {
  sameDocumentIdentity,
  type DocumentIdentity,
} from '../types/documentSession';

interface CachedPage {
  loadedPage: LoadedPage;
  lastAccess: number;
  evictionRequested: boolean;
}

interface CachedDocument {
  identity: DocumentIdentity;
  proxy: PDFDocumentProxy;
  pageCount: number;
  pageCache: Map<number, CachedPage>;
  pendingLoads: Map<number, Promise<LoadedPage | null>>;
  loadQueue: QueuedPageLoad[];
  activeLoadCount: number;
  disposed: boolean;
  cleanupRetryTimer: ReturnType<typeof setTimeout> | null;
}

interface QueuedPageLoad {
  pageIndex: number;
  promise: Promise<LoadedPage | null>;
  resolve: (loadedPage: LoadedPage | null) => void;
  reject: (error: unknown) => void;
}

export interface IdentitySafePageResult {
  identity: DocumentIdentity;
  pageIndex: number;
  requestId: number;
  loadedPage: LoadedPage;
}

type DocumentLoader = (data: Uint8Array) => Promise<PDFDocumentProxy>;

export class DocumentManager {
  private readonly documents = new Map<string, CachedDocument>();
  private readonly openingInstances = new Map<string, number>();
  private nextInstanceId = 0;

  constructor(private readonly documentLoader: DocumentLoader = loadPdfDocument) {}

  async openDocument(
    docId: string,
    data: Uint8Array,
  ): Promise<{ identity: DocumentIdentity; pageCount: number }> {
    const identity = { docId, instanceId: ++this.nextInstanceId };
    this.openingInstances.set(docId, identity.instanceId);

    const existing = this.documents.get(docId);
    if (existing) void this.closeDocument(existing.identity);

    const proxy = await this.documentLoader(data);
    if (this.openingInstances.get(docId) !== identity.instanceId) {
      await proxy.destroy();
      throw new Error(`Document load superseded: ${docId}`);
    }

    const cached: CachedDocument = {
      identity,
      proxy,
      pageCount: proxy.numPages,
      pageCache: new Map(),
      pendingLoads: new Map(),
      loadQueue: [],
      activeLoadCount: 0,
      disposed: false,
      cleanupRetryTimer: null,
    };
    this.documents.set(docId, cached);
    return { identity, pageCount: proxy.numPages };
  }

  async closeDocument(identity: DocumentIdentity): Promise<void> {
    if (this.openingInstances.get(identity.docId) === identity.instanceId) {
      this.openingInstances.delete(identity.docId);
    }
    const cached = this.getRecord(identity);
    if (!cached) return;

    cached.disposed = true;
    this.documents.delete(identity.docId);
    if (cached.cleanupRetryTimer !== null) {
      clearTimeout(cached.cleanupRetryTimer);
      cached.cleanupRetryTimer = null;
    }
    cached.pageCache.clear();
    for (const queued of cached.loadQueue.splice(0)) {
      cached.pendingLoads.delete(queued.pageIndex);
      queued.resolve(null);
    }

    try {
      await cached.proxy.destroy();
    } catch (error) {
      console.warn('Failed to destroy PDF document:', error);
    }
  }

  getDocumentProxy(identity: DocumentIdentity): PDFDocumentProxy | null {
    return this.getRecord(identity)?.proxy ?? null;
  }

  getPageCount(identity: DocumentIdentity): number {
    return this.getRecord(identity)?.pageCount ?? 0;
  }

  async getPage(
    identity: DocumentIdentity,
    pageIndex: number,
    requestId: number,
  ): Promise<IdentitySafePageResult | null> {
    const cached = this.getRecord(identity);
    if (!cached || pageIndex < 0 || pageIndex >= cached.pageCount) return null;

    const existing = cached.pageCache.get(pageIndex);
    if (existing) {
      existing.lastAccess = Date.now();
      existing.evictionRequested = false;
      return { identity, pageIndex, requestId, loadedPage: existing.loadedPage };
    }

    let pending = cached.pendingLoads.get(pageIndex);
    if (!pending) {
      pending = this.enqueuePageLoad(cached, pageIndex);
    }

    const loadedPage = await pending;
    if (!loadedPage || !this.isCurrent(cached)) return null;
    return { identity, pageIndex, requestId, loadedPage };
  }

  getPageProxy(identity: DocumentIdentity, pageIndex: number): PDFPageProxy | null {
    const entry = this.getRecord(identity)?.pageCache.get(pageIndex);
    if (!entry || entry.evictionRequested) return null;
    entry.lastAccess = Date.now();
    return entry.loadedPage.page;
  }

  reconcilePageCache(
    identity: DocumentIdentity,
    keepPages: ReadonlySet<number>,
    maxRetainedPages: number = CANVAS_MEMORY_POLICY.maxRetainedPages,
  ): number[] {
    const cached = this.getRecord(identity);
    if (!cached) return [];

    const keep = [...keepPages]
      .map((pageIndex) => ({ pageIndex, entry: cached.pageCache.get(pageIndex) }))
      .filter((item): item is { pageIndex: number; entry: CachedPage } => !!item.entry)
      .sort((left, right) => right.entry.lastAccess - left.entry.lastAccess)
      .slice(0, Math.max(0, maxRetainedPages));
    const effectiveKeep = new Set(keep.map(({ pageIndex }) => pageIndex));
    const requested: number[] = [];

    for (const pageIndex of cached.pageCache.keys()) {
      if (effectiveKeep.has(pageIndex)) continue;
      requested.push(pageIndex);
      this.requestPageEviction(identity, pageIndex);
    }
    return requested;
  }

  requestPageEviction(identity: DocumentIdentity, pageIndex: number): boolean {
    const cached = this.getRecord(identity);
    const entry = cached?.pageCache.get(pageIndex);
    if (!cached || !entry) return true;
    entry.evictionRequested = true;
    const evicted = this.tryEvictPage(cached, pageIndex);
    if (!evicted) this.scheduleCleanupRetry(cached);
    return evicted;
  }

  getCacheSnapshot(identity: DocumentIdentity): {
    cachedPages: number;
    pendingLoads: number;
    evictionPending: number;
  } | null {
    const cached = this.getRecord(identity);
    if (!cached) return null;
    return {
      cachedPages: cached.pageCache.size,
      pendingLoads: cached.pendingLoads.size,
      evictionPending: [...cached.pageCache.values()]
        .filter((entry) => entry.evictionRequested).length,
    };
  }

  private getRecord(identity: DocumentIdentity): CachedDocument | null {
    const cached = this.documents.get(identity.docId);
    return cached && sameDocumentIdentity(cached.identity, identity) && !cached.disposed
      ? cached
      : null;
  }

  private isCurrent(cached: CachedDocument): boolean {
    return !cached.disposed && this.documents.get(cached.identity.docId) === cached;
  }

  private tryEvictPage(cached: CachedDocument, pageIndex: number): boolean {
    const entry = cached.pageCache.get(pageIndex);
    if (!entry || !entry.evictionRequested) return true;
    if (!entry.loadedPage.page.cleanup()) return false;
    cached.pageCache.delete(pageIndex);
    return true;
  }

  private enqueuePageLoad(cached: CachedDocument, pageIndex: number): Promise<LoadedPage | null> {
    let resolve!: (loadedPage: LoadedPage | null) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<LoadedPage | null>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    cached.pendingLoads.set(pageIndex, promise);
    cached.loadQueue.push({ pageIndex, promise, resolve, reject });
    this.pumpPageLoads(cached);
    return promise;
  }

  private pumpPageLoads(cached: CachedDocument): void {
    while (this.isCurrent(cached)
      && cached.activeLoadCount < CANVAS_MEMORY_POLICY.maxConcurrentPageLoads
      && cached.loadQueue.length > 0) {
      const queued = cached.loadQueue.shift()!;
      if (cached.pendingLoads.get(queued.pageIndex) !== queued.promise) continue;
      cached.activeLoadCount += 1;

      void loadPage(cached.proxy, queued.pageIndex).then(
        (loadedPage) => {
          if (!this.isCurrent(cached)) {
            loadedPage.page.cleanup();
            queued.resolve(null);
            return;
          }
          cached.pageCache.set(queued.pageIndex, {
            loadedPage,
            lastAccess: Date.now(),
            evictionRequested: false,
          });
          queued.resolve(loadedPage);
        },
        (error: unknown) => {
          if (!this.isCurrent(cached)) queued.resolve(null);
          else queued.reject(error);
        },
      ).finally(() => {
        cached.activeLoadCount -= 1;
        if (cached.pendingLoads.get(queued.pageIndex) === queued.promise) {
          cached.pendingLoads.delete(queued.pageIndex);
        }
        this.pumpPageLoads(cached);
      });
    }
  }

  private scheduleCleanupRetry(cached: CachedDocument): void {
    if (cached.cleanupRetryTimer !== null || !this.isCurrent(cached)) return;
    cached.cleanupRetryTimer = setTimeout(() => {
      cached.cleanupRetryTimer = null;
      if (!this.isCurrent(cached)) return;
      let retryNeeded = false;
      for (const [pageIndex, entry] of cached.pageCache) {
        if (entry.evictionRequested && !this.tryEvictPage(cached, pageIndex)) {
          retryNeeded = true;
        }
      }
      if (retryNeeded) this.scheduleCleanupRetry(cached);
    }, CANVAS_MEMORY_POLICY.cleanupRetryMs);
  }
}

const documentManager = new DocumentManager();

export const openDocument = documentManager.openDocument.bind(documentManager);
export const closeDocument = documentManager.closeDocument.bind(documentManager);
export const getDocumentProxy = documentManager.getDocumentProxy.bind(documentManager);
export const getPageCount = documentManager.getPageCount.bind(documentManager);
export const getPage = documentManager.getPage.bind(documentManager);
export const getPageProxy = documentManager.getPageProxy.bind(documentManager);
export const reconcilePageCache = documentManager.reconcilePageCache.bind(documentManager);
export const requestPageEviction = documentManager.requestPageEviction.bind(documentManager);
export const getCacheSnapshot = documentManager.getCacheSnapshot.bind(documentManager);
