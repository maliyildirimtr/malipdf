import './UseCases.css';

const cases = [
  {
    id: 'students',
    title: 'Students',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    ),
    headline: 'Everything you need to study from a screen.',
    body: 'Annotate lecture PDFs, work through problem sets directly on slides, paste in screenshots of board work, and build a visual record of how you understood each topic.',
    details: [
      'Annotate lecture slides with handwritten notes',
      'Solve problems directly on the PDF page',
      'Import scanned problem sheets as printout pages',
      'Paste screenshots and mark up diagrams',
      'Undo, revise and reorganize without reprinting',
    ],
  },
  {
    id: 'lecturers',
    title: 'Lecturers',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="5"/>
        <path d="M20 21a8 8 0 1 0-16 0"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    headline: 'Present and mark up without modifying source files.',
    body: 'Keep your original lecture materials intact. Open PDFs in MaliPDF to annotate, highlight key concepts, and sketch in real time — without touching the source documents.',
    details: [
      'Add live annotations during presentations',
      'Highlight critical passages without editing the source',
      'Draw diagrams and worked examples on top of slides',
      'Prepare marked-up copies without duplicating files',
      'Navigate multi-page lecture packs efficiently',
    ],
  },
  {
    id: 'engineering',
    title: 'Engineering',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41"/>
        <line x1="12" y1="2" x2="12" y2="5"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
        <line x1="2" y1="12" x2="5" y2="12"/>
        <line x1="19" y1="12" x2="22" y2="12"/>
      </svg>
    ),
    headline: 'Mark up technical documents the way engineers think.',
    body: 'Sketch free-body diagrams, annotate specifications, highlight tolerances and calculation steps — directly on the technical PDF without exporting to another format.',
    details: [
      'Draw freehand diagrams and force arrows on schematics',
      'Mark up specification documents without conversion',
      'Annotate circuit diagrams and structural drawings',
      'Highlight critical dimensions and tolerances',
      'Add polygon regions for complex area marking',
    ],
  },
  {
    id: 'research',
    title: 'Research',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
    headline: 'Read, annotate and think visually in one place.',
    body: 'Work through research papers with your full annotation vocabulary — highlight passages, sketch ideas next to figures, add text comments, and build a visual understanding of complex material.',
    details: [
      'Highlight and annotate academic papers',
      'Add margin notes next to figures and equations',
      'Mark up methodology sections with shapes and arrows',
      'Organize multi-document reading with tabs',
      'Insert relevant screenshots alongside the paper',
    ],
  },
];

export function UseCases() {
  return (
    <section className="usecases section--lg" id="use-cases" aria-labelledby="usecases-heading">
      <div className="container">
        <div className="usecases__header reveal">
          <span className="section-eyebrow">Use Cases</span>
          <h2 id="usecases-heading">
            Built for real work.
          </h2>
          <p className="usecases__subtitle">
            MaliPDF is designed around how people actually use PDFs —
            not around feature checklists.
          </p>
        </div>

        <div className="usecases__grid">
          {cases.map((uc) => (
            <article className="usecase-card reveal" key={uc.id} aria-labelledby={`uc-${uc.id}-title`}>
              <div className="usecase-card__icon" aria-hidden="true">
                {uc.icon}
              </div>
              <div className="usecase-card__tag">{uc.title}</div>
              <h3 id={`uc-${uc.id}-title`} className="usecase-card__headline">
                {uc.headline}
              </h3>
              <p className="usecase-card__body">{uc.body}</p>
              <ul className="usecase-card__details" aria-label={`${uc.title} use case details`}>
                {uc.details.map((d) => (
                  <li key={d} className="usecase-card__detail">{d}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
