import './PrintoutSection.css';

export function PrintoutSection() {
  return (
    <section className="printout section--lg" aria-labelledby="printout-heading">
      <div className="container">
        {/* Header */}
        <div className="printout__header reveal">
          <span className="section-eyebrow">PDF Printout</span>
          <h2 id="printout-heading" className="printout__title">
            Bring lecture slides<br />into your notes.
          </h2>
          <p className="printout__subtitle">
            Import any PDF as a set of printout pages — then annotate directly
            on top, as if you had printed and written on the paper.
          </p>
        </div>

        {/* Workflow diagram */}
        <div className="printout__workflow reveal" aria-label="Printout workflow diagram">
          {/* Step 1 */}
          <div className="printout__step">
            <div className="printout__step-visual printout__step-visual--source">
              <div className="printout__pdf-icon" aria-hidden="true">
                <svg width="32" height="40" viewBox="0 0 32 40" fill="none" aria-hidden="true">
                  <rect width="32" height="40" rx="4" fill="rgba(45,95,168,0.15)" stroke="rgba(45,95,168,0.4)" strokeWidth="1.5"/>
                  <rect x="6" y="10" width="20" height="3" rx="1" fill="rgba(45,95,168,0.4)"/>
                  <rect x="6" y="16" width="16" height="2" rx="1" fill="rgba(45,95,168,0.3)"/>
                  <rect x="6" y="21" width="18" height="2" rx="1" fill="rgba(45,95,168,0.3)"/>
                  <rect x="6" y="26" width="14" height="2" rx="1" fill="rgba(45,95,168,0.25)"/>
                  <text x="16" y="37" textAnchor="middle" fill="rgba(45,95,168,0.7)" fontSize="5" fontWeight="700">.PDF</text>
                </svg>
              </div>
              <div className="printout__step-pages" aria-hidden="true">
                {[1,2,3].map((n) => (
                  <div key={n} className="printout__page-thumb" style={{ transform: `translateX(${(n-1)*6}px) translateY(${(n-1)*4}px)` }} />
                ))}
              </div>
            </div>
            <div className="printout__step-label">
              <span className="printout__step-num">1</span>
              <div>
                <h4>Source PDF</h4>
                <p>Any PDF — lecture slides, textbook chapters, specifications</p>
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="printout__arrow" aria-hidden="true">
            <svg width="40" height="24" viewBox="0 0 40 24" fill="none">
              <path d="M2 12 H36 M28 4 L38 12 L28 20" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="printout__arrow-label">Import</span>
          </div>

          {/* Step 2 — MaliPDF */}
          <div className="printout__step">
            <div className="printout__step-visual printout__step-visual--malipdf">
              <div className="printout__malipdf-badge" aria-hidden="true">
                <span className="printout__m-mark">M</span>
                <span className="printout__m-text">MaliPDF</span>
              </div>
              <div className="printout__conversion-lines" aria-hidden="true">
                {[1,2,3,4].map((n) => (
                  <div key={n} className="printout__conv-line" />
                ))}
              </div>
            </div>
            <div className="printout__step-label">
              <span className="printout__step-num">2</span>
              <div>
                <h4>Open in MaliPDF</h4>
                <p>Each imported page becomes an editable printout layer in your document</p>
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="printout__arrow" aria-hidden="true">
            <svg width="40" height="24" viewBox="0 0 40 24" fill="none">
              <path d="M2 12 H36 M28 4 L38 12 L28 20" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="printout__arrow-label">Annotate</span>
          </div>

          {/* Step 3 */}
          <div className="printout__step">
            <div className="printout__step-visual printout__step-visual--annotated">
              <div className="printout__annotated-page" aria-hidden="true">
                {/* Simulated annotated printout */}
                <div className="printout__page-content">
                  <div className="pa-line" style={{ width: '80%' }} />
                  <div className="pa-line" style={{ width: '65%' }} />
                  <div className="pa-highlight" />
                  <div className="pa-line" style={{ width: '70%' }} />
                  <div className="pa-pen-stroke" />
                  <div className="pa-line" style={{ width: '55%' }} />
                  <div className="pa-text-note">← see notes</div>
                </div>
              </div>
            </div>
            <div className="printout__step-label">
              <span className="printout__step-num">3</span>
              <div>
                <h4>Annotated printout</h4>
                <p>Write, draw and highlight directly on the slide pages — original PDF is never modified</p>
              </div>
            </div>
          </div>
        </div>

        {/* Feature callouts */}
        <div className="printout__callouts reveal">
          {[
            {
              title: 'Non-destructive',
              body: 'Your original PDF file is never modified. All annotations live in the MaliPDF project file.',
            },
            {
              title: 'Page-accurate',
              body: 'Each imported page is placed accurately — annotations align precisely with the source content.',
            },
            {
              title: 'PowerPoint Printout',
              body: 'PowerPoint Printout support is in active development. Import .pptx slides into your annotation workflow.',
              badge: 'In development',
            },
          ].map(({ title, body, badge }) => (
            <div className="printout__callout" key={title}>
              <h4 className="printout__callout-title">
                {title}
                {badge && <span className="printout__badge">{badge}</span>}
              </h4>
              <p className="printout__callout-body">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
