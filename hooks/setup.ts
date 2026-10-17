// Finds the TeX toolchain the mod compiles with, checks it has the packages
// the mod's documents load, and says how to install what is missing.
// Only $.fs, $.env and $.process: no state of its own.

import type { EngineInterface as Engine } from 'claude-code'
import { BIN_CANDIDATES } from './texjobs'

// Which program typesets. `latex` is pdfTeX writing DVI, the fastest, with
// saved formats. `xelatex` is XeTeX writing XDV, slower, for blocks that load
// system OpenType fonts with fontspec or need Unicode input beyond Latin.
// Both hand their output to dvisvgm. `mathjax` never runs a local TeX:
// formulas use MathJax and LaTeX blocks stay code. `auto` takes the first
// that is installed, in that order.
//
// Tectonic is not offered: it typesets, but dvisvgm finds font files only
// through a TeX Live tree, so without one every formula comes out blank.
export const BACKENDS = ['auto', 'latex', 'xelatex', 'mathjax'] as const
export type Backend = (typeof BACKENDS)[number]
export type TexEngine = 'latex' | 'xelatex'

export type Toolchain = {
  engine: TexEngine
  // The folder the typesetter is in.
  bin: string
  // The latex or xelatex program.
  typesetter: string
  dvisvgm: string
  // kpsewhich, to check packages.
  kpsewhich?: string
}

// The files the mod's documents load: the class, the math packages every
// block loads, and TikZ for diagrams. A minimal TeX Live has latex and
// dvisvgm but not all of these, and every block then fails the same way.
export const REQUIRED_FILES = [
  'standalone.cls',
  'amsmath.sty',
  'mathtools.sty',
  'bm.sty',
  'xcolor.sty',
  'cancel.sty',
  'braket.sty',
  'mhchem.sty',
  'tikz.sty',
  'tikz-cd.sty',
  'pgfplots.sty',
]

// The package each LaTeX math font loads. TeX Live installs most of them
// only with its larger font collections (texlive-fonts-extra).
export const FONT_FILES: Record<string, string> = {
  cm: 'amsmath.sty',
  libertinus: 'libertinus-type1.sty',
  palatino: 'newpxmath.sty',
  times: 'newtxmath.sty',
  euler: 'eulervm.sty',
  concrete: 'ccfonts.sty',
  fourier: 'fourier.sty',
  stix2: 'stix2.sty',
  kpfonts: 'kpfonts.sty',
  cmbright: 'cmbright.sty',
}

export function isBackend(value: unknown): value is Backend {
  return BACKENDS.includes(value as Backend)
}

// The folders to look in: the one the settings name, else the usual places
// and the PATH. A leading ~ is the home folder.
export function searchFolders(texPath: string, path: string, home: string): string[] {
  const own = texPath.trim().replace(/^~(?=\/|$)/, home)
  if (own) return [own.replace(/\/+$/, '') || '/']
  return [...new Set([...BIN_CANDIDATES, ...path.split(':').filter(Boolean)])]
}

async function has($: Engine, file: string): Promise<boolean> {
  return $.fs.exists(file).catch(() => false)
}

// The first toolchain the backend allows, or null.
export async function findToolchain($: Engine, backend: Backend, folders: string[]): Promise<Toolchain | null> {
  if (backend === 'mathjax') return null
  const engines: TexEngine[] = backend === 'auto' ? ['latex', 'xelatex'] : [backend]
  for (const engine of engines) {
    for (const bin of folders) {
      const typesetter = `${bin}/${engine}`
      const dvisvgm = `${bin}/dvisvgm`
      if (!(await has($, typesetter)) || !(await has($, dvisvgm))) continue
      const kpsewhich = `${bin}/kpsewhich`
      return { engine, bin, typesetter, dvisvgm, ...((await has($, kpsewhich)) ? { kpsewhich } : {}) }
    }
  }
  return null
}

// The required files, and the chosen font's package, that TeX cannot find.
// Empty when kpsewhich cannot run: the compiles themselves then say.
export async function missingFiles($: Engine, toolchain: Toolchain, font: string | null): Promise<string[]> {
  if (!toolchain.kpsewhich) return []
  const fontFile = font ? FONT_FILES[font] : undefined
  const wanted = fontFile && !REQUIRED_FILES.includes(fontFile) ? [...REQUIRED_FILES, fontFile] : REQUIRED_FILES
  const run = await $.process.run([toolchain.kpsewhich, ...wanted], { timeoutMs: 15000 }).catch(() => null)
  if (!run) return []
  const found = new Set(run.stdout.split('\n').map(line => line.trim().split('/').pop()))
  return wanted.filter(file => !found.has(file))
}

export type Platform = 'mac' | 'linux' | 'windows' | 'other'

export async function platformOf($: Engine): Promise<Platform> {
  if (await has($, '/usr/bin/sw_vers')) return 'mac'
  if (await has($, '/proc/version')) return 'linux'
  return (await $.env.get('WINDIR').catch(() => undefined)) ? 'windows' : 'other'
}

// How to get a working toolchain here: one command to run.
export function installHint(platform: Platform, missing: string[], hasToolchain: boolean): string {
  const fonts = missing.some(file => Object.values(FONT_FILES).includes(file) && !REQUIRED_FILES.includes(file))
  if (hasToolchain && missing.length) {
    if (platform === 'mac') return `sudo tlmgr install ${missing.map(file => file.replace(/\.(sty|cls)$/, '')).join(' ')}`
    if (platform === 'linux') return `sudo apt install texlive-latex-extra texlive-pictures texlive-science${fonts ? ' texlive-fonts-extra' : ''}`
    return `Install the LaTeX packages: ${missing.join(', ')}`
  }
  if (platform === 'mac') return 'brew install --cask mactex-no-gui'
  if (platform === 'linux') return 'sudo apt install texlive-latex-extra texlive-pictures texlive-science dvisvgm'
  if (platform === 'windows') return 'Install MiKTeX or TeX Live, which include latex and dvisvgm'
  return 'Install TeX Live, which includes latex and dvisvgm'
}

// What the setup check found, for the settings pane and /latex setup.
export type SetupReport = {
  backend: Backend
  toolchain: Toolchain | null
  folders: string[]
  missing: string[]
  sandbox: string
  platform: Platform
  macros: { path: string; count: number; error?: string; exists: boolean }
}

export function describeSetup(report: SetupReport): string[] {
  const lines: string[] = []
  const { toolchain } = report
  if (report.backend === 'mathjax') lines.push('Backend: MathJax only. LaTeX blocks stay code and the LaTeX fonts are off.')
  else if (toolchain) lines.push(`Backend: ${toolchain.engine} in ${toolchain.bin}`)
  else lines.push(`Backend: no ${report.backend === 'auto' ? 'latex or xelatex' : report.backend} with dvisvgm found, so math uses MathJax and blocks stay code. Looked in ${report.folders.join(', ')}.`)
  if (toolchain) lines.push(report.missing.length ? `Missing LaTeX packages: ${report.missing.join(', ')}` : 'LaTeX packages: all found')
  if (report.backend !== 'mathjax' && (!toolchain || report.missing.length)) lines.push(`To fix: ${installHint(report.platform, report.missing, toolchain !== null)}`)
  if (toolchain) lines.push(`Sandbox: ${report.sandbox}`)
  const { macros } = report
  if (!macros.exists) lines.push(`Macros: no file at ${macros.path}`)
  else lines.push(`Macros: ${macros.count} definition${macros.count === 1 ? '' : 's'} from ${macros.path}${macros.error ? `, with an error: ${macros.error}` : ''}`)
  return lines
}
