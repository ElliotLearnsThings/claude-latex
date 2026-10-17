import type { PromptEditInput, PromptEditResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { promptDecorations } from '../hooks/prompt'
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
