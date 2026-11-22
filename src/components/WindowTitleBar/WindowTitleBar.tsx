/**
 * Windows / Linux title bar: app icon and "document - MaliPDF", like other
 * Windows apps. The system draws minimize / maximize / close over its right
 * end; the bar is the window's drag area (double-click maximizes).
 */
import appIcon from '../../assets/app-icon.png';
import { useDocumentStore } from '../../store/documentStore';
import styles from './WindowTitleBar.module.css';

export function WindowTitleBar() {
  const title = useDocumentStore((state) => {
    const doc = state.activeDocId ? state.documents.get(state.activeDocId) : null;
    if (!doc) return 'MaliPDF';
    const dirty = doc.currentStateId !== doc.savedStateId;
    return `${dirty ? '• ' : ''}${doc.title} - MaliPDF`;
  });
  return (
    <div className={styles.titleBar}>
      <img className={styles.icon} src={appIcon} alt="" draggable={false} />
      <span className={styles.title} data-no-translate>{title}</span>
    </div>
  );
}
