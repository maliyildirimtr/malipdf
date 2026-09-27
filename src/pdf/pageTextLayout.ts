/**
 * Cached text layouts (see textSelection.ts) per document revision and page.
 */
import type { DocumentIdentity } from '../types/documentSession';
import { documentIdentityKey } from '../types/documentSession';
import { getDocumentProxy, getLoadedRevision } from './documentManager';
import { buildTextLayout, type PageTextLayout } from './textSelection';

const cache = new Map<string, PageTextLayout>();
const pending = new Map<string, Promise<PageTextLayout | null>>();
const MAX_CACHED = 40;

function keyOf(identity: DocumentIdentity, pageIndex: number): string {
  return `${documentIdentityKey(identity)}@${getLoadedRevision(identity)}:${pageIndex}`;
}

/** The layout if it is already loaded. */
export function peekPageTextLayout(identity: DocumentIdentity, pageIndex: number): PageTextLayout | null {
  return cache.get(keyOf(identity, pageIndex)) ?? null;
}

export function loadPageTextLayout(identity: DocumentIdentity, pageIndex: number): Promise<PageTextLayout | null> {
  const key = keyOf(identity, pageIndex);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = pending.get(key);
  if (running) return running;
  const job = (async () => {
    const proxy = getDocumentProxy(identity);
    if (!proxy) return null;
    const page = await proxy.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => ('str' in item ? [{
      str: item.str,
      transform: item.transform as number[],
      width: item.width,
      height: item.height,
      hasEOL: item.hasEOL,
      fontFamily: content.styles?.[item.fontName]?.fontFamily,
    }] : []));
    const layout = buildTextLayout(items);
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
    cache.set(key, layout);
    return layout;
  })().catch(() => null).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
