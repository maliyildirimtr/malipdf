/**
 * The Formula dialog's equation ribbon, modelled on Word's Equation tab:
 * symbol galleries and structure menus (Fraction, Script, Radical, …).
 * Every entry is plain LaTeX that KaTeX can typeset; letters such as a, b,
 * x stand for the parts to fill in. When inserted, the first {…} group is
 * selected (or receives the selected text), so typing replaces it.
 */

export interface FormulaItem {
  latex: string;
  title: string;
}

export interface SymbolGroup {
  id: string;
  label: string;
  items: FormulaItem[];
}

export interface StructureSection {
  label: string;
  items: FormulaItem[];
}

export interface Structure {
  id: string;
  label: string;
  /** Shown on the ribbon button. */
  icon: string;
  sections: StructureSection[];
}

const s = (latex: string, title: string): FormulaItem => ({ latex, title });

// ─── Symbols ──────────────────────────────────────────────────────────────────

export const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    id: 'basic', label: 'Basic Math', items: [
      s('\\pm', 'Plus-minus'), s('\\infty', 'Infinity'), s('=', 'Equals'), s('\\neq', 'Not equal'), s('\\sim', 'Tilde'),
      s('\\times', 'Times'), s('\\div', 'Division'), s('!', 'Factorial'), s('\\propto', 'Proportional to'), s('<', 'Less than'),
      s('\\ll', 'Much less than'), s('>', 'Greater than'), s('\\gg', 'Much greater than'), s('\\leq', 'Less or equal'),
      s('\\geq', 'Greater or equal'), s('\\mp', 'Minus-plus'), s('\\cong', 'Approximately equal (congruent)'),
      s('\\approx', 'Almost equal'), s('\\equiv', 'Identical to'), s('\\forall', 'For all'), s('\\complement', 'Complement'),
      s('\\partial', 'Partial differential'), s('\\sqrt{x}', 'Square root'), s('\\sqrt[3]{x}', 'Cube root'),
      s('\\sqrt[4]{x}', 'Fourth root'), s('\\cup', 'Union'), s('\\cap', 'Intersection'), s('\\emptyset', 'Empty set'),
      s('\\%', 'Percent'), s('^{\\circ}', 'Degree'), s('{}^{\\circ}\\mathrm{F}', 'Degrees Fahrenheit'),
      s('{}^{\\circ}\\mathrm{C}', 'Degrees Celsius'), s('\\Delta', 'Increment'), s('\\nabla', 'Nabla'),
      s('\\exists', 'There exists'), s('\\nexists', 'There does not exist'), s('\\in', 'Element of'), s('\\ni', 'Contains as member'),
      s('\\leftarrow', 'Left arrow'), s('\\uparrow', 'Up arrow'), s('\\rightarrow', 'Right arrow'), s('\\downarrow', 'Down arrow'),
      s('\\leftrightarrow', 'Left-right arrow'), s('\\therefore', 'Therefore'), s('\\because', 'Because'), s('+', 'Plus'),
      s('-', 'Minus'), s('\\neg', 'Not'), s('\\ast', 'Asterisk'), s('\\cdot', 'Dot operator'), s('\\vdots', 'Vertical ellipsis'),
      s('\\cdots', 'Midline ellipsis'), s('\\ddots', 'Down-right diagonal ellipsis'), s('\\aleph', 'Aleph'),
      s('\\beth', 'Beth'), s('\\blacksquare', 'End of proof'),
    ],
  },
  {
    id: 'greek', label: 'Greek Letters', items: [
      ...['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
        'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi',
        'chi', 'psi', 'omega'].map((n) => s(`\\${n}`, n)),
      ...['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega'].map((n) => s(`\\${n}`, n)),
    ],
  },
  {
    id: 'letters', label: 'Letter-Like Symbols', items: [
      s('\\forall', 'For all'), s('\\complement', 'Complement'), s('\\mathbb{C}', 'Complex numbers'), s('\\partial', 'Partial'),
      s('\\hbar', 'Planck constant over 2π'), s('\\Im', 'Imaginary part'), s('\\Re', 'Real part'), s('\\ell', 'Script l'),
      s('\\mathbb{N}', 'Natural numbers'), s('\\mathbb{Z}', 'Integers'), s('\\mathbb{Q}', 'Rational numbers'),
      s('\\mathbb{R}', 'Real numbers'), s('\\mathbb{P}', 'Primes'), s('\\wp', 'Weierstrass p'), s('\\aleph', 'Aleph'),
      s('\\beth', 'Beth'), s('\\gimel', 'Gimel'), s('\\daleth', 'Daleth'), s('\\imath', 'Dotless i'), s('\\jmath', 'Dotless j'),
      s('\\mathcal{L}', 'Script L'), s('\\mathcal{F}', 'Script F'), s('\\mathcal{O}', 'Big O'), s('\\eth', 'Eth'),
    ],
  },
  {
    id: 'operators', label: 'Operators', items: [
      s('+', 'Plus'), s('-', 'Minus'), s('\\pm', 'Plus-minus'), s('\\mp', 'Minus-plus'), s('\\times', 'Times'),
      s('\\div', 'Division'), s('\\cdot', 'Dot'), s('\\ast', 'Asterisk'), s('\\star', 'Star'), s('\\circ', 'Ring'),
      s('\\bullet', 'Bullet'), s('\\oplus', 'Circled plus'), s('\\ominus', 'Circled minus'), s('\\otimes', 'Circled times'),
      s('\\oslash', 'Circled slash'), s('\\odot', 'Circled dot'), s('\\cup', 'Union'), s('\\cap', 'Intersection'),
      s('\\uplus', 'Multiset union'), s('\\sqcup', 'Square union'), s('\\sqcap', 'Square intersection'), s('\\wedge', 'Logical and'),
      s('\\vee', 'Logical or'), s('\\setminus', 'Set minus'), s('=', 'Equals'), s('\\neq', 'Not equal'), s('\\equiv', 'Identical'),
      s('\\approx', 'Almost equal'), s('\\simeq', 'Asymptotically equal'), s('\\cong', 'Congruent'), s('\\propto', 'Proportional'),
      s('\\prec', 'Precedes'), s('\\succ', 'Succeeds'), s('\\preceq', 'Precedes or equal'), s('\\succeq', 'Succeeds or equal'),
      s('\\subset', 'Subset'), s('\\supset', 'Superset'), s('\\subseteq', 'Subset or equal'), s('\\supseteq', 'Superset or equal'),
      s('\\in', 'Element of'), s('\\notin', 'Not an element of'), s('\\perp', 'Perpendicular'), s('\\parallel', 'Parallel'),
      s('\\mid', 'Divides'), s('\\models', 'Models'), s('\\vdash', 'Proves'), s('\\coloneqq', 'Defined as'),
    ],
  },
  {
    id: 'arrows', label: 'Arrows', items: [
      s('\\leftarrow', 'Left'), s('\\rightarrow', 'Right'), s('\\uparrow', 'Up'), s('\\downarrow', 'Down'),
      s('\\leftrightarrow', 'Left-right'), s('\\updownarrow', 'Up-down'), s('\\Leftarrow', 'Double left'),
      s('\\Rightarrow', 'Implies'), s('\\Uparrow', 'Double up'), s('\\Downarrow', 'Double down'),
      s('\\Leftrightarrow', 'If and only if'), s('\\Updownarrow', 'Double up-down'), s('\\longleftarrow', 'Long left'),
      s('\\longrightarrow', 'Long right'), s('\\longleftrightarrow', 'Long left-right'), s('\\Longleftarrow', 'Long double left'),
      s('\\Longrightarrow', 'Long double right'), s('\\Longleftrightarrow', 'Long double left-right'), s('\\mapsto', 'Maps to'),
      s('\\hookrightarrow', 'Hook right'), s('\\hookleftarrow', 'Hook left'), s('\\nearrow', 'North-east'),
      s('\\searrow', 'South-east'), s('\\swarrow', 'South-west'), s('\\nwarrow', 'North-west'),
      s('\\rightleftharpoons', 'Equilibrium'), s('\\leftrightarrows', 'Left-right pair'), s('\\rightrightarrows', 'Right pair'),
      s('\\circlearrowleft', 'Anticlockwise'), s('\\circlearrowright', 'Clockwise'),
    ],
  },
  {
    id: 'negated', label: 'Negated Relations', items: [
      s('\\neq', 'Not equal'), s('\\nless', 'Not less'), s('\\ngtr', 'Not greater'), s('\\nleq', 'Neither less nor equal'),
      s('\\ngeq', 'Neither greater nor equal'), s('\\nsim', 'Not similar'), s('\\ncong', 'Not congruent'),
      s('\\not\\equiv', 'Not identical'), s('\\not\\approx', 'Not almost equal'), s('\\notin', 'Not in'),
      s('\\not\\ni', 'Does not contain'), s('\\not\\subset', 'Not a subset'), s('\\not\\supset', 'Not a superset'),
      s('\\nsubseteq', 'Neither subset nor equal'), s('\\nsupseteq', 'Neither superset nor equal'), s('\\nmid', 'Does not divide'),
      s('\\nparallel', 'Not parallel'), s('\\nexists', 'Does not exist'), s('\\nprec', 'Does not precede'), s('\\nsucc', 'Does not succeed'),
    ],
  },
  {
    id: 'logic', label: 'Logic & Digital', items: [
      s('\\overline{A}', 'NOT (bar)'), s('\\neg A', 'NOT (¬)'), s("A'", 'NOT (prime)'), s('A \\cdot B', 'AND'), s('AB', 'AND (juxtaposed)'),
      s('A + B', 'OR'), s('A \\oplus B', 'XOR'), s('A \\odot B', 'XNOR'), s('\\overline{A \\cdot B}', 'NAND'),
      s('\\overline{A + B}', 'NOR'), s('\\overline{A \\oplus B}', 'XNOR (bar)'), s('\\land', 'Logical and'), s('\\lor', 'Logical or'),
      s('\\lnot', 'Logical not'), s('\\veebar', 'Exclusive or'), s('\\uparrow', 'NAND (Sheffer)'), s('\\downarrow', 'NOR (Peirce)'),
      s('\\Rightarrow', 'Implies'), s('\\Leftrightarrow', 'Equivalent'), s('\\top', 'True'), s('\\bot', 'False'),
      s('\\forall', 'For all'), s('\\exists', 'Exists'), s('\\therefore', 'Therefore'), s('\\because', 'Because'),
      s('\\sum m(0,1,3)', 'Sum of minterms'), s('\\prod M(2,4)', 'Product of maxterms'), s('\\overline{Q}', 'Q bar'),
      s('Q_{n+1}', 'Next state'), s('\\mathrm{CLK}', 'Clock'), s('(1011)_{2}', 'Binary number'), s('(2F)_{16}', 'Hex number'),
    ],
  },
  {
    id: 'geometry', label: 'Geometry', items: [
      s('\\angle', 'Angle'), s('\\measuredangle', 'Measured angle'), s('\\sphericalangle', 'Spherical angle'),
      s('\\perp', 'Perpendicular'), s('\\parallel', 'Parallel'), s('\\triangle', 'Triangle'), s('\\square', 'Square'),
      s('\\bigcirc', 'Circle'), s('\\cong', 'Congruent'), s('\\sim', 'Similar'), s('\\overline{AB}', 'Segment'),
      s('\\overrightarrow{AB}', 'Vector / ray'), s('\\overleftrightarrow{AB}', 'Line'), s('\\widehat{ABC}', 'Angle ABC'),
      s('\\overset{\\frown}{AB}', 'Arc'), s('^{\\circ}', 'Degree'), s("'", 'Minute'), s("''", 'Second'), s('\\pi r^{2}', 'Circle area'),
      s('\\Box', 'Box'), s('\\diamond', 'Diamond'),
    ],
  },
];

// ─── Structures ───────────────────────────────────────────────────────────────

export const STRUCTURES: Structure[] = [
  {
    id: 'fraction', label: 'Fraction', icon: '\\frac{x}{y}', sections: [
      { label: 'Fraction', items: [
        s('\\frac{a}{b}', 'Stacked fraction'), s('{}^{a}\\!/_{b}', 'Skewed fraction'), s('a/b', 'Linear fraction'),
        s('\\tfrac{a}{b}', 'Small fraction'), s('\\cfrac{a}{b}', 'Continued fraction'), s('\\binom{n}{k}', 'Binomial'),
      ] },
      { label: 'Common Fractions', items: [
        s('\\frac{dy}{dx}', 'Differential'), s('\\frac{\\Delta y}{\\Delta x}', 'Delta y over delta x'),
        s('\\frac{\\partial y}{\\partial x}', 'Partial differential'), s('\\frac{\\delta y}{\\delta x}', 'Delta y over delta x (small)'),
        s('\\frac{\\pi}{2}', 'Pi over 2'), s('\\frac{1}{2}', 'One half'),
      ] },
    ],
  },
  {
    id: 'script', label: 'Script', icon: 'e^{x}', sections: [
      { label: 'Subscripts and Superscripts', items: [
        s('x^{2}', 'Superscript'), s('x_{i}', 'Subscript'), s('x_{i}^{2}', 'Subscript-superscript'),
        s('{}_{a}^{b}X', 'Left subscript-superscript'), s('{}^{b}X', 'Left superscript'), s('{}_{a}X', 'Left subscript'),
      ] },
      { label: 'Common Subscripts and Superscripts', items: [
        s('x_{y^{2}}', 'Subscript with superscript'), s('e^{-i\\omega t}', 'e to the -iωt'), s('x^{n}', 'x to the n'),
        s('{}_{1}^{n}Y', 'Y with left scripts'), s('a_{n}', 'Sequence'), s('x_{1},\\dots,x_{n}', 'List'),
      ] },
    ],
  },
  {
    id: 'radical', label: 'Radical', icon: '\\sqrt[n]{x}', sections: [
      { label: 'Radicals', items: [
        s('\\sqrt{x}', 'Square root'), s('\\sqrt[n]{x}', 'Radical with degree'), s('\\sqrt[3]{x}', 'Cube root'),
        s('\\sqrt[4]{x}', 'Fourth root'),
      ] },
      { label: 'Common Radicals', items: [
        s('\\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}', 'Quadratic formula'), s('\\sqrt{a^{2}+b^{2}}', 'Hypotenuse'),
        s('\\sqrt{2}', 'Root 2'),
      ] },
    ],
  },
  {
    id: 'integral', label: 'Integral', icon: '\\int_{-x}^{x}', sections: [
      { label: 'Integrals', items: [
        s('\\int f(x)\\,dx', 'Integral'), s('\\int_{a}^{b} f(x)\\,dx', 'Definite integral'),
        s('\\int\\limits_{a}^{b} f(x)\\,dx', 'Definite integral (limits above/below)'), s('\\iint f\\,dA', 'Double integral'),
        s('\\iint_{D} f\\,dA', 'Double integral over D'), s('\\iiint f\\,dV', 'Triple integral'),
        s('\\iiint_{V} f\\,dV', 'Triple integral over V'),
      ] },
      { label: 'Contour Integrals', items: [
        s('\\oint F\\cdot dr', 'Contour integral'), s('\\oint_{C} F\\cdot dr', 'Contour integral over C'),
        s('\\oiint_{S} F\\cdot dS', 'Surface integral'), s('\\oiiint_{V} f\\,dV', 'Volume integral'),
      ] },
      { label: 'Differentials', items: [
        s('dx', 'Differential x'), s('dy', 'Differential y'), s('d\\theta', 'Differential theta'),
      ] },
    ],
  },
  {
    id: 'largeOperator', label: 'Large Operator', icon: '\\sum_{i=0}^{n}', sections: [
      { label: 'Summations', items: [
        s('\\sum x_{i}', 'Summation'), s('\\sum_{i=1}^{n} x_{i}', 'Summation with limits'),
        s('\\sum\\limits_{i=1}^{n} x_{i}', 'Summation (limits above/below)'), s('\\sum_{i} x_{i}', 'Summation with subscript'),
      ] },
      { label: 'Products and Coproducts', items: [
        s('\\prod_{i=1}^{n} x_{i}', 'Product'), s('\\coprod_{i=1}^{n} x_{i}', 'Coproduct'), s('\\prod_{i} x_{i}', 'Product with subscript'),
      ] },
      { label: 'Unions and Intersections', items: [
        s('\\bigcup_{i=1}^{n} A_{i}', 'Union'), s('\\bigcap_{i=1}^{n} A_{i}', 'Intersection'),
        s('\\bigvee_{i} x_{i}', 'Logical or'), s('\\bigwedge_{i} x_{i}', 'Logical and'), s('\\bigoplus_{i} x_{i}', 'Direct sum'),
        s('\\bigotimes_{i} x_{i}', 'Tensor product'), s('\\bigsqcup_{i} A_{i}', 'Disjoint union'),
      ] },
      { label: 'Common Large Operators', items: [
        s('\\sum_{k=0}^{n} \\binom{n}{k}', 'Binomial sum'), s('\\sum_{i=0}^{n} i', 'Sum of i'),
        s('\\prod_{k=1}^{n} A_{k}', 'Product of A'), s('\\bigcup_{n=1}^{m} (X_{n} \\cap Y_{n})', 'Union of intersections'),
      ] },
    ],
  },
  {
    id: 'bracket', label: 'Bracket', icon: '\\{()\\}', sections: [
      { label: 'Brackets', items: [
        s('\\left( x \\right)', 'Parentheses'), s('\\left[ x \\right]', 'Square brackets'), s('\\left\\{ x \\right\\}', 'Braces'),
        s('\\left\\langle x \\right\\rangle', 'Angle brackets'), s('\\left\\lfloor x \\right\\rfloor', 'Floor'),
        s('\\left\\lceil x \\right\\rceil', 'Ceiling'), s('\\left| x \\right|', 'Absolute value'), s('\\left\\| x \\right\\|', 'Norm'),
        s('\\left[ x \\right[', 'Reversed bracket'), s('\\left] x \\right[', 'Outward brackets'), s('\\left[\\!\\left[ x \\right]\\!\\right]', 'Double brackets'),
      ] },
      { label: 'Brackets with Separators', items: [
        s('\\left( a \\middle| b \\right)', 'Parentheses with separator'), s('\\left\\{ a \\middle| b \\right\\}', 'Set builder'),
        s('\\left\\langle a \\middle| b \\right\\rangle', 'Bra-ket'), s('\\left\\langle a \\middle| b \\middle| c \\right\\rangle', 'Bra-operator-ket'),
      ] },
      { label: 'Single Brackets', items: [
        s('\\left\\{ x \\right.', 'Left brace'), s('\\left. x \\right\\}', 'Right brace'), s('\\left. x \\right|_{a}^{b}', 'Evaluated at'),
      ] },
      { label: 'Cases and Stacks', items: [
        s('\\begin{cases} a & x < 0 \\\\ b & x \\geq 0 \\end{cases}', 'Cases (two)'),
        s('\\begin{cases} a & x < 0 \\\\ b & x = 0 \\\\ c & x > 0 \\end{cases}', 'Cases (three)'),
        s('\\binom{n}{k}', 'Binomial coefficient'), s('\\left\\langle \\frac{n}{k} \\right\\rangle', 'Angle stack'),
      ] },
      { label: 'Common Brackets', items: [
        s('f(x) = \\begin{cases} -x, & x < 0 \\\\ x, & x \\geq 0 \\end{cases}', 'Absolute value function'),
        s('\\left.\\frac{dy}{dx}\\right|_{x=0}', 'Derivative evaluated at 0'),
      ] },
    ],
  },
  {
    id: 'function', label: 'Function', icon: '\\sin\\theta', sections: [
      { label: 'Trigonometric Functions', items: [
        s('\\sin x', 'Sine'), s('\\cos x', 'Cosine'), s('\\tan x', 'Tangent'), s('\\csc x', 'Cosecant'), s('\\sec x', 'Secant'),
        s('\\cot x', 'Cotangent'),
      ] },
      { label: 'Inverse Functions', items: [
        s('\\sin^{-1} x', 'Inverse sine'), s('\\cos^{-1} x', 'Inverse cosine'), s('\\tan^{-1} x', 'Inverse tangent'),
        s('\\arcsin x', 'Arcsine'), s('\\arccos x', 'Arccosine'), s('\\arctan x', 'Arctangent'),
      ] },
      { label: 'Hyperbolic Functions', items: [
        s('\\sinh x', 'Hyperbolic sine'), s('\\cosh x', 'Hyperbolic cosine'), s('\\tanh x', 'Hyperbolic tangent'),
        s('\\coth x', 'Hyperbolic cotangent'), s('\\operatorname{sech} x', 'Hyperbolic secant'), s('\\operatorname{csch} x', 'Hyperbolic cosecant'),
      ] },
      { label: 'Common Functions', items: [
        s('\\sin\\theta', 'Sine theta'), s('\\sin 2x', 'Sine 2x'), s('\\tan\\theta = \\frac{\\sin\\theta}{\\cos\\theta}', 'Tangent formula'),
        s('\\sin^{2}x + \\cos^{2}x = 1', 'Pythagorean identity'),
      ] },
    ],
  },
  {
    id: 'accent', label: 'Accent', icon: '\\ddot{a}', sections: [
      { label: 'Accents', items: [
        s('\\dot{a}', 'Dot'), s('\\ddot{a}', 'Double dot'), s('\\hat{a}', 'Hat'),
        s('\\check{a}', 'Check'), s('\\acute{a}', 'Acute'), s('\\grave{a}', 'Grave'), s('\\breve{a}', 'Breve'),
        s('\\tilde{a}', 'Tilde'), s('\\bar{a}', 'Bar'), s('\\vec{a}', 'Vector'), s('\\mathring{a}', 'Ring'),
      ] },
      { label: 'Wide Accents', items: [
        s('\\widehat{ab}', 'Wide hat'), s('\\widetilde{ab}', 'Wide tilde'), s('\\overleftarrow{AB}', 'Arrow left above'),
        s('\\overrightarrow{AB}', 'Arrow right above'), s('\\overleftrightarrow{AB}', 'Double arrow above'),
        s('\\underleftarrow{AB}', 'Arrow left below'), s('\\underrightarrow{AB}', 'Arrow right below'),
      ] },
      { label: 'Overbars and Underbars', items: [
        s('\\overline{a}', 'Overbar'), s('\\underline{a}', 'Underbar'), s('\\overline{\\overline{a}}', 'Double overbar'),
      ] },
      { label: 'Braces and Boxes', items: [
        s('\\overbrace{a+b}^{n}', 'Overbrace'), s('\\underbrace{a+b}_{n}', 'Underbrace'), s('\\overbrace{a+b}', 'Overbrace (no label)'),
        s('\\underbrace{a+b}', 'Underbrace (no label)'), s('\\boxed{a}', 'Boxed'), s('\\cancel{a}', 'Cancel'), s('\\bcancel{a}', 'Back-cancel'),
      ] },
      { label: 'Common Accents', items: [
        s('\\overline{A}', 'A bar'), s('\\overline{ABC}', 'ABC bar'), s('\\overline{x \\oplus y}', 'x XOR y, bar'),
      ] },
    ],
  },
  {
    id: 'limit', label: 'Limit and Log', icon: '\\lim_{n\\to\\infty}', sections: [
      { label: 'Functions', items: [
        s('\\log_{b} x', 'Logarithm base b'), s('\\log x', 'Logarithm'), s('\\lim_{n \\to \\infty} a_{n}', 'Limit'),
        s('\\min_{x} f(x)', 'Minimum'), s('\\max_{x} f(x)', 'Maximum'), s('\\ln x', 'Natural logarithm'),
        s('\\sup_{x} f(x)', 'Supremum'), s('\\inf_{x} f(x)', 'Infimum'), s('\\exp x', 'Exponential'),
        s('\\operatorname{arg\\,max}_{x} f(x)', 'Argmax'),
      ] },
      { label: 'Common Functions', items: [
        s('\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^{n}', 'e as a limit'),
        s('\\max_{0 \\leq x \\leq 1} x e^{-x^{2}}', 'Maximum example'), s('\\lim_{x \\to 0} \\frac{\\sin x}{x}', 'sin x over x'),
        s('\\log_{2} n', 'Log base 2'),
      ] },
    ],
  },
  {
    id: 'operator', label: 'Operator', icon: '\\overset{\\Delta}{=}', sections: [
      { label: 'Basic Operators', items: [
        s('\\coloneqq', 'Colon equals'), s('==', 'Equal equal'), s('+=', 'Plus equal'), s('-=', 'Minus equal'),
        s('\\overset{\\text{def}}{=}', 'Equal by definition'), s('\\overset{m}{=}', 'Measured by'), s('\\triangleq', 'Delta equal'),
        s('\\overset{?}{=}', 'Questioned equal'),
      ] },
      { label: 'Operator Structures', items: [
        s('\\xrightarrow{a}', 'Arrow right with text'), s('\\xleftarrow{a}', 'Arrow left with text'),
        s('\\xRightarrow{a}', 'Double arrow right with text'), s('\\xLeftarrow{a}', 'Double arrow left with text'),
        s('\\xleftrightarrow{a}', 'Two-way arrow with text'), s('\\xrightarrow[b]{a}', 'Arrow with text above and below'),
        s('\\underset{b}{\\rightarrow}', 'Arrow with text below'), s('\\overset{a}{\\leftarrow}', 'Arrow left with text above'),
        s('\\stackrel{a}{=}', 'Stacked equals'),
      ] },
      { label: 'Common Operator Structures', items: [
        s('\\xrightarrow{\\Delta}', 'Yields with heat'), s('\\xrightarrow{n \\to \\infty}', 'Tends to'),
        s('\\overset{\\text{def}}{=}', 'Defined as'),
      ] },
    ],
  },
  {
    id: 'matrix', label: 'Matrix', icon: '\\left[\\begin{smallmatrix}1&0\\\\0&1\\end{smallmatrix}\\right]', sections: [
      { label: 'Empty Matrices', items: [
        s('\\begin{matrix} a & b \\end{matrix}', '1×2'), s('\\begin{matrix} a \\\\ b \\end{matrix}', '2×1'),
        s('\\begin{matrix} a & b & c \\end{matrix}', '1×3'), s('\\begin{matrix} a \\\\ b \\\\ c \\end{matrix}', '3×1'),
        s('\\begin{matrix} a & b \\\\ c & d \\end{matrix}', '2×2'), s('\\begin{matrix} a & b & c \\\\ d & e & f \\end{matrix}', '2×3'),
        s('\\begin{matrix} a & b \\\\ c & d \\\\ e & f \\end{matrix}', '3×2'),
        s('\\begin{matrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{matrix}', '3×3'),
      ] },
      { label: 'Dots', items: [
        s('\\cdots', 'Midline dots'), s('\\ldots', 'Baseline dots'), s('\\vdots', 'Vertical dots'), s('\\ddots', 'Diagonal dots'),
      ] },
      { label: 'Identity Matrices', items: [
        s('\\begin{matrix} 1 & 0 \\\\ 0 & 1 \\end{matrix}', '2×2 identity'),
        s('\\begin{matrix} 1 & 0 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0 & 1 \\end{matrix}', '3×3 identity'),
      ] },
      { label: 'Matrices with Brackets', items: [
        s('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'Parentheses'), s('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', 'Brackets'),
        s('\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}', 'Determinant'), s('\\begin{Vmatrix} a & b \\\\ c & d \\end{Vmatrix}', 'Norm bars'),
        s('\\begin{Bmatrix} a & b \\\\ c & d \\end{Bmatrix}', 'Braces'),
      ] },
      { label: 'Sparse and Large Matrices', items: [
        s('\\begin{pmatrix} a_{11} & \\cdots & a_{1n} \\\\ \\vdots & \\ddots & \\vdots \\\\ a_{m1} & \\cdots & a_{mn} \\end{pmatrix}', 'm×n with dots'),
        s('\\begin{pmatrix} 1 & 0 & \\cdots & 0 \\\\ 0 & 1 & \\cdots & 0 \\\\ \\vdots & \\vdots & \\ddots & \\vdots \\\\ 0 & 0 & \\cdots & 1 \\end{pmatrix}', 'n×n identity'),
        s('\\left[\\begin{array}{cc|c} a & b & e \\\\ c & d & f \\end{array}\\right]', 'Augmented matrix'),
      ] },
    ],
  },
];

/** Where the cursor goes after inserting `latex` (the first {…} group). */
export function firstPlaceholder(latex: string): { start: number; end: number } | null {
  // Skip environment names such as \begin{matrix}.
  const re = /\\(?:begin|end)\{[^}]*\}|\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latex))) {
    if (m[0] !== '{') continue;
    let depth = 1;
    let i = m.index + 1;
    for (; i < latex.length && depth > 0; i++) {
      if (latex[i] === '{') depth++;
      else if (latex[i] === '}') depth--;
    }
    if (depth === 0 && i - 1 > m.index + 1) return { start: m.index + 1, end: i - 1 };
  }
  return null;
}

/**
 * Insert `latex` into `text` at the selection. A selection replaces the first
 * placeholder, so choosing "Square root" with "x+1" selected gives \sqrt{x+1}.
 * Returns the new text and the range to select afterwards.
 */
export function insertStructure(text: string, selStart: number, selEnd: number, latex: string): { text: string; selStart: number; selEnd: number } {
  const selected = text.slice(selStart, selEnd);
  const slot = firstPlaceholder(latex);
  let insert = latex;
  if (selected && slot) insert = latex.slice(0, slot.start) + selected + latex.slice(slot.end);
  // Keep a space after commands like \alpha so the next letter does not glue on.
  const before = text.slice(0, selStart);
  const after = text.slice(selEnd);
  const needsSpace = /\\[a-zA-Z]+$/.test(insert) && /^[a-zA-Z]/.test(after);
  const joined = insert + (needsSpace ? ' ' : '');
  const next = before + joined + after;
  if (selected && slot) {
    const caret = selStart + insert.length;
    return { text: next, selStart: caret, selEnd: caret };
  }
  if (slot) return { text: next, selStart: selStart + slot.start, selEnd: selStart + slot.end };
  const caret = selStart + joined.length;
  return { text: next, selStart: caret, selEnd: caret };
}
