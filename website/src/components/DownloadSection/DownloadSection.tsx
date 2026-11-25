import { downloads } from '../../config/downloads';
import './DownloadSection.css';

export function DownloadSection() {
  return (
    <section className="download section--lg" id="download" aria-labelledby="download-heading">
      <div className="container">
        <div className="download__panel">
          <div className="download__bg-deco" aria-hidden="true" />

          <div className="download__content">
            <span className="download__eyebrow section-eyebrow section-eyebrow--on-navy">
              Download Center
            </span>
            <h2 id="download-heading" className="download__title">
              Start annotating today.
            </h2>
            <p className="download__body">
              Explore all official store editions and installers for macOS, iPadOS, and Windows — organized by operating system and release version.
            </p>

            <div className="download__cta-single">
              <a
                href="/download/"
                className="btn btn--primary-navy btn--lg download__btn-main"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Go to Download Page →
              </a>
            </div>

            <p className="download__version">
              Latest Desktop v{downloads.version} · iPadOS v1.2
            </p>

            {/* Trust indicators */}
            <div className="download__trust">
              {[
                'macOS · App Store & DMG',
                'iPadOS · App Store',
                'Windows · Microsoft Store',
                'iPhone & Android (Upcoming)',
                'Offline-first + Optional Cloud Sync',
              ].map((item) => (
                <span className="download__trust-item" key={item}>
                  <span className="download__trust-dot" aria-hidden="true" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
