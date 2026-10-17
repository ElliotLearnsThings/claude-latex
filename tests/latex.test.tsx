import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SAMPLE = [
  'The loss is $L(\\boldsymbol{\\phi}) = \\sum_{i=1}^{I} (\\phi_0 + \\phi_1 x_i - y_i)^2$, and **its gradient** is',
  '',
  '$$\\frac{\\partial L}{\\partial \\phi_1} = 2\\sum_{i=1}^{I} x_i(\\phi_0 + \\phi_1 x_i - y_i) = 0.$$',
  '',
  'This costs $5 and $10.',
].join('\n')

const reply = (text: string) => ({ text, isFirstOfReply: true })

// Setup runs in the background after session start. Let it finish.
async function settle(clock: { advance: (ms: number) => Promise<void> }) {
  for (let i = 0; i < 5; i++) await clock.advance(0)
}

test('draws inline and display math as SVG on the desktop', async $ => {
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(SAMPLE) })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(2)
  // Copy TeX is off by default.
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  expect(await ui.find({ type: 'Markdown', text: /costs \$5 and \$10/ })).toBeDefined()
  await ui.unmount()
})

test('leaves dollar amounts to the app', async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine drew this</Text>
  })
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('It costs $5 and $10 today.') })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /engine drew/ })).toBeDefined()
  await ui.unmount()
})

test('keeps math inside code blocks as code', async $ => {
  const text = 'Run this:\n\n```bash\necho "$HOME and $PATH"\n```\n\nThen $x^2$.'
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(text) })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  expect(await ui.find({ type: 'Markdown', text: /echo/ })).toBeDefined()
  await ui.unmount()
})

test('shows a bad formula as red source', async $ => {
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('Broken: $\\frac{a$ here.') })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  await ui.unmount()
})

test('with the rendered setting, draws your message in a bubble over the app row kept for its controls', { options: { userBubble: 'rendered' } }, async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`app row: ${String((e.props as { text?: string }).text)}`}</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'latex',
    surface: 'desktop',
    component: 'UserMessage',
    props: { text: 'why is $\\mathbb{E}[X^2] \\ge \\mathbb{E}[X]^2$ and **this** bold?', origin: { kind: 'composer' }, isExpanded: true } as never,
  })
  // The app's row is there once, with its text replaced, for its controls.
  expect(await ui.findAll({ type: 'Text', text: /app row/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /app row: ⋯/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /this/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'copy-message' })).toBeDefined()
  await ui.unmount()
})

test('with the under setting, keeps the native bubble and draws your math under it', { options: { userBubble: 'under' } }, async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>native bubble</Text>
  })
  const ui = await $.ui.mount({
    plugin: 'latex',
    surface: 'desktop',
    component: 'UserMessage',
    props: { text: 'why is $\\mathbb{E}[X^2] \\ge \\mathbb{E}[X]^2$ and **this** bold?', origin: { kind: 'composer' }, isExpanded: true } as never,
  })
  expect(await ui.find({ type: 'Text', text: /native bubble/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  // Only the math is drawn under the bubble, not the prose again.
  expect(await ui.find({ type: 'Text', text: /bold/ })).toBeUndefined()
  await ui.unmount()
})

test('reads formulas left to right, and leaves code spans alone', async $ => {
  const text = 'Adjacent $a$$b$ here.\n\nCode `$$PATH$$` and `$x$` stay.\n\n$$c^2$$\n\nNested $\\text{if $x>0$ then } y$ and an empty $$ $$ pair.\n\n$$d^2$$'
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(text) })
  const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
  expect(alts).toEqual(['a', 'b', 'c^2', '\\text{if $x>0$ then } y', 'd^2'])
  await ui.unmount()
})

test('a dollar inside a code span never closes a formula', async $ => {
  const text = 'This costs $5 and $10, and `$HOME` stays code. Then $x^2$.'
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(text) })
  expect((await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))).toEqual(['x^2'])
  expect(await ui.find({ type: 'Text', text: /\$HOME/ })).toBeDefined()
  await ui.unmount()
})

test('a macro defined in one formula does not reach the next', async $ => {
  const text = 'First $\\renewcommand{\\alpha}{\\text{changed}}\\alpha$ then $\\alpha$.'
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(text) })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(2)
  expect(String(svgs[1]?.props.source)).not.toContain('mtext')
  await ui.unmount()
})

test('lays out a table with math, and draws links and emphasis beside math', async $ => {
  const text = [
    '| Name | Formula |',
    '|---|---|',
    '| Absolute value | $|x|$ and $a \\mid b$ |',
    '',
    'A [link](https://example.com/zeta) next to $\\zeta(2)$, then _italic_ and ~~struck~~.',
  ].join('\n')
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(text) })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(3)
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Absolute/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~~|_italic_/ })).toBeUndefined()
  await ui.unmount()
})

test('a message with too much math for one drawing hands the rest to the app', async $ => {
  const formula = (k: number) =>
    `$$\\det\\begin{pmatrix} 1 & x_1 & x_1^2 & \\cdots & x_1^{${k}} \\\\ 1 & x_2 & x_2^2 & \\cdots & x_2^{n-1} \\\\ \\vdots & \\vdots & \\vdots & \\ddots & \\vdots \\\\ 1 & x_n & x_n^2 & \\cdots & x_n^{n-1} \\end{pmatrix} = \\prod_{1 \\le i < j \\le n} (x_j - x_i) \\sum_{n=1}^{\\infty} \\frac{1}{n^s} \\oint_{\\gamma} \\frac{f(z)}{z-a}\\,dz$$`
  const text = Array.from({ length: 36 }, (_, k) => formula(k)).join('\n\n')
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(text) })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.length).toBeGreaterThan(5)
  expect(svgs.length).toBeLessThan(36)
  // What is drawn stays under the size the desktop app accepts.
  expect(svgs.reduce((n, svg) => n + String(svg.props.source).length, 0)).toBeLessThan(235_000)
  expect(await ui.find({ type: 'Text', text: /more math than/ })).toBeDefined()
  // The formulas past the limit reach the app's Markdown as they were written.
  expect(await ui.find({ type: 'Markdown', text: /x_1\^\{23\}/ })).toBeDefined()
  await ui.unmount()
})

test('lays out lists with inline math', async $ => {
  const text = '- first $a_1$\n- second $a_2$\n1. third $a_3$'
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(text) })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(3)
  await ui.unmount()
})

test('maps \\bm to bold math', async $ => {
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('A vector $\\bm{x} \\in \\mathbb{R}^n$.') })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  await ui.unmount()
})

test('draws chemistry with mhchem', async $ => {
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('$$\\ce{CO2 + H2O <=> H2CO3}$$') })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  await ui.unmount()
})

test('shows an unknown command as red source, not as an SVG', async $ => {
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('Try $\\notacommand{x}$ now.') })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /notacommand/ })).toBeDefined()
  await ui.unmount()
})

// A fake TeX install: latex writes d.dvi, dvisvgm writes one SVG per page,
// and kpsewhich finds every package but those named `missing`.
function fakeTex(on: On, pages = 1, missing: string[] = []) {
  const files = new Map<string, string>()
  const runs: string[][] = []
  const sandboxed: boolean[] = []
  const workdirs: string[] = []
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('fs.exists', async ($, e) => ({ value: e.path.startsWith('/Library/TeX/texbin/') || files.has(e.path) }))
  on('fs.write', async ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', async ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(e.path + '/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('process.run', async ($, e) => {
    // Compiles run inside sandbox-exec: look at the command it wraps.
    const isSandboxed = e.argv[0] === '/usr/bin/sandbox-exec'
    if (isSandboxed) sandboxed.push(true)
    // sandbox-exec -D WORKDIR=<folder> -f <profile> <command...>
    const argv = isSandboxed ? e.argv.slice(e.argv.indexOf('-f') + 2) : [...e.argv]
    if (isSandboxed) workdirs.push(e.argv.find(a => a.startsWith('WORKDIR='))?.slice(8) ?? '')
    // The setup check asks each program its version: not a compile.
    if (argv.includes('--version')) return { value: { exitCode: 0, stdout: 'pdfTeX 3.141592653 (TeX Live 2026)\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    runs.push(argv)
    e = { ...e, argv }
    const cwd = e.init?.cwd ?? ''
    if (e.argv.includes('-ini')) {
      const job = e.argv.find(a => a.startsWith('-jobname='))?.slice('-jobname='.length)
      files.set(`${cwd}/${job}.fmt`, 'format')
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === '/bin/mv') {
      const [from, to] = [e.argv[1] ?? '', e.argv[2] ?? '']
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    }
    if (e.argv[0]?.endsWith('/latex')) files.set(`${cwd}/d.dvi`, 'dvi')
    if (e.argv[0]?.endsWith('/xelatex') && !e.argv.includes('-ini')) files.set(`${cwd}/d.xdv`, 'xdv')
    if (e.argv[0]?.endsWith('/dvisvgm')) {
      if (e.argv.includes('d.svg')) files.set(`${cwd}/d.svg`, "<svg width='10pt' height='5pt'><path d=''/></svg>")
      else for (let i = 1; i <= pages; i++) files.set(`${cwd}/d-${i}.svg`, `<svg width='${i}pt' height='5pt'></svg>`)
    }
    if (e.argv[0] === '/bin/rm') for (const p of [...files.keys()]) if (p.startsWith(e.argv[2] + '/')) files.delete(p)
    if (e.argv[0]?.endsWith('/kpsewhich')) {
      const found = e.argv.slice(1).filter(file => !missing.includes(file))
      return { value: { exitCode: 0, stdout: found.map(file => `/usr/share/texmf/${file}\n`).join(''), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { files, runs, sandboxed, workdirs }
}

test('a LaTeX block redraws by itself once compiled', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/test', PATH: '' })
  const { runs, sandboxed, files } = fakeTex(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle(clock)
  // The sandbox profile is written, probed and used for every TeX run.
  expect(files.get('/Users/test/.cache/claude-latex/sandbox.sb')).toContain('(deny file-read* (subpath "/Users/test")')
  const text = 'A square:\n\n```tikzcd\nA \\arrow[r] & B\n```'
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(text) })
  expect(await ui.find({ type: 'Text', text: /Compiling with LaTeX/ })).toBeDefined()
  for (let i = 0; i < 3; i++) await clock.advance(100)
  expect(runs.some(argv => argv[0]?.endsWith('/latex'))).toBe(true)
  // The compile used a saved format, built once in the background.
  expect(runs.some(argv => argv.includes('-ini'))).toBe(true)
  expect(runs.some(argv => argv.some(a => a.startsWith('-fmt=')))).toBe(true)
  expect(sandboxed.length).toBeGreaterThan(2)
  expect(await ui.find({ type: 'Text', text: /Compiling with LaTeX/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  await ui.unmount()
})

test('compiles blocks side by side, each in its own folder', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/test', PATH: '' })
  const { runs } = fakeTex(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle(clock)
  const text = ['```tikz', '\\draw (0,0) -- (1,1);', '```', '', '```latex', '\\usepackage{bussproofs}', 'x', '```', '', '```tikzcd', 'A & B', '```'].join('\n')
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply(text) })
  await clock.advance(100)
  await clock.advance(100)
  const latexRuns = runs.filter(argv => argv[0]?.endsWith('/latex') && !argv.includes('-ini'))
  expect(latexRuns).toHaveLength(3)
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(3)
  await ui.unmount()
})

test('with a LaTeX font, typesets a message in one run and swaps it in', { options: { mathFont: 'palatino' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/test', PATH: '' })
  const { runs, files } = fakeTex(on, 2)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle(clock)
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('Both $a^2$ and $b^2$ here.') })
  const before = await ui.findAll({ type: 'Svg' })
  expect(before).toHaveLength(2)
  expect(String(before[0]?.props.source)).toContain('viewBox')
  await clock.advance(100)
  await clock.advance(100)
  expect(runs.filter(argv => argv[0]?.endsWith('/latex') && !argv.includes('-ini'))).toHaveLength(1)
  const source = [...files.entries()].find(([p]) => p.endsWith('.svg') && p.includes('/m-'))
  expect(source).toBeDefined()
  const after = await ui.findAll({ type: 'Svg' })
  expect(after.map(s => String(s.props.source).match(/width='(\d)pt'/)?.[1])).toEqual(['1', '2'])
  await ui.unmount()
})

test('a LaTeX font whose package is missing falls back to MathJax, and the setup check says how to install it', { options: { mathFont: 'palatino' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/test', PATH: '' })
  on('ui.log', async () => ({ value: undefined }))
  const { runs } = fakeTex(on, 2, ['newpxmath.sty', 'standalone.cls'])
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle(clock)
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('Both $a^2$ and $b^2$ here.') })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
  await clock.advance(100)
  await clock.advance(100)
  // No formula is sent to LaTeX: MathJax draws them.
  expect(runs.filter(argv => argv[0]?.endsWith('/latex') && !argv.includes('-ini') && argv.includes('d.tex'))).toHaveLength(0)
  await ui.unmount()
  const report = await $.command.run({ command: 'latex', args: 'setup' } as never)
  expect(report.text).toContain('Missing LaTeX packages: standalone.cls, newpxmath.sty')
  expect(report.text).toContain('To fix:')
})

test('the setup check reports where TeX is, and MathJax only when asked', { options: { backend: 'mathjax' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/test', PATH: '' })
  fakeTex(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle(clock)
  const report = await $.command.run({ command: 'latex', args: 'setup' } as never)
  expect(report.text).toContain('MathJax only')
  // A tikz block stays code: nothing is compiled.
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('```tikz\n\\draw (0,0) -- (1,1);\n```\n\nand $x$') })
  expect(await ui.find({ type: 'Text', text: /Compiling/ })).toBeUndefined()
  await ui.unmount()
})

test('the xelatex backend writes XDV and hands it to dvisvgm', { options: { backend: 'xelatex' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/test', PATH: '' })
  const { runs } = fakeTex(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle(clock)
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('```latex\n\\usepackage{fontspec}\nZürich\n```') })
  for (let i = 0; i < 3; i++) await clock.advance(100)
  const compile = runs.find(argv => argv[0]?.endsWith('/xelatex') && !argv.includes('-ini'))
  expect(compile).toContain('-no-pdf')
  expect(runs.find(argv => argv[0]?.endsWith('/dvisvgm'))).toContain('d.xdv')
  // Its saved formats are its own: a latex format would not load.
  expect(runs.find(argv => argv.includes('-ini'))).toContain('&xelatex')
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
  await ui.unmount()
})

test('a TeX run may write only its own folder, and dvisvgm runs no PostScript', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/test', PATH: '' })
  const { runs, workdirs, files } = fakeTex(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle(clock)
  // The profile lets a run write its WORKDIR, never the whole cache.
  const profile = files.get('/Users/test/.cache/claude-latex/sandbox.sb') ?? ''
  expect(profile).toContain('(param "WORKDIR")')
  expect(profile).not.toMatch(/allow file-write\* \(subpath "\/Users\/test\/\.cache\/claude-latex"\)/)
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('```tikz\n\\draw (0,0) -- (1,1);\n```') })
  for (let i = 0; i < 3; i++) await clock.advance(100)
  expect(runs.find(argv => argv[0]?.endsWith('/dvisvgm'))).toContain('--no-specials=ps')
  // Compiles write their build folder; formats are built in the formats folder.
  expect(workdirs.some(dir => /\/build\/b-/.test(dir))).toBe(true)
  expect(workdirs.every(dir => /\/(build\/[^/]+|formats)$/.test(dir))).toBe(true)
  await ui.unmount()
})

test('a font changed after the workers start compiles in the font its key says', { options: { mathFont: 'palatino' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/test', PATH: '' })
  on('ui.log', async () => ({ value: undefined }))
  // First the font's package is missing, so the workers start with MathJax.
  const missing = ['newpxmath.sty']
  const { runs } = fakeTex(on, 1, missing)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle(clock)
  // Then it is installed, and the check runs again.
  missing.length = 0
  await $.command.run({ command: 'latex', args: 'setup' } as never)
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('Now $a^2$.') })
  for (let i = 0; i < 3; i++) await clock.advance(100)
  const math = runs.find(argv => argv[0]?.endsWith('/latex') && !argv.includes('-ini') && argv.includes('d.tex'))
  expect(math).toBeDefined()
  await ui.unmount()
})

test('creates a macros file from the template and reads it', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/Users/test', PATH: '' })
  const { files } = fakeTex(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await settle(clock)
  const pane = await $.ui.mount<'desktop', 'Pane'>({ plugin: 'latex', surface: 'desktop', component: 'Pane', props: { title: 'LaTeX settings', isFocused: true, bodyColumns: 80, placement: 'dock' } as never, requestId: 'latex-settings' } as never)
  await pane.press({ key: 'create-macros' })
  expect(files.get('/Users/test/.claude/latex-macros.tex')).toContain('\\newcommand{\\R}{\\mathbb{R}}')
  expect(await pane.find({ type: 'Text', text: /definitions read/ })).toBeDefined()
  await pane.unmount()
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'terminal', component: 'AssistantMessage', props: reply('Take $x \\in \\R^n$.') })
  expect(await ui.find({ type: 'Text', text: /x ∈ ℝⁿ/ })).toBeDefined()
  await ui.unmount()
})

test('draws Copy TeX buttons when the setting is on', { options: { copyButton: true } }, async $ => {
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AssistantMessage', props: reply('$$a^2 + b^2 = c^2$$') })
  expect(await ui.find({ type: 'Button', key: 'copy-0' })).toBeDefined()
  await ui.unmount()
})

const own = (text: string) => ({ text, origin: { kind: 'composer' }, isExpanded: true }) as never

test('with the rendered setting, your Markdown message keeps its line breaks', { options: { userBubble: 'rendered' } }, async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>native bubble</Text>
  })
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'UserMessage', props: own('**bold** and a list:\n- one\n- two\nline one\nline two') })
  const md = await ui.find({ type: 'Markdown' })
  expect(String(md?.props.text)).toContain('line one  \nline two')
  await ui.unmount()
})

test('a message with nothing to render keeps the native bubble', async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>native bubble</Text>
  })
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'UserMessage', props: own('plain words, 2 * 3 * 4 and snake_case_name, costs $5') })
  expect(await ui.find({ type: 'Text', text: /native bubble/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

test('your messages are left alone unless a setting says otherwise', async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>native bubble</Text>
  })
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'UserMessage', props: own('**bold** and $x^2$') })
  expect(await ui.find({ type: 'Text', text: /native bubble/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  await ui.unmount()
})

test('tells the model how math renders, where the mod draws', async ($, on) => {
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are an agent.', scope: 'shared' as const }] }))
  const facts = { model: 'claude', promptModel: 'claude', tools: [], outputStyle: null, traits: [] }
  const onDesktop = await $.prompt.compose({ ...facts, surfaces: ['desktop'] } as never)
  const note = onDesktop.sections.find(section => section.id === 'latex:rendering')
  expect(note?.text).toContain('235 KB')
  expect(note?.text).toContain('```tex')
  // In a terminal the note says math shows as Unicode, and blocks as code.
  const inTerminal = await $.prompt.compose({ ...facts, surfaces: ['terminal'] } as never)
  const terminalNote = inTerminal.sections.find(section => section.id === 'latex:rendering')
  expect(terminalNote?.text).toContain('Unicode')
  expect(terminalNote?.text).not.toContain('235 KB')
  const headless = await $.prompt.compose({ ...facts, surfaces: [] } as never)
  expect(headless.sections.map(section => section.id)).toEqual(['intro'])
})

test('the note to the model can be turned off', { options: { tellModel: false } }, async ($, on) => {
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'You are an agent.', scope: 'shared' as const }] }))
  const composed = await $.prompt.compose({ model: 'claude', promptModel: 'claude', tools: [], outputStyle: null, traits: [], surfaces: ['desktop'] } as never)
  expect(composed.sections.map(section => section.id)).toEqual(['intro'])
})

test('leaves task notifications to the app', async ($, on) => {
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine drew this</Text>
  })
  const props = { text: '**done**', origin: { kind: 'task-notification' }, isExpanded: true } as never
  const ui = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'UserMessage', props })
  expect(await ui.find({ type: 'Text', text: /engine drew/ })).toBeDefined()
  await ui.unmount()
})

test('shows the welcome band once, and Got it remembers', async ($, on) => {
  mock.store(on)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('config.list', async () => ({ value: [] }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine drew this</Text>
  })
  const bandProps = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80 } as never
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AbovePrompt', props: bandProps })
  expect(await band.find({ type: 'Text', text: /LaTeX mod is on/ })).toBeDefined()
  await band.press({ key: 'intro-dismiss' })
  expect(await band.find({ type: 'Text', text: /LaTeX mod is on/ })).toBeUndefined()
  await band.unmount()
  // A new session reads the store and keeps the band hidden.
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const again = await $.ui.mount({ plugin: 'latex', surface: 'desktop', component: 'AbovePrompt', props: bandProps })
  expect(await again.find({ type: 'Text', text: /LaTeX mod is on/ })).toBeUndefined()
  await again.unmount()
})

test('the settings pane changes the real settings', async ($, on) => {
  const sets: unknown[] = []
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('config.list', async () => ({ value: [{ key: 'latex.copyButton', label: 'Copy TeX button', kind: 'boolean', value: false, provider: { kind: 'plugin', name: 'latex' }, isLocked: false }] as never }))
  on('config.set', async ($, e) => {
    sets.push(e)
    return { value: e.value }
  })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const pane = await $.ui.mount<'desktop', 'Pane'>({ plugin: 'latex', surface: 'desktop', component: 'Pane', props: { title: 'LaTeX settings', isFocused: true, bodyColumns: 60, placement: 'dock' } as never, requestId: 'latex-settings' } as never)
  expect(await pane.find({ type: 'Select', key: 'math-font' })).toBeDefined()
  await pane.press({ key: 'toggle-copyButton' })
  await pane.select({ key: 'math-font', value: 'euler' })
  expect(sets).toEqual([
    expect.objectContaining({ key: 'latex.copyButton', value: true }),
    expect.objectContaining({ key: 'latex.mathFont', value: 'euler' }),
  ])
  await pane.unmount()
})
