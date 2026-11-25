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
          <p className="hero__eyebrow">Native on Mac · iPad · Windows</p>
          <h1 id="hero-title" className="hero__headline">
            Your PDFs.<br />
            <em className="hero__headline-em">Your workspace.</em>
          </h1>
          <p className="hero__description">
            Write naturally with Apple Pencil on iPad, teach from lecture slides,
            and work across tabs on Mac and Windows — with optional iCloud Drive
            and Google Drive sync where you stay in control.
          </p>

          <div className="hero__actions">
            <a
              href="/download/"
              className="btn btn--primary btn--lg hero__btn-primary"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open MaliPDF Download Center in a new tab"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download MaliPDF
            </a>

            <a
              href="#features"
              className="btn btn--outline btn--lg hero__btn-secondary"
            >
              Explore Features
            </a>
          </div>
          <p className="hero__notice">
            Free for macOS, iPadOS &amp; Windows · Optional iCloud Drive &amp; Google Drive sync.
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
          <div className="hero__note hero__note--context">Mac · iPad<br />Windows</div>
          <div className="hero__checklist"><span>Apple Pencil</span><span>iCloud &amp; Drive</span><span>Offline-first</span></div>
          <span className="hero__cross hero__cross--one" />
          <span className="hero__cross hero__cross--two" />
        </div>
      </div>
      <div className="hero__fade" aria-hidden="true" />
    </section>
  );
}
