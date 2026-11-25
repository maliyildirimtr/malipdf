import { useState } from 'react';
import './FAQ.css';

const faqs = [
  {
    id: 'what-is',
    question: 'What is MaliPDF?',
    answer:
      'MaliPDF is a native PDF annotation and notebook workspace for Apple silicon Macs, iPad (with full Apple Pencil & Pencil Pro support), and Windows. Draw, highlight, add LaTeX formulas, edit images, and organize notebooks — with zero accounts or subscriptions.',
  },
  {
    id: 'ipad-sync',
    question: 'How does syncing work between Mac, iPad, and Windows?',
    answer:
      'Your library includes a simple Device ⇄ Cloud switch. Files in This Device mode stay strictly local and are never uploaded. Files created in or moved to Cloud mode sync automatically through your own iCloud Drive (Mac & iPad) or Google Drive / OneDrive (iPad, Windows & Mac) with conflict protection.',
  },
  {
    id: 'modifies-pdf',
    question: 'Are my handwritten notes still editable after saving?',
    answer:
      'Yes. MaliPDF saves standard .pdf files that open in any PDF viewer while keeping your strokes, highlights, text boxes, and images fully editable whenever you reopen them in MaliPDF on any device.',
  },
  {
    id: 'lecture-slides',
    question: 'Can I annotate lecture slides and present live?',
    answer:
      'Yes. Open any PDF or slide deck, present in Slide Show mode with a live laser pointer and smooth pen ink, or import slides as annotatable printout pages with extra writing room.',
  },
  {
    id: 'images',
    question: 'Does MaliPDF include image editing tools?',
    answer:
      'Yes. Insert photos from files, camera, clipboard, or region screenshots, then open the built-in Image Studio to crop, enhance scanned pages, remove white backgrounds, or mosaic-censor sensitive details.',
  },
  {
    id: 'offline',
    question: 'Does it work completely offline?',
    answer:
      'Yes. MaliPDF is offline-first on Mac, iPad, and Windows. No internet connection or user account is required to read, create notebooks, annotate, or save your work.',
  },
  {
    id: 'windows',
    question: 'Where can I download MaliPDF?',
    answer:
      'MaliPDF is available on the App Store for Mac and iPad, and on the Microsoft Store for Windows 10 and 11, with automatic store updates.',
  },
];

interface FAQItemProps {
  id: string;
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}

function FAQItem({ id, question, answer, isOpen, onToggle }: FAQItemProps) {
  return (
    <div className={`faq__item${isOpen ? ' faq__item--open' : ''}`}>
      <button
        className="faq__question"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`faq-answer-${id}`}
        id={`faq-btn-${id}`}
      >
        <span>{question}</span>
        <span className="faq__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </button>
      <div
        className="faq__answer"
        id={`faq-answer-${id}`}
        role="region"
        aria-labelledby={`faq-btn-${id}`}
        hidden={!isOpen}
      >
        <p>{answer}</p>
      </div>
    </div>
  );
}

export function FAQ() {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <section className="faq section" id="faq" aria-labelledby="faq-heading">
      <div className="container--narrow">
        <div className="faq__header reveal">
          <span className="section-eyebrow">FAQ</span>
          <h2 id="faq-heading">Common questions.</h2>
        </div>

        <div className="faq__list" role="list">
          {faqs.map((item) => (
            <FAQItem
              key={item.id}
              {...item}
              isOpen={openId === item.id}
              onToggle={() => toggle(item.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
