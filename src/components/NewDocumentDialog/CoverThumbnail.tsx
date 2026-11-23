import React, { useEffect, useRef } from 'react';
import { drawNotebookCoverOnCanvas, type NotebookCoverDef } from '../../document/notebookCovers';

interface CoverThumbnailProps {
  cover: NotebookCoverDef;
  width?: number;
  height?: number;
  title?: string;
  className?: string;
}

export function CoverThumbnail({
  cover,
  width = 88,
  height = 118,
  title,
  className,
}: CoverThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawNotebookCoverOnCanvas(ctx, cover, width, height, title);
  }, [cover, width, height, title]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block' }}
      className={className}
      aria-hidden="true"
    />
  );
}
