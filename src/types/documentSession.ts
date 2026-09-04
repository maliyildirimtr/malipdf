import type { LoadedPage } from '../pdf/renderer';

/** Identifies one concrete pdf.js document lifetime, not just a tab id. */
export interface DocumentIdentity {
  docId: string;
  instanceId: number;
}

export function documentIdentityKey(identity: DocumentIdentity): string {
  return `${identity.docId}:${identity.instanceId}`;
}

export function sameDocumentIdentity(
  left: DocumentIdentity | null | undefined,
  right: DocumentIdentity | null | undefined,
): boolean {
  return !!left
    && !!right
    && left.docId === right.docId
    && left.instanceId === right.instanceId;
}

/** Lightweight page geometry retained after the heavy page proxy is evicted. */
export interface PageLayout {
  pageIndex: number;
  /** Scale-1 viewport width including intrinsic PDF rotation. */
  intrinsicWidth: number;
  /** Scale-1 viewport height including intrinsic PDF rotation. */
  intrinsicHeight: number;
  intrinsicRotation: 0 | 90 | 180 | 270;
  measured: boolean;
}

export type PageLoadStatus = 'idle' | 'queued' | 'loading' | 'ready' | 'error';

export interface PageSessionEntry {
  pageIndex: number;
  status: PageLoadStatus;
  requestId: number | null;
  layout: PageLayout | null;
  /** Retained only while the page belongs to the active session cache window. */
  loadedPage: LoadedPage | null;
  lastAccess: number;
  error: string | null;
}

export interface DocumentSession {
  identity: DocumentIdentity;
  pageCount: number;
  active: boolean;
  zoom: number;
  activePageIndex: number;

  pages: Map<number, PageSessionEntry>;
  visiblePages: Set<number>;
  renderPages: Set<number>;
  preloadPages: Set<number>;
  pinnedPages: Set<number>;
  pendingLoads: Map<number, number>;
  lastVisiblePages: Set<number>;

  requestRevision: number;
  isRestoringScroll: boolean;
}
