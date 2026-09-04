import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { DocumentManager } from '../documentManager';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function page(marker: string, cleanup = vi.fn(() => true)): PDFPageProxy {
  return {
    rotate: 0,
    marker,
    cleanup,
    getViewport: () => ({ width: 600, height: 800 }) as PageViewport,
  } as unknown as PDFPageProxy;
}

function proxy(getPage: (pageNumber: number) => Promise<PDFPageProxy>, destroy = vi.fn(async () => {})) {
  return {
    numPages: 10,
    getPage,
    destroy,
  } as unknown as PDFDocumentProxy;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DocumentManager identity-safe lifecycle', () => {
  it('deduplicates duplicate page requests but preserves caller request ids', async () => {
    const pending = deferred<PDFPageProxy>();
    const getPage = vi.fn(() => pending.promise);
    const manager = new DocumentManager(async () => proxy(getPage));
    const { identity } = await manager.openDocument('A', new Uint8Array([1]));

    const first = manager.getPage(identity, 0, 101);
    const second = manager.getPage(identity, 0, 102);
    expect(manager.getCacheSnapshot(identity)?.pendingLoads).toBe(1);
    expect(getPage).toHaveBeenCalledOnce();

    pending.resolve(page('A'));
    await expect(first).resolves.toMatchObject({ identity, pageIndex: 0, requestId: 101 });
    await expect(second).resolves.toMatchObject({ identity, pageIndex: 0, requestId: 102 });
  });

  it('limits all page consumers to three concurrent document loads', async () => {
    const pendingPages = Array.from({ length: 5 }, () => deferred<PDFPageProxy>());
    const getPage = vi.fn((pageNumber: number) => pendingPages[pageNumber - 1].promise);
    const manager = new DocumentManager(async () => proxy(getPage));
    const { identity } = await manager.openDocument('A', new Uint8Array([1]));

    const results = Array.from({ length: 5 }, (_, pageIndex) => (
      manager.getPage(identity, pageIndex, pageIndex + 1)
    ));
    expect(getPage).toHaveBeenCalledTimes(3);

    pendingPages[0].resolve(page('0'));
    await vi.waitFor(() => expect(getPage).toHaveBeenCalledTimes(4));

    pendingPages[1].resolve(page('1'));
    pendingPages[2].resolve(page('2'));
    pendingPages[3].resolve(page('3'));
    await vi.waitFor(() => expect(getPage).toHaveBeenCalledTimes(5));
    pendingPages[4].resolve(page('4'));
    await expect(Promise.all(results)).resolves.toHaveLength(5);
  });

  it('never mixes A/page0 with B/page0', async () => {
    const proxies = [
      proxy(async () => page('A')),
      proxy(async () => page('B')),
    ];
    const manager = new DocumentManager(async () => proxies.shift()!);
    const openedA = await manager.openDocument('A', new Uint8Array([1]));
    const openedB = await manager.openDocument('B', new Uint8Array([2]));

    const resultA = await manager.getPage(openedA.identity, 0, 1);
    const resultB = await manager.getPage(openedB.identity, 0, 2);

    expect((resultA!.loadedPage.page as any).marker).toBe('A');
    expect((resultB!.loadedPage.page as any).marker).toBe('B');
    expect(manager.getPageProxy(openedA.identity, 0)).not.toBe(manager.getPageProxy(openedB.identity, 0));
  });

  it('rejects a pending result after close', async () => {
    const pending = deferred<PDFPageProxy>();
    const destroy = vi.fn(async () => {});
    const manager = new DocumentManager(async () => proxy(() => pending.promise, destroy));
    const { identity } = await manager.openDocument('A', new Uint8Array([1]));
    const result = manager.getPage(identity, 0, 1);

    const closing = manager.closeDocument(identity);
    pending.resolve(page('stale'));

    await expect(result).resolves.toBeNull();
    await closing;
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects the old result when the same docId has a new instance', async () => {
    const oldPending = deferred<PDFPageProxy>();
    const proxies = [
      proxy(() => oldPending.promise),
      proxy(async () => page('new')),
    ];
    const manager = new DocumentManager(async () => proxies.shift()!);
    const oldDocument = await manager.openDocument('same', new Uint8Array([1]));
    const oldResult = manager.getPage(oldDocument.identity, 0, 1);
    const newDocument = await manager.openDocument('same', new Uint8Array([2]));

    oldPending.resolve(page('old'));

    await expect(oldResult).resolves.toBeNull();
    const newResult = await manager.getPage(newDocument.identity, 0, 2);
    expect((newResult!.loadedPage.page as any).marker).toBe('new');
    expect(newDocument.identity.instanceId).not.toBe(oldDocument.identity.instanceId);
  });

  it('retries cleanup when a page is still rendering', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const manager = new DocumentManager(async () => proxy(async () => page('A', cleanup)));
    const { identity } = await manager.openDocument('A', new Uint8Array([1]));
    await manager.getPage(identity, 0, 1);

    manager.reconcilePageCache(identity, new Set(), 0);
    expect(manager.getCacheSnapshot(identity)?.cachedPages).toBe(1);

    await vi.advanceTimersByTimeAsync(200);

    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(manager.getCacheSnapshot(identity)?.cachedPages).toBe(0);
  });

  it('enforces the retained page-cache ceiling', async () => {
    const manager = new DocumentManager(async () => proxy(async (pageNumber) => page(String(pageNumber))));
    const { identity } = await manager.openDocument('A', new Uint8Array([1]));
    for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
      await manager.getPage(identity, pageIndex, pageIndex + 1);
    }

    manager.reconcilePageCache(identity, new Set(Array.from({ length: 10 }, (_, i) => i)), 4);

    expect(manager.getCacheSnapshot(identity)?.cachedPages).toBe(4);
  });
});
