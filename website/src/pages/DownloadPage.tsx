import { useMemo, useState } from 'react';
import { downloads, ipadAppStore, macAppStore, macosInstaller, windowsStore } from '../config/downloads';
import { Footer } from '../components/Footer/Footer';
import './DownloadPage.css';

type OsFilter = 'all' | 'macos' | 'ios' | 'windows' | 'android';

function detectVisitorOs(): Exclude<OsFilter, 'all'> {
  if (typeof navigator === 'undefined') return 'macos';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  if (/Win/i.test(ua)) return 'windows';
  return 'macos';
}

export function DownloadPage() {
  const detectedOs = useMemo(() => detectVisitorOs(), []);
  const [filter, setFilter] = useState<OsFilter>('all');

  const show = (os: Exclude<OsFilter, 'all'>) => filter === 'all' || filter === os;

  const recommended = useMemo(() => {
    switch (detectedOs) {
      case 'ios':
        return {
          osName: 'iPadOS & iOS (Universal)',
          version: 'v1.5',
          meta: ipadAppStore.meta,
          label: ipadAppStore.fullLabel,
          url: ipadAppStore.url,
          secondaryLabel: null as string | null,
          secondaryUrl: null as string | null,
        };
      case 'windows':
        return {
          osName: 'Windows',
          version: `v${downloads.version}`,
          meta: windowsStore.meta,
          label: windowsStore.fullLabel,
          url: windowsStore.url,
          secondaryLabel: null,
          secondaryUrl: null,
        };
      case 'android':
        return {
          osName: 'Android (Upcoming) · Try Desktop or iPad Today',
          version: `v${downloads.version}`,
          meta: 'Google Play edition in development — syncs via Google Drive with Windows, iPad & Mac',
          label: 'View All Platforms Below',
          url: '#platforms',
          secondaryLabel: null,
          secondaryUrl: null,
        };
      default:
        return {
          osName: 'macOS (Apple Silicon)',
          version: `v${downloads.version}`,
          meta: macAppStore.meta,
          label: macAppStore.fullLabel,
          url: macAppStore.url,
          secondaryLabel: `Direct .dmg Installer (${macosInstaller.sizeLabel})`,
          secondaryUrl: macosInstaller.url,
        };
    }
  }, [detectedOs]);

  return (
    <div className="dl-page">
      {/* Top Sticky Header matching main site */}
      <header className="dl-header" role="banner">
        <div className="container dl-header__inner">
          <a href="/" className="dl-header__logo" aria-label="Back to MaliPDF home">
            <img src="/malipdf-icon.png" alt="" className="dl-header__logo-img" />
            <span className="dl-header__logo-text">MaliPDF</span>
            <span className="dl-header__badge">Downloads</span>
          </a>

          <nav className="dl-header__nav" aria-label="Platform sections">
            <a href="#macos">macOS</a>
            <a href="#ipados">iPad &amp; iPhone</a>
            <a href="#windows">Windows</a>
            <a href="#android">Android</a>
            <a href="#releases">Versions</a>
          </nav>

          <a href="/" className="btn btn--outline btn--sm dl-header__back">
            ← Back to Home
          </a>
        </div>
      </header>

      {/* Hero Banner — identical blueprint grid + warm ivory wash aesthetic as Home Hero */}
      <section className="dl-hero" aria-labelledby="dl-hero-title">
        <div className="dl-hero__bg-grid" aria-hidden="true" />
        <div className="dl-hero__wash dl-hero__wash--top" aria-hidden="true" />
        <div className="dl-hero__wash dl-hero__wash--bottom" aria-hidden="true" />

        <div className="container dl-hero__inner">
          <div className="dl-hero__copy">
            <p className="dl-hero__eyebrow">Official Download Center · All Operating Systems</p>
            <h1 id="dl-hero-title" className="dl-hero__title">
              MaliPDF for <em className="dl-hero__em">every device.</em>
            </h1>
            <p className="dl-hero__subtitle">
              Choose your operating system below. Every edition works completely offline
              with standard PDF files — and optionally syncs your Cloud library across
              ecosystems via iCloud Drive, Google Drive, or OneDrive.
            </p>
          </div>

          {/* Smart Auto-Detected Device Card */}
          <div className="dl-detected-card">
            <div className="dl-detected-card__top">
              <span className="dl-detected-card__pill">Recommended for your device</span>
              <span className="dl-detected-card__ver">{recommended.version}</span>
            </div>
            <h2 className="dl-detected-card__os">{recommended.osName}</h2>
            <p className="dl-detected-card__meta">{recommended.meta}</p>
            <div className="dl-detected-card__actions">
              <a
                href={recommended.url}
                className="btn btn--primary btn--lg dl-detected-card__btn"
                target={recommended.url.startsWith('http') ? '_blank' : undefined}
                rel={recommended.url.startsWith('http') ? 'noopener noreferrer' : undefined}
              >
                {recommended.label}
              </a>
              {recommended.secondaryUrl && recommended.secondaryLabel && (
                <a
                  href={recommended.secondaryUrl}
                  className="dl-detected-card__alt-link"
                >
                  or download {recommended.secondaryLabel}
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Operating System Filter Bar + Platform Cards */}
      <main className="dl-main section" id="platforms">
        <div className="container">
          <div className="dl-filter-bar" role="tablist" aria-label="Filter by operating system">
            {([
              { id: 'all', label: 'All Platforms' },
              { id: 'macos', label: 'macOS' },
              { id: 'ios', label: 'iPadOS & iOS' },
              { id: 'windows', label: 'Windows' },
              { id: 'android', label: 'Android' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                className={`dl-filter-btn${filter === tab.id ? ' dl-filter-btn--active' : ''}`}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="dl-os-grid">
            {/* 1. macOS */}
            {show('macos') && (
              <article className="dl-os-card" id="macos">
                <div className="dl-os-card__header">
                  <div className="dl-os-card__icon" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                    </svg>
                  </div>
                  <div>
                    <div className="dl-os-card__title-row">
                      <h3>macOS</h3>
                      <span className="dl-version-tag">v{downloads.version}</span>
                    </div>
                    <p className="dl-os-card__req">macOS 12 Monterey or later · Apple Silicon (M1, M2, M3, M4)</p>
                  </div>
                </div>

                <p className="dl-os-card__desc">
                  Full multi-tab desktop PDF workspace with Vision OCR, Word &amp; PowerPoint conversion, LaTeX math, Focus &amp; Presentation modes, plus integrated Cloud Library.
                </p>

                <div className="dl-channels">
                  <div className="dl-channel">
                    <div className="dl-channel__info">
                      <strong>Mac App Store</strong>
                      <span>Recommended · Sandboxed · Automatic updates</span>
                    </div>
                    <a
                      href={macAppStore.url}
                      className="btn btn--primary btn--sm"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open App Store →
                    </a>
                  </div>

                  <div className="dl-channel">
                    <div className="dl-channel__info">
                      <strong>Direct Installer (.dmg)</strong>
                      <span>Apple Silicon universal DMG · {macosInstaller.sizeLabel} · Developer ID notarized</span>
                    </div>
                    <a
                      href={macosInstaller.url}
                      className="btn btn--outline btn--sm"
                    >
                      Download .dmg
                    </a>
                  </div>
                </div>

                <div className="dl-os-card__footer">
                  <span>Sync support: iCloud Drive · Google Drive · OneDrive · Dropbox</span>
                </div>
              </article>
            )}

            {/* 2. iPadOS & iOS */}
            {show('ios') && (
              <article className="dl-os-card" id="ipados">
                <div className="dl-os-card__header">
                  <div className="dl-os-card__icon" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="2" width="16" height="20" rx="2.5" />
                      <line x1="12" y1="18" x2="12.01" y2="18" />
                    </svg>
                  </div>
                  <div>
                    <div className="dl-os-card__title-row">
                      <h3>iPadOS &amp; iOS</h3>
                      <span className="dl-version-tag">Universal v1.5</span>
                    </div>
                    <p className="dl-os-card__req">iPadOS &amp; iOS 16.0 or later · iPhone, iPad &amp; Apple Pencil Pro</p>
                  </div>
                </div>

                <p className="dl-os-card__desc">
                  Universal app for iPad and iPhone — tactile notebook &amp; PDF studio with Apple Pencil Double-Tap &amp; Squeeze on iPad, responsive pocket annotation on iPhone, and instant Device ⇄ iCloud Drive sync.
                </p>

                <div className="dl-channels">
                  <div className="dl-channel">
                    <div className="dl-channel__info">
                      <strong>App Store for iPad &amp; iPhone</strong>
                      <span>Universal App Store build · One download across iPhone &amp; iPad</span>
                    </div>
                    <a
                      href={ipadAppStore.url}
                      className="btn btn--primary btn--sm"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open App Store →
                    </a>
                  </div>
                </div>

                <div className="dl-os-card__footer">
                  <span>Sync support: Native iCloud Drive (Mac · iPad · iPhone)</span>
                </div>
              </article>
            )}

            {/* 3. Windows */}
            {show('windows') && (
              <article className="dl-os-card" id="windows">
                <div className="dl-os-card__header">
                  <div className="dl-os-card__icon" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 5.1 10.4 4v7.2H3V5.1zm8.3-1.2L21 2.5v8.7h-9.7V3.9zM3 12.6h7.4v7.2L3 18.8v-6.2zm8.3 0H21v8.9l-9.7-1.4v-7.5z" />
                    </svg>
                  </div>
                  <div>
                    <div className="dl-os-card__title-row">
                      <h3>Windows</h3>
                      <span className="dl-version-tag">v{downloads.version}</span>
                    </div>
                    <p className="dl-os-card__req">Windows 10 &amp; Windows 11 · 64-bit (x64)</p>
                  </div>
                </div>

                <p className="dl-os-card__desc">
                  Native desktop workspace for Windows PCs and pen-enabled Surface / Windows tablets, with full ribbon tools, multi-tab editing, and cross-ecosystem Cloud Library sync.
                </p>

                <div className="dl-channels">
                  <div className="dl-channel">
                    <div className="dl-channel__info">
                      <strong>Microsoft Store</strong>
                      <span>Official Store package · Installs &amp; updates automatically</span>
                    </div>
                    <a
                      href={windowsStore.url}
                      className="btn btn--primary btn--sm"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Microsoft Store →
                    </a>
                  </div>
                </div>

                <div className="dl-os-card__footer">
                  <span>Sync support: Google Drive · OneDrive · Dropbox · iCloud for Windows</span>
                </div>
              </article>
            )}

            {/* 4. Android & Google Play (Future-ready slot!) */}
            {show('android') && (
              <article className="dl-os-card dl-os-card--upcoming" id="android">
                <div className="dl-os-card__header">
                  <div className="dl-os-card__icon dl-os-card__icon--muted" aria-hidden="true">
                    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="4" width="14" height="17" rx="2" />
                      <path d="M9 1v3M15 1v3M9 17h6" />
                    </svg>
                  </div>
                  <div>
                    <div className="dl-os-card__title-row">
                      <h3>Android &amp; Tablets</h3>
                      <span className="dl-soon-pill">Planned</span>
                    </div>
                    <p className="dl-os-card__req">Android Phones &amp; Stylus Tablets · Google Play</p>
                  </div>
                </div>

                <p className="dl-os-card__desc">
                  Designed to share the exact same open PDF + Cloud Library format so notes written on iPad or Windows open seamlessly on Android tablets via Google Drive.
                </p>

                <div className="dl-channels">
                  <div className="dl-channel dl-channel--upcoming">
                    <div className="dl-channel__info">
                      <strong>Google Play Store</strong>
                      <span>Android tablet &amp; phone edition</span>
                    </div>
                    <span className="dl-soon-pill">In Roadmap</span>
                  </div>
                </div>

                <div className="dl-os-card__footer">
                  <span>Cross-ecosystem bridge: Google Drive</span>
                </div>
              </article>
            )}
          </div>

          {/* Version & Release Notes Table */}
          <section className="dl-releases" id="releases" aria-labelledby="dl-releases-heading">
            <div className="dl-releases__head">
              <div>
                <span className="section-eyebrow">Release Channels &amp; Versions</span>
                <h2 id="dl-releases-heading">Current versions by platform.</h2>
              </div>
              <a
                href="https://github.com/maliyildirimtr/malipdf/releases"
                className="btn btn--outline btn--sm"
                target="_blank"
                rel="noopener noreferrer"
              >
                All GitHub Releases &amp; Changelogs →
              </a>
            </div>

            <div className="dl-table-wrap">
              <table className="dl-table">
                <thead>
                  <tr>
                    <th>Operating System</th>
                    <th>Current Version</th>
                    <th>Distribution Channel</th>
                    <th>Architecture / Requirements</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>macOS</strong></td>
                    <td><code>v{downloads.version}</code></td>
                    <td>Mac App Store &amp; Direct <code>.dmg</code></td>
                    <td>macOS 12+ · Apple Silicon (arm64)</td>
                    <td><span className="dl-status dl-status--live">Available</span></td>
                  </tr>
                  <tr>
                    <td><strong>iPadOS</strong></td>
                    <td><code>v1.5</code></td>
                    <td>Apple App Store</td>
                    <td>iPadOS 16+ · Apple Pencil / Pro</td>
                    <td><span className="dl-status dl-status--live">Available</span></td>
                  </tr>
                  <tr>
                    <td><strong>Windows</strong></td>
                    <td><code>v{downloads.version}</code></td>
                    <td>Microsoft Store</td>
                    <td>Windows 10 / 11 · 64-bit (x64)</td>
                    <td><span className="dl-status dl-status--live">Available</span></td>
                  </tr>
                  <tr>
                    <td><strong>iOS (iPhone)</strong></td>
                    <td><code>v1.5</code></td>
                    <td>Apple App Store (Universal)</td>
                    <td>iOS 16+ · All modern iPhones</td>
                    <td><span className="dl-status dl-status--live">Available</span></td>
                  </tr>
                  <tr>
                    <td><strong>Android</strong></td>
                    <td><code>—</code></td>
                    <td>Google Play Store</td>
                    <td>Android Tablets &amp; Phones</td>
                    <td><span className="dl-status dl-status--soon">Planned</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
