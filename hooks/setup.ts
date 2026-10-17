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
  // The first line of `latex --version`: saved formats are tied to it.
  version?: string
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

// The packages each LaTeX math font loads (texjobs.ts FONTS). TeX Live
// installs most of them only with its larger font collections.
export const FONT_FILES: Record<string, string[]> = {
  cm: ['amssymb.sty'],
  libertinus: ['libertinus-type1.sty', 'newtxmath.sty'],
  palatino: ['newpxtext.sty', 'newpxmath.sty'],
  times: ['newtxtext.sty', 'newtxmath.sty'],
  euler: ['amssymb.sty', 'eulervm.sty'],
  concrete: ['amssymb.sty', 'ccfonts.sty', 'eulervm.sty'],
  fourier: ['fourier.sty', 'eufrak.sty'],
  stix2: ['stix2.sty'],
  kpfonts: ['kpfonts.sty'],
  cmbright: ['amssymb.sty', 'cmbright.sty'],
}

// The TeX Live package each file comes in, where its name differs.
const TL_PACKAGE: Record<string, string> = {
  'tikz.sty': 'pgf',
  'bm.sty': 'tools',
  'amsmath.sty': 'amsmath',
  'amssymb.sty': 'amsfonts',
  'eufrak.sty': 'amsfonts',
  'newpxtext.sty': 'newpx',
  'newpxmath.sty': 'newpx',
  'newtxtext.sty': 'newtx',
  'newtxmath.sty': 'newtx',
  'stix2.sty': 'stix2-type1',
}
export function packageOf(file: string): string {
  return TL_PACKAGE[file] ?? file.replace(/\.(sty|cls)$/, '')
}

export function isBackend(value: unknown): value is Backend {
  return BACKENDS.includes(value as Backend)
}

// The folders to look in: the one the settings name, else the usual places
// and the PATH. A leading ~ is the home folder. A path to latex or dvisvgm
// itself means its folder. A relative path is refused: the compiles run in
// another folder, where it would lead elsewhere.
export function searchFolders(texPath: string, path: string, home: string): { folders: string[]; problem?: string } {
  const own = texPath.trim().replace(/^~(?=\/|$)/, home)
  if (own) {
    if (!own.startsWith('/')) return { folders: [], problem: `TeX folder "${texPath}" is not an absolute path` }
    const folder = own.replace(/\/+$/, '').replace(/\/(latex|xelatex|dvisvgm|kpsewhich)$/, '')
    return { folders: [folder || '/'] }
  }
  return { folders: [...new Set([...BIN_CANDIDATES, ...path.split(':').filter(dir => dir.startsWith('/'))])] }
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
  const fontFiles = (font ? FONT_FILES[font] : undefined) ?? []
  const wanted = [...new Set([...REQUIRED_FILES, ...fontFiles])]
  const run = await $.process.run([toolchain.kpsewhich, ...wanted], { timeoutMs: 15000 }).catch(() => null)
  if (!run) return []
  const found = new Set(run.stdout.split('\n').map(line => line.trim().split('/').pop()))
  return wanted.filter(file => !found.has(file))
}

// What TeX's own settings say: the folders a sandbox must let it reach.
export async function texVariable($: Engine, toolchain: Toolchain, name: string): Promise<string> {
  if (!toolchain.kpsewhich) return ''
  const run = await $.process.run([toolchain.kpsewhich, `-var-value=${name}`], { timeoutMs: 10000 }).catch(() => null)
  return run?.exitCode === 0 ? run.stdout.trim() : ''
}

export async function versionOf($: Engine, toolchain: Toolchain): Promise<string> {
  const run = await $.process.run([toolchain.typesetter, '--version'], { timeoutMs: 10000 }).catch(() => null)
  return run?.stdout.split('\n')[0]?.trim() ?? ''
}

export type Platform = 'mac' | 'linux' | 'windows' | 'other'
// How this machine installs TeX packages: TeX Live's own tlmgr, or the
// system's package manager for a distribution's TeX Live.
export type Installer = 'tlmgr' | 'apt' | 'dnf' | 'pacman' | null

export async function platformOf($: Engine): Promise<Platform> {
  if (await has($, '/usr/bin/sw_vers')) return 'mac'
  if (await has($, '/proc/version')) return 'linux'
  return (await $.env.get('WINDIR').catch(() => undefined)) ? 'windows' : 'other'
}

// A TeX Live installed from tug.org keeps tlmgr beside latex; one from the
// distribution lives in /usr/bin and comes from its package manager.
export async function installerOf($: Engine, platform: Platform, toolchain: Toolchain | null): Promise<Installer> {
  if (toolchain && toolchain.bin !== '/usr/bin' && (await has($, `${toolchain.bin}/tlmgr`))) return 'tlmgr'
  if (platform === 'mac') return 'tlmgr'
  if (platform !== 'linux') return null
  if (await has($, '/usr/bin/apt-get')) return 'apt'
  if (await has($, '/usr/bin/dnf')) return 'dnf'
  if (await has($, '/usr/bin/pacman')) return 'pacman'
  return null
}

// How to get a working toolchain here: one command to run.
export function installHint(o: { platform: Platform; installer: Installer; missing: string[]; hasToolchain: boolean; backend: Backend; fontChosen: boolean }): string {
  const fonts = o.fontChosen || o.missing.some(file => !REQUIRED_FILES.includes(file))
  const xetex = o.backend === 'xelatex'
  if (o.hasToolchain && o.missing.length) {
    const packages = [...new Set(o.missing.map(packageOf))]
    if (o.installer === 'tlmgr') return `sudo tlmgr install ${packages.join(' ')}`
    if (o.installer === 'apt') return `sudo apt install texlive-latex-extra texlive-pictures texlive-science${fonts ? ' texlive-fonts-extra' : ''}`
    if (o.installer === 'dnf') return `sudo dnf install ${packages.map(name => `texlive-${name}`).join(' ')}`
    if (o.installer === 'pacman') return `sudo pacman -S texlive-latexextra texlive-pictures texlive-science${fonts ? ' texlive-fontsextra' : ''}`
    return `Install the LaTeX packages: ${packages.join(', ')}`
  }
  if (o.platform === 'mac') return `brew install --cask mactex-no-gui`
  if (o.installer === 'apt') return `sudo apt install texlive-latex-extra texlive-pictures texlive-science dvisvgm${xetex ? ' texlive-xetex' : ''}${fonts ? ' texlive-fonts-extra' : ''}`
  if (o.installer === 'dnf') return `sudo dnf install texlive-scheme-medium texlive-dvisvgm texlive-standalone${xetex ? ' texlive-xetex' : ''}`
  if (o.installer === 'pacman') return `sudo pacman -S texlive-latexextra texlive-pictures texlive-science texlive-binextra${xetex ? ' texlive-xetex' : ''}${fonts ? ' texlive-fontsextra' : ''}`
  if (o.platform === 'windows') return 'Install MiKTeX or TeX Live, which include latex and dvisvgm'
  return 'Install TeX Live (https://tug.org/texlive), which includes latex and dvisvgm'
}

// What the setup check found, for the settings pane and /latex setup.
export type SetupReport = {
  backend: Backend
  toolchain: Toolchain | null
  folders: string[]
  // Why the folders could not be searched: a TeX folder setting that is
  // not an absolute path.
  problem?: string
  missing: string[]
  // Whether TeX runs in a sandbox, and its description.
  isSandboxed: boolean
  sandbox: string
  platform: Platform
  installer: Installer
  fontChosen: boolean
  macros: { path: string; count: number; error?: string; exists: boolean }
}

export function describeSetup(report: SetupReport): string[] {
  const lines: string[] = []
  const { toolchain } = report
  if (report.backend === 'mathjax') lines.push('Backend: MathJax only. LaTeX blocks stay code and the LaTeX fonts are off.')
  else if (toolchain) lines.push(`Backend: ${toolchain.engine} in ${toolchain.bin}`)
  else if (report.problem) lines.push(`Backend: ${report.problem}, so math uses MathJax and blocks stay code.`)
  else lines.push(`Backend: no ${report.backend === 'auto' ? 'latex or xelatex' : report.backend} with dvisvgm found, so math uses MathJax and blocks stay code. Looked in ${report.folders.join(', ')}.`)
  if (toolchain) lines.push(report.missing.length ? `Missing LaTeX packages: ${report.missing.join(', ')}` : 'LaTeX packages: all found')
  if (report.backend !== 'mathjax' && !report.problem && (!toolchain || report.missing.length)) {
    lines.push(`To fix: ${installHint({ ...report, hasToolchain: toolchain !== null })}`)
  }
  if (toolchain) lines.push(`Sandbox: ${report.sandbox}`)
  if (toolchain && !report.isSandboxed && report.platform === 'linux') lines.push('To fix: install bubblewrap (bwrap) from your distribution, then Check again')
  const { macros } = report
  if (!macros.exists) lines.push(`Macros: no file at ${macros.path}`)
  else lines.push(`Macros: ${macros.count} definition${macros.count === 1 ? '' : 's'} from ${macros.path}${macros.error ? `, with an error: ${macros.error}` : ''}`)
  return lines
}
