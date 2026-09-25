import { useState } from 'react';
import './FAQ.css';

const faqs = [
  {
    id: 'what-is',
    question: 'What is MaliPDF?',
    answer:
      'MaliPDF is a native desktop PDF annotation application for macOS and Windows. It lets you draw, highlight, add text, insert shapes and arrows, and annotate directly on PDF pages — without modifying the original file. It is built for students, lecturers, engineers and researchers who work intensively with PDF documents.',
  },
  {
    id: 'modifies-pdf',
    question: 'Does MaliPDF modify my original PDF?',
    answer:
      'No. MaliPDF stores all annotations in its own project file, separate from your source PDF. Your original document is never overwritten or changed.',
  },
  {
    id: 'lecture-slides',
    question: 'Can I annotate lecture slides?',
    answer:
      'Yes. You can open any PDF — including lecture slides exported from presentation software — and annotate directly on top with pen, highlighter, text, shapes and more. You can also import a PDF as a printout and annotate page by page.',
  },
  {
    id: 'printout',
    question: 'Can I insert another PDF as a printout?',
    answer:
      'Yes. The PDF Printout feature lets you import any PDF, placing each of its pages as an annotatable layer within your current document. This is useful for annotating lecture slides, textbook pages, or specification documents in context.',
  },
  {
    id: 'images',
    question: 'Does MaliPDF support inserting images?',
    answer:
      'Yes. You can insert image files directly, drag and drop images onto the canvas, paste from your clipboard, take a full screenshot, or capture a specific region of your screen — all inserted as annotation elements that can be moved and resized.',
  },
  {
    id: 'offline',
    question: 'Does it work offline?',
    answer:
      'Yes, MaliPDF is a fully local desktop application. It does not require an internet connection to run, annotate, or save your work. Your files remain on your machine.',
  },
  {
    id: 'windows',
    question: 'Is there a Windows version?',
    answer:
      'A Windows version is in development. The current build is focused on macOS. Check back for updates or subscribe to release notifications when they are available.',
  },
  {
    id: 'powerpoint',
    question: 'Does MaliPDF support PowerPoint files?',
    answer:
      'PowerPoint Printout support is currently in active development. The goal is to allow you to import .pptx slide decks and annotate each slide as a printout page, similar to the PDF printout workflow. This feature is not yet available in the current release.',
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
