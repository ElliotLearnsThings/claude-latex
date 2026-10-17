import type { PromptEditInput, PromptEditResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { promptDecorations } from '../hooks/prompt'
import { bwrapArgv, outermost } from '../hooks/sandbox'
import { installHint, searchFolders } from '../hooks/setup'
import { DARK_STYLE } from '../hooks/style'
import { readMacros, texToUnicode, texToUnicodeLines } from '../hooks/unicode'

const reply = (text: string) => ({ text, isFirstOfReply: true })
// The kit raises prompt.edit as the composer does, though its typings do
// not list the call yet.
const edit = ($: unknown, input: PromptEditInput) => ($ as { prompt: { edit: (e: PromptEditInput) => Promise<PromptEditResult> } }).prompt.edit(input)
const own = (text: string) => ({ text, origin: { kind: 'composer' }, isExpanded: true }) as never

test('turns inline TeX into one line of Unicode', () => {
  expect(texToUnicode('\\alpha^2 + \\frac{1}{2}')).toBe('α² + ½')
  expect(texToUnicode('\\mathbb{E}[X^2] \\ge \\mathbb{E}[X]^2')).toBe('𝔼[X²] ≥ 𝔼[X]²')
  expect(texToUnicode('\\frac{a+b}{c}')).toBe('(a + b)/c')
  expect(texToUnicode('\\sqrt{x^2+1}')).toBe('√(x² + 1)')
  expect(texToUnicode('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1')).toBe('lim_(x→0) (sin x)/x = 1')
  expect(texToUnicode('x^{a/b}')).toBe('x^(a/b)')
  expect(texToUnicode('\\ce{H2SO4 -> 2H+ + SO4^{2-}}')).toBe('H₂SO₄ → 2H⁺ + SO₄²⁻')
  expect(texToUnicode('\\not\\in')).toBe('∉')
  // A command with no Unicode form is kept as written.
  expect(texToUnicode('\\weird{x}')).toContain('\\weird')
})

test('expands the macros file before converting', () => {
  const macros = readMacros('\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\norm}[1]{\\lVert #1 \\rVert}')
  expect(texToUnicode('x \\in \\R^n', macros)).toBe('x ∈ ℝⁿ')
  expect(texToUnicode('\\norm{v}', macros)).toBe('‖v‖')
})

test('lays out display math over several rows', () => {
  expect(texToUnicodeLines('\\frac{a}{b}')).toEqual([' a', '───', ' b'])
  expect(texToUnicodeLines('\\sum_{i=1}^{n} i')).toEqual([' n', ' ∑ i', 'i=1'])
  expect(texToUnicodeLines('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')).toEqual(['⎛a  b⎞', '⎝c  d⎠'])
  expect(texToUnicodeLines('\\begin{align} a &= b + c \\\\ &= d \\end{align}')).toEqual(['a = b + c', '  = d'])
  expect(texToUnicodeLines('f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}')).toEqual(['f(x) = ⎧1   x > 0', '       ⎩0   otherwise'])
})

test('draws math as Unicode text in the terminal', async $ => {
  const text = 'The loss is $\\phi_0 + \\phi_1 x_i$, and its gradient is\n\n$$\\frac{\\partial L}{\\partial \\phi_1} = 0$$\n\nThis costs $5 and $10.'
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'terminal', component: 'AssistantMessage', props: reply(text) })
  expect(await ui.find({ type: 'Text', text: /ϕ₀ \+ ϕ₁xᵢ/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /∂L[\s\S]*─────[\s\S]*∂ϕ₁/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /costs \$5 and \$10/ })).toBeDefined()
  await ui.unmount()
})

test('leaves a terminal reply without math to the app', async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine drew this</Text>
  })
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'terminal', component: 'AssistantMessage', props: reply('It costs $5 and $10 today.') })
  expect(await ui.find({ type: 'Text', text: /engine drew/ })).toBeDefined()
  await ui.unmount()
})

test('a tikz block stays code in the terminal', async $ => {
  const text = 'A diagram:\n\n```tikz\n\\draw (0,0) -- (1,1);\n```\n\nand $x^2$.'
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'terminal', component: 'AssistantMessage', props: reply(text) })
  expect(await ui.find({ type: 'Markdown', text: /```tikz/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /x²/ })).toBeDefined()
  await ui.unmount()
})

test('the terminal setting turns it off', { options: { terminal: false } }, async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine drew this</Text>
  })
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'terminal', component: 'AssistantMessage', props: reply('Then $x^2$.') })
  expect(await ui.find({ type: 'Text', text: /engine drew/ })).toBeDefined()
  await ui.unmount()
})

test('with the under setting, your terminal message keeps its row and shows its math below', { options: { userBubble: 'under' } }, async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>native row</Text>
  })
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'terminal', component: 'UserMessage', props: own('why is $\\sqrt{2}$ irrational?') })
  expect(await ui.find({ type: 'Text', text: /native row/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /√2/ })).toBeDefined()
  await ui.unmount()
})

test('paints the prompt box like render-markdown, with a preview of each formula', () => {
  const draft = '# Plan\n- [ ] show $\\alpha^2$ is **positive**'
  const decorations = promptDecorations(draft, DARK_STYLE)
  const at = (piece: string) => decorations.filter(d => draft.slice(d.start, d.end) === piece)
  expect(at('# Plan')[0]).toEqual(expect.objectContaining({ color: DARK_STYLE.headings[0], backgroundColor: DARK_STYLE.headingBackgrounds[0], bold: true }))
  expect(at('-')[0]).toEqual(expect.objectContaining({ color: DARK_STYLE.bullet }))
  expect(at('[ ]')[0]).toEqual(expect.objectContaining({ color: DARK_STYLE.unchecked }))
  expect(at('$\\alpha^2$')[0]).toEqual(expect.objectContaining({ color: DARK_STYLE.math }))
  expect(decorations.find(d => d.virtualText)).toEqual(expect.objectContaining({ virtualText: ' → α²', start: draft.indexOf('$ is') + 1 }))
  expect(at('**positive**')[0]).toEqual(expect.objectContaining({ bold: true }))
  // Inside a code fence nothing is read as math.
  const fenced = promptDecorations('```sh\necho $HOME $PATH\n```', DARK_STYLE)
  expect(fenced.some(d => d.virtualText || d.color === DARK_STYLE.math)).toBe(false)
})

test('answers each prompt edit with the paint for the draft', async ($, on) => {
  on('prompt.edit', async ($, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  const edited = await edit($, { origin: { kind: 'composer' }, text: 'see $x^2', cursor: 8, start: 8, end: 8, inputText: '$' })
  expect(edited.text).toBe('see $x^2$')
  expect(edited.decorations?.find(d => d.virtualText)?.virtualText).toBe(' → x²')
})

test('the prompt box setting turns the paint off', { options: { promptBox: false } }, async ($, on) => {
  on('prompt.edit', async ($, e) => ({ text: e.text + e.inputText, cursor: e.text.length + 1 }))
  const edited = await edit($, { origin: { kind: 'composer' }, text: 'see $x^2', cursor: 8, start: 8, end: 8, inputText: '$' })
  expect(edited.decorations ?? []).toEqual([])
})

test('a macro that calls itself, or nests without end, is shown as written in good time', () => {
  const started = Date.now()
  expect(texToUnicode('\\a', readMacros('\\newcommand{\\a}{\\a\\a\\a\\a\\a\\a\\a\\a\\a\\a}'))).toBe('\\a')
  expect(texToUnicode('\\f{x}', readMacros('\\newcommand{\\f}[1]{\\f{#1}\\f{#1}\\f{#1}\\f{#1}}'))).toBe('\\f{x}')
  expect(texToUnicodeLines('\\frac{'.repeat(3000))).toHaveLength(1)
  expect(texToUnicodeLines(`\\begin{align}${Array.from({ length: 300 }, () => 'a &= b').join('\\\\')}\\end{align}`)).toHaveLength(300)
  expect(Date.now() - started).toBeLessThan(2000)
})

test('reads the macros a formula defines, and keeps \\\\ a row break', () => {
  expect(texToUnicode('\\newcommand{\\R}{\\mathbb{R}} x \\in \\R')).toBe('x ∈ ℝ')
  expect(texToUnicode('\\DeclareMathOperator{\\Tr}{Tr} \\Tr A')).toBe('Tr A')
  expect(texToUnicodeLines('a \\\\ \\d b', readMacros('\\newcommand{\\d}{\\mathrm{d}}'))).toEqual(['a', 'db'])
  expect(texToUnicode('x^\\half', readMacros('\\newcommand{\\half}{\\frac12}'))).toBe('x^½')
})

test('keeps fractions, relations and stacked operators apart from their neighbours', () => {
  expect(texToUnicode('\\frac{a}{b}c')).toBe('(a/b)c')
  expect(texToUnicode('i\\hbar\\frac{\\partial}{\\partial t}\\Psi')).toBe('iℏ(∂/∂t)Ψ')
  expect(texToUnicode('x = \\frac{a}{b}')).toBe('x = a/b')
  expect(texToUnicodeLines('\\frac{a}{b}\\frac{c}{d}')).toEqual([' a   c', '─── ───', ' b   d'])
  expect(texToUnicode('x := 5')).toBe('x := 5')
  expect(texToUnicodeLines('\\sum_{i=1}^{n} \\sum_{j=1}^{m} a_{ij}')).toEqual([' n   m', ' ∑   ∑ aᵢⱼ', 'i=1 j=1'])
  expect(texToUnicode('n \\choose k')).toBe('C(n, k)')
  expect(texToUnicode('x \\foo y')).toBe('x\\foo y')
  expect(texToUnicode('\\dv{x}')).toBe('d/dx')
  expect(texToUnicode('\\qty(\\frac{f(x)}{2})')).toBe('(f(x)/2)')
  expect(texToUnicode('a \\overset{def}{=} b')).toBe('a =ᵈᵉᶠ b')
  expect(texToUnicode('\\underbrace{a+b}_{n}')).toBe('(a + b)ₙ')
  expect(texToUnicode('a \\not')).toBe('a')
})

test('a display formula wider than the terminal is drawn on one line', async $ => {
  const wide = `$$${Array.from({ length: 30 }, (_, i) => `\\frac{a_{${i}}}{b}`).join(' + ')}$$`
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'terminal', component: 'AssistantMessage', props: reply(wide), viewport: { columns: 60, rows: 40 } } as never)
  const text = (await ui.find({ type: 'Text', text: /a₀/ }))?.text ?? ''
  expect(text).not.toContain('\n')
  await ui.unmount()
})

test('a link in a terminal line keeps its address', async $ => {
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'terminal', component: 'AssistantMessage', props: reply('See [the docs](https://example.com/a) for $x^2$.') })
  expect(await ui.find({ type: 'Link' })).toEqual(expect.objectContaining({ props: expect.objectContaining({ href: 'https://example.com/a' }) }))
  await ui.unmount()
})

test('the setup check takes only an absolute TeX folder, or a path to latex itself', () => {
  expect(searchFolders('texlive/bin', '', '/Users/me').problem).toContain('not an absolute path')
  expect(searchFolders('~/texlive/bin/', '', '/Users/me').folders).toEqual(['/Users/me/texlive/bin'])
  expect(searchFolders('/usr/bin/latex', '', '/Users/me').folders).toEqual(['/usr/bin'])
  expect(searchFolders('', '/a/bin:relative:/b/bin', '/Users/me').folders).toContain('/b/bin')
  expect(searchFolders('', '/a/bin:relative', '/Users/me').folders).not.toContain('relative')
})

test('install hints name the TeX Live packages, not the files', () => {
  const missing = ['tikz.sty', 'bm.sty', 'newpxmath.sty', 'standalone.cls']
  expect(installHint({ platform: 'mac', installer: 'tlmgr', missing, hasToolchain: true, backend: 'auto', fontChosen: true })).toBe('sudo tlmgr install pgf tools newpx standalone')
  expect(installHint({ platform: 'linux', installer: 'apt', missing, hasToolchain: true, backend: 'auto', fontChosen: true })).toContain('texlive-fonts-extra')
  expect(installHint({ platform: 'linux', installer: 'apt', missing: [], hasToolchain: false, backend: 'xelatex', fontChosen: false })).toContain('texlive-xetex')
  expect(installHint({ platform: 'linux', installer: 'dnf', missing: ['tikz.sty'], hasToolchain: true, backend: 'auto', fontChosen: false })).toBe('sudo dnf install texlive-pgf')
})

test('a bwrap sandbox hides every home, binds the cache read-only and lets a run write only its folder', () => {
  const argv = bwrapArgv({ kind: 'bwrap', bwrap: '/usr/bin/bwrap', hidden: outermost(['/home/me', '/home', '/mnt']), readable: ['/home/me/.cache/claude-latex'], writable: [] }, ['latex', 'd.tex'], '/home/me/.cache/claude-latex/build/b-1')
  const text = argv.join(' ')
  expect(text).toContain('--tmpfs /home --tmpfs /mnt')
  expect(text).not.toContain('--tmpfs /home/me')
  expect(text).toContain('--ro-bind-try /home/me/.cache/claude-latex /home/me/.cache/claude-latex')
  expect(text).toContain('--bind /home/me/.cache/claude-latex/build/b-1 /home/me/.cache/claude-latex/build/b-1 --chdir /home/me/.cache/claude-latex/build/b-1')
  expect(text).toContain('--unshare-net')
  // The writable folder is bound after the read-only cache, so it wins.
  expect(text.indexOf('--bind /home/me/.cache/claude-latex/build')).toBeGreaterThan(text.indexOf('--ro-bind-try /home/me/.cache/claude-latex'))
})
