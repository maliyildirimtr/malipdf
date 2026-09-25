import './AnnotationShowcase.css';

const tools = [
  {
    name: 'Pen',
    icon: '✏️',
    description: 'Freehand drawing directly on PDF pages. Adjustable stroke weight.',
    category: 'draw',
  },
  {
    name: 'Highlighter',
    icon: '🟡',
    description: 'Semi-transparent brush for emphasizing text and regions.',
    category: 'draw',
  },
  {
    name: 'Text',
    icon: 'T',
    description: 'Add text annotations anywhere on the page.',
    category: 'insert',
  },
  {
    name: 'Shapes',
    icon: '□',
    description: 'Rectangles, ellipses and lines for clear diagrams.',
    category: 'draw',
  },
  {
    name: 'Arrow',
    icon: '→',
    description: 'Point to specific regions with directional arrows.',
    category: 'draw',
  },
  {
    name: 'Polygon',
    icon: '⬡',
    description: 'Multi-point closed shapes for complex region marking.',
    category: 'draw',
  },
  {
    name: 'Selection',
    icon: '⊹',
    description: 'Select, move and resize any annotation.',
    category: 'edit',
  },
  {
    name: 'Multi-select',
    icon: '⊡',
    description: 'Select multiple annotations to move or delete together.',
    category: 'edit',
  },
  {
    name: 'Eraser',
    icon: '◻',
    description: 'Remove specific annotation strokes with precision.',
    category: 'edit',
  },
  {
    name: 'Undo / Redo',
    icon: '↩',
    description: 'Full undo/redo history for all annotation operations.',
    category: 'edit',
  },
];

export function AnnotationShowcase() {
  return (
    <section className="annotation section" id="features" aria-labelledby="annotation-heading">
      <div className="container">
        {/* Header */}
        <div className="annotation__header reveal">
          <span className="section-eyebrow">Core Annotation</span>
          <h2 id="annotation-heading" className="annotation__title">
            Every tool you need,<br />nothing you don't.
          </h2>
          <p className="annotation__subtitle">
            A focused set of annotation tools designed for real academic and professional
            work — not an overcrowded toolbar.
          </p>
        </div>

        {/* Layout: tool grid + central mockup */}
        <div className="annotation__layout">
          {/* Left tools */}
          <div className="annotation__tools-left">
            {tools.slice(0, 5).map((tool) => (
              <div className="annotation__tool-card reveal" key={tool.name}>
                <div className="annotation__tool-icon" aria-hidden="true">
                  {tool.icon}
                </div>
                <div>
                  <h4 className="annotation__tool-name">{tool.name}</h4>
                  <p className="annotation__tool-desc">{tool.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Central workspace mockup */}
          <div className="annotation__center reveal">
            <div className="annotation__workspace">
              {/* Toolbar */}
              <div className="annotation__ws-toolbar" aria-hidden="true">
                {['Pen','Hl','T','□','→','⬡','⊹','◻'].map((t, i) => (
                  <button key={i} className={`annotation__ws-tool${i === 0 ? ' annotation__ws-tool--active' : ''}`} tabIndex={-1} aria-hidden="true">
                    {t}
                  </button>
                ))}
              </div>

              {/* Canvas */}
              <div className="annotation__ws-canvas" aria-label="Annotation workspace mockup — placeholder for real screenshot">
                {/* Simulated annotated PDF */}
                <svg viewBox="0 0 360 240" className="annotation__svg" aria-hidden="true">
                  {/* Page background */}
                  <rect x="20" y="10" width="320" height="220" rx="4" fill="rgba(255,255,255,0.94)" />

                  {/* Text lines */}
                  {[30,48,66,84].map((y, i) => (
                    <rect key={y} x="36" y={y} width={[220,180,240,160][i]} height="7" rx="2" fill="rgba(15,28,46,0.10)" />
                  ))}

                  {/* Highlighter */}
                  <rect x="36" y="28" width="180" height="14" rx="2" fill="rgba(255,213,79,0.38)" />

                  {/* Pen stroke */}
                  <path d="M 260 40 Q 290 20 310 50 Q 330 80 290 100" stroke="rgba(45,95,168,0.8)" strokeWidth="2.5" fill="none" strokeLinecap="round" />

                  {/* Arrow */}
                  <line x1="36" y1="110" x2="100" y2="110" stroke="rgba(220,80,60,0.8)" strokeWidth="2" markerEnd="url(#arrowhead)" />
                  <defs>
                    <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                      <path d="M 0 0 L 6 3 L 0 6 z" fill="rgba(220,80,60,0.8)" />
                    </marker>
                  </defs>

                  {/* Rectangle shape */}
                  <rect x="150" y="120" width="80" height="50" rx="2" fill="none" stroke="rgba(76,175,122,0.8)" strokeWidth="2" strokeDasharray="5,3" />

                  {/* Text annotation */}
                  <text x="38" y="185" fill="rgba(45,95,168,0.9)" fontSize="9" fontWeight="600">← Important: see definition above</text>

                  {/* Polygon */}
                  <polygon points="240,130 270,120 300,140 290,170 250,165" fill="none" stroke="rgba(150,80,200,0.7)" strokeWidth="1.5" />

                  {/* More text lines */}
                  {[195, 210].map((y, i) => (
                    <rect key={y} x="36" y={y} width={[200,150][i]} height="6" rx="2" fill="rgba(15,28,46,0.08)" />
                  ))}
                </svg>
              </div>

              <p className="annotation__ws-label" aria-hidden="true">
                Placeholder — insert real screenshot here
              </p>
            </div>
          </div>

          {/* Right tools */}
          <div className="annotation__tools-right">
            {tools.slice(5).map((tool) => (
              <div className="annotation__tool-card annotation__tool-card--right reveal" key={tool.name}>
                <div>
                  <h4 className="annotation__tool-name">{tool.name}</h4>
                  <p className="annotation__tool-desc">{tool.description}</p>
                </div>
                <div className="annotation__tool-icon" aria-hidden="true">
                  {tool.icon}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
