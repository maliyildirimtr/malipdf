/**
 * iPad app menu: the commands the desktop app keeps in its menu bar.
 * Shown at the start of the tab bar only in the iPad app.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Check, FilePlus, FolderOpen, History, ImagePlus, Menu, PenLine, Save, SaveAll, Settings, Share, X,
} from 'lucide-react';
import { useDocumentStore } from '../store/documentStore';
import { useUIStore } from '../store/uiStore';
import { runIpadCommand } from './ipadBridge';
import styles from './IpadMenu.module.css';

interface Item {
  command: string;
  label: string;
  icon: typeof Menu;
  needsDocument?: boolean;
}

const GROUPS: Item[][] = [
  [
    { command: 'file.open', label: 'Open…', icon: FolderOpen },
    { command: 'file.new', label: 'New Document…', icon: FilePlus },
    { command: 'file.fromImages', label: 'New PDF from Images…', icon: ImagePlus },
  ],
  [
    { command: 'file.save', label: 'Save', icon: Save, needsDocument: true },
    { command: 'file.saveAs', label: 'Save As…', icon: SaveAll, needsDocument: true },
    { command: 'file.print', label: 'Share or Print…', icon: Share, needsDocument: true },
    { command: 'file.close', label: 'Close', icon: X, needsDocument: true },
  ],
  [
    { command: 'file.recoveredDocuments', label: 'Recovered Documents…', icon: History },
    { command: 'app.settings', label: 'Settings…', icon: Settings },
  ],
];

export function IpadMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasDocument = useDocumentStore((state) => state.activeDocId !== null);
  const pencilOnly = useUIStore((state) => state.pencilOnly);
  const setPencilOnly = useUIStore((state) => state.setPencilOnly);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const run = (command: string) => {
    setOpen(false);
    runIpadCommand(command);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label="MaliPDF menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.menu} role="menu" aria-label="MaliPDF menu">
          {GROUPS.map((group, index) => (
            <div className={styles.group} key={index}>
              {group.map(({ command, label, icon: Icon, needsDocument }) => (
                <button
                  key={command}
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  disabled={needsDocument && !hasDocument}
                  onClick={() => run(command)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className={styles.group}>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={pencilOnly}
              className={styles.item}
              onClick={() => setPencilOnly(!pencilOnly)}
            >
              <PenLine size={18} aria-hidden="true" />
              <span className={styles.label}>
                <span>Draw with Apple Pencil only</span>
                <span className={styles.hint}>A finger scrolls and zooms; the Pencil draws.</span>
              </span>
              {pencilOnly && <Check size={18} className={styles.check} aria-hidden="true" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
