import { downloads, macosInstaller, windowsStore } from '../../config/downloads';
import './DownloadSection.css';

export function DownloadSection() {
  return (
    <section className="download section--lg" id="download" aria-labelledby="download-heading">
      <div className="container">
        <div className="download__panel">
          {/* Background decoration */}
          <div className="download__bg-deco" aria-hidden="true" />

          <div className="download__content">
            <span className="download__eyebrow section-eyebrow section-eyebrow--on-navy">
              Download MaliPDF
            </span>
            <h2 id="download-heading" className="download__title">
              Start annotating today.
            </h2>
            <p className="download__body">
              MaliPDF is a native desktop application for Apple silicon Macs and Windows.
              No account required. No subscription. Your documents stay on your machine.
            </p>

            <div className="download__buttons">
              <div className="download__platform">
                <a
                  href={macosInstaller.url}
                  download={macosInstaller.fileName}
                  className="btn btn--primary-navy btn--lg download__btn"
                  aria-label={`${downloads.macos.label}, version ${downloads.version}, Apple Silicon`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                  </svg>
                  {downloads.macos.label}
                </a>
                <span className="download__meta">
                  {macosInstaller.label} · {macosInstaller.sizeLabel}
                </span>
              </div>
              <div className="download__platform">
                <a
                  href={windowsStore.url}
                  className="btn btn--ghost-navy btn--lg download__btn"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Get MaliPDF from the Microsoft Store for Windows"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 5.1 10.4 4v7.2H3V5.1zm8.3-1.2L21 2.5v8.7h-9.7V3.9zM3 12.6h7.4v7.2L3 18.8v-6.2zm8.3 0H21v8.9l-9.7-1.4v-7.5z" />
              </svg>
                  {windowsStore.label}
                </a>
                <span className="download__meta">{windowsStore.meta}</span>
              </div>
            </div>

            <p className="download__version">
              Version {downloads.version}
            </p>

            {/* Trust indicators */}
            <div className="download__trust">
              {[
                'No account required',
                'Works offline',
                'Files stay on your machine',
                'Apple notarized',
                'Microsoft Store',
              ].map((item) => (
                <span className="download__trust-item" key={item}>
                  <span className="download__trust-dot" aria-hidden="true" />
                  {item}
                </span>
              ))}
            </div>

            <a
              href={downloads.releaseNotesUrl}
              className="download__release-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              View release notes for v{downloads.version} →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
