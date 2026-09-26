/** The PDF's own table of contents. Click an entry to go to its page. */
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getDocumentProxy } from '../../pdf/documentManager';
import { loadOutline, type OutlineNode } from '../../pdf/outline';
import { goToPage } from '../../commands/bookmarkCommands';
import type { DocumentIdentity } from '../../types/documentSession';
import styles from './PageSidebar.module.css';

export function OutlinePanel({ identity, revision }: { identity: DocumentIdentity; revision: number }) {
  const [nodes, setNodes] = useState<OutlineNode[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNodes(null);
    setError(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (triesLeft: number) => {
      const proxy = getDocumentProxy(identity);
      if (!proxy) {
        // The PDF is still loading; try again shortly.
        if (triesLeft > 0) timer = setTimeout(() => attempt(triesLeft - 1), 250);
        else setError(true);
        return;
      }
      loadOutline(proxy).then(
        (result) => !cancelled && setNodes(result),
        () => !cancelled && setError(true),
      );
    };
    attempt(40);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [identity.docId, identity.instanceId, revision]);

  if (error) return <div className={styles.emptyPanel}><span>The outline could not be read.</span></div>;
  if (!nodes) return <div className={styles.emptyPanel}><span>Loading…</span></div>;
  if (nodes.length === 0) {
    return (
      <div className={styles.emptyPanel}>
        <span>This PDF has no table of contents.</span>
        <span className={styles.emptyHint}>Use Bookmarks to mark pages yourself.</span>
      </div>
    );
  }
  return (
    <div className={styles.annotationList} role="tree" aria-label="Outline">
      {nodes.map((node) => <OutlineItem key={node.id} node={node} depth={0} docId={identity.docId} />)}
    </div>
  );
}

function OutlineItem({ node, depth, docId }: { node: OutlineNode; depth: number; docId: string }) {
  const [open, setOpen] = useState(depth === 0 && node.children.length <= 30);
  const go = () => node.pageIndex !== null && goToPage(docId, node.pageIndex);
  return (
    <div role="treeitem" aria-expanded={node.children.length ? open : undefined}>
      <div
        className={`${styles.annotationRow} ${node.pageIndex === null ? styles.outlineDisabled : ''}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        tabIndex={0}
        onClick={go}
        onKeyDown={(event) => {
          if (event.key === 'Enter') go();
          if (event.key === 'ArrowRight') setOpen(true);
          if (event.key === 'ArrowLeft') setOpen(false);
        }}
        title={node.url ?? (node.pageIndex !== null ? `Page ${node.pageIndex + 1}` : undefined)}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            className={styles.rowButton}
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(!open);
            }}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : <span className={styles.outlineSpacer} />}
        <span
          className={styles.annotationLabel}
          style={{ fontWeight: node.bold ? 600 : undefined, fontStyle: node.italic ? 'italic' : undefined }}
        >
          {node.title}
        </span>
        {node.pageIndex !== null && <span className={styles.outlinePage}>{node.pageIndex + 1}</span>}
      </div>
      {open && node.children.map((child) => <OutlineItem key={child.id} node={child} depth={depth + 1} docId={docId} />)}
    </div>
  );
}
