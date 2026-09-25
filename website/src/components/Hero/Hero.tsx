import { downloads, windowsInstaller } from '../../config/downloads';
import { DownloadMenu } from '../DownloadMenu/DownloadMenu';
import './Hero.css';

const lineWidths = ['82%', '66%', '91%', '74%', '86%', '58%', '78%', '92%', '69%'];

function DocumentLines({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`hero__document-lines${compact ? ' hero__document-lines--compact' : ''}`}>
      {lineWidths.slice(0, compact ? 7 : 9).map((width, index) => (
        <span key={`${width}-${index}`} style={{ width }} />
      ))}
    </div>
  );
}

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__bg-grid" aria-hidden="true" />
      <div className="hero__wash hero__wash--top" aria-hidden="true" />
      <div className="hero__wash hero__wash--bottom" aria-hidden="true" />

      <div className="container--wide hero__container">
        <div className="hero__text">
          <p className="hero__eyebrow">PDF annotation for serious work</p>
          <h1 id="hero-title" className="hero__headline">
            Your PDFs.<br />
            <em className="hero__headline-em">Your workspace.</em>
          </h1>
          <p className="hero__description">
            Annotate documents, teach from lecture slides, organize visual
            notes, and work directly on PDFs — with a fast, focused desktop
            workflow built for macOS and Windows.
          </p>

          <div className="hero__actions">
            <DownloadMenu
              platform={downloads.macos}
              buttonClassName="btn btn--primary btn--lg hero__btn-primary"
              ariaLabel={`${downloads.macos.label} — choose Apple Silicon or Intel`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M14.5 8.5c0-1.38-1.12-2.5-2.5-2.5S9.5 7.12 9.5 8.5c0 .74.32 1.4.83 1.87L7 14h10l-3.33-3.63c.51-.47.83-1.13.83-1.87z" />
              </svg>
              {downloads.macos.label}
            </DownloadMenu>
            <a
              href={windowsInstaller.url}
              download={windowsInstaller.fileName}
              className="btn btn--outline btn--lg hero__btn-secondary"
              aria-label={`${downloads.windows.label} (${windowsInstaller.label}, ${windowsInstaller.sizeLabel})`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
              </svg>
              {downloads.windows.label}
            </a>
          </div>
          <p className="hero__notice">
            Version {downloads.version} · Free during early access. No account required.
          </p>
        </div>

        <div className="hero__art" aria-hidden="true">
          <div className="hero__blueprint-dots" />
          <svg className="hero__orbit hero__orbit--top" viewBox="0 0 260 150" fill="none">
            <path d="M8 132C54 20 159-16 252 38" />
          </svg>
          <svg className="hero__orbit hero__orbit--bottom" viewBox="0 0 250 190" fill="none">
            <path d="M242 185C214 52 118-12 8 22" />
          </svg>

          <div className="hero__paper hero__paper--back"><DocumentLines compact /></div>
          <div className="hero__paper hero__paper--main">
            <div className="hero__pdf-title">PDF</div>
            <DocumentLines />
            <span className="hero__highlight hero__highlight--yellow" />
            <span className="hero__highlight hero__highlight--blue" />
            <span className="hero__annotation-circle" />
            <span className="hero__annotation-square" />
          </div>
          <div className="hero__paper hero__paper--technical">
            <DocumentLines compact />
            <svg className="hero__technical-drawing" viewBox="0 0 180 220" fill="none">
              <circle cx="90" cy="76" r="45" />
              <ellipse cx="90" cy="76" rx="23" ry="45" />
              <path d="M38 76h104M90 24v104M50 45l80 62M50 107l80-62" />
              <path d="M50 156l42-23 39 26-43 25-38-28Z" />
              <path d="M50 156v34l38 23 43-24v-30M88 184v29" />
            </svg>
          </div>

          <div className="hero__note hero__note--annotate">
            Annotate<br />Learn<br />Build
            <svg viewBox="0 0 74 62" fill="none"><path d="M4 6c30 4 48 20 60 45M53 45l11 7 3-13" /></svg>
          </div>
          <div className="hero__note hero__note--organize">Organize.<br />Understand.<br />Make it yours.</div>
          <div className="hero__note hero__note--context">Knowledge<br />in context.</div>
          <div className="hero__checklist"><span>Ideas</span><span>Notes</span><span>References</span></div>
          <span className="hero__cross hero__cross--one" />
          <span className="hero__cross hero__cross--two" />
        </div>
      </div>
      <div className="hero__fade" aria-hidden="true" />
    </section>
  );
}
