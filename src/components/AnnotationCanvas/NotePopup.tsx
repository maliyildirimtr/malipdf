/**
 * The popup of a sticky note: type the note, change its colour, delete it.
 * Changes become one undo step when the popup closes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { NOTE_ICON_SIZE, type NoteAnnotation } from '../../types/annotations';
import { useAnnotationStore } from '../../store/annotationStore';
import { useHistoryStore, makeAddAction, makeRemoveAction, makeUpdateAction } from '../../store/historyStore';
import { useUIStore, type OpenNoteState } from '../../store/uiStore';
import { pdfRectToScreenBounds, type PageTransform } from '../../pdf/coordinateTransform';
import styles from './NotePopup.module.css';

export const NOTE_COLORS = ['#F5C400', '#FF9F43', '#FF6B81', '#5BC0EB', '#7BD389', '#B39DDB'];
const WIDTH = 240;

interface NotePopupProps {
  note: NoteAnnotation;
  state: OpenNoteState;
  transform: PageTransform;
}

export function NotePopup({ note, state, transform }: NotePopupProps) {
  const [content, setContent] = useState(note.content);
  const [color, setColor] = useState(note.color);
  const draft = useRef({ content, color });
  draft.current = { content, color };
  const done = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const el = inputRef.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  /** Write the draft into the store and history (once). */
  const commit = (remove = false) => {
    if (done.current) return;
    done.current = true;
    const store = useAnnotationStore.getState();
    const history = useHistoryStore.getState();
    const current = store.getPageAnnotations(state.docId, state.pageIndex).find((a) => a.id === note.id);
    if (!current || current.type !== 'note') return;
    const { content: text, color: nextColor } = draft.current;
    const empty = text.trim() === '';
    if (remove || (state.isNew && empty)) {
      const index = store.getPageAnnotations(state.docId, state.pageIndex).indexOf(current);
      store.removeAnnotation(state.docId, state.pageIndex, note.id);
      if (!state.isNew) history.push(makeRemoveAction(state.docId, current, index));
      return;
    }
    if (text === current.content && nextColor === current.color && !state.isNew) return;
    const after: NoteAnnotation = { ...current, content: text, color: nextColor, updatedAt: Date.now() };
    store.replaceAnnotation(state.docId, state.pageIndex, after);
    history.push(state.isNew ? makeAddAction(state.docId, after) : makeUpdateAction(state.docId, current, after));
  };

  const close = (remove = false) => {
    commit(remove);
    useUIStore.getState().setOpenNote(null);
  };

  // Closing from elsewhere (another note, tool change, page unmount) still saves.
  // Deferred, so React's development double-mount does not close a new note.
  const pendingCommit = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(pendingCommit.current);
    return () => { pendingCommit.current = setTimeout(() => commit(), 0); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const icon = pdfRectToScreenBounds({ x: note.x, y: note.y, width: NOTE_ICON_SIZE, height: NOTE_ICON_SIZE }, transform);
  const pageWidth = transform.cssWidth;
  const left = icon.x + icon.width + 8 + WIDTH <= pageWidth || icon.x - 8 - WIDTH < 0
    ? icon.x + icon.width + 8
    : icon.x - 8 - WIDTH;

  return (
    <div
      className={styles.popup}
      data-note-popup
      style={{ left, top: Math.max(0, icon.y), width: WIDTH, ['--note-color' as string]: color }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className={styles.header}>
        <div className={styles.colors} role="group" aria-label="Note colour">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.color} ${c.toLowerCase() === color.toLowerCase() ? styles.colorActive : ''}`}
              style={{ background: c }}
              aria-label={`Colour ${c}`}
              aria-pressed={c.toLowerCase() === color.toLowerCase()}
              onClick={() => { setColor(c); useUIStore.getState().updateNoteOptions({ color: c }); }}
            />
          ))}
        </div>
        <button type="button" className={styles.iconButton} title="Delete note" aria-label="Delete note" onClick={() => close(true)}>
          <Trash2 size={14} />
        </button>
        <button type="button" className={styles.iconButton} title="Close (Esc)" aria-label="Close note" onClick={() => close()}>
          <X size={14} />
        </button>
      </div>
      <textarea
        ref={inputRef}
        className={styles.text}
        value={content}
        placeholder="Write a note…"
        aria-label="Note text"
        onChange={(e) => setContent(e.target.value)}
      />
      <div className={styles.footer}>{new Date(note.updatedAt).toLocaleString()}</div>
    </div>
  );
}
