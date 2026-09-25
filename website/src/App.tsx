import { useEffect } from 'react';
import { Header } from './components/Header/Header';
import { Hero } from './components/Hero/Hero';
import { AnnotationShowcase } from './components/AnnotationShowcase/AnnotationShowcase';
import { WorkspaceShowcase } from './components/WorkspaceShowcase/WorkspaceShowcase';
import { TeachingSection } from './components/TeachingSection/TeachingSection';
import { PrintoutSection } from './components/PrintoutSection/PrintoutSection';
import { UseCases } from './components/UseCases/UseCases';
import { FeatureOverview } from './components/FeatureOverview/FeatureOverview';
import { DownloadSection } from './components/DownloadSection/DownloadSection';
import { FAQ } from './components/FAQ/FAQ';
import { Footer } from './components/Footer/Footer';

function App() {
  // Initialize scroll-reveal observers for all .reveal elements
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -48px 0px' }
    );

    const timer = setTimeout(() => {
      const elements = document.querySelectorAll('.reveal');
      elements.forEach((el) => observer.observe(el));
    }, 100);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <Header />
      <main id="main-content">
        <Hero />
        <AnnotationShowcase />
        <WorkspaceShowcase />
        <TeachingSection />
        <PrintoutSection />
        <UseCases />
        <FeatureOverview />
        <DownloadSection />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}

export default App;
