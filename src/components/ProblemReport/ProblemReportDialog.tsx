/**
 * Report a problem (Help ▸ Report a Problem…, or offered after a crash).
 *
 * The user can describe what happened, see exactly what will be sent, and
 * send it as an e-mail from their own mail app (Gmail in the browser when no
 * mail app is set up). Nothing is sent by MaliPDF itself.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bug, Check, ChevronDown, ChevronRight, Copy, Mail, ShieldCheck, X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { errorMessage, notifyUser } from '../../utils/notify';
import styles from './ProblemReportDialog.module.css';

type Stage = 'compose' | 'noMailApp' | 'opened';
/** Shown before the report (with the configured address) has loaded. */
const SUPPORT_EMAIL_FALLBACK = 'mali@maliyildirimtr.com';

export function ProblemReportDialog() {
  const state = useUIStore((s) => s.problemReport);
  const setState = useUIStore((s) => s.setProblemReport);
  const [note, setNote] = useState('');
  const [report, setReport] = useState<{ title: string; body: string; to: string } | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [stage, setStage] = useState<Stage>('compose');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // After a crash the main process asks for this dialog.
  useEffect(() => window.electronAPI?.onShowProblemReport?.((info) => setState(info)), [setState]);

  const open = state !== null;
  const afterCrash = state?.afterCrash === true;

  useEffect(() => {
    if (!open) return;
    setNote('');
    setShowReport(false);
    setStage('compose');
    setBusy(false);
    setCopied(false);
    setReport(null);
    requestAnimationFrame(() => noteRef.current?.focus());
  }, [open]);

  // Keep the preview in step with the note.
  useEffect(() => {
    if (!open || !showReport) return;
    const timer = setTimeout(() => {
      void window.electronAPI?.problemReport?.(afterCrash, note).then(setReport).catch(() => setReport(null));
    }, 150);
    return () => clearTimeout(timer);
  }, [open, showReport, note, afterCrash]);

  if (!open) return null;
  const close = () => { if (!busy) setState(null); };
  const api = window.electronAPI;

  const send = async (via: 'mail' | 'gmail') => {
    if (!api?.sendProblemReport) return;
    setBusy(true);
    try {
      const result = await api.sendProblemReport(afterCrash, note, via);
      if (result === 'noMailApp') {
        await api.copyProblemReport?.(afterCrash, note);
        setReport(await api.problemReport?.(afterCrash, note) ?? null);
        setStage('noMailApp');
      } else {
        setStage('opened');
      }
    } catch (error) {
      notifyUser('error', `The report could not be opened: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await api?.copyProblemReport?.(afterCrash, note);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="problem-report-title">
        <button type="button" className={styles.closeButton} aria-label="Close" onClick={close}><X size={16} /></button>

        <div className={styles.hero}>
          <div className={`${styles.badge} ${afterCrash ? styles.badgeWarning : ''}`}>
            {afterCrash ? <AlertTriangle size={22} /> : <Bug size={22} />}
          </div>
          <h2 id="problem-report-title">{afterCrash ? 'MaliPDF closed unexpectedly' : 'Report a Problem'}</h2>
          <p>{afterCrash
            ? 'Sorry about that. Sending a short report helps fix it in the next version.'
            : 'Tell us what went wrong. Your report goes straight to the developer by e-mail.'}</p>
        </div>

        {stage === 'compose' && (
          <>
            <div className={styles.body}>
              <label className={styles.label} htmlFor="problem-report-note">What were you doing? <span>(optional)</span></label>
              <textarea
                id="problem-report-note"
                ref={noteRef}
                className={styles.note}
                value={note}
                maxLength={1000}
                placeholder="e.g. I was writing on a page with the pen and the app closed."
                onChange={(e) => setNote(e.target.value)}
                rows={4}
              />

              <div className={styles.privacy}>
                <ShieldCheck size={16} aria-hidden="true" />
                <span>The report contains the app version, your system and the error details — never your documents or file names.</span>
              </div>

              <button type="button" className={styles.disclosure} aria-expanded={showReport} onClick={() => setShowReport(!showReport)}>
                {showReport ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Show what will be sent
              </button>
              {showReport && (
                <pre className={styles.preview} data-no-translate>
                  {report ? `To: ${report.to}\nSubject: ${report.title}\n\n${report.body}` : '…'}
                </pre>
              )}
            </div>

            <div className={styles.footer}>
              <button type="button" className={styles.ghostButton} onClick={() => void copy()} disabled={busy}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy Report'}
              </button>
              <div className={styles.spacer} />
              <button type="button" className={styles.secondaryButton} onClick={close} disabled={busy}>{afterCrash ? 'Not Now' : 'Cancel'}</button>
              <button type="button" className={styles.primaryButton} onClick={() => void send('mail')} disabled={busy}>
                <Mail size={15} /> Send by E-mail
              </button>
            </div>
          </>
        )}

        {stage === 'opened' && (
          <>
            <div className={styles.result}>
              <div className={styles.resultIcon}><Check size={20} /></div>
              <p><strong>Your e-mail is ready.</strong> Check it in your mail app and press Send. Thank you!</p>
            </div>
            <div className={styles.footer}>
              <div className={styles.spacer} />
              <button type="button" className={styles.primaryButton} onClick={close}>Done</button>
            </div>
          </>
        )}

        {stage === 'noMailApp' && (
          <>
            <div className={styles.result}>
              <div className={`${styles.resultIcon} ${styles.resultInfo}`}><Mail size={20} /></div>
              <div>
                <p><strong>No e-mail app is set up on this computer.</strong></p>
                <p>The report was copied. Paste it into a new e-mail, or open Gmail with everything filled in.</p>
                <p className={styles.addressLine}>
                  <span>Address:</span> <span data-no-translate className={styles.address}>{report?.to ?? SUPPORT_EMAIL_FALLBACK}</span>
                </p>
              </div>
            </div>
            <div className={styles.footer}>
              <button type="button" className={styles.ghostButton} onClick={() => void copy()}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy Again'}
              </button>
              <div className={styles.spacer} />
              <button type="button" className={styles.secondaryButton} onClick={close}>Close</button>
              <button type="button" className={styles.primaryButton} onClick={() => void send('gmail')} disabled={busy}>
                <Mail size={15} /> Open Gmail
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
