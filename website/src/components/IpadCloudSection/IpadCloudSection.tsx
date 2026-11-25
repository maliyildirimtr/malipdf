import { ipadAppStore } from '../../config/downloads';
import './IpadCloudSection.css';

const ipadHighlights = [
  {
    title: 'Apple Pencil & Pencil Pro',
    body: 'Curvature-adaptive liquid ink, pressure & tilt fountain/calligraphy nibs, Double-Tap eraser toggle, and Pencil Pro Squeeze palette.',
  },
  {
    title: 'Notebooks, Templates & Endless Page',
    body: 'Create lined, grid, dotted, millimetric, or Cornell notebooks with custom covers — or extend any PDF page downward as you write.',
  },
  {
    title: 'Built-in Image Studio',
    body: 'Crop, enhance scanned handouts, remove white backgrounds, censor sensitive lines, and drag selections seamlessly across pages.',
  },
  {
    title: 'Device-Only or Cloud — Your Choice',
    body: 'Switch between This Device and Cloud right from your library. Sync selected notebooks across Mac, iPad, and Windows via iCloud Drive or Google Drive.',
  },
];

export function IpadCloudSection() {
  return (
    <section className="ipad-cloud section" id="ipad" aria-labelledby="ipad-cloud-heading">
      <div className="container">
        <div className="ipad-cloud__layout">
          {/* Left column: copy + highlights */}
          <div className="ipad-cloud__copy reveal">
            <span className="section-eyebrow">iPadOS &amp; Cross-Device Sync</span>
            <h2 id="ipad-cloud-heading" className="ipad-cloud__title">
              Handwrite on iPad.<br />
              Continue on Mac &amp; Windows.
            </h2>
            <p className="ipad-cloud__lead">
              MaliPDF brings a tactile iPadOS notebook and PDF studio together with
              the full desktop editor. Keep private files strictly on your device, or
              flip into Cloud mode to keep folders and editable ink in sync through
              your own iCloud Drive or Google Drive — with zero subscriptions.
            </p>

            <div className="ipad-cloud__cards">
              {ipadHighlights.map((item) => (
                <div className="ipad-cloud__card" key={item.title}>
                  <h3 className="ipad-cloud__card-title">{item.title}</h3>
                  <p className="ipad-cloud__card-body">{item.body}</p>
                </div>
              ))}
            </div>

            <div className="ipad-cloud__cta-row">
              <a
                href="/download/#ipados"
                className="btn btn--primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get MaliPDF for iPad &amp; Desktop →
              </a>
              <span className="ipad-cloud__cta-meta">{ipadAppStore.meta}</span>
            </div>
          </div>

          {/* Right column: stylized iPad Pro + Cloud Switcher mockup */}
          <div className="ipad-cloud__visual reveal" aria-hidden="true">
            <div className="ipad-mockup">
              <div className="ipad-mockup__topbar">
                <div className="ipad-mockup__dots">
                  <span />
                  <span />
                </div>
                <div className="ipad-mockup__tools">
                  <span className="ipad-mockup__tool ipad-mockup__tool--active">✎</span>
                  <span className="ipad-mockup__tool">🖍</span>
                  <span className="ipad-mockup__tool">⌫</span>
                  <span className="ipad-mockup__tool">⬚</span>
                  <span className="ipad-mockup__tool">T</span>
                  <span className="ipad-mockup__tool">◯</span>
                </div>
                <div className="ipad-mockup__sync-pill">
                  <span className="ipad-mockup__sync-dot" />
                  iCloud Drive · Synced
                </div>
              </div>

              <div className="ipad-mockup__body">
                {/* Left mini library sidebar with Device <-> Cloud pill */}
                <div className="ipad-mockup__sidebar">
                  <div className="ipad-mockup__nav ipad-mockup__nav--active">Home (iCloud)</div>
                  <div className="ipad-mockup__nav">Favorites</div>
                  <div className="ipad-mockup__nav">Recent</div>
                  <div className="ipad-mockup__folder">📁 Thermodynamics</div>
                  <div className="ipad-mockup__folder">📁 Linear Algebra</div>

                  <div className="ipad-mockup__scope-switch">
                    <span className="ipad-mockup__scope-btn">💻</span>
                    <span className="ipad-mockup__scope-btn ipad-mockup__scope-btn--on">☁️</span>
                  </div>
                </div>

                {/* Right grid note canvas with Apple Pencil ink + floating palette */}
                <div className="ipad-mockup__canvas">
                  <div className="ipad-mockup__page">
                    <div className="ipad-mockup__page-tag">Lecture 04 · Cornell Grid</div>
                    <svg className="ipad-mockup__ink" viewBox="0 0 360 220" fill="none">
                      {/* Soft yellow highlight */}
                      <path
                        d="M28 42 H238"
                        stroke="rgba(250, 204, 21, 0.45)"
                        strokeWidth="16"
                        strokeLinecap="round"
                      />
                      {/* Handwritten equation & curve */}
                      <path
                        d="M32 44 C52 30, 68 54, 90 40 C112 26, 128 50, 154 38 C178 28, 198 48, 226 39"
                        stroke="#163b6e"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                      <rect
                        x="30"
                        y="78"
                        width="136"
                        height="86"
                        rx="8"
                        stroke="#2868bd"
                        strokeWidth="2.2"
                        fill="rgba(40, 104, 189, 0.05)"
                      />
                      <path
                        d="M46 146 Q96 86 150 132"
                        stroke="#e4593d"
                        strokeWidth="2.8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M174 120 H226 M218 113 L228 120 L218 127"
                        stroke="#163b6e"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <ellipse
                        cx="278"
                        cy="120"
                        rx="52"
                        ry="32"
                        stroke="#2a8a64"
                        strokeWidth="2.2"
                        fill="rgba(42, 138, 100, 0.06)"
                      />
                    </svg>

                    {/* Floating Apple Pencil Pro Squeeze Palette */}
                    <div className="ipad-mockup__squeeze-palette">
                      <span className="ipad-mockup__swatch" style={{ background: '#163b6e' }} />
                      <span className="ipad-mockup__swatch" style={{ background: '#e4593d' }} />
                      <span className="ipad-mockup__swatch" style={{ background: '#2a8a64' }} />
                      <span className="ipad-mockup__swatch" style={{ background: '#f59e0b' }} />
                      <span className="ipad-mockup__squeeze-label">Pencil Pro</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="ipad-cloud__ecosystems">
              <span> iCloud Drive (Mac · iPad)</span>
              <span>☁️ Google Drive (iPad · Windows · Mac)</span>
              <span>📁 OneDrive &amp; Dropbox</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
