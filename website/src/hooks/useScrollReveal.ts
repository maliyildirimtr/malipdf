import { useEffect, useRef, useCallback } from 'react';

/**
 * Intersection Observer hook for scroll-reveal animations.
 * Adds 'visible' class to elements as they enter the viewport.
 */
export function useScrollReveal(threshold = 0.12) {
  const observerRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible');
              observerRef.current?.unobserve(entry.target);
            }
          });
        },
        { threshold, rootMargin: '0px 0px -40px 0px' }
      );
    }
    observerRef.current.observe(node);
  }, [threshold]);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  return ref;
}

/**
 * Observe all .reveal elements on mount for scroll-driven reveals.
 */
export function usePageReveal() {
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
      { threshold: 0.1, rootMargin: '0px 0px -48px 0px' }
    );

    const elements = document.querySelectorAll('.reveal');
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);
}
