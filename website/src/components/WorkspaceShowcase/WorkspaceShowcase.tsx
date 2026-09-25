import './WorkspaceShowcase.css';

const workspaceFeatures = [
  {
    label: 'Multi-tab documents',
    description: 'Open several PDFs in separate tabs. Switch between them without losing your place.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="7" width="20" height="14" rx="2"/>
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      </svg>
    ),
  },
  {
    label: 'Page thumbnails',
    description: 'Sidebar page navigator for quick visual scanning and jumping to any page.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx="1"/>
        <rect x="14" y="3" width="7" height="9" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    label: 'Zoom, Fit Page, Fit Width',
    description: 'Navigate dense documents at any zoom level. Fit-page and fit-width for comfortable reading.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="11" y1="8" x2="11" y2="14"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
    ),
  },
  {
    label: 'Page navigation',
    description: 'Previous / next page, direct page number entry, and keyboard navigation throughout.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    ),
  },
  {
    label: 'Native-feeling interface',
    description: 'A desktop application layout — not a browser-based workaround. Keyboard shortcuts, menus and window management that feel right.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8M12 17v4"/>
      </svg>
    ),
  },
];

export function WorkspaceShowcase() {
  return (
    <section className="workspace section--lg" id="workflow" aria-labelledby="workspace-heading">
      <div className="container">
        <div className="workspace__grid">
          {/* Text content */}
          <div className="workspace__text reveal">
            <span className="section-eyebrow">PDF Workspace</span>
            <h2 id="workspace-heading" className="workspace__title">
              A real desktop<br />PDF environment.
            </h2>
            <p className="workspace__body">
              MaliPDF is not just a drawing layer over a document viewer.
              It is a full workspace built for focused, extended sessions with
              PDF documents — with the navigation and organization features
              serious work requires.
            </p>

            <ul className="workspace__features" aria-label="Workspace features">
              {workspaceFeatures.map((feat) => (
                <li className="workspace__feature" key={feat.label}>
                  <div className="workspace__feature-icon" aria-hidden="true">
                    {feat.icon}
                  </div>
                  <div>
                    <h4 className="workspace__feature-label">{feat.label}</h4>
                    <p className="workspace__feature-desc">{feat.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Workspace mockup */}
          <div className="workspace__mockup-area reveal">
            <div className="workspace__mockup">
              {/* Window chrome */}
              <div className="workspace__chrome">
                <div className="workspace__chrome-dots" aria-hidden="true">
                  <span className="ws-dot ws-dot--red" />
                  <span className="ws-dot ws-dot--yellow" />
                  <span className="ws-dot ws-dot--green" />
                </div>
                <div className="workspace__chrome-tabs" aria-hidden="true">
                  <span className="ws-tab ws-tab--active">Research_2024.pdf</span>
                  <span className="ws-tab">Ch3_Mechanics.pdf</span>
                  <span className="ws-tab">Notes.pdf</span>
                </div>
              </div>

              {/* App layout */}
              <div className="workspace__app" aria-label="PDF workspace mockup — placeholder for real screenshot" aria-hidden="true">
                {/* Sidebar thumbnails */}
                <div className="workspace__sidebar">
                  <div className="workspace__sidebar-label">Pages</div>
                  {[1,2,3,4,5,6,7].map((n) => (
                    <div key={n} className={`ws-thumb${n === 2 ? ' ws-thumb--active' : ''}`}>
                      <div className="ws-thumb-page">
                        <div className="ws-thumb-line" style={{ width: '70%' }} />
                        <div className="ws-thumb-line" style={{ width: '50%' }} />
                        <div className="ws-thumb-line" style={{ width: '80%' }} />
                      </div>
                      <span className="ws-thumb-num">{n}</span>
                    </div>
                  ))}
                </div>

                {/* Main canvas */}
                <div className="workspace__main">
                  {/* Zoom bar */}
                  <div className="workspace__zoombar">
                    <button className="ws-zoom-btn" tabIndex={-1}>−</button>
                    <span className="ws-zoom-val">85%</span>
                    <button className="ws-zoom-btn" tabIndex={-1}>+</button>
                    <span className="ws-zoom-sep" />
                    <span className="ws-zoom-fit">Fit Width</span>
                    <span className="ws-zoom-sep" />
                    <span className="ws-zoom-page">Page 2 / 24</span>
                  </div>

                  {/* PDF document */}
                  <div className="workspace__document">
                    <div className="ws-doc-page">
                      {/* Simulated academic content */}
                      <div className="ws-doc-heading" />
                      {[80, 65, 90, 55, 75, 85, 60, 70].map((w, i) => (
                        <div key={i} className="ws-doc-line" style={{ width: `${w}%` }} />
                      ))}
                      <div style={{ height: '16px' }} />
                      {[70, 85, 50, 95, 65].map((w, i) => (
                        <div key={i} className="ws-doc-line" style={{ width: `${w}%` }} />
                      ))}
                      {/* Annotation on top */}
                      <div className="ws-doc-annotation" />
                    </div>
                  </div>

                  {/* Nav bar */}
                  <div className="workspace__navbar">
                    <button className="ws-nav-btn" tabIndex={-1}>‹ Prev</button>
                    <span className="ws-nav-info">Page 2 of 24</span>
                    <button className="ws-nav-btn" tabIndex={-1}>Next ›</button>
                  </div>
                </div>
              </div>

              <p className="workspace__mockup-label" aria-hidden="true">
                Placeholder — insert real screenshot here
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
