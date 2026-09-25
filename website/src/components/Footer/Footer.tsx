import './Footer.css';

const currentYear = new Date().getFullYear();

const footerLinks = {
  product: [
    { label: 'Features', href: '#features' },
    { label: 'Workflow', href: '#workflow' },
    { label: 'Use Cases', href: '#use-cases' },
    { label: 'Download', href: '#download' },
    { label: 'FAQ', href: '#faq' },
  ],
  legal: [
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Use', href: '/terms' },
  ],
};

export function Footer() {
  return (
    <footer className="footer" role="contentinfo">
      <div className="container">
        <div className="footer__grid">
          {/* Brand column */}
          <div className="footer__brand">
            <a href="#" className="footer__logo" aria-label="MaliPDF home">
              <img
                src="/malipdf-icon.png"
                alt=""
                className="footer__logo-img"
                aria-hidden="true"
              />
              <span className="footer__logo-text">MaliPDF</span>
            </a>
            <p className="footer__tagline">
              PDF annotation for serious work.
            </p>
            <p className="footer__desc">
              A native desktop application for macOS and Windows, built
              for students, lecturers, engineers and researchers.
            </p>
          </div>

          {/* Product links */}
          <div className="footer__col">
            <h4 className="footer__col-heading">Product</h4>
            <ul className="footer__col-list">
              {footerLinks.product.map(({ label, href }) => (
                <li key={label}>
                  <a href={href} className="footer__link">{label}</a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal / Info */}
          <div className="footer__col">
            <h4 className="footer__col-heading">Info</h4>
            <ul className="footer__col-list">
              {footerLinks.legal.map(({ label, href }) => (
                <li key={label}>
                  <a href={href} className="footer__link">{label}</a>
                </li>
              ))}
              {/* GitHub placeholder — uncomment when ready */}
              {/*
              <li>
                <a href="https://github.com/malipdf" className="footer__link" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>
              </li>
              */}
            </ul>
          </div>
        </div>

        <div className="footer__bottom">
          <p className="footer__copy">
            © {currentYear} MaliPDF. All rights reserved.
          </p>
          <p className="footer__sub">
            Built for focused PDF work.
          </p>
        </div>
      </div>
    </footer>
  );
}
