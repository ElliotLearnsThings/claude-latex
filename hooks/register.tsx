import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'
import { definePreamble, renderTex, withInk, type ColorScheme } from './math'
import { drawMessage } from './draw'
import { keepLineBreaks, looksLikeMarkdown, looksLikeMath, mathOnly, parse } from './parse'
import { promptDecorations } from './prompt'
import { DARK_STYLE, isLightTerminal, LIGHT_STYLE } from './style'
import { drawTerminal } from './terminal'
import { readMacros, texToUnicode, texToUnicodeLines } from './unicode'
import { countDefinitions, MACROS_TEMPLATE } from './macros'
import { BWRAP_CANDIDATES, macProfile, SANDBOX_EXEC, sandboxed, type Sandbox } from './sandbox'
import {
  BACKENDS,
  describeSetup,
  FONT_FILES,
  findToolchain,
  isBackend,
  missingFiles,
  platformOf,
  searchFolders,
  type Backend,
  type SetupReport,
  type Toolchain,
} from './setup'
import {
  documentForBlock,
  documentForMath,
  fullDocument,
  hashOf,
  hasQueued,
  isLatexFont,
  pageNumber,
  release,
  requestBlock,
  requestMath,
  resultOf,
  setResult,
  takeBlock,
  takeMathBatch,
  texError,
  themeInk,
  type BlockJob,
  type LatexFont,
  type MathJob,
  type Rendered,
  type TexDoc,
} from './texjobs'

// Draws messages in the desktop Code tab with TeX rendered, and in the
// terminal with TeX as Unicode text.
// $$...$$, \[...\] and equation/align environments become centered SVG blocks
// with a Copy TeX button. A paragraph with $...$ or \(...\) is laid out word
// by word, each formula an inline SVG sitting on the text's baseline.
// MathJax draws every formula at once. With a LaTeX font chosen, the local
// TeX install then typesets each formula in that font and the drawing swaps.
// ```tikz, ```tikzcd and ```latex blocks are compiled with the local TeX.
// Everything else stays the app's own Markdown.
// In the terminal, inline math runs in the line as Unicode and display math
// is laid out over several rows (hooks/unicode.ts). The prompt box paints
// the draft's Markdown and previews each formula as it is typed
// (hooks/prompt.ts), in the colors of render-markdown.nvim (hooks/style.ts).

// Goes up each time a compile finishes. Every message that draws math
// reads it, so writing it redraws exactly those messages.
const version = atom({ plugin: 'latex', key: 'version' } as const, 0)
// The one-time welcome band. Shown until dismissed, then remembered in the
// store across sessions.
const intro = atom({ plugin: 'latex', key: 'intro' } as const, false)
// Goes up each time the setup check or the macros change, which redraws the
// settings pane.
const setup = atom({ plugin: 'latex', key: 'setup' } as const, 0)
const DEFAULT_MACROS_FILE = '~/.claude/latex-macros.tex'
const INTRO_SEEN = 'introSeen'
const PANE = 'latex-settings'

// The user's own messages get Markdown. Notifications, agents and peers
// keep the app's drawing.
const OWN_MESSAGES = new Set(['composer', 'sdk', 'bridge', 'unclassified'])
// How your own sent message is drawn. `off`, the default: as typed, in the
// app's bubble. `under`: the app's bubble, with the math from the message
// under it. `rendered`, experimental: in a bubble of the mod's, as Markdown
// with its math.
const BUBBLE_MODES = ['off', 'under', 'rendered'] as const
type BubbleMode = (typeof BUBBLE_MODES)[number]
// The bubble behind a rendered message of yours: a light gray that reads on
// a light and on a dark theme.
const USER_BUBBLE = '#8080801f'
// What the model is told while the mod draws its replies: how to write math
// so it renders, and where the limits are. One section of the system prompt.
const MODEL_NOTE = `# Math rendering in this app (LaTeX mod)

A mod draws TeX in your replies here. Write math as TeX, never as Unicode symbols in plain text.

- Inline math: $...$ or \\(...\\). Display math: $$...$$, \\[...\\], or a bare equation, align, gather or multline environment.
- MathJax draws it, with AMS, mathtools, mhchem (\\ce), physics (\\dv, \\qty), braket, cancel and color. A display formula MathJax cannot draw is typeset by the user's own LaTeX when they have one.
- A \`\`\`tikz, \`\`\`tikzcd or \`\`\`latex code block is compiled by the user's LaTeX and shown as a drawing. To show LaTeX source as code, use \`\`\`tex.
- A macro defined in one formula (\\newcommand, \\def) does not exist in the next formula. Define it again, or avoid it.
- Size limit: one reply can hold about 235 KB of drawing. That is roughly 75 formulas in a reply that is mostly text, or 4 to 6 diagrams. Past the limit the rest of the reply is drawn by the app's plain renderer, which handles only simple formulas. Split longer material over several replies.
- One drawing can be at most 128 KB. A dense plot or a very long formula over that shows an error in its place.
- A display formula wider than the window is scaled down to fit. Break a long one over lines with aligned or split.
- Dollar amounts such as $5 and $10 are left as text. Write \\$ where a dollar sign could be read as math.
- The app may show text written between tool calls only as a short summary. Put math the user must see in the final message of a turn.`

// The same note for a terminal, where the mod turns TeX into Unicode text.
const TERMINAL_NOTE = `# Math in this terminal (LaTeX mod)

A mod shows TeX in your replies as Unicode text here. Write math as TeX, never as Unicode symbols in plain text.

- Inline math: $...$ or \\(...\\), drawn in the line: \\alpha^2 + \\frac{1}{2} reads α² + ½. Keep inline formulas short: anything tall is flattened onto one line.
- Display math: $$...$$, \\[...\\], or an align, gather, cases or matrix environment. It is laid out over several rows: fractions stacked, sums with their bounds above and below, matrices with tall brackets, align rows lined up.
- A \`\`\`tikz, \`\`\`tikzcd or \`\`\`latex block is not compiled in a terminal. It shows as code. Draw a diagram only when asked.
- Dollar amounts such as $5 and $10 are left as text. Write \\$ where a dollar sign could be read as math.`

// What the app's own row says under a rendered message of yours. The row is
// there for its controls.
const CONTROLS_ROW_TEXT = '⋯'

const FONT_CHOICES = ['mathjax', 'cm', 'libertinus', 'palatino', 'times', 'euler', 'concrete', 'fourier', 'stix2', 'kpfonts', 'cmbright']
// Compiles run side by side, each in its own folder.
const MAX_WORKERS = 3
// Interrupted compiles are retried this many times.
const MAX_RETRIES = 2
const retries = new Map<string, number>()

// What a failed run looks like to the reader.
function describeFailure(error: unknown): Rendered {
  const text = String(error)
  if (/time|still running/i.test(text)) {
    return { error: 'LaTeX ran for 60 seconds without finishing, so it was stopped. The block may loop forever.' }
  }
  return { error: text, interrupted: true }
}
// The app's limit on one Svg element is 131072 characters. Leave room for
// the color style withInk adds.
const MAX_SVG_CHARS = 131072 - 400
// How large one message's drawing may be. The desktop app showed a drawing
// of about 248,000 characters and dropped the next one, about 257,000,
// without a word: it kept showing the older drawing, with the end of the
// message missing. Past this size the mod hands the rest of the message to
// the app's own Markdown.
const MAX_MESSAGE_CHARS = 235_000

// The TeX that typesets (latex or xelatex, and dvisvgm), and where compiled
// SVGs are kept. Null while there is none: math then uses MathJax and blocks
// stay code.
let tex: { toolchain: Toolchain; cacheDir: string } | null = null
// What the last setup check found, for the settings pane and /latex setup.
let setupReport: SetupReport | null = null
// A log the mod writes to ~/.cache/claude-latex/debug/, readable without
// the app: each setup step, its time, and why it failed.
const debugLines: string[] = []
let debugDir = ''

function debug($: Engine, line: string): void {
  debugLines.push(`${new Date().toISOString()} ${line}`)
  if (debugLines.length > 600) debugLines.splice(0, debugLines.length - 600)
  if (debugDir) void $.fs.write(`${debugDir}/setup.log`, debugLines.join('\n') + '\n').catch(() => undefined)
}

// Runs one setup step on its own, so a failure or a hang in one never
// blocks the others.
async function step($: Engine, name: string, run: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now()
  try {
    await run()
    debug($, `ok   ${name} ${Date.now() - t0} ms`)
  } catch (error) {
    debug($, `FAIL ${name} ${Date.now() - t0} ms: ${String(error)}`)
  }
}

// While a turn runs, its message is redrawn on every streamed chunk anyway,
// and forcing extra redraws of a message mid-stream can stall the app's
// drawing of it. So forced redraws wait for the turn to end. The flag clears
// itself after ten minutes in case an end event is missed.
let turnStartedAt = 0
function isTurnRunning(): boolean {
  return turnStartedAt > 0 && Date.now() - turnStartedAt < 10 * 60 * 1000
}

// Compiles queued blocks and formulas, up to MAX_WORKERS at once, and
// redraws waiting messages as results land.
let workersStarted = false
function startWorkers($: Engine, latexFont: LatexFont | null): void {
  if (workersStarted) return
  workersStarted = true
  let running = 0
  let finished = 0
  let lastBump = 0
  $.clock.every(100, () => {
    // Redraw waiting messages at most every 400 ms, and once more when
    // the queue drains, rather than once per compile.
    const now = Date.now()
    if (finished > 0 && (now - lastBump >= 400 || (running === 0 && !hasQueued()))) {
      finished = 0
      lastBump = now
      void update($, version, n => n + 1).catch(() => undefined)
    }
    while (running < MAX_WORKERS && hasQueued()) {
      const block = takeBlock()
      const batch = block || !latexFont ? [] : takeMathBatch(60)
      if (!block && batch.length === 0) break
      running += 1
      void (async () => {
        if (block) {
          const font = latexFont ?? 'cm'
          const compileStarted = Date.now()
          const result = await compileBlock($, block, font).catch(describeFailure)
          const tries = retries.get(block.key) ?? 0
          const outcome = 'svg' in result ? `${result.svg.length} chars` : `error${result.interrupted ? ' (interrupted)' : ''}: ${result.error.split('\n')[0]}`
          debug($, `compiled ${block.lang} ${block.key}, try ${tries + 1}: ${outcome}, ${Date.now() - compileStarted} ms | ${JSON.stringify(block.source.slice(0, 40))}`)
          if ('error' in result && result.interrupted && tries < MAX_RETRIES) {
            retries.set(block.key, tries + 1)
            release(block.key)
            requestBlock(block)
          } else {
            setResult(block.key, result)
          }
        } else if (latexFont) {
          await compileMath($, batch, latexFont).catch(() => {
            for (const job of batch) setResult(job.key, { error: 'compile failed' })
          })
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          running -= 1
          finished += 1
        })
    }
  })
}

// The sandbox every TeX run goes through (hooks/sandbox.ts): sandbox-exec
// on macOS, bubblewrap on Linux, when either starts here.
let sandbox: Sandbox | null = null
let sandboxNote = 'off'
// TeX's own write guard: no writing outside the build folder.
const TEX_ENV = { openout_any: 'p', openin_any: 'p' }

function texArgv(argv: string[]): string[] {
  return sandboxed(sandbox, argv)
}

// Tries each sandbox this machine may have, keeping the first whose probe
// runs.
async function setupSandbox($: Engine, home: string): Promise<void> {
  if (!tex || !home) return
  const { cacheDir } = tex
  const profile = `${cacheDir}/sandbox.sb`
  await $.fs.write(profile, macProfile(home, cacheDir))
  const candidates: Sandbox[] = [{ kind: 'macos', profile }]
  for (const bwrap of BWRAP_CANDIDATES) {
    if (await $.fs.exists(bwrap).catch(() => false)) candidates.push({ kind: 'bwrap', bwrap, home, cacheDir })
  }
  for (const candidate of candidates) {
    const probe = await $.process.run(sandboxed(candidate, ['/usr/bin/true']), { cwd: cacheDir, timeoutMs: 10000 }).catch(() => null)
    if (probe?.exitCode === 0) {
      sandbox = candidate
      sandboxNote = candidate.kind === 'macos' ? 'on (macOS sandbox-exec)' : `on (bubblewrap, ${candidate.bwrap})`
      return
    }
  }
  sandboxNote = 'off: neither sandbox-exec nor bubblewrap (bwrap) runs here, so LaTeX blocks run without a sandbox'
  $.ui.log('latex: could not sandbox LaTeX here, so LaTeX blocks run without a sandbox', { to: 'debug' })
}
let macros = ''
// The macros file's definitions, read for the Unicode conversion, and
// whether the file has been read yet.
let unicodeMacros = readMacros('')
let macrosRead = false
// The colors the terminal and the prompt box use, picked at session start
// when the setting follows the system.
let terminalStyle = DARK_STYLE

async function findTex($: Engine, home: string, backend: Backend, folders: string[]): Promise<boolean> {
  const toolchain = await findToolchain($, backend, folders)
  tex = toolchain ? { toolchain, cacheDir: `${home}/.cache/claude-latex` } : null
  return tex !== null
}

// Saved LaTeX formats: the class and fixed preamble of one kind of document,
// loaded once and dumped, so each compile skips loading TikZ, pgfplots and
// the font packages. About halves LaTeX time. Built once per machine and
// kept in the cache folder. A format that ever fails is not used again this
// session, and the compile falls back to the whole document.
const formats = new Map<string, Promise<string | null>>()
const brokenFormats = new Set<string>()

async function buildFormat($: Engine, name: string, base: string): Promise<string | null> {
  const dir = `${tex!.cacheDir}/formats`
  const path = `${dir}/${name}`
  if (await $.fs.exists(`${path}.fmt`)) return path
  // Build under a temporary name, then move it into place, so a session that
  // looks while another builds never reads half a format.
  const temp = `${name}-${Math.random().toString(36).slice(2, 8)}`
  await $.fs.write(`${dir}/${temp}.tex`, `${base}\n\\dump\n`)
  const { engine, typesetter } = tex!.toolchain
  await $.process.run(texArgv([typesetter, '-ini', '-interaction=nonstopmode', `-jobname=${temp}`, `&${engine}`, `${temp}.tex`]), {
    cwd: dir,
    env: TEX_ENV,
    timeoutMs: 120000,
  })
  if (!(await $.fs.exists(`${dir}/${temp}.fmt`))) return null
  await $.process.run(['/bin/mv', `${dir}/${temp}.fmt`, `${path}.fmt`])
  await $.process.run(['/bin/rm', '-f', `${dir}/${temp}.tex`, `${dir}/${temp}.log`]).catch(() => undefined)
  return (await $.fs.exists(`${path}.fmt`)) ? path : null
}

function formatName(doc: TexDoc): string {
  return `fmt-${tex!.toolchain.engine}-${doc.kind}-${hashOf(doc.base)}`
}

function formatFor($: Engine, doc: TexDoc): Promise<string | null> {
  const name = formatName(doc)
  if (brokenFormats.has(name)) return Promise.resolve(null)
  let pending = formats.get(name)
  if (!pending) {
    pending = buildFormat($, name, doc.base).catch(() => null)
    formats.set(name, pending)
  }
  return pending
}

// Runs latex then dvisvgm in a fresh folder `dir`, then removes it.
// Returns the SVG pages in order, or the LaTeX error.
async function runTex($: Engine, dir: string, doc: TexDoc, dvisvgmArgs: string[]): Promise<string[] | { error: string; interrupted?: boolean }> {
  const { engine, typesetter, dvisvgm: dvisvgmPath } = tex!.toolchain
  // XeTeX writes XDV, which dvisvgm reads as it reads DVI.
  const output = engine === 'xelatex' ? 'd.xdv' : 'd.dvi'
  const latex = async (source: string, fmt: string | null) => {
    await $.fs.write(`${dir}/d.tex`, source)
    return $.process.run(
      texArgv([typesetter, ...(fmt ? [`-fmt=${fmt}`] : []), ...(engine === 'xelatex' ? ['-no-pdf'] : []), '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'd.tex']),
      { cwd: dir, env: TEX_ENV, timeoutMs: 60000 },
    )
  }
  try {
    const fmt = await formatFor($, doc)
    let run = fmt ? await latex(doc.rest, fmt) : await latex(fullDocument(doc), null)
    if (run.exitCode !== 0 && fmt) {
      // Either the document has an error or the format does. The whole
      // document tells them apart.
      run = await latex(fullDocument(doc), null)
      if (run.exitCode === 0) brokenFormats.add(formatName(doc))
    }
    if (run.exitCode !== 0) {
      // A run with no error line was stopped from outside, not by the TeX.
      const isTexError = run.stdout.includes('\n!') || run.stdout.startsWith('!')
      return isTexError ? { error: texError(run.stdout) } : { error: 'The compile was interrupted.', interrupted: true }
    }
    const dvisvgm = await $.process.run(texArgv([dvisvgmPath, '--no-fonts', '--precision=2', ...dvisvgmArgs, output]), {
      cwd: dir,
      env: TEX_ENV,
      timeoutMs: 60000,
    })
    if (dvisvgm.exitCode !== 0) return { error: 'dvisvgm stopped before writing the SVG.', interrupted: true }
    const pages = (await $.fs.list(dir))
      .map(entry => ({ name: entry.name, page: entry.name === 'd.svg' ? 1 : pageNumber(entry.name) }))
      .filter((p): p is { name: string; page: number } => p.page !== undefined)
      .sort((a, b) => a.page - b.page)
    const svgs: string[] = []
    for (const p of pages) svgs.push(themeInk(await $.fs.read(`${dir}/${p.name}`)))
    return svgs
  } finally {
    await $.process.run(['/bin/rm', '-rf', dir]).catch(() => undefined)
  }
}

async function compileBlock($: Engine, job: BlockJob, font: LatexFont): Promise<Rendered> {
  const cached = `${tex!.cacheDir}/b-${job.key}.svg`
  if (await $.fs.exists(cached)) return { svg: await $.fs.read(cached) }
  const out = await runTex($, `${tex!.cacheDir}/build/b-${job.key}`, documentForBlock(job, font, macros), [
    '--exact-bbox',
    '--zoom=1.3',
    '-o',
    'd.svg',
  ])
  if (!Array.isArray(out)) return out
  const svg = out[0]
  if (!svg) return { error: 'dvisvgm wrote no page.' }
  // The app refuses an SVG over 131072 characters, and refusing one refuses
  // the whole message's drawing. Report it on this block instead.
  if (svg.length > MAX_SVG_CHARS) {
    return { error: `This drawing is ${Math.round(svg.length / 1024)} KB of SVG. The app draws at most 128 KB.` }
  }
  await $.fs.write(cached, svg)
  return { svg }
}

// Typesets a batch of formulas in one LaTeX run, one page each. If the run
// fails, each formula is tried alone so one bad formula costs only itself.
async function compileMath($: Engine, jobs: MathJob[], font: LatexFont): Promise<void> {
  const todo: MathJob[] = []
  for (const job of jobs) {
    const cached = `${tex!.cacheDir}/m-${job.key}.svg`
    if (await $.fs.exists(cached)) setResult(job.key, { svg: await $.fs.read(cached) })
    else todo.push(job)
  }
  if (todo.length === 0) return
  const batchDir = `${tex!.cacheDir}/build/m-${hashOf(...todo.map(job => job.key))}`
  const out = await runTex($, batchDir, documentForMath(todo, font, macros), [
    '--bbox=papersize',
    '--zoom=1.2',
    '-p',
    '1-',
  ])
  if (Array.isArray(out) && out.length === todo.length) {
    for (const [i, job] of todo.entries()) {
      const svg = out[i]!
      setResult(job.key, { svg })
      await $.fs.write(`${tex!.cacheDir}/m-${job.key}.svg`, svg)
    }
    return
  }
  if (todo.length === 1) {
    setResult(todo[0]!.key, Array.isArray(out) ? { error: 'page count mismatch' } : out)
    return
  }
  for (const job of todo) await compileMath($, [job], font)
}

// A compiled SVG already on disk is read straight into memory while
// drawing, so a cached diagram appears at once instead of after a compile
// round trip.
async function fromDisk($: Engine, file: string, key: string): Promise<Rendered | undefined> {
  if (!tex) return undefined
  const path = `${tex.cacheDir}/${file}`
  if (!(await $.fs.exists(path).catch(() => false))) return undefined
  const svg = await $.fs.read(path).catch(() => '')
  if (!svg) return undefined
  setResult(key, { svg })
  return { svg }
}

// What the settings say, for the setup functions below. Set by register.
type Settings = { chosenFont: LatexFont | null; backend: Backend; texPath: string; macrosOption: string; blocksOn: boolean }
let settings: Settings = { chosenFont: null, backend: 'auto', texPath: '', macrosOption: DEFAULT_MACROS_FILE, blocksOn: true }
// The font formulas are typeset in: the chosen one, or none (MathJax) when
// the setup check finds its package missing.
let latexFont: LatexFont | null = null
let home = ''
let macrosInfo: SetupReport['macros'] = { path: DEFAULT_MACROS_FILE, count: 0, exists: false }

function macrosPath(): string {
  return settings.macrosOption.replace(/^~(?=\/)/, home)
}

// Reads the macros file into MathJax and the Unicode converter.
async function loadMacros($: Engine): Promise<void> {
  const path = macrosPath()
  macrosInfo = { path, count: 0, exists: false }
  if (!(await $.fs.exists(path).catch(() => false))) return
  macros = await $.fs.read(path)
  unicodeMacros = readMacros(macros)
  const error = definePreamble(macros)
  macrosInfo = { path, count: countDefinitions(macros), exists: true, ...(error ? { error } : {}) }
  if (error) $.ui.log(`latex: ${path}: ${error}`)
}

// Finds TeX, checks its packages, and writes the setup report. A chosen
// LaTeX font whose package is missing falls back to MathJax, with a note,
// instead of failing every formula.
async function checkSetup($: Engine): Promise<boolean> {
  const { chosenFont, backend, texPath } = settings
  const path = (await $.env.get('PATH').catch(() => undefined)) ?? ''
  const folders = searchFolders(texPath, path, home)
  const ready = await findTex($, home, backend, folders)
  debug($, `     TeX ${ready ? `${tex!.toolchain.engine} at ${tex!.toolchain.bin}` : 'not found'}`)
  const missing = ready ? await missingFiles($, tex!.toolchain, chosenFont) : []
  latexFont = chosenFont
  if (chosenFont && (!ready || missing.some(file => file === FONT_FILES[chosenFont]))) {
    latexFont = null
    $.ui.log(ready ? `latex: the ${chosenFont} font is not installed, so math uses MathJax. Run /latex setup for how to install it.` : 'latex: no latex and dvisvgm found, so math uses MathJax')
  }
  if (missing.length) debug($, `     missing ${missing.join(' ')}`)
  setupReport = { backend, toolchain: tex?.toolchain ?? null, folders, missing, sandbox: sandboxNote, platform: await platformOf($), macros: macrosInfo }
  return ready
}

async function bumpSetup($: Engine): Promise<void> {
  if (setupReport) setupReport = { ...setupReport, sandbox: sandboxNote, macros: macrosInfo }
  await update($, setup, n => n + 1).catch(() => undefined)
}

// Finds TeX and gets it ready: the sandbox, the saved formats, the workers.
// Run at session start and again from the settings pane, after an install.
// With blocks and fonts off it only writes the report.
async function setUpTex($: Engine): Promise<void> {
  if (settings.blocksOn || settings.chosenFont) {
    let ready = false
    await step($, 'find TeX', async () => {
      ready = await checkSetup($)
    })
    if (ready) {
      await step($, 'sandbox', async () => {
        await setupSandbox($, home)
        debug($, `     sandbox ${sandbox ? 'on' : 'off'}`)
      })
      // A compile killed mid-run (a reload, a crash) leaves its folder.
      // Clear folders older than ten minutes, which no live compile uses.
      void $.process
        .run(['/usr/bin/find', `${tex!.cacheDir}/build`, '-mindepth', '1', '-maxdepth', '1', '-mmin', '+10', '-exec', '/bin/rm', '-rf', '{}', '+'])
        .catch(() => undefined)
      // Build the common formats now, in the background, so the first
      // diagram does not wait for them.
      const font = latexFont ?? 'cm'
      void formatFor($, documentForBlock({ key: '', lang: 'tikz', source: '' }, font, ''))
      void formatFor($, documentForBlock({ key: '', lang: 'latex', source: '' }, font, ''))
      if (latexFont) void formatFor($, documentForMath([], latexFont, ''))
      startWorkers($, latexFont)
      // Messages drawn before TeX was found left their blocks as code.
      // Draw them again now that blocks can compile.
      await update($, version, n => n + 1).catch(() => undefined)
    }
  } else {
    await step($, 'setup report', () => checkSetup($))
  }
  await bumpSetup($)
}

async function reloadMacros($: Engine): Promise<void> {
  await loadMacros($)
  await update($, version, n => n + 1).catch(() => undefined)
  await bumpSetup($)
}

// Writes the macros template where the setting points, unless a file is
// there already, and reads it.
async function createMacros($: Engine): Promise<void> {
  const path = macrosPath()
  if (!(await $.fs.exists(path).catch(() => false))) await $.fs.write(path, MACROS_TEMPLATE)
  await reloadMacros($)
}

export const register: Register = (on, options) => {
  const scheme = (['light', 'dark'].includes(String(options.colorScheme))
    ? options.colorScheme
    : 'auto') as ColorScheme
  const fontOption = String(options.mathFont ?? 'mathjax')
  const chosenFont: LatexFont | null = isLatexFont(fontOption) ? fontOption : null
  latexFont = chosenFont
  const backend: Backend = isBackend(options.backend) ? options.backend : 'auto'
  const texPath = String(options.texPath ?? '')
  const macrosOption = String(options.macrosFile || DEFAULT_MACROS_FILE)
  const blocksOn = options.tikz !== false
  settings = { chosenFont, backend, texPath, macrosOption, blocksOn }
  const bubbleMode: BubbleMode = BUBBLE_MODES.find(mode => mode === options.userBubble) ?? 'off'
  const showCopy = options.copyButton === true
  const tellModel = options.tellModel !== false
  const terminalOn = options.terminal !== false
  const promptOn = options.promptBox !== false
  terminalStyle = scheme === 'light' ? LIGHT_STYLE : DARK_STYLE

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Setup runs after the session is ready, so it never holds it up. TeX
    // comes first: it is what most of the mod needs.
    void (async () => {
      home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
      debugDir = home ? `${home}/.cache/claude-latex/debug` : ''
      debug($, `session start, options ${JSON.stringify(options)}`)
      if (scheme === 'auto') terminalStyle = isLightTerminal(await $.env.get('COLORFGBG').catch(() => undefined)) ? LIGHT_STYLE : DARK_STYLE

      // The macros come first: every formula, in every surface, reads
      // them, and the setup report counts them.
      await step($, 'macros', () => loadMacros($))
      macrosRead = true
      if (macros) await update($, version, n => n + 1).catch(() => undefined)

      await setUpTex($)

      await step($, 'settings rows', async () => {
        const keys = (await $.config.list()).map(row => row.key).filter(key => key.startsWith('latex'))
        debug($, `     keys ${JSON.stringify(keys)}`)
      })
      await step($, 'register /latex', () =>
        $.command.register({ name: 'latex', description: 'Open the LaTeX mod settings. /latex setup checks your TeX install; /latex reload reads the macros file again', argumentHint: '[setup|reload]' }),
      )
      await step($, 'welcome band', async () => {
        if (!(await $.store.get(INTRO_SEEN))) await update($, intro, () => true)
      })
    })()
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    turnStartedAt = Date.now()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    turnStartedAt = 0
    // One redraw for everything that compiled during the turn.
    await update($, version, n => n + 1).catch(() => undefined)
    return done
  })

  // The model cannot see how its reply is drawn. Where the mod draws, it adds
  // one section to the system prompt saying how math renders and what the
  // limits are.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const drawsHere = e.surfaces.some(surface => surface === 'desktop' || surface === 'mobile')
    const inTerminal = terminalOn && e.surfaces.includes('terminal')
    if (!tellModel || !(drawsHere || inTerminal)) return composed
    // Where the app also draws (the desktop through Remote Control), the
    // desktop's note says what renders best.
    const note = drawsHere ? MODEL_NOTE : TERMINAL_NOTE
    return { sections: [...composed.sections, { id: 'latex:rendering', text: note, scope: 'session' as const }] }
  })

  // The prompt box: each edit's answer carries the paint for the draft as it
  // now stands.
  on('prompt.edit', async ($, e, next) => {
    const edited = await next(e)
    if (!promptOn) return edited
    return { ...edited, decorations: [...(edited.decorations ?? []), ...promptDecorations(edited.text, terminalStyle, unicodeMacros)] }
  }).catch(async ($, e, next) => next(e))

  // /latex opens the settings. /latex setup says what the setup check
  // found, as text, so it reads in any surface. /latex reload reads the
  // macros file again.
  on('command.run', { command: 'latex' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'setup' || word === 'doctor' || word === 'check') {
      await setUpTex($)
      return { text: setupReport ? describeSetup(setupReport).join('\n') : 'The setup check has not run yet.' }
    }
    if (word === 'reload') {
      await reloadMacros($)
      return { text: macrosInfo.exists ? `Read ${macrosInfo.count} macros from ${macrosInfo.path}.${macrosInfo.error ? ` Error: ${macrosInfo.error}` : ''}` : `No macros file at ${macrosInfo.path}.` }
    }
    // Tall enough to show every setting where the terminal opens it inline.
    await $.ui.open({ id: PANE, title: 'LaTeX settings', rows: 60, closeOnEscape: true })
    return { text: 'Opened the LaTeX settings.' }
  })

  on('ui.render', { component: ['AssistantMessage', 'UserMessage'] }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile' && e.surface !== 'terminal') return next(e)
    const renderStarted = Date.now()
    try {
    if (e.surface === 'terminal') {
      if (!terminalOn) return next(e)
      const isUser = e.component === 'UserMessage'
      if (isUser && (e.props.task || e.props.from || !OWN_MESSAGES.has(e.props.origin.kind))) return next(e)
      const mode = !isUser ? 'reply' : bubbleMode
      if (mode === 'off') return next(e)
      const text = isUser ? keepLineBreaks(e.props.text) : e.props.text
      const isMarkdownToo = mode === 'rendered' && looksLikeMarkdown(text)
      if (!looksLikeMath(text) && !isMarkdownToo) return next(e)
      // Nothing compiles here: LaTeX blocks stay code blocks.
      let pieces = parse(text, { blocks: false })
      if (mode === 'under') pieces = mathOnly(pieces)
      if (!pieces.some(p => p.kind !== 'md') && !isMarkdownToo) return next(e)
      // Drawn before the macros file is read, a message is drawn again
      // once it is.
      if (!macrosRead) await read($, version)
      const { Box, Text, Markdown, Link } = $.ui.resolve(e)
      const tree = drawTerminal(pieces, {
        el: { Box, Text, Markdown, Link },
        style: terminalStyle,
        inline: tex => texToUnicode(tex, unicodeMacros),
        display: tex => texToUnicodeLines(tex, unicodeMacros),
        columns: e.viewport?.columns ?? 80,
      })
      debug($, `drew ${e.component} ${e.props.text.length} chars in the terminal as ${mode}: pieces ${pieces.map(p => p.kind[0]).join('')}, ${Date.now() - renderStarted} ms`)
      // `under` keeps the app's row and adds the math below it. `rendered`
      // draws the message in place of the row, behind the prompt mark.
      if (mode === 'under') {
        return (
          <Box flexDirection="column">
            {await next(e)}
            <Box flexDirection="column" marginLeft={2}>
              {tree}
            </Box>
          </Box>
        )
      }
      if (mode === 'rendered') {
        return (
          <Box flexDirection="row">
            <Text color={terminalStyle.muted}>{'❯ '}</Text>
            <Box flexDirection="column" flexShrink={1}>
              {tree}
            </Box>
          </Box>
        )
      }
      return tree
    }
    const isUser = e.component === 'UserMessage'
    if (isUser && (e.props.task || e.props.from || !OWN_MESSAGES.has(e.props.origin.kind))) return next(e)
    const text = isUser ? keepLineBreaks(e.props.text) : e.props.text
    const { Box, Text, Markdown, Svg, Button, Link } = $.ui.resolve(e)
    const mode = !isUser ? 'reply' : bubbleMode
    if (mode === 'off') return next(e)
    // Before TeX is found, blocks are left as code. Listen for the redraw
    // that follows TeX setup.
    if (blocksOn && tex === null && /```\s*(tikz|latex)/.test(text)) await read($, version)
    const hasMath = looksLikeMath(text)
    // A message of yours with nothing to render keeps the app's own bubble.
    if (!hasMath && !(mode === 'rendered' && looksLikeMarkdown(text))) return next(e)
    let pieces = parse(text, { blocks: blocksOn && tex !== null })
    if (mode === 'under') pieces = mathOnly(pieces)
    // A display formula MathJax cannot draw goes to LaTeX. Before TeX is
    // found it is drawn as source: listen for the redraw that follows setup.
    if (blocksOn && tex === null && pieces.some(p => p.kind === 'display' && renderTex(p.tex, true) === null)) await read($, version)
    // Dollars that turned out not to be math leave nothing to draw.
    if (!pieces.some(p => p.kind !== 'md') && !(mode === 'rendered' && looksLikeMarkdown(text))) return next(e)

    // The app's bubble cannot be drawn into: it reaches a mod as a closed
    // handle. So a rendered message of yours is drawn in a bubble of the
    // mod's own, on the right, with a Copy button that appears under it on
    // hover and copies the message as you typed it.
    const inBubble = (tree: ReturnType<typeof drawMessage>) => (
      <Box key={`you-${hashOf(e.props.text)}`} flexDirection="column" alignItems="flex-end">
        <Box flexDirection="column" flexShrink={1} marginLeft={6} backgroundColor={USER_BUBBLE} borderStyle="round" borderColor={USER_BUBBLE} paddingX={1}>
          {tree}
        </Box>
        <Box flexDirection="row" height={1}>
          <Box flexDirection="row" display="none" hover={{ display: 'flex' }}>
            <Button
              key="copy-message"
              label="Copy"
              plain
              dimColor
              onPress={press => {
                void $.ui.copy({ text: e.props.text, surface: press.surface }).then(r => {
                  if (r.isCopied) $.ui.toast('Message copied')
                })
              }}
            />
          </Box>
        </Box>
      </Box>
    )
    // `under` keeps the app's bubble and adds the math below it.
    const underBubble = async (tree: ReturnType<typeof drawMessage>) => (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="column" marginTop={1}>
          {tree}
        </Box>
      </Box>
    )

    // The font this drawing typesets in, fixed for the whole drawing.
    const font = latexFont
    const useLatex = font !== null && tex !== null
    let isWaiting = false
    // What this drawing hands the app, for the debug log.
    const handed = { svgs: 0, svgChars: 0 }
    let size: { chars: number; handedBackAt: number | null } = { chars: 0, handedBackAt: null }
    const count = (svg: string) => {
      handed.svgs += 1
      handed.svgChars += svg.length
      return svg
    }
    // A display formula MathJax cannot draw is typeset by the local LaTeX,
    // as a LaTeX block would be.
    const canFallBack = blocksOn && tex !== null
    const fallbackBlock = (p: { source: string }) => ({ lang: 'latex' as const, source: p.source })
    const blockKey = (p: { lang: BlockJob['lang']; source: string }) => hashOf('block', font ?? 'cm', p.lang, macros, p.source)
    const compiled = (p: { lang: BlockJob['lang']; source: string }) => {
      const key = blockKey(p)
      const result = resultOf(key)
      if (!result) {
        requestBlock({ key, lang: p.lang, source: p.source })
        isWaiting = true
        return undefined
      }
      return 'svg' in result ? { svg: count(withInk(result.svg, scheme)) } : result
    }

    // Fill the in-memory results from the disk cache before drawing.
    for (const p of pieces) {
      const asBlock = p.kind === 'block' ? p : p.kind === 'display' && canFallBack && renderTex(p.tex, true) === null ? fallbackBlock(p) : null
      if (asBlock) {
        const key = blockKey(asBlock)
        if (!resultOf(key)) await fromDisk($, `b-${key}.svg`, key)
      }
      if (useLatex && (p.kind === 'display' || p.kind === 'inline')) {
        const formulas =
          p.kind === 'display'
            ? [{ tex: p.tex, display: true }]
            : p.lines.flatMap(l => l.spans.flatMap(sp => (sp.kind === 'math' ? [{ tex: sp.tex, display: false }] : [])))
        for (const f of formulas) {
          const key = hashOf('math', font!, f.display ? 'D' : 'I', macros, f.tex)
          if (!resultOf(key)) await fromDisk($, `m-${key}.svg`, key)
        }
      }
    }

    const tree = drawMessage(pieces, {
      el: { Box, Text, Markdown, Svg, Button, Link },
      formula: (source, display) => {
        if (useLatex) {
          const key = hashOf('math', font!, display ? 'D' : 'I', macros, source)
          const typeset = resultOf(key)
          if (typeset && 'svg' in typeset) return count(withInk(typeset.svg, scheme))
          if (!typeset) {
            requestMath({ key, tex: source, display })
            isWaiting = true
          }
        }
        const svg = renderTex(source, display)
        return svg ? count(withInk(svg, scheme)) : null
      },
      block: compiled,
      maxChars: MAX_MESSAGE_CHARS,
      onDrawn: drawn => {
        size = drawn
      },
      fallback: p => (canFallBack ? compiled(fallbackBlock(p)) : null),
      showCopy,
      onCopy: (text, press) => {
        void $.ui.copy({ text, surface: press.surface }).then(r => {
          if (r.isCopied) $.ui.toast('TeX copied')
        })
      },
    })
    // Only a message still waiting on a compile listens for finished
    // compiles. A finished message is never redrawn by them.
    if (isWaiting) await read($, version)
    const kinds = pieces.map(p => p.kind[0]).join('')
    debug($, `drew ${e.component} ${e.props.text.length} chars as ${mode}: pieces ${kinds}, ${handed.svgs} svgs of ${handed.svgChars} chars, drawing ${size.chars} chars${size.handedBackAt === null ? '' : ` then handed back from piece ${size.handedBackAt}`}, ${Date.now() - renderStarted} ms${isWaiting ? ', waiting on LaTeX' : ''} | ${JSON.stringify(e.props.text.slice(0, 40))}`)
    if (mode === 'rendered') {
      // The time, copy, rewind and fork controls are the app's, and come only
      // with the app's own row. So that row is kept under the rendered
      // bubble with its text replaced by an ellipsis: a small pill whose
      // controls show on hover. It must be asked for once: the app drew
      // nothing when one drawing held several of its rows.
      const controls = await next({ ...e, props: { ...e.props, text: CONTROLS_ROW_TEXT } } as typeof e).catch(() => null)
      return (
        <Box flexDirection="column">
          {inBubble(tree)}
          {controls}
        </Box>
      )
    }
    return mode === 'under' ? await underBubble(tree) : tree
    } catch (error) {
      // Never leave a message undrawn: fall back to the app's own drawing.
      debug($, `render error (${e.component}, ${e.props.text.length} chars): ${String(error)}`)
      return next(e)
    } finally {
      const ms = Date.now() - renderStarted
      if (ms > 150) debug($, `slow render ${ms} ms (${e.component}, ${e.props.text.length} chars)`)
    }
  }).catch(async ($, e, next) => {
    // The engine refused the drawing, or the hook overran. Write down why,
    // and let the app draw the message itself.
    debug($, `REFUSED ${e.component} ${e.props.text.length} chars: ${next.error.kind} ${next.error.message ?? ''} | ${JSON.stringify(e.props.text.slice(0, 40))}`)
    return next(e)
  })

  // A one-time band above the prompt: what the mod does, where its settings are.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, intro))) return next(e)
    await read($, setup)
    const { Box, Text, Button } = $.ui.resolve(e)
    // What the setup check found, in one line: blocks only compile with a
    // working TeX, so say so where the person first looks.
    const report = setupReport
    const setupLine = !report || e.surface === 'terminal' || report.backend === 'mathjax'
      ? null
      : !report.toolchain
        ? { text: 'No LaTeX found, so diagrams stay code. Open settings to see how to install it.', isProblem: true }
        : report.missing.length
          ? { text: `LaTeX is missing ${report.missing.length} package${report.missing.length === 1 ? '' : 's'} the mod uses. Open settings to see which.`, isProblem: true }
          : { text: `Diagrams compile with ${report.toolchain.engine}.`, isProblem: false }
    const dismiss = async () => {
      await $.store.set(INTRO_SEEN, true)
      await update($, intro, () => false)
    }
    return (
      <Box flexDirection="column">
        <Text bold>LaTeX mod is on</Text>
        <Text dimColor>
          {e.surface === 'terminal'
            ? 'Math in replies now shows as Unicode text, laid out over several rows for display math. The prompt box colors your Markdown and previews each formula as you type.'
            : 'Math, TikZ and LaTeX blocks in replies now render. You can pick one of 10 math fonts, and choose whether your own messages show their math.'}
        </Text>
        {setupLine ? <Text color={setupLine.isProblem ? 'warning' : undefined} dimColor={!setupLine.isProblem}>{setupLine.text}</Text> : null}
        <Box flexDirection="row" gap={1}>
          <Button
            key="intro-settings"
            label="Open settings"
            variant="primary"
            onPress={() => {
              void dismiss()
              void $.ui.open({ id: PANE, title: 'LaTeX settings' })
            }}
          />
          <Button key="intro-dismiss" label="Got it" role="dismiss" onPress={() => void dismiss()} />
        </Box>
      </Box>
    )
  })

  // The settings pane, opened by /latex or the welcome band. Each change goes
  // through the app's own settings, which reloads the mod with the new value.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Redrawn when the setup check or the macros change.
    await read($, setup)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // The mobile app has no Select or Input. Show the value as text there.
    const Select = 'Select' in elements ? elements.Select : undefined
    const Input = 'Input' in elements ? elements.Input : undefined
    // Each call names its setting in full, so the plugin directory can read
    // which settings the pane changes. A change reloads the mod.
    const saved = (change: Promise<unknown>) => void change.catch(error => debug($, `config.set failed: ${error}`))
    const setBackend = (value: string) => saved($.config.set({ key: 'latex.backend', value: value }))
    const setTexPath = (value: string) => saved($.config.set({ key: 'latex.texPath', value: value.trim() }))
    const setMacrosFile = (value: string) => saved($.config.set({ key: 'latex.macrosFile', value: value.trim() || DEFAULT_MACROS_FILE }))
    const setMathFont = (value: string) => saved($.config.set({ key: 'latex.mathFont', value: value }))
    const setColorScheme = (value: string) => saved($.config.set({ key: 'latex.colorScheme', value: value }))
    const setUserBubble = (value: string) => saved($.config.set({ key: 'latex.userBubble', value: value }))
    const setTellModel = (value: boolean) => saved($.config.set({ key: 'latex.tellModel', value: value }))
    const setCopyButton = (value: boolean) => saved($.config.set({ key: 'latex.copyButton', value: value }))
    const setTikz = (value: boolean) => saved($.config.set({ key: 'latex.tikz', value: value }))
    const setTerminal = (value: boolean) => saved($.config.set({ key: 'latex.terminal', value: value }))
    const setPromptBox = (value: boolean) => saved($.config.set({ key: 'latex.promptBox', value: value }))
    const heading = (text: string) => (
      <Text bold underline>
        {text}
      </Text>
    )
    const toggle = (field: string, label: string, help: string, isOn: boolean, change: (value: boolean) => void) => (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key={`toggle-${field}`} label={isOn ? 'On' : 'Off'} variant={isOn ? 'primary' : 'secondary'} onPress={() => change(!isOn)} />
          <Text bold>{label}</Text>
        </Box>
        <Text dimColor>{help}</Text>
      </Box>
    )
    const choice = (key: string, label: string, value: string, choices: { value: string; label: string }[], change: (value: string) => void, help?: string) => (
      <Box flexDirection="column">
        <Text bold>{label}</Text>
        {Select ? <Select key={key} value={value} options={choices} onSelect={change} /> : <Text>{choices.find(c => c.value === value)?.label ?? value}</Text>}
        {help ? <Text dimColor>{help}</Text> : null}
      </Box>
    )
    const field = (key: string, label: string, value: string, placeholder: string, change: (value: string) => void, help: string) => (
      <Box flexDirection="column">
        <Text bold>{label}</Text>
        {Input ? <Input key={key} value={value} placeholder={placeholder} submitLabel="Save" onSubmit={change} /> : <Text>{value || placeholder}</Text>}
        <Text dimColor>{help}</Text>
      </Box>
    )
    const fontValue = String(options.mathFont ?? 'mathjax')
    const colorValue = String(options.colorScheme ?? 'auto')
    const report = setupReport ? describeSetup(setupReport) : ['Checking your TeX install…']
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {heading('Setup')}
          {report.map(line => (
            <Text dimColor={!/^(To fix|Missing)/.test(line)} color={/^(To fix|Missing)/.test(line) ? 'warning' : undefined}>
              {line}
            </Text>
          ))}
          <Box flexDirection="row" gap={1}>
            <Button key="check-setup" label="Check again" onPress={() => void setUpTex($)} />
          </Box>
        </Box>
        <Box flexDirection="column" gap={1}>
          {heading('Rendering')}
          {choice(
            'backend',
            'Backend',
            backend,
            [
              { value: 'auto', label: 'Auto: the first installed of LaTeX and XeLaTeX' },
              { value: 'latex', label: 'LaTeX (latex and dvisvgm, fastest)' },
              { value: 'xelatex', label: 'XeLaTeX (system fonts and fontspec in blocks)' },
              { value: 'mathjax', label: 'MathJax only (never runs your TeX)' },
            ],
            setBackend,
            'What typesets LaTeX blocks and the LaTeX fonts. Formulas always show in MathJax first.',
          )}
          {field('tex-path', 'TeX folder', texPath, 'Found automatically', setTexPath, 'The folder holding latex (or xelatex) and dvisvgm. Leave empty to search the usual places and your PATH.')}
          {choice('math-font', 'Math font', fontValue, FONT_CHOICES.map(v => ({ value: v, label: v === 'mathjax' ? 'MathJax (instant)' : v })), setMathFont, 'Any font but MathJax is typeset by your LaTeX, with MathJax shown until it is ready.')}
          {choice('math-color', 'Math color', colorValue, [{ value: 'auto', label: 'Follow the system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], setColorScheme)}
          {toggle('tikz', 'Compile LaTeX blocks', 'tikz, tikzcd and latex code blocks, using your TeX.', blocksOn, setTikz)}
          {toggle('copyButton', 'Copy TeX button', 'A button under each display formula and LaTeX block.', showCopy, setCopyButton)}
        </Box>
        <Box flexDirection="column" gap={1}>
          {heading('Macros')}
          {field('macros-file', 'Macros file', macrosOption, DEFAULT_MACROS_FILE, setMacrosFile, '\\newcommand and \\DeclareMathOperator lines every formula can use.')}
          <Text dimColor>
            {macrosInfo.exists ? `${macrosInfo.count} definition${macrosInfo.count === 1 ? '' : 's'} read${macrosInfo.error ? `, with an error: ${macrosInfo.error}` : ''}.` : 'There is no file there yet.'}
          </Text>
          <Box flexDirection="row" gap={1}>
            {macrosInfo.exists ? null : <Button key="create-macros" label="Create it with examples" variant="primary" onPress={() => void createMacros($)} />}
            <Button key="reload-macros" label="Reload macros" onPress={() => void reloadMacros($)} />
          </Box>
        </Box>
        <Box flexDirection="column" gap={1}>
          {heading('Terminal')}
          {toggle('terminal', 'Math in the terminal', 'Math in replies as Unicode text, display math over several rows.', terminalOn, setTerminal)}
          {toggle('promptBox', 'Style the prompt box', 'Color the Markdown you type, render-markdown.nvim style, and preview each formula.', promptOn, setPromptBox)}
        </Box>
        <Box flexDirection="column" gap={1}>
          {heading('Messages')}
          {choice(
            'user-bubble',
            'Your messages',
            bubbleMode,
            [
              { value: 'off', label: 'As typed' },
              { value: 'under', label: 'As typed, with the math under it' },
              { value: 'rendered', label: 'Rendered: Markdown and math (experimental)' },
            ],
            setUserBubble,
          )}
          {toggle('tellModel', 'Tell the model how math renders here', 'A short note in the system prompt: the syntax that renders, and the limits.', tellModel, setTellModel)}
        </Box>
      </Box>
    )
  })
}
