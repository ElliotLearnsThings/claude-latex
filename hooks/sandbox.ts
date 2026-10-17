// The sandbox every TeX run goes through. A LaTeX block can \input any file
// by its absolute path, and TeX's own openin_any setting does not stop that,
// so the sandbox hides the home folder apart from TeX's and the mod's own
// folders, and blocks the network and writes outside them.
//
// macOS: sandbox-exec with a profile. Linux: bubblewrap (bwrap), which
// mounts the root read-only, an empty home over the real one, and binds back
// only the cache folder. Elsewhere, or where the sandbox cannot start (a
// container without user namespaces), TeX runs without one and the setup
// report says so.

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
export const BWRAP_CANDIDATES = ['/usr/bin/bwrap', '/usr/local/bin/bwrap', '/bin/bwrap']

export type Sandbox =
  | { kind: 'macos'; profile: string }
  | { kind: 'bwrap'; bwrap: string; home: string; cacheDir: string }

export function macProfile(home: string, cacheDir: string): string {
  const q = (path: string) => JSON.stringify(path)
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    `(deny file-read* (subpath ${q(home)}) (subpath "/Volumes"))`,
    `(allow file-read* (subpath ${q(cacheDir)}) (subpath ${q(`${home}/Library/texlive`)}) (subpath ${q(`${home}/Library/texmf`)}) (subpath ${q(`${home}/texmf`)}))`,
    '(deny file-write* (subpath "/"))',
    `(allow file-write* (subpath ${q(cacheDir)}) (subpath ${q(`${home}/Library/texlive`)}) (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null"))`,
    '',
  ].join('\n')
}

// The bwrap command line that runs `argv` in `cwd`. `cwd` must be inside the
// cache folder: it is the only place the run can write besides /tmp.
export function bwrapArgv(box: Extract<Sandbox, { kind: 'bwrap' }>, argv: string[], readable: string[]): string[] {
  const out = [
    box.bwrap,
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    // An empty home over the real one, then the folders TeX may use.
    '--tmpfs', box.home,
  ]
  for (const dir of readable) out.push('--ro-bind-try', dir, dir)
  out.push('--bind', box.cacheDir, box.cacheDir)
  out.push('--unshare-net', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--die-with-parent', '--new-session')
  return [...out, '--', ...argv]
}

// What TeX may read in the home folder: its own per-user trees.
export function texHomeFolders(home: string): string[] {
  return [`${home}/texmf`, `${home}/.texlive`, `${home}/.texmf-var`, `${home}/.texmf-config`]
}

// Wraps a TeX command in the sandbox, when there is one.
export function sandboxed(box: Sandbox | null, argv: string[]): string[] {
  if (!box) return argv
  if (box.kind === 'macos') return [SANDBOX_EXEC, '-f', box.profile, ...argv]
  return bwrapArgv(box, argv, texHomeFolders(box.home))
}
