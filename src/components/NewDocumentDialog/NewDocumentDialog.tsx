import React, { useEffect, useState, useRef } from 'react';
import { Minus, Plus, File as FileIcon } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { getNextUntitledName } from '../../document/untitledNaming';
import { generateNewDocument, type PageBackground, type BackgroundSpacing, type BackgroundWeight } from '../../document/newDocumentGenerator';
import { getCanonicalPageDimensions, type PageSizePreset, type Orientation, type Unit, ISO_A_MM, ISO_B_MM, ISO_C_MM, NA_INCH, SCREEN_PT } from '../../document/pageSizes';
import { openDocumentBytes } from '../../document/openDocumentBytes';
import styles from './NewDocumentDialog.module.css';

const BACKGROUND_TYPES: { type: PageBackground['type']; label: string }[] = [
  { type: 'blank', label: 'Blank' },
  { type: 'grid', label: 'Grid' },
  { type: 'lined', label: 'Lined' },
  { type: 'dotted', label: 'Dotted' },
  { type: 'millimetric', label: 'Millimetric' },
];

function BackgroundThumbnail({ 
  type, 
  spacing, 
  color, 
  selected, 
  onClick 
}: { 
  type: PageBackground['type']; 
  spacing: BackgroundSpacing;
  color: string;
  selected: boolean; 
  onClick: () => void;
}) {
  const renderPattern = () => {
    if (type === 'blank') return null;
    
    // Scale down spacing for preview (e.g. 5mm -> 5px approx, 10mm -> 10px approx)
    const step = spacing;
    const lines = [];

    if (type === 'grid' || type === 'millimetric') {
      if (type === 'millimetric') {
        // Draw minor lines
        for (let x = 1; x < 48; x++) {
          lines.push(<line key={`minv${x}`} x1={x} y1={0} x2={x} y2={64} stroke={color} strokeWidth="0.25" opacity={0.3} />);
        }
        for (let y = 1; y < 64; y++) {
          lines.push(<line key={`minh${y}`} x1={0} y1={y} x2={48} y2={y} stroke={color} strokeWidth="0.25" opacity={0.3} />);
        }
      }
      for (let x = step; x < 48; x += step) {
        lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={64} stroke={color} strokeWidth={type === 'millimetric' ? "0.8" : "0.5"} />);
      }
    }
    
    if (type === 'grid' || type === 'lined' || type === 'millimetric') {
      for (let y = step; y < 64; y += step) {
        lines.push(<line key={`h${y}`} x1={0} y1={y} x2={48} y2={y} stroke={color} strokeWidth={type === 'millimetric' ? "0.8" : "0.5"} />);
      }
    }

    if (type === 'dotted') {
      for (let x = step; x < 48; x += step) {
        for (let y = step; y < 64; y += step) {
          lines.push(<circle key={`d${x}-${y}`} cx={x} cy={y} r={0.5} fill={color} />);
        }
      }
    }

    return lines;
  };

  return (
    <button
      type="button"
      className={`${styles.thumbnailBtn} ${selected ? styles.thumbnailSelected : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <div className={styles.thumbnailPreview}>
        <svg viewBox="0 0 48 64" width="48" height="64" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="48" height="64" fill="white" stroke="#ccc" strokeWidth="1" />
          {renderPattern()}
        </svg>
      </div>
      <span className={styles.thumbnailLabel}>
        {BACKGROUND_TYPES.find(b => b.type === type)?.label}
      </span>
    </button>
  );
}

export function NewDocumentDialog() {
  const isOpen = useUIStore((state) => state.newDocumentDialogOpen);
  const setIsOpen = useUIStore((state) => state.setNewDocumentDialogOpen);
  const documents = useDocumentStore((state) => state.documents);

  const [preset, setPreset] = useState<PageSizePreset>('A4');
  const [orientation, setOrientation] = useState<Orientation>('Portrait');
  const [pageCount, setPageCount] = useState<number>(1);

  const [bgType, setBgType] = useState<PageBackground['type']>('blank');
  const [bgSpacing, setBgSpacing] = useState<BackgroundSpacing>(5);
  const [bgColor, setBgColor] = useState<string>('#999999');
  const [bgOpacity, setBgOpacity] = useState<number>(1.0);
  const [bgWeight, setBgWeight] = useState<BackgroundWeight>('normal');

  const [customWidth, setCustomWidth] = useState<number>(210);
  const [customHeight, setCustomHeight] = useState<number>(297);
  const [customUnit, setCustomUnit] = useState<Unit>('mm');

  const [isGenerating, setIsGenerating] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPreset('A4');
      setOrientation('Portrait');
      setBgType('blank');
      setBgSpacing(5);
      setBgColor('#999999');
      setBgOpacity(1.0);
      setBgWeight('normal');
      setPageCount(1);
      setIsGenerating(false);
      setTimeout(() => dialogRef.current?.focus(), 10);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isCustom = preset === 'Custom';

  const handleCreate = async () => {
    if (pageCount < 1 || pageCount > 500) {
      alert('Page count must be between 1 and 500.');
      return;
    }
    if (isCustom && (customWidth <= 0 || customHeight <= 0)) {
      alert('Dimensions must be greater than 0.');
      return;
    }

    setIsGenerating(true);

    try {
      const [widthPt, heightPt] = getCanonicalPageDimensions(
        preset,
        orientation,
        customWidth,
        customHeight,
        customUnit
      );

      let background: PageBackground = { type: 'blank' };
      if (bgType !== 'blank') {
        if (bgType === 'millimetric') {
          background = {
            type: 'millimetric',
            majorSpacingMm: bgSpacing,
            color: bgColor,
            minorOpacity: bgOpacity * 0.4,
            majorOpacity: bgOpacity,
            minorWeight: 'light',
            majorWeight: bgWeight
          };
        } else {
          background = {
            type: bgType,
            spacingMm: bgSpacing,
            color: bgColor,
            opacity: bgOpacity,
            weight: bgWeight
          };
        }
      }

      const pdfBytes = await generateNewDocument({
        widthPt,
        heightPt,
        background,
        pageCount,
      });

      const existingTitles = Array.from(documents.values()).map(doc => doc.title);
      const name = getNextUntitledName(existingTitles);

      await openDocumentBytes(name, null, pdfBytes.buffer as ArrayBuffer);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to create new document:', error);
      alert(`Error creating document: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const incrementPageCount = () => setPageCount(p => Math.min(500, p + 1));
  const decrementPageCount = () => setPageCount(p => Math.max(1, p - 1));
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setIsOpen(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setIsOpen(false); }}
      onKeyDown={handleKeyDown}
    >
      <div 
        className={styles.dialog} 
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-label="New Document"
      >
        <div className={styles.header}>
          <h2>New Document</h2>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>PAGE BACKGROUND</div>
            <div className={styles.thumbnailRow}>
              {BACKGROUND_TYPES.map(bg => (
                <BackgroundThumbnail
                  key={bg.type}
                  type={bg.type}
                  spacing={bgSpacing}
                  color={bgColor}
                  selected={bgType === bg.type}
                  onClick={() => setBgType(bg.type)}
                />
              ))}
            </div>

            {bgType !== 'blank' && (
              <div className={styles.contextualRow}>
                <div className={styles.chipGroup}>
                  {([5, 8, 10] as BackgroundSpacing[]).map(s => (
                    <button
                      key={s}
                      type="button"
                      className={`${styles.chip} ${bgSpacing === s ? styles.chipSelected : ''}`}
                      onClick={() => setBgSpacing(s)}
                    >
                      {s} mm
                    </button>
                  ))}
                </div>
                <div className={styles.colorControl}>
                  <input 
                    type="color" 
                    value={bgColor} 
                    onChange={e => setBgColor(e.target.value)} 
                    className={styles.colorWell}
                  />
                  <select 
                    className={styles.compactSelect} 
                    style={{ width: '80px' }}
                    value={bgOpacity} 
                    onChange={e => setBgOpacity(Number(e.target.value))}
                  >
                    <option value={1.0}>100%</option>
                    <option value={0.75}>75%</option>
                    <option value={0.5}>50%</option>
                    <option value={0.25}>25%</option>
                  </select>
                  <select 
                    className={styles.compactSelect} 
                    style={{ width: '80px' }}
                    value={bgWeight} 
                    onChange={e => setBgWeight(e.target.value as BackgroundWeight)}
                  >
                    <option value="light">Light</option>
                    <option value="normal">Normal</option>
                    <option value="strong">Strong</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <div className={styles.sectionHeader}>PAGE FORMAT</div>
            
            <div className={styles.formRow}>
              <label>Orientation</label>
              <div className={styles.radioGroup}>
                <label className={`${styles.radioCard} ${orientation === 'Portrait' ? styles.radioSelected : ''}`}>
                  <input
                    type="radio"
                    name="orientation"
                    className={styles.srOnly}
                    checked={orientation === 'Portrait'}
                    onChange={() => setOrientation('Portrait')}
                  />
                  <div className={styles.radioIcon}>
                    <FileIcon size={16} style={{ transform: 'scaleY(1.2) scaleX(0.9)', strokeWidth: 1.5 }} />
                  </div>
                  <span>Portrait</span>
                </label>
                <label className={`${styles.radioCard} ${orientation === 'Landscape' ? styles.radioSelected : ''}`}>
                  <input
                    type="radio"
                    name="orientation"
                    className={styles.srOnly}
                    checked={orientation === 'Landscape'}
                    onChange={() => setOrientation('Landscape')}
                  />
                  <div className={styles.radioIcon}>
                    <FileIcon size={16} style={{ transform: 'rotate(-90deg) scaleY(1.2) scaleX(0.9)', strokeWidth: 1.5 }} />
                  </div>
                  <span>Landscape</span>
                </label>
              </div>
            </div>

            <div className={styles.formRow}>
              <label>Size</label>
              <div className={styles.sizeControl}>
                <select 
                  className={styles.compactSelect}
                  value={preset} 
                  onChange={(e) => setPreset(e.target.value as PageSizePreset)}
                >
                  <optgroup label="ISO A Series">
                    {Object.keys(ISO_A_MM).map(p => <option key={p} value={p}>{p}</option>)}
                  </optgroup>
                  <optgroup label="ISO B Series">
                    {Object.keys(ISO_B_MM).map(p => <option key={p} value={p}>{p}</option>)}
                  </optgroup>
                  <optgroup label="ISO C Series">
                    {Object.keys(ISO_C_MM).map(p => <option key={p} value={p}>{p}</option>)}
                  </optgroup>
                  <optgroup label="North American">
                    {Object.keys(NA_INCH).map(p => <option key={p} value={p}>{p}</option>)}
                  </optgroup>
                  <optgroup label="Screen / Presentation">
                    {Object.keys(SCREEN_PT).map(p => <option key={p} value={p}>{p}</option>)}
                  </optgroup>
                  <optgroup label="Custom">
                    <option value="Custom">Custom Size...</option>
                  </optgroup>
                </select>
                
                {isCustom && (
                  <div className={styles.dimensions}>
                    <input
                      type="number"
                      min={1}
                      className={styles.compactInput}
                      value={customWidth}
                      onChange={(e) => setCustomWidth(Number(e.target.value))}
                      title="Width"
                    />
                    <span className={styles.dimSep}>×</span>
                    <input
                      type="number"
                      min={1}
                      className={styles.compactInput}
                      value={customHeight}
                      onChange={(e) => setCustomHeight(Number(e.target.value))}
                      title="Height"
                    />
                    <select 
                      className={styles.compactSelect}
                      value={customUnit} 
                      onChange={(e) => setCustomUnit(e.target.value as Unit)}
                    >
                      <option value="mm">mm</option>
                      <option value="inch">in</option>
                      <option value="pt">pt</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <div className={styles.sectionHeader}>PAGES</div>
            <div className={styles.stepperControl}>
              <button 
                type="button" 
                className={styles.stepperBtn} 
                onClick={decrementPageCount}
                disabled={pageCount <= 1}
                aria-label="Decrease pages"
              >
                <Minus size={14} />
              </button>
              <input
                type="number"
                min={1}
                max={500}
                className={styles.stepperInput}
                value={pageCount}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setPageCount(Math.min(500, Math.max(1, val)));
                }}
              />
              <button 
                type="button" 
                className={styles.stepperBtn} 
                onClick={incrementPageCount}
                disabled={pageCount >= 500}
                aria-label="Increase pages"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={() => setIsOpen(false)} disabled={isGenerating}>
            Cancel
          </button>
          <button className={styles.createButton} onClick={handleCreate} disabled={isGenerating}>
            {isGenerating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
