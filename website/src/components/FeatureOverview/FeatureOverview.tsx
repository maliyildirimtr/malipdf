import './FeatureOverview.css';

const featureGroups = [
  {
    category: 'Annotate',
    description: 'Core drawing and markup tools',
    features: [
      'Pen (freehand drawing)',
      'Highlighter (semi-transparent brush)',
      'Text annotation',
      'Rectangle, ellipse and line shapes',
      'Arrow tool',
      'Polygon (multi-point)',
      'Undo / Redo',
    ],
  },
  {
    category: 'Select & Edit',
    description: 'Manage and refine annotations',
    features: [
      'Select single annotation',
      'Multi-select',
      'Move annotation',
      'Resize annotation',
      'Eraser tool',
      'Delete selected',
    ],
  },
  {
    category: 'Insert',
    description: 'Add content to your document',
    features: [
      'Insert image file',
      'Drag & drop image',
      'Paste from clipboard',
      'Full screenshot capture',
      'Region screenshot (select area)',
      'PDF printout import',
    ],
  },
  {
    category: 'Navigate',
    description: 'Move through documents efficiently',
    features: [
      'Multi-tab documents',
      'Page thumbnail sidebar',
      'Previous / Next page',
      'Direct page number entry',
      'Zoom in / Zoom out',
      'Fit Page / Fit Width',
    ],
  },
  {
    category: 'Workflow',
    description: 'Project and file organization',
    features: [
      'Save annotation project',
      'Open existing project',
      'Non-destructive — original PDF unmodified',
      'PowerPoint printout (in development)',
    ],
  },
];

export function FeatureOverview() {
  return (
    <section className="features section" aria-labelledby="features-overview-heading">
      <div className="container">
        <div className="features__header reveal">
          <span className="section-eyebrow">Full Feature Overview</span>
          <h2 id="features-overview-heading">What MaliPDF includes.</h2>
          <p className="features__subtitle">
            A focused feature set — built around real PDF annotation needs.
          </p>
        </div>

        <div className="features__grid">
          {featureGroups.map((group) => (
            <div className="features__group reveal" key={group.category}>
              <div className="features__group-header">
                <h3 className="features__group-category">{group.category}</h3>
                <p className="features__group-desc">{group.description}</p>
              </div>
              <ul className="features__list" aria-label={`${group.category} features`}>
                {group.features.map((feat) => (
                  <li key={feat} className={`features__item${feat.includes('development') ? ' features__item--upcoming' : ''}`}>
                    <span className="features__check" aria-hidden="true">
                      {feat.includes('development') ? '◦' : '✓'}
                    </span>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
