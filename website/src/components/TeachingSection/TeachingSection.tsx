import './TeachingSection.css';

const audiences = [
  { role: 'Students', icon: '📖' },
  { role: 'Lecturers', icon: '🎓' },
  { role: 'Engineers', icon: '⚙️' },
  { role: 'Researchers', icon: '🔬' },
];

export function TeachingSection() {
  return (
    <section className="teaching section--lg" aria-labelledby="teaching-heading">
      <div className="container">
        {/* Navy accent panel */}
        <div className="teaching__panel">
          <div className="teaching__panel-text reveal">
            <span className="section-eyebrow section-eyebrow--on-navy">
              Drawing &amp; Teaching Tools
            </span>
            <h2 id="teaching-heading" className="teaching__title">
              Made for explaining ideas.
            </h2>
            <p className="teaching__body">
              Whether you're working through a derivation, marking up lecture slides,
              or annotating an engineering specification — MaliPDF's drawing tools
              are built for clarity and precision, not decoration.
            </p>

            <ul className="teaching__tools" aria-label="Drawing and teaching tools">
              {[
                ['Pen', 'Natural freehand strokes with adjustable weight for handwritten notes and diagrams'],
                ['Highlighter', 'Semi-transparent overlay for text emphasis and region marking'],
                ['Shapes', 'Rectangles, ellipses and lines — the vocabulary of technical drawing'],
                ['Text', 'Type annotations anywhere on the page'],
                ['Polygon', 'Multi-point closed shapes for complex marking and region definition'],
              ].map(([name, desc]) => (
                <li key={name} className="teaching__tool-item">
                  <span className="teaching__tool-name">{name}</span>
                  <span className="teaching__tool-desc">{desc}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Audience tags */}
          <div className="teaching__audiences reveal">
            <p className="teaching__audiences-label">Who uses it</p>
            <div className="teaching__audience-grid">
              {audiences.map(({ role, icon }) => (
                <div className="teaching__audience-card" key={role}>
                  <span className="teaching__audience-icon" aria-hidden="true">{icon}</span>
                  <span className="teaching__audience-role">{role}</span>
                </div>
              ))}
            </div>

            {/* Examples */}
            <div className="teaching__examples">
              <p className="teaching__examples-label">Use cases</p>
              <ul className="teaching__examples-list">
                {[
                  'Annotate lecture PDF slides with freehand notes',
                  'Work through problem sets directly on scanned exam sheets',
                  'Draw circuit diagrams or structural sketches on technical documents',
                  'Mark up research papers with highlights and comments',
                  'Prepare materials for presenting and teaching live',
                ].map((item) => (
                  <li key={item} className="teaching__example-item">{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
