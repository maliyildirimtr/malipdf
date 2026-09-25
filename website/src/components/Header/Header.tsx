import { useState, useEffect } from 'react';
import './Header.css';

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Workflow', href: '#workflow' },
  { label: 'Use Cases', href: '#use-cases' },
  { label: 'FAQ', href: '#faq' },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close menu on route change / link click
  const handleLinkClick = () => setMenuOpen(false);

  // Prevent body scroll when menu open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  return (
    <header className={`header${scrolled ? ' header--scrolled' : ''}`} role="banner">
      <div className="header__inner container">
        {/* Logo */}
        <a href="#" className="header__logo" aria-label="MaliPDF home">
          <img
            src="/malipdf-icon.png"
            alt=""
            className="header__logo-img"
            aria-hidden="true"
          />
          <span className="header__logo-text">MaliPDF</span>
        </a>

        {/* Desktop Nav */}
        <nav className="header__nav" aria-label="Primary navigation">
          <ul className="header__nav-list">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="header__nav-link">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Desktop CTA */}
        <a
          href="#download"
          className="btn btn--primary btn--sm header__cta"
          aria-label="Download MaliPDF"
        >
          Download
        </a>

        {/* Mobile hamburger */}
        <button
          className={`header__hamburger${menuOpen ? ' header__hamburger--open' : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {/* Mobile menu */}
      <div
        id="mobile-menu"
        className={`header__mobile-menu${menuOpen ? ' header__mobile-menu--open' : ''}`}
        aria-hidden={!menuOpen}
      >
        <nav aria-label="Mobile navigation">
          <ul className="header__mobile-list">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="header__mobile-link"
                  onClick={handleLinkClick}
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#download"
                className="btn btn--primary header__mobile-cta"
                onClick={handleLinkClick}
              >
                Download
              </a>
            </li>
          </ul>
        </nav>
      </div>

      {/* Mobile overlay */}
      {menuOpen && (
        <div
          className="header__overlay"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}
    </header>
  );
}
