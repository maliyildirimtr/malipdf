import { macAppStore, windowsStore } from '../../config/downloads';
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
            workflow built for Mac and Windows.
          </p>

          <div className="hero__actions">
            <a
              href={macAppStore.url}
              className="btn btn--primary btn--lg hero__btn-primary"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Download MaliPDF on the Mac App Store"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              {macAppStore.label}
            </a>
            <a
              href={windowsStore.url}
              className="btn btn--outline btn--lg hero__btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Get MaliPDF from the Microsoft Store for Windows"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 5.1 10.4 4v7.2H3V5.1zm8.3-1.2L21 2.5v8.7h-9.7V3.9zM3 12.6h7.4v7.2L3 18.8v-6.2zm8.3 0H21v8.9l-9.7-1.4v-7.5z" />
              </svg>
              {windowsStore.label}
            </a>
          </div>
          <p className="hero__notice">
            Free on the Mac App Store and the Microsoft Store · Updates install automatically.
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
