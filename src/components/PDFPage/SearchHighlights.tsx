/** Search-result highlights for one page (PDF user space → screen via PageTransform). */
import React, { useMemo } from 'react';
import { pdfRectToScreenBounds, type PageTransform } from '../../pdf/coordinateTransform';
import { pageSearchHighlights, useSearchStore } from '../../store/searchStore';
import type { DocumentIdentity } from '../../types/documentSession';

export const SearchHighlights = React.memo(function SearchHighlights({
  identity,
  pageIndex,
  transform,
}: {
  identity: DocumentIdentity;
  pageIndex: number;
  transform: PageTransform;
}) {
  const results = useSearchStore((state) => state.results);
  const currentIndex = useSearchStore((state) => state.currentIndex);
  const searchIdentity = useSearchStore((state) => state.identity);

  const { matches, current } = useMemo(
    () => pageSearchHighlights({ results, currentIndex, identity: searchIdentity }, identity, pageIndex),
    [results, currentIndex, searchIdentity, identity, pageIndex],
  );
  if (matches.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }} aria-hidden="true">
      {matches.flatMap((match, matchIndex) => match.rects.map((rect, rectIndex) => {
        const box = pdfRectToScreenBounds(rect, transform);
        const isCurrent = match === current;
        return (
          <div
            key={`${matchIndex}:${rectIndex}`}
            data-search-current={isCurrent ? 'true' : undefined}
            style={{
              position: 'absolute',
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              background: isCurrent ? 'rgba(255, 140, 0, 0.45)' : 'rgba(255, 220, 0, 0.35)',
              outline: isCurrent ? '2px solid rgba(255, 120, 0, 0.9)' : undefined,
              borderRadius: 2,
              mixBlendMode: 'multiply',
            }}
          />
        );
      }))}
    </div>
  );
});
