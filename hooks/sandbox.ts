// The sandbox every TeX run goes through. A LaTeX block can \input any file
// by its absolute path on some TeX versions, and dvisvgm runs the
// PostScript in a block's \special{ps: ...}, which can open files. So the
// sandbox hides the home folder apart from TeX's and the mod's own folders,
// blocks the network, and lets a run write only to its own working folder:
// a compile to its build folder, a format build to the formats folder. The
// rest of the cache, which later sessions load (saved formats, compiled
// SVGs), stays read-only to every run.
//
// macOS: sandbox-exec with a profile, the working folder passed as the
// WORKDIR parameter. Linux: bubblewrap (bwrap), which mounts the root
// read-only, empty folders over every home and removable-media folder, and
// binds back only what TeX needs. Elsewhere, or where neither starts (a
// container without user namespaces), TeX runs without a sandbox and the
// setup check says so.

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
export const BWRAP_CANDIDATES = ['/usr/bin/bwrap', '/usr/local/bin/bwrap', '/bin/bwrap']

export type Sandbox =
  | { kind: 'macos'; profile: string }
  | {
      kind: 'bwrap'
      bwrap: string
      // Folders hidden behind an empty one: every home, removable media.
      hidden: string[]
      // Folders bound back read-only: TeX's per-user trees, user fonts, a
      // TeX install under the home folder, and the mod's cache.
      readable: string[]
      // Folders bound back writable for every run: TeX's own var tree, where
      // it generates fonts.
      writable: string[]
    }

// Folders a bwrap sandbox hides when they exist, besides the home folder.
export const HIDDEN_ROOTS = ['/home', '/root', '/Users', '/mnt', '/media', '/run/media', '/run/user', '/var/tmp']

export function macProfile(home: string, cacheDir: string): string {
  const q = (path: string) => JSON.stringify(path)
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    `(deny file-read* (subpath ${q(home)}) (subpath "/Volumes"))`,
    `(allow file-read* (subpath ${q(cacheDir)}) (subpath ${q(`${home}/Library/texlive`)}) (subpath ${q(`${home}/Library/texmf`)}) (subpath ${q(`${home}/texmf`)}) (subpath ${q(`${home}/Library/Fonts`)}))`,
    '(deny file-write* (subpath "/"))',
    `(allow file-write* (subpath (param "WORKDIR")) (subpath ${q(`${home}/Library/texlive`)}) (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null"))`,
    '',
  ].join('\n')
}

// The bwrap command line that runs `argv` with `workdir` as its working
// folder, the one folder of the cache it may write.
export function bwrapArgv(box: Extract<Sandbox, { kind: 'bwrap' }>, argv: string[], workdir: string): string[] {
  const out = [box.bwrap, '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp']
  for (const dir of box.hidden) out.push('--tmpfs', dir)
  for (const dir of box.readable) out.push('--ro-bind-try', dir, dir)
  for (const dir of box.writable) out.push('--bind-try', dir, dir)
  out.push('--bind', workdir, workdir, '--chdir', workdir)
  out.push('--unshare-net', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--die-with-parent', '--new-session')
  return [...out, '--', ...argv]
}

// Wraps a TeX command in the sandbox, when there is one. `workdir` is the
// folder it runs in and may write.
export function sandboxed(box: Sandbox | null, argv: string[], workdir: string): string[] {
  if (!box) return argv
  if (box.kind === 'macos') return [SANDBOX_EXEC, '-D', `WORKDIR=${workdir}`, '-f', box.profile, ...argv]
  return bwrapArgv(box, argv, workdir)
}

// The hidden folders without any that another one already covers.
export function outermost(dirs: string[]): string[] {
  const unique = [...new Set(dirs.map(dir => dir.replace(/\/+$/, '') || '/'))].sort()
  return unique.filter(dir => !unique.some(other => other !== dir && dir.startsWith(`${other}/`)))
}
