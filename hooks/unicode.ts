// TeX to Unicode text, for the places that cannot draw an SVG: the terminal
// and the prompt box. Pure functions, no engine calls.
//
// Inline math becomes one line: `\alpha^2 + \frac{1}{2}` reads `α² + ½`.
// Display math is laid out in two dimensions on a grid of character cells:
// fractions stack over a rule, sums and limits carry their bounds above and
// below, matrices and cases get tall delimiters, and align rows line up.
// What has no Unicode form is kept readable: `x^{a/b}` is `x^(a/b)` on one
// line, and an unknown command is left as its source.

// A block of text cells: its rows, and which row is the baseline that the
// boxes beside it line up on.
type Box = { lines: string[]; base: number }
// How a formula is laid out. `display` may use several rows. `inline` is one
// row with spaces around relations and operators. `script` is one row, tight,
// for sub- and superscripts.
type Mode = 'display' | 'inline' | 'script'

// The width of a text in terminal cells: combining marks take none, wide
// East Asian characters take two.
export function cellWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    if (/\p{M}/u.test(ch)) continue
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1
  }
  return width
}

const padRight = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))
const boxWidth = (box: Box) => Math.max(0, ...box.lines.map(cellWidth))
const textBox = (text: string): Box => ({ lines: [text], base: 0 })
const isFlat = (box: Box) => box.lines.length === 1
const flatText = (box: Box) => box.lines.join(' ')

function center(text: string, width: number): string {
  const left = Math.floor((width - cellWidth(text)) / 2)
  return padRight(' '.repeat(Math.max(0, left)) + text, width)
}

// Boxes side by side, lined up on their baselines.
function hcat(boxes: Box[]): Box {
  const parts = boxes.filter(b => b.lines.length > 0)
  if (parts.length === 0) return textBox('')
  if (parts.every(isFlat)) return textBox(parts.map(b => b.lines[0]).join(''))
  const above = Math.max(...parts.map(b => b.base))
  const below = Math.max(...parts.map(b => b.lines.length - 1 - b.base))
  const lines: string[] = []
  for (let row = 0; row <= above + below; row++) {
    lines.push(
      parts
        .map(b => {
          const width = boxWidth(b)
          return padRight(b.lines[row - (above - b.base)] ?? '', width)
        })
        .join(''),
    )
  }
  return { lines, base: above }
}

// Boxes one above the other, each centered on the widest; `base` names the
// row the result lines up on.
function vstack(boxes: Box[], base: number, width = Math.max(...boxes.map(boxWidth))): Box {
  return { lines: boxes.flatMap(b => b.lines.map(line => center(line, width))), base }
}

// ---------------------------------------------------------------------------
// Symbols

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', varkappa: 'ϰ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς',
  tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', digamma: 'ϝ',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', varGamma: 'Γ', varDelta: 'Δ', varTheta: 'Θ', varLambda: 'Λ',
  varXi: 'Ξ', varPi: 'Π', varSigma: 'Σ', varUpsilon: 'Υ', varPhi: 'Φ', varPsi: 'Ψ', varOmega: 'Ω',
}

// Ordinary symbols: drawn as they are, no space around them.
const ORD: Record<string, string> = {
  infty: '∞', partial: '∂', nabla: '∇', hbar: 'ℏ', hslash: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', wp: '℘',
  aleph: 'ℵ', beth: 'ℶ', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄',
  neg: '¬', lnot: '¬', top: '⊤', bot: '⊥', angle: '∠', measuredangle: '∡', triangle: '△',
  square: '□', Box: '□', blacksquare: '■', Diamond: '◇', lozenge: '◊', prime: '′', dagger: '†',
  ddagger: '‡', star: '⋆', ast: '∗', bullet: '∙', cdots: '⋯', ldots: '…', dots: '…', dotsc: '…',
  dotsb: '⋯', dotsm: '⋯', dotsi: '⋯', vdots: '⋮', ddots: '⋱', imath: 'ı', jmath: 'ȷ', complement: '∁',
  surd: '√', flat: '♭', natural: '♮', sharp: '♯', clubsuit: '♣', diamondsuit: '♢', heartsuit: '♡',
  spadesuit: '♠', checkmark: '✓', degree: '°', backslash: '\\', S: '§', P: '¶', copyright: '©',
  pounds: '£', euro: '€', dag: '†', ddag: '‡', mho: '℧', Finv: 'Ⅎ', eth: 'ð', infin: '∞',
  langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lvert: '|',
  rvert: '|', lVert: '‖', rVert: '‖', vert: '|', Vert: '‖', lbrace: '{', rbrace: '}', lbrack: '[',
  rbrack: ']', ulcorner: '⌜', urcorner: '⌝', llcorner: '⌞', lrcorner: '⌟', lgroup: '⟮', rgroup: '⟯',
}

// Binary operators: a space each side between two operands.
const BIN: Record<string, string> = {
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '⋅', circ: '∘', oplus: '⊕', ominus: '⊖',
  otimes: '⊗', oslash: '⊘', odot: '⊙', wedge: '∧', land: '∧', vee: '∨', lor: '∨', cap: '∩',
  cup: '∪', setminus: '∖', smallsetminus: '∖', sqcup: '⊔', sqcap: '⊓', uplus: '⊎', amalg: '⨿',
  bigtriangleup: '△', bigtriangledown: '▽', triangleleft: '◁', triangleright: '▷', wr: '≀',
  ltimes: '⋉', rtimes: '⋊', bowtie: '⋈', diamond: '⋄', bigcirc: '◯', boxplus: '⊞', boxminus: '⊟',
  boxtimes: '⊠', boxdot: '⊡', divideontimes: '⋇', dotplus: '∔', centerdot: '⋅', intercal: '⊺',
  barwedge: '⊼', veebar: '⊻', curlywedge: '⋏', curlyvee: '⋎', And: '&',
}

// Relations and arrows: a space each side.
const REL: Record<string, string> = {
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', approxeq: '≊', sim: '∼',
  simeq: '≃', cong: '≅', equiv: '≡', propto: '∝', ll: '≪', gg: '≫', lll: '⋘', ggg: '⋙', prec: '≺',
  succ: '≻', preceq: '⪯', succeq: '⪰', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
  subsetneq: '⊊', supsetneq: '⊋', sqsubset: '⊏', sqsupset: '⊐', sqsubseteq: '⊑', sqsupseteq: '⊒',
  in: '∈', notin: '∉', ni: '∋', owns: '∋', mid: '∣', nmid: '∤', parallel: '∥', nparallel: '∦',
  perp: '⊥', vdash: '⊢', dashv: '⊣', models: '⊨', vDash: '⊨', Vdash: '⊩', coloneqq: '≔',
  eqqcolon: '≕', coloneq: '≔', doteq: '≐', asymp: '≍', leqslant: '⩽', geqslant: '⩾', lesssim: '≲',
  gtrsim: '≳', lessgtr: '≶', gtrless: '≷', nleq: '≰', ngeq: '≱', nless: '≮', ngtr: '≯', nsim: '≁',
  ncong: '≇', nsubseteq: '⊈', nsupseteq: '⊉', triangleq: '≜', bumpeq: '≏', smile: '⌣', frown: '⌢',
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⇔', iff: '⟺', implies: '⟹', impliedby: '⟸', mapsto: '↦',
  longrightarrow: '⟶', longleftarrow: '⟵', longleftrightarrow: '⟷', Longrightarrow: '⟹',
  Longleftarrow: '⟸', Longleftrightarrow: '⟺', longmapsto: '⟼', uparrow: '↑', downarrow: '↓',
  updownarrow: '↕', Uparrow: '⇑', Downarrow: '⇓', Updownarrow: '⇕', hookrightarrow: '↪',
  hookleftarrow: '↩', rightharpoonup: '⇀', rightharpoondown: '⇁', leftharpoonup: '↼',
  leftharpoondown: '↽', rightleftharpoons: '⇌', leftrightharpoons: '⇋', nearrow: '↗', searrow: '↘',
  swarrow: '↙', nwarrow: '↖', twoheadrightarrow: '↠', twoheadleftarrow: '↞', leadsto: '⇝',
  rightsquigarrow: '⇝', rightrightarrows: '⇉', leftleftarrows: '⇇', leftrightarrows: '⇆',
  rightleftarrows: '⇄', curvearrowright: '↷', curvearrowleft: '↶', circlearrowright: '↻',
  circlearrowleft: '↺', nrightarrow: '↛', nleftarrow: '↚', nRightarrow: '⇏', nLeftarrow: '⇍',
  therefore: '∴', because: '∵', colon: ':', vartriangleleft: '⊲', vartriangleright: '⊳',
  trianglelefteq: '⊴', trianglerighteq: '⊵', between: '≬', pitchfork: '⋔', multimap: '⊸',
  Join: '⨝', approxident: '≋', backsim: '∽', eqcirc: '≖', circeq: '≗', risingdotseq: '≓',
  fallingdotseq: '≒', precsim: '≾', succsim: '≿', Subset: '⋐', Supset: '⋑', varpropto: '∝',
}

// Large operators. Those in LIMITS take their bounds above and below in a
// display formula; the rest, the integrals, take them at the side.
const BIG: Record<string, string> = {
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', iiiint: '⨌', oint: '∮',
  oiint: '∯', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂', bigodot: '⨀', bigvee: '⋁',
  bigwedge: '⋀', bigsqcup: '⨆', biguplus: '⨄', intop: '∫', smallint: '∫',
}
const NAMED_LIMITS = ['lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'det', 'Pr', 'gcd', 'argmax', 'argmin', 'injlim', 'projlim']
const LIMITS = new Set([...Object.keys(BIG).filter(name => !/int/.test(name)), ...NAMED_LIMITS])

// Operator names drawn upright, as words.
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'arccot', 'sinh', 'cosh',
  'tanh', 'coth', 'sech', 'csch', 'log', 'ln', 'lg', 'exp', 'lim', 'liminf', 'limsup', 'sup', 'inf',
  'max', 'min', 'det', 'dim', 'ker', 'deg', 'gcd', 'lcm', 'arg', 'Pr', 'hom', 'Hom', 'tr', 'Tr',
  'rank', 'sgn', 'diag', 'span', 'injlim', 'projlim', 'argmax', 'argmin', 'Res', 'erf', 'id',
])

const SPACES: Record<string, string> = {
  ',': ' ', ':': ' ', '>': ' ', ';': ' ', ' ': ' ', '!': '', quad: '  ', qquad: '    ', enspace: ' ',
  thinspace: ' ', medspace: ' ', thickspace: ' ', enskip: ' ', negthinspace: '', negmedspace: '',
  negthickspace: '', hfill: ' ', hspace: ' ', space: ' ', nobreakspace: ' ', allowbreak: '',
}

// Commands that change nothing a terminal can show; those in DROP_WITH_ARG
// take an argument with them.
const IGNORED = new Set([
  'left', 'right', 'middle', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl',
  'biggr', 'Biggl', 'Biggr', 'bigm', 'Bigm', 'displaystyle', 'textstyle', 'scriptstyle',
  'scriptscriptstyle', 'nolimits', 'nonumber', 'notag', 'limits', 'mathstrut', 'strut', 'relax',
  'protect', 'normalsize', 'small', 'large', 'Large', 'LARGE', 'huge', 'Huge', 'tiny', 'footnotesize',
  'scriptsize', 'mathord', 'mathbin', 'mathrel', 'mathop', 'mathopen', 'mathclose', 'mathpunct',
  'mathinner', 'ensuremath', 'leavevmode', 'centering', 'noindent', 'cr', 'hline', 'midrule',
  'toprule', 'bottomrule', 'vphantom', 'smash', 'rlap', 'llap', 'mathrlap', 'mathllap', 'clap',
])
const DROP_WITH_ARG = new Set(['label', 'hphantom', 'phantom', 'vspace', 'color', 'cline'])

// Accents: a combining mark after the character. Wide ones go over every
// character of their argument.
const ACCENTS: Record<string, string> = {
  hat: '̂', widehat: '̂', check: '̌', widecheck: '̌', tilde: '̃',
  widetilde: '̃', acute: '́', grave: '̀', dot: '̇', ddot: '̈',
  dddot: '⃛', breve: '̆', bar: '̄', vec: '⃗', mathring: '̊',
  overline: '̅', underline: '̲', overrightarrow: '⃗', overleftarrow: '⃖',
  utilde: '̰', underbar: '̲', cancel: '̶', bcancel: '̶', xcancel: '̶',
  sout: '̶', overleftrightarrow: '⃡',
}
const WIDE_ACCENTS = new Set(['widehat', 'widetilde', 'widecheck', 'overline', 'underline', 'overrightarrow', 'overleftarrow', 'cancel', 'bcancel', 'xcancel', 'sout', 'underbar', 'utilde', 'overleftrightarrow'])

const NEGATED: Record<string, string> = {
  '=': '≠', '∈': '∉', '⊂': '⊄', '⊃': '⊅', '⊆': '⊈', '⊇': '⊉', '<': '≮', '>': '≯', '≤': '≰',
  '≥': '≱', '∼': '≁', '≡': '≢', '∃': '∄', '≅': '≇', '≈': '≉', '∣': '∤', '∥': '∦', '≃': '≄',
  '→': '↛', '←': '↚', '⇒': '⇏', '⇔': '⇎', '↔': '↮', '≺': '⊀', '≻': '⊁', '⊢': '⊬', '⊨': '⊭',
}

// ---------------------------------------------------------------------------
// Math alphabets

function shift(text: string, ranges: [RegExp, number, number][], exceptions: Record<string, string> = {}): string {
  let out = ''
  for (const ch of text) {
    if (exceptions[ch]) {
      out += exceptions[ch]
      continue
    }
    const range = ranges.find(([re]) => re.test(ch))
    out += range ? String.fromCodePoint(range[1] + ch.codePointAt(0)! - range[2]) : ch
  }
  return out
}

const UPPER: [RegExp, number] = [/^[A-Z]$/, 65]
const LOWER: [RegExp, number] = [/^[a-z]$/, 97]
const DIGIT: [RegExp, number] = [/^[0-9]$/, 48]
const at = ([re, from]: [RegExp, number], start: number): [RegExp, number, number] => [re, start, from]

const ALPHABETS: Record<string, (text: string) => string> = {
  bf: t => shift(t, [at(UPPER, 0x1d400), at(LOWER, 0x1d41a), at(DIGIT, 0x1d7ce)]),
  bb: t =>
    shift(t, [at(UPPER, 0x1d538), at(LOWER, 0x1d552), at(DIGIT, 0x1d7d8)], {
      C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ',
    }),
  cal: t =>
    shift(t, [at(UPPER, 0x1d49c), at(LOWER, 0x1d4b6)], {
      B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ',
    }),
  frak: t => shift(t, [at(UPPER, 0x1d504), at(LOWER, 0x1d51e)], { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' }),
  sf: t => shift(t, [at(UPPER, 0x1d5a0), at(LOWER, 0x1d5ba), at(DIGIT, 0x1d7e2)]),
  tt: t => shift(t, [at(UPPER, 0x1d670), at(LOWER, 0x1d68a), at(DIGIT, 0x1d7f6)]),
  // Bold italic, for \bm and \boldsymbol: Greek too.
  bm: t =>
    shift(t, [
      at(UPPER, 0x1d468),
      at(LOWER, 0x1d482),
      at(DIGIT, 0x1d7ce),
      [/^[Α-Ω]$/, 0x1d71c, 0x391],
      [/^[α-ω]$/, 0x1d736, 0x3b1],
    ]),
  rm: t => t,
}
const ALPHABET_COMMANDS: Record<string, keyof typeof ALPHABETS> = {
  mathbf: 'bf', textbf: 'bf', bf: 'bf', mathbfup: 'bf', vb: 'bf', mathbb: 'bb', Bbb: 'bb', mathds: 'bb',
  mathcal: 'cal', mathscr: 'cal', mathfrak: 'frak', mathsf: 'sf', textsf: 'sf', mathtt: 'tt',
  texttt: 'tt', boldsymbol: 'bm', bm: 'bm', pmb: 'bm', mathrm: 'rm', mathit: 'rm', mathnormal: 'rm',
  mathup: 'rm', textit: 'rm', textup: 'rm', emph: 'rm', textmd: 'rm', textsl: 'rm',
}

// ---------------------------------------------------------------------------
// Sub- and superscripts

const SUP_FROM = '0123456789+-−=()abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVWαβγδεθιφχ'
const SUP_TO = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂᵅᵝᵞᵟᵋᶿᶥᵠᵡ'
const SUB_FROM = '0123456789+-−=()aehijklmnoprstuvxβγρφχ'
const SUB_TO = '₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓᵦᵧᵨᵩᵪ'
function scriptMap(from: string, to: string): Map<string, string> {
  const a = [...from]
  const b = [...to]
  return new Map(a.map((ch, i) => [ch, b[i]!]))
}
const SUP = scriptMap(SUP_FROM, SUP_TO)
const SUB = scriptMap(SUB_FROM, SUB_TO)
// Characters already raised, or that read fine as they are, in a superscript.
for (const ch of ['′', '″', '‴', '*', '∗', '°', '†', '‡', ',', '˒']) SUP.set(ch, ch === '∗' ? '*' : ch === '∘' ? '°' : ch)
SUP.set('∘', '°')
SUB.set(',', ',')

function toScript(text: string, map: Map<string, string>): string | null {
  let out = ''
  for (const ch of text.replace(/\s+/g, '')) {
    const mapped = map.get(ch)
    if (mapped === undefined) return null
    out += mapped
  }
  return out
}

// ---------------------------------------------------------------------------
// Tall delimiters, for a display formula several rows high.

function tallDelimiter(ch: string, height: number, base: number): Box {
  if (height <= 1 || ch === '') return { lines: [ch], base: 0 }
  const column = (top: string, middle: string, bottom: string, centerMark?: string) => {
    const lines = Array.from({ length: height }, (_, i) => (i === 0 ? top : i === height - 1 ? bottom : middle))
    if (centerMark) lines[Math.floor((height - 1) / 2)] = centerMark
    return { lines, base }
  }
  switch (ch) {
    case '(': return column('⎛', '⎜', '⎝')
    case ')': return column('⎞', '⎟', '⎠')
    case '[': return column('⎡', '⎢', '⎣')
    case ']': return column('⎤', '⎥', '⎦')
    case '⌈': return column('⎡', '⎢', '⎢')
    case '⌉': return column('⎤', '⎥', '⎥')
    case '⌊': return column('⎢', '⎢', '⎣')
    case '⌋': return column('⎥', '⎥', '⎦')
    case '{': return column('⎧', '⎪', '⎩', height > 2 ? '⎨' : undefined)
    case '}': return column('⎫', '⎪', '⎭', height > 2 ? '⎬' : undefined)
    case '|': case '∣': return column('│', '│', '│')
    case '‖': return column('‖', '‖', '‖')
    case '⟨': return { lines: Array.from({ length: height }, (_, i) => (i < height / 2 ? '╱' : '╲')), base }
    case '⟩': return { lines: Array.from({ length: height }, (_, i) => (i < height / 2 ? '╲' : '╱')), base }
    default: return column(ch, ch, ch)
  }
}

function delimited(open: string, inner: Box, close: string): Box {
  return hcat([tallDelimiter(open, inner.lines.length, inner.base), inner, tallDelimiter(close, inner.lines.length, inner.base)])
}

// ---------------------------------------------------------------------------
// Macros: \newcommand, \renewcommand, \def and \DeclareMathOperator, from the
// macros file and from the formula itself, expanded before conversion.

export type Macros = Map<string, { args: number; body: string; isOperator?: boolean }>

// The text of the braced group that opens at `start`, and where it ends.
function groupAt(src: string, start: number): { text: string; end: number } | null {
  if (src[start] !== '{') return null
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') i += 1
    else if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return { text: src.slice(start + 1, i), end: i + 1 }
    }
  }
  return null
}

export function readMacros(src: string, into: Macros = new Map()): Macros {
  const re = /\\(?:(?:re)?newcommand\*?|providecommand\*?|DeclareMathOperator(\*?)|def)\s*/g
  for (const m of src.matchAll(re)) {
    let i = m.index! + m[0].length
    let name = ''
    const braced = groupAt(src, i)
    if (braced) {
      name = braced.text.trim()
      i = braced.end
    } else {
      const bare = /^\\[a-zA-Z]+/.exec(src.slice(i))
      if (!bare) continue
      name = bare[0]
      i += name.length
    }
    if (!name.startsWith('\\')) continue
    let args = 0
    const count = /^\s*\[(\d)\]/.exec(src.slice(i))
    if (count) {
      args = Number(count[1])
      i += count[0].length
    } else {
      // \def\f#1#2{...}
      const params = /^(#\d)+/.exec(src.slice(i))
      if (params) {
        args = params[0].length / 2
        i += params[0].length
      }
    }
    while (src[i] === ' ') i += 1
    const body = groupAt(src, i)
    if (!body) continue
    const isOperator = m[0].startsWith('\\DeclareMathOperator')
    into.set(name.slice(1), { args, body: isOperator ? `\\operatorname${m[1] ? '*' : ''}{${body.text}}` : body.text, isOperator })
  }
  return into
}

function expandMacros(src: string, macros: Macros): string {
  if (macros.size === 0) return src
  let out = src
  // Each pass expands one level; a macro that expands into itself stops here.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    out = out.replace(/\\([a-zA-Z]+)/g, (whole, name: string, offset: number, all: string) => {
      const macro = macros.get(name)
      if (!macro || macro.args > 0) return whole
      changed = true
      // Keep a following letter from joining the expansion's last command.
      return /[a-zA-Z]/.test(all[offset + whole.length] ?? '') ? `{${macro.body}}` : macro.body
    })
    // Macros with arguments: read each braced or single-token argument.
    let result = ''
    let i = 0
    const re = /\\([a-zA-Z]+)/g
    for (let m = re.exec(out); m; m = re.exec(out)) {
      const macro = macros.get(m[1]!)
      if (!macro || macro.args === 0) continue
      let j = m.index + m[0].length
      const args: string[] = []
      for (let k = 0; k < macro.args; k++) {
        while (out[j] === ' ') j += 1
        const group = groupAt(out, j)
        if (group) {
          args.push(group.text)
          j = group.end
        } else if (out[j] === '\\') {
          const cmd = /^\\([a-zA-Z]+|.)/.exec(out.slice(j))![0]
          args.push(cmd)
          j += cmd.length
        } else if (j < out.length) {
          args.push(out[j]!)
          j += 1
        }
      }
      result += out.slice(i, m.index) + `{${macro.body.replace(/#(\d)/g, (_, n: string) => args[Number(n) - 1] ?? '')}}`
      i = j
      re.lastIndex = j
      changed = true
    }
    out = result + out.slice(i)
    if (!changed) break
  }
  return out
}

// ---------------------------------------------------------------------------
// The converter

type Kind = 'ord' | 'bin' | 'rel' | 'op' | 'open' | 'close' | 'punct' | 'space'
type Item = { box: Box; kind: Kind; limits?: boolean; hasScripts?: boolean }

// Splits a body at top-level `\\` into rows and each row at `&` into cells.
function splitRows(body: string): string[][] {
  const rows: string[][] = [['']]
  let depth = 0
  let env = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    const row = rows[rows.length - 1]!
    if (c === '\\') {
      const rest = body.slice(i)
      if (rest.startsWith('\\begin{')) env += 1
      if (rest.startsWith('\\end{')) env -= 1
      if (depth === 0 && env === 0 && body[i + 1] === '\\') {
        // A row break, with any [2pt] spacing after it.
        const spacing = /^\\\\\s*(\[[^\]]*\])?/.exec(rest)!
        rows.push([''])
        i += spacing[0].length - 1
        continue
      }
      row[row.length - 1] += body.slice(i, i + 2)
      i += 1
      continue
    }
    if (c === '{') depth += 1
    if (c === '}') depth -= 1
    if (c === '&' && depth === 0 && env === 0) {
      row.push('')
      continue
    }
    row[row.length - 1] += c
  }
  // A last row that is empty, from a trailing \\, is not a row.
  const last = rows[rows.length - 1]!
  if (rows.length > 1 && last.every(cell => cell.trim() === '')) rows.pop()
  return rows
}

const MATRIX_DELIMITERS: Record<string, [string, string]> = {
  matrix: ['', ''], smallmatrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'],
  vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], array: ['', ''], subarray: ['', ''],
}
const ALIGN_ENVS = new Set(['align', 'aligned', 'alignat', 'alignedat', 'flalign', 'eqnarray', 'split', 'IEEEeqnarray'])
const CENTER_ENVS = new Set(['gather', 'gathered', 'multline', 'equation', 'displaymath', 'math', 'subequations', 'center'])

class Converter {
  private i = 0
  private tags: string[] = []

  constructor(
    private src: string,
    private mode: Mode,
    private macros: Macros,
  ) {}

  run(): Box {
    const box = this.sequence(null)
    if (this.tags.length) return hcat([box, textBox(`    (${this.tags.join(', ')})`)])
    return box
  }

  private sub(src: string, mode: Mode): Box {
    return new Converter(src, mode, this.macros).run()
  }

  private get flat(): boolean {
    return this.mode !== 'display'
  }

  private skipSpace(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i]!)) this.i += 1
  }

  private peekCommand(): string | null {
    const m = /^\\([a-zA-Z]+|.)/.exec(this.src.slice(this.i))
    return m ? m[1]! : null
  }

  // A raw argument: the braced group's text, or one token.
  private rawArg(): string {
    this.skipSpace()
    const group = groupAt(this.src, this.i)
    if (group) {
      this.i = group.end
      return group.text
    }
    const cmd = /^\\([a-zA-Z]+|.)/.exec(this.src.slice(this.i))
    if (cmd) {
      this.i += cmd[0].length
      return cmd[0]
    }
    const ch = this.src[this.i] ?? ''
    this.i += ch.length
    return ch
  }

  private optionalArg(): string | null {
    this.skipSpace()
    if (this.src[this.i] !== '[') return null
    let depth = 0
    for (let j = this.i; j < this.src.length; j++) {
      const c = this.src[j]
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === ']' && depth === 0) {
        const text = this.src.slice(this.i + 1, j)
        this.i = j + 1
        return text
      }
    }
    return null
  }

  private arg(mode: Mode = this.mode): Box {
    return this.sub(this.rawArg(), mode)
  }

  // Reads atoms up to `stop` (a closing `}`, or `\right` for a \left), and
  // lays them out with TeX's spacing between them.
  private sequence(stop: '}' | 'right' | null): Box {
    const items: Item[] = []
    while (this.i < this.src.length) {
      if (stop === '}' && this.src[this.i] === '}') {
        this.i += 1
        break
      }
      if (stop === 'right' && this.src.startsWith('\\right', this.i) && !/[a-zA-Z]/.test(this.src[this.i + 6] ?? '')) break
      const item = this.atom()
      if (!item) continue
      this.scripts(item)
      items.push(item)
    }
    return this.join(items)
  }

  private join(items: Item[]): Box {
    const spaced = this.mode !== 'script'
    const parts: Box[] = []
    const visible = items.filter(item => !(item.kind === 'space' && item.box.lines[0] === ''))
    visible.forEach((item, n) => {
      const before = visible[n - 1]
      const after = visible[n + 1]
      let kind = item.kind
      // An operator with nothing to its left is a sign: -x, +1.
      if (kind === 'bin' && (!before || ['bin', 'rel', 'open', 'punct', 'op'].includes(before.kind))) kind = 'ord'
      if (kind === 'bin' && !after) kind = 'ord'
      // Relations take a space each side, binary operators one each side
      // between two operands, and a named or large operator one before an
      // operand next to it and one after, unless a bracket follows.
      const spaceBefore = spaced && before && (kind === 'bin' || kind === 'rel' || (kind === 'op' && ['ord', 'close'].includes(before.kind)))
      const spaceAfter =
        spaced &&
        after &&
        after.kind !== 'close' &&
        (kind === 'bin' || kind === 'rel' || kind === 'punct' || (kind === 'op' && !['punct', 'bin', 'rel'].includes(after.kind) && (after.kind !== 'open' || item.hasScripts)))
      if (spaceBefore && !item.box.lines[item.box.base]?.startsWith(' ')) parts.push(textBox(' '))
      parts.push(item.box)
      // A stacked operator's centered row may already start or end in a space.
      if (spaceAfter && !item.box.lines[item.box.base]?.endsWith(' ')) parts.push(textBox(' '))
    })
    const box = hcat(parts)
    // Collapse the runs of spaces that spacing commands and padding leave.
    return { lines: box.lines.map(line => (isFlat(box) ? line.replace(/ {3,}/g, m => (m.length >= 4 ? '    ' : '  ')).replace(/^ +| +$/g, '') : line)), base: box.base }
  }

  // Attaches the sub- and superscripts that follow an item.
  private scripts(item: Item): void {
    let sup: string | null = null
    let sub: string | null = null
    let limits = item.limits ?? false
    for (;;) {
      this.skipSpace()
      const c = this.src[this.i]
      if (c === "'") {
        let primes = ''
        while (this.src[this.i] === "'") {
          primes += '′'
          this.i += 1
        }
        sup = (sup ?? '') + primes
        continue
      }
      if (c === '^' || c === '_') {
        this.i += 1
        const raw = this.rawArg()
        if (c === '^') sup = sup === null ? raw : `${sup}${raw}`
        else sub = sub === null ? raw : `${sub}${raw}`
        continue
      }
      const cmd = this.peekCommand()
      if (cmd === 'limits' || cmd === 'nolimits') {
        limits = cmd === 'limits'
        this.i += cmd.length + 1
        continue
      }
      break
    }
    if (sup === null && sub === null) return
    item.hasScripts = true
    const supBox = sup === null ? null : this.sub(sup.replace(/′/g, "\\prime "), 'script')
    const subBox = sub === null ? null : this.sub(sub, 'script')
    if (limits && !this.flat) {
      const rows = [supBox, item.box, subBox].filter((b): b is Box => b !== null)
      const width = Math.max(...rows.map(boxWidth))
      item.box = vstack(rows, (supBox ? supBox.lines.length : 0) + item.box.base, width)
      return
    }
    const parts: Box[] = [item.box]
    const raised = supBox && toScript(flatText(supBox), SUP)
    const lowered = subBox && toScript(flatText(subBox), SUB)
    if (subBox) parts.push(lowered !== null ? textBox(lowered) : this.flat ? textBox(`_${wrapScript(flatText(subBox))}`) : { lines: ['', flatText(subBox)], base: 0 })
    if (supBox) parts.push(raised !== null ? textBox(raised) : this.flat ? textBox(`^${wrapScript(flatText(supBox))}`) : { lines: [flatText(supBox), ''], base: 1 })
    item.box = hcat(parts)
  }

  private atom(): Item | null {
    const c = this.src[this.i]!
    if (/\s/.test(c)) {
      this.i += 1
      return null
    }
    if (c === '{') {
      this.i += 1
      return { box: this.sequence('}'), kind: 'ord' }
    }
    if (c === '}') {
      this.i += 1
      return null
    }
    if (c === '\\') return this.command()
    if (c === '^' || c === '_') {
      // A script with nothing before it.
      return { box: textBox(''), kind: 'ord' }
    }
    if (c === '$') {
      this.i += 1
      return null
    }
    if (c === '~') {
      this.i += 1
      return { box: textBox(' '), kind: 'space' }
    }
    if (c === '&') {
      this.i += 1
      return { box: textBox(' '), kind: 'space' }
    }
    if (c === "'") {
      this.i += 1
      return { box: textBox('′'), kind: 'ord' }
    }
    const ch = String.fromCodePoint(this.src.codePointAt(this.i)!)
    this.i += ch.length
    if (c === '-') return { box: textBox('−'), kind: 'bin' }
    if ('+*'.includes(c)) return { box: textBox(c === '*' ? '∗' : c), kind: 'bin' }
    if ('=<>'.includes(c)) return { box: textBox(c), kind: 'rel' }
    if (c === ':') return { box: textBox(':'), kind: 'rel' }
    if (',;'.includes(c)) return { box: textBox(c), kind: 'punct' }
    if ('([⟨'.includes(c)) return { box: textBox(c), kind: 'open' }
    if (')]⟩'.includes(c)) return { box: textBox(c), kind: 'close' }
    if (['≤', '≥', '≠', '→', '←', '⇒', '∈', '≈', '≡'].includes(ch)) return { box: textBox(ch), kind: 'rel' }
    if (['±', '×', '÷', '·', '⋅', '∓'].includes(ch)) return { box: textBox(ch), kind: 'bin' }
    return { box: textBox(ch), kind: 'ord' }
  }

  private command(): Item | null {
    const m = /^\\([a-zA-Z]+\*?|.)/.exec(this.src.slice(this.i))
    if (!m) {
      this.i += 1
      return null
    }
    let name = m[1]!
    // A star belongs to the name only for the commands that take one.
    if (name.endsWith('*') && !['operatorname*', 'DeclareMathOperator*', 'newcommand*', 'renewcommand*'].includes(name)) name = name.slice(0, -1)
    this.i += 1 + name.length
    const ord = (text: string): Item => ({ box: textBox(text), kind: 'ord' })

    if (name in SPACES) {
      if (name === 'hspace') this.rawArg()
      return { box: textBox(SPACES[name]!), kind: 'space' }
    }
    if (name === '\\') return { box: textBox(this.flat ? '; ' : ' '), kind: 'space' }
    if ('{}$%&#_|'.includes(name) && name.length === 1) return name === '|' ? ord('‖') : ord(name)
    if (name in GREEK) return ord(GREEK[name]!)
    if (name in ORD) {
      const kind: Kind = ['langle', 'lceil', 'lfloor', 'lvert', 'lVert', 'lbrace', 'lbrack', 'lgroup'].includes(name) ? 'open' : ['rangle', 'rceil', 'rfloor', 'rvert', 'rVert', 'rbrace', 'rbrack', 'rgroup'].includes(name) ? 'close' : 'ord'
      return { box: textBox(ORD[name]!), kind }
    }
    if (name in BIN) return { box: textBox(BIN[name]!), kind: 'bin' }
    if (name in REL) return { box: textBox(REL[name]!), kind: 'rel' }
    if (name in BIG) return { box: textBox(BIG[name]!), kind: 'op', limits: LIMITS.has(name) }
    if (FUNCTIONS.has(name)) return { box: textBox(name === 'argmax' || name === 'argmin' ? `arg${name.slice(3)}` : name.replace(/^lim(inf|sup)$/, 'lim $1')), kind: 'op', limits: LIMITS.has(name) }
    if (IGNORED.has(name)) {
      if (name === 'left') return this.leftRight()
      if (['vphantom', 'smash', 'rlap', 'llap', 'mathrlap', 'mathllap', 'clap'].includes(name)) {
        const inner = this.rawArg()
        return name === 'vphantom' ? null : { box: this.sub(inner, this.mode), kind: 'ord' }
      }
      if (['mathord', 'mathbin', 'mathrel', 'mathop', 'mathopen', 'mathclose', 'mathpunct', 'mathinner', 'ensuremath'].includes(name)) {
        const box = this.arg()
        const kind: Kind = name === 'mathbin' ? 'bin' : name === 'mathrel' ? 'rel' : name === 'mathop' ? 'op' : name === 'mathopen' ? 'open' : name === 'mathclose' ? 'close' : name === 'mathpunct' ? 'punct' : 'ord'
        return { box, kind }
      }
      if (name === 'right') {
        this.rawArg()
        return null
      }
      if (['big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr', 'bigm', 'Bigm', 'middle'].includes(name)) {
        const delim = this.delimiter()
        const kind: Kind = /l$/.test(name) ? 'open' : /r$/.test(name) ? 'close' : name.endsWith('m') || name === 'middle' ? 'rel' : 'ord'
        return { box: textBox(delim), kind }
      }
      return null
    }
    if (DROP_WITH_ARG.has(name)) {
      this.rawArg()
      return null
    }
    if (name in ALPHABET_COMMANDS) {
      const style = ALPHABETS[ALPHABET_COMMANDS[name]!]!
      const isText = name.startsWith('text') || name === 'emph'
      const box = isText ? this.text(this.rawArg()) : this.arg()
      return { box: { lines: box.lines.map(style), base: box.base }, kind: 'ord' }
    }
    if (name in ACCENTS) {
      const mark = ACCENTS[name]!
      const box = this.arg(this.flat ? this.mode : 'inline')
      const text = flatText(box)
      const chars = [...text]
      if (WIDE_ACCENTS.has(name) || chars.length === 1) return ord(chars.map(ch => (ch === ' ' ? ch : ch + mark)).join(''))
      // A narrow accent over several characters goes on the last letter.
      const last = chars.length - 1
      return ord(chars.map((ch, n) => (n === last ? ch + mark : ch)).join(''))
    }

    switch (name) {
      case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': case 'genfrac': case 'flatfrac':
        if (name === 'genfrac') for (let k = 0; k < 4; k++) this.rawArg()
        return this.fraction(this.rawArg(), this.rawArg(), name === 'tfrac' || name === 'flatfrac')
      case 'over': return ord('/')
      case 'dv': case 'pdv': case 'odv': {
        const d = name === 'pdv' ? '∂' : 'd'
        const order = this.optionalArg()
        const f = this.rawArg()
        this.skipSpace()
        const hasVar = this.src[this.i] === '{'
        const x = hasVar ? this.rawArg() : null
        const power = order ? `^{${order}}` : ''
        if (x === null) return this.fraction(`${d}${power}`, `${d}`, false)
        return this.fraction(`${d}${power} ${f}`, `${d} ${x}${power}`, false)
      }
      case 'binom': case 'dbinom': case 'tbinom': {
        const n = this.rawArg()
        const k = this.rawArg()
        if (this.flat) return ord(`C(${flatText(this.sub(n, 'inline'))}, ${flatText(this.sub(k, 'inline'))})`)
        return { box: delimited('(', vstack([this.sub(n, 'display'), this.sub(k, 'display')], 0), ')'), kind: 'ord' }
      }
      case 'sqrt': {
        const index = this.optionalArg()
        const box = this.arg()
        const sign = index === '3' ? '∛' : index === '4' ? '∜' : index ? `${toScript(index, SUP) ?? `(${index})`}√` : '√'
        if (!isFlat(box)) return { box: hcat([textBox(sign), delimited('(', box, ')')]), kind: 'ord' }
        const text = flatText(box)
        return ord(isSimple(text) ? `${sign}${text}` : `${sign}(${text})`)
      }
      case 'operatorname': case 'operatorname*': case 'DeclareMathOperator': {
        const text = this.rawArg().replace(/\\,|\\[:;!]/g, ' ').replace(/[{}\\]/g, '')
        return { box: textBox(text), kind: 'op', limits: name === 'operatorname*' }
      }
      case 'text': case 'textrm': case 'textnormal': case 'mbox': case 'hbox': case 'textsc': case 'intertext': case 'shortintertext': case 'tag': {
        const box = this.text(this.rawArg())
        if (name === 'tag') {
          this.tags.push(flatText(box))
          return null
        }
        return { box, kind: 'ord' }
      }
      case 'not': {
        this.skipSpace()
        const next = this.atom()
        if (!next) return null
        const text = flatText(next.box)
        return { box: textBox(NEGATED[text] ?? `${text}̸`), kind: 'rel' }
      }
      case 'mod': case 'bmod': return { box: textBox(' mod '), kind: 'space' }
      case 'pmod': return ord(` (mod ${flatText(this.arg('inline'))})`)
      case 'pod': return ord(` (${flatText(this.arg('inline'))})`)
      case 'stackrel': case 'overset': case 'underset': {
        const mark = this.rawArg()
        const base = this.rawArg()
        const baseItem = this.sub(base, this.mode)
        const markBox = this.sub(mark, 'script')
        const isOver = name !== 'underset'
        if (this.flat) {
          const scripted = toScript(flatText(markBox), isOver ? SUP : SUB)
          return { box: textBox(flatText(baseItem) + (scripted ?? `${isOver ? '^' : '_'}${wrapScript(flatText(markBox))}`)), kind: name === 'stackrel' ? 'rel' : 'ord' }
        }
        const rows = isOver ? [markBox, baseItem] : [baseItem, markBox]
        return { box: vstack(rows, isOver ? markBox.lines.length + baseItem.base : baseItem.base), kind: name === 'stackrel' ? 'rel' : 'ord' }
      }
      case 'overbrace': case 'underbrace': case 'overbracket': case 'underbracket': {
        const box = this.arg()
        if (this.flat) return { box, kind: 'ord' }
        const width = boxWidth(box)
        const brace = name.startsWith('over') ? '⏞' : '⏟'
        const rule = textBox(brace.repeat(Math.max(1, width)))
        return name.startsWith('over')
          ? { box: vstack([rule, box], 1 + box.base, width), kind: 'op', limits: true }
          : { box: vstack([box, rule], box.base, width), kind: 'op', limits: true }
      }
      case 'boxed': case 'fbox': case 'framebox': {
        const box = name === 'boxed' ? this.arg() : this.text(this.rawArg())
        if (this.flat) return ord(`[${flatText(box)}]`)
        const width = boxWidth(box)
        return {
          box: { lines: [`┌${'─'.repeat(width + 2)}┐`, ...box.lines.map(line => `│ ${padRight(line, width)} │`), `└${'─'.repeat(width + 2)}┘`], base: box.base + 1 },
          kind: 'ord',
        }
      }
      case 'xrightarrow': case 'xleftarrow': case 'xRightarrow': case 'xLeftarrow': case 'xmapsto': case 'xleftrightarrow': case 'xrightleftharpoons': {
        const under = this.optionalArg()
        const over = flatText(this.arg('script'))
        const head = { xrightarrow: '→', xleftarrow: '←', xRightarrow: '⇒', xLeftarrow: '⇐', xmapsto: '↦', xleftrightarrow: '↔', xrightleftharpoons: '⇌' }[name]
        if (this.flat) return { box: textBox(over ? `─${over}${head}` : head), kind: 'rel' }
        const width = Math.max(cellWidth(over), cellWidth(under ?? ''), 1) + 2
        const arrow = name === 'xleftarrow' || name === 'xLeftarrow' ? `${head}${'─'.repeat(width - 1)}` : `${'─'.repeat(width - 1)}${head}`
        const rows = [textBox(over), textBox(arrow), ...(under ? [this.sub(under, 'script')] : [])]
        return { box: vstack(rows, 1, width), kind: 'rel' }
      }
      case 'textcolor': case 'colorbox': {
        this.rawArg()
        return { box: name === 'colorbox' ? this.text(this.rawArg()) : this.arg(), kind: 'ord' }
      }
      case 'begin': return this.environment()
      case 'end': {
        this.rawArg()
        return null
      }
      case 'newcommand': case 'renewcommand': case 'newcommand*': case 'renewcommand*': case 'providecommand': case 'def': case 'DeclareMathOperator*': {
        // A definition inside the formula: read it, then draw nothing.
        const start = this.i - name.length - 1
        const rest = this.src.slice(start)
        readMacros(rest.slice(0, definitionLength(rest)), this.macros)
        this.i = start + definitionLength(rest)
        return null
      }
      case 'ce': case 'pu': return ord(chemistry(this.rawArg()))
      case 'abs': return this.paired('|', '|')
      case 'norm': return this.paired('‖', '‖')
      case 'qty': case 'quantity': case 'pqty': return this.paired('(', ')', true)
      case 'bqty': return this.paired('[', ']')
      case 'Bqty': return this.paired('{', '}')
      case 'vqty': return this.paired('|', '|')
      case 'ev': case 'expval': case 'expectationvalue': return this.paired('⟨', '⟩')
      case 'order': case 'bigO': return { box: hcat([textBox('O'), this.paired('(', ')').box]), kind: 'ord' }
      case 'bra': return ord(`⟨${flatText(this.arg('inline'))}|`)
      case 'ket': return ord(`|${flatText(this.arg('inline'))}⟩`)
      case 'braket': case 'Braket': {
        const first = flatText(this.arg('inline'))
        this.skipSpace()
        if (this.src[this.i] === '{') return ord(`⟨${first}|${flatText(this.arg('inline'))}⟩`)
        return ord(`⟨${first.replace(/\s*[|‖]\s*/g, '|')}⟩`)
      }
      case 'ketbra': case 'dyad': {
        const a = flatText(this.arg('inline'))
        return ord(`|${a}⟩⟨${flatText(this.arg('inline'))}|`)
      }
      case 'Set': case 'set': return this.paired('{', '}')
      case 'dd': case 'diffd': {
        this.skipSpace()
        if (this.src[this.i] === '{' || this.src[this.i] === '(') return { box: hcat([textBox('d'), this.arg()]), kind: 'ord' }
        return ord('d')
      }
      case 'grad': return ord('∇')
      case 'curl': return ord('∇×')
      case 'divergence': return ord('∇⋅')
      case 'laplacian': return ord('∇²')
      case 'vu': return ord(`${flatText(this.arg('inline'))}̂`)
      case 'unit': case 'si': case 'SI': {
        if (name === 'SI') return ord(`${flatText(this.arg('inline'))} ${units(this.rawArg())}`)
        return ord(units(this.rawArg()))
      }
      case 'num': return ord(this.rawArg())
      case 'ang': return ord(`${this.rawArg()}°`)
      case 'ref': case 'eqref': return ord(`(${this.rawArg()})`)
      case 'cdotp': return { box: textBox('·'), kind: 'punct' }
      case 'ldotp': return { box: textBox('.'), kind: 'punct' }
      case 'hline': return null
      case 'substack': {
        const rows = splitRows(this.rawArg()).map(row => flatText(this.sub(row.join(' '), 'script')))
        return { box: this.flat ? textBox(rows.join(', ')) : vstack(rows.map(textBox), 0), kind: 'ord' }
      }
      case 'TeX': return ord('TeX')
      case 'LaTeX': return ord('LaTeX')
    }
    // A command with no Unicode form is left as its source, so nothing is
    // silently lost.
    return ord(`\\${name}`)
  }

  // A delimiter after \left, \right, \big and the like.
  private delimiter(): string {
    this.skipSpace()
    const cmd = /^\\([a-zA-Z]+|.)/.exec(this.src.slice(this.i))
    if (cmd) {
      this.i += cmd[0].length
      const name = cmd[1]!
      if (name === '{') return '{'
      if (name === '}') return '}'
      if (name === '|') return '‖'
      return ORD[name] ?? REL[name] ?? (name === 'backslash' ? '\\' : '')
    }
    const ch = this.src[this.i] ?? ''
    this.i += 1
    return ch === '.' ? '' : ch === '<' ? '⟨' : ch === '>' ? '⟩' : ch
  }

  // \left( ... \right): the delimiters grow with what is between them.
  private leftRight(): Item {
    const open = this.delimiter()
    const inner = this.sequence('right')
    let close = ''
    if (this.src.startsWith('\\right', this.i)) {
      this.i += 6
      close = this.delimiter()
    }
    return { box: delimited(open, inner, close), kind: 'ord' }
  }

  // An argument in a pair of delimiters, as \abs and \qty draw it. \qty
  // takes the delimiters it is written with.
  private paired(open: string, close: string, takesOwn = false): Item {
    this.skipSpace()
    const c = this.src[this.i]
    if (takesOwn && c && '([|'.includes(c)) {
      const closing = c === '(' ? ')' : c === '[' ? ']' : '|'
      const end = this.src.indexOf(closing, this.i + 1)
      if (end > 0) {
        const inner = this.sub(this.src.slice(this.i + 1, end), this.mode)
        this.i = end + 1
        return { box: delimited(c, inner, closing), kind: 'ord' }
      }
    }
    return { box: delimited(open, this.arg(), close), kind: 'ord' }
  }

  private fraction(top: string, bottom: string, forceFlat: boolean): Item {
    if (this.flat || forceFlat) {
      const a = flatText(this.sub(top, 'inline'))
      const b = flatText(this.sub(bottom, 'inline'))
      const vulgar = VULGAR[`${a}/${b}`]
      if (vulgar) return { box: textBox(vulgar), kind: 'ord' }
      return { box: textBox(`${wrapFlat(a)}/${wrapFlat(b)}`), kind: 'ord' }
    }
    const num = this.sub(top, 'display')
    const den = this.sub(bottom, 'display')
    const width = Math.max(boxWidth(num), boxWidth(den)) + 2
    return { box: vstack([num, textBox('─'.repeat(width)), den], num.lines.length, width), kind: 'ord' }
  }

  // \text{...}: the words as written, with any $...$ inside converted.
  private text(raw: string): Box {
    const words = raw
      .replace(/\$([^$]*)\$/g, (_, inner: string) => flatText(this.sub(inner, 'inline')))
      .replace(/\\([%&#_${}])/g, '$1')
      .replace(/\\textbackslash\s*/g, '\\')
      .replace(/\\(?:quad|qquad)\b\s*/g, '  ')
      .replace(/\\[,;: ]|~/g, ' ')
      .replace(/\\(text\w*|emph|mbox)\s*/g, '')
      .replace(/[{}]/g, '')
      .replace(/``|''/g, '"')
      .replace(/---/g, '—')
      .replace(/--/g, '–')
    return textBox(words)
  }

  private environment(): Item {
    const env = this.rawArg().trim()
    const name = env.replace(/\*$/, '')
    // The column spec of an array, and alignat's column count.
    if (name === 'array' || name === 'subarray' || name === 'alignat' || name === 'alignedat' || name === 'IEEEeqnarray') this.rawArg()
    const endTag = `\\end{${env}}`
    let depth = 0
    let end = -1
    for (let j = this.i; j < this.src.length; j++) {
      if (this.src.startsWith('\\begin{', j)) depth += 1
      else if (this.src.startsWith('\\end{', j)) {
        if (depth === 0 && this.src.startsWith(endTag, j)) {
          end = j
          break
        }
        depth -= 1
      }
    }
    const body = this.src.slice(this.i, end < 0 ? this.src.length : end)
    this.i = end < 0 ? this.src.length : end + endTag.length
    const rows = splitRows(body)
    return { box: this.layoutRows(name, rows), kind: 'ord' }
  }

  private layoutRows(name: string, rows: string[][]): Box {
    const cellMode: Mode = this.flat ? 'inline' : 'display'
    const cells = rows.map(row => row.map(cell => this.sub(cell.trim(), cellMode)))
    if (name === 'cases' || name === 'dcases' || name === 'rcases' || name === 'cases*' || name === 'numcases') {
      if (this.flat) return textBox(`{ ${cells.map(row => row.map(flatText).filter(Boolean).join(' ')).join('; ')} }`)
      const grid = this.grid(cells, ['left', 'left'], '   ')
      return name === 'rcases' ? delimited('', grid, '}') : delimited('{', grid, '')
    }
    if (name in MATRIX_DELIMITERS) {
      const [open, close] = MATRIX_DELIMITERS[name]!
      if (this.flat) {
        const inner = cells.map(row => row.map(flatText).join(' ')).join('; ')
        return textBox(open || close ? `${open}${inner}${close}` : `[${inner}]`)
      }
      const columns = Math.max(...cells.map(row => row.length))
      return delimited(open, this.grid(cells, Array(columns).fill('center'), '  '), close)
    }
    if (this.flat) return textBox(cells.map(row => row.map(flatText).join(' ')).join('; '))
    if (ALIGN_ENVS.has(name)) {
      const columns = Math.max(...cells.map(row => row.length))
      // Pairs of columns: the first of each pair to the right, the second
      // to the left, so the `&=` of each row lines up.
      return this.grid(cells, Array.from({ length: columns }, (_, c) => (c % 2 === 0 ? 'right' : 'left')), '', ' ')
    }
    if (CENTER_ENVS.has(name) || rows.every(row => row.length === 1)) {
      const lines = cells.map(row => hcat(row.flatMap((cell, n) => (n > 0 ? [textBox(' '), cell] : [cell]))))
      const width = Math.max(...lines.map(boxWidth))
      return vstack(lines, 0, width)
    }
    const columns = Math.max(...cells.map(row => row.length))
    return this.grid(cells, Array(columns).fill('left'), '  ')
  }

  // A table of boxes: each column as wide as its widest cell, each row as
  // tall as its tallest. `gap` goes between columns; `pairGap` between the
  // two halves of an align pair.
  private grid(cells: Box[][], align: ('left' | 'right' | 'center')[], gap: string, pairGap?: string): Box {
    const columns = Math.max(...cells.map(row => row.length))
    const widths = Array.from({ length: columns }, (_, c) => Math.max(0, ...cells.map(row => (row[c] ? boxWidth(row[c]!) : 0))))
    const lines: string[] = []
    for (const row of cells) {
      const placed = widths.map((width, c) => {
        const cell = row[c] ?? textBox('')
        const how = align[c] ?? 'left'
        return {
          lines: cell.lines.map(line => {
            const room = width - cellWidth(line)
            if (how === 'right') return ' '.repeat(room) + line
            if (how === 'center') return center(line, width)
            return padRight(line, width)
          }),
          base: cell.base,
        }
      })
      const joined: Box[] = []
      placed.forEach((cell, c) => {
        if (c > 0) joined.push(textBox(pairGap !== undefined ? (c % 2 === 1 ? pairGap : '   ') : gap))
        joined.push(cell)
      })
      lines.push(...hcat(joined).lines.map(line => line.replace(/\s+$/, '')))
    }
    return { lines, base: Math.floor((lines.length - 1) / 2) }
  }
}

function definitionLength(src: string): number {
  // The command, its name, an optional [n] or #1#2, and its body.
  const head = /^\\[a-zA-Z]+\*?\s*(\{\\[a-zA-Z]+\}|\\[a-zA-Z]+)\s*(\[\d\]|(#\d)+)?\s*/.exec(src)
  if (!head) return src.length
  const body = groupAt(src, head[0].length)
  return body ? body.end : head[0].length
}

const VULGAR: Record<string, string> = {
  '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '2/5': '⅖', '3/5': '⅗',
  '4/5': '⅘', '1/6': '⅙', '5/6': '⅚', '1/7': '⅐', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞',
  '1/9': '⅑', '1/10': '⅒',
}

// A text that reads as one term: a number, or a name with its scripts.
function isSimple(text: string): boolean {
  return [...text].length <= 1 || /^[\p{L}\p{N}.′\p{M}⁰-₟ᵃ-ᶿ∂∇]+$/u.test(text)
}
const wrapFlat = (text: string) => (isSimple(text) || /^\(.*\)$/.test(text) ? text : `(${text})`)
const wrapScript = (text: string) => ([...text].length === 1 ? text : `(${text})`)

// mhchem's \ce, read loosely: H2O is H₂O, ->  is →, ^{2+} is ²⁺.
function chemistry(src: string): string {
  return src
    .replace(/<=>|<->/g, ' ⇌ ')
    .replace(/->/g, ' → ')
    .replace(/<-/g, ' ← ')
    .replace(/\^\{([^}]*)\}|\^([0-9+-]+)/g, (_, a: string | undefined, b: string | undefined) => toScript(a ?? b ?? '', SUP) ?? `^(${a ?? b})`)
    .replace(/_\{([^}]*)\}|_([0-9]+)/g, (_, a: string | undefined, b: string | undefined) => toScript(a ?? b ?? '', SUB) ?? `_(${a ?? b})`)
    .replace(/([A-Za-z)\]])(\d+)/g, (_, atom: string, n: string) => atom + toScript(n, SUB)!)
    // A sign straight after an atom is its charge: H+ is H⁺.
    .replace(/([A-Za-z\u2080-\u2089])([+-])(?=\s|$)/g, (_, atom: string, sign: string) => atom + toScript(sign, SUP)!)
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// siunitx units, loosely: \kilo\meter\per\second is km/s.
function units(src: string): string {
  const PREFIX: Record<string, string> = { kilo: 'k', mega: 'M', giga: 'G', tera: 'T', milli: 'm', micro: 'μ', nano: 'n', pico: 'p', centi: 'c' }
  const UNIT: Record<string, string> = {
    meter: 'm', metre: 'm', second: 's', gram: 'g', kelvin: 'K', ampere: 'A', mole: 'mol', candela: 'cd', newton: 'N',
    joule: 'J', watt: 'W', volt: 'V', ohm: 'Ω', hertz: 'Hz', pascal: 'Pa', coulomb: 'C', electronvolt: 'eV', liter: 'L',
    litre: 'L', percent: '%', degree: '°', celsius: '°C', tesla: 'T', henry: 'H', farad: 'F',
  }
  let out = ''
  // What goes before the next unit: a dot between units, a slash after \per.
  let joiner = ''
  for (const m of src.matchAll(/\\([a-zA-Z]+)|([^\\]+)/g)) {
    const name = m[1]
    if (name === undefined) {
      out += (m[2] ?? '').replace(/\^\{?(-?\d+)\}?/g, (_, n: string) => toScript(n, SUP)!).replace(/\s*\.\s*/g, '⋅')
      continue
    }
    if (name === 'per') joiner = '/'
    else if (name === 'squared' || name === 'cubed') out += name === 'squared' ? '²' : '³'
    else if (name in PREFIX) {
      out += (out ? joiner || '⋅' : '') + PREFIX[name]
      joiner = 'prefixed'
    } else {
      out += (joiner === 'prefixed' ? '' : out ? joiner || '⋅' : '') + (UNIT[name] ?? name)
      joiner = ''
    }
  }
  return out
}

// One line of Unicode for an inline formula.
export function texToUnicode(tex: string, macros: Macros = new Map()): string {
  try {
    const local = new Map(macros)
    return flatText(new Converter(expandMacros(tex, local), 'inline', local).run()).replace(/\s+/g, ' ').trim()
  } catch {
    return tex
  }
}

// The rows of a display formula, laid out in two dimensions.
export function texToUnicodeLines(tex: string, macros: Macros = new Map()): string[] {
  try {
    const local = new Map(macros)
    let src = expandMacros(tex, local).trim()
    // A bare row break or & at the top level makes the whole formula an
    // aligned block.
    if (!/^\\begin\{/.test(src) && splitRows(src).some(row => row.length > 1)) src = `\\begin{aligned}${src}\\end{aligned}`
    else if (!/^\\begin\{/.test(src) && splitRows(src).length > 1) src = `\\begin{gathered}${src}\\end{gathered}`
    const box = new Converter(src, 'display', local).run()
    const lines = box.lines.map(line => line.replace(/\s+$/, ''))
    // Drop the blank rows a lone script or empty cell can leave at the edges.
    while (lines.length > 1 && lines[0]!.trim() === '') lines.shift()
    while (lines.length > 1 && lines[lines.length - 1]!.trim() === '') lines.pop()
    const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.length - line.trimStart().length))
    return lines.map(line => line.slice(Number.isFinite(indent) ? indent : 0))
  } catch {
    return [tex]
  }
}
