# Security

## What the mod runs

The mod draws math with MathJax, which runs inside Claude Code with no file, process or network access.

LaTeX blocks are different. When a reply contains a ` ```tikz `, ` ```tikzcd ` or ` ```latex ` block, the mod compiles it with your own `latex` and `dvisvgm`. Claude writes those blocks, and Claude's replies can be shaped by whatever it reads: a web page, a file in your repository, an issue comment. So the mod treats every block as untrusted input.

## What protects you

| Risk | Protection |
| --- | --- |
| Running shell commands with `\write18` | `latex` runs with `-no-shell-escape` |
| Reading your files with `\input`, `\openin` or `\includegraphics` | On macOS, `sandbox-exec` denies reading your home folder apart from `~/.cache/claude-latex`, `~/Library/texlive`, `~/Library/texmf` and `~/texmf`, and denies `/Volumes`. On Linux, bubblewrap mounts an empty folder over your home and binds back only `~/.cache/claude-latex` and TeX's per-user trees (`~/texmf`, `~/.texlive`, `~/.texmf-var`, `~/.texmf-config`, read-only) |
| Writing files with `\openout` | The sandbox denies writes outside the mod's cache, TeX's own folders and the temp folders. On Linux the whole root is mounted read-only, with a private `/tmp`. `openout_any=p` also stops TeX writing outside the build folder |
| Sending data out | The sandbox denies all network access (on Linux, a network namespace with no interfaces) |
| A block that never finishes | Each compile is stopped after 60 seconds |
| A block that exhausts TeX's memory | TeX stops with a capacity error, shown on that block |
| A huge drawing | A drawing over the app's 128 KB limit shows an error on that block, and the rest of the message still renders |
| A formula that overflows MathJax | Errors and stack overflows are caught and the formula shows as red source |

The macOS profile is written to `~/.cache/claude-latex/sandbox.sb` when a session starts, so you can read exactly what it allows. The Linux command line is built by `bwrapArgv` in `hooks/sandbox.ts`. The mod uses whichever sandbox starts here, tried in that order, and `/latex setup` names it. Every compile runs in its own folder under `~/.cache/claude-latex/build/`, deleted afterwards.

TeX's own `openin_any=p` setting does not stop LaTeX reading a file by its absolute path. That is why the mod uses the macOS sandbox instead of relying on TeX's settings.

## Limits

- The sandbox runs on macOS and on Linux with bubblewrap installed (`apt install bubblewrap`, or your distribution's package). Windows is not supported for LaTeX blocks yet, and math does not need it. Some containers forbid the user namespaces bubblewrap needs: there it cannot start, and the setup check says so.
- The sandbox allows reading system folders such as `/etc` and `/usr`, which TeX needs to run. These do not hold your personal files.
- If no sandbox can run, LaTeX blocks compile without one and `/latex setup` says so. Choose the `mathjax` backend, or turn off **Compile LaTeX blocks** in `/latex`, if you do not want that.
- The mod itself runs with your permissions, like every Claude Code plugin. Read `hooks/register.tsx`, or run `claude plugin validate .` to list every call it makes.

## Tested attacks

These were run on macOS with TeX Live 2026, using the mod's own compile commands, environment and sandbox profile:

- `\input` of a canary file in the home folder: reported as not found.
- `\openout` to the home folder: refused.
- `\immediate\write18{touch ...}`: no file created.
- `\def\a{\a\a}\a`: TeX capacity error.
- 2,000 page breaks in one block: "Dimension too large" error.
- A 3,000 point plot (442 KB of SVG): stopped by the size guard.
- A recursive macro and 400 nested exponents in MathJax: red source.

The same attacks were run on Linux (Ubuntu, TeX Live 2023, bubblewrap 0.9) through `bwrapArgv` with the mod's compile commands and environment: the canary was not found by `\input` and not read by `\openin`; `\openout` to the home folder and to an absolute `/tmp` path were refused; `\write18` created nothing; a piped `\input{|curl ...}` was not run. XeLaTeX compiles, with `fontspec` and saved formats, ran in the same sandbox.

The Unicode conversion used in the terminal and the prompt box runs inside the mod, never a program. A macro that calls itself stops after 1000 expansions, groups nest at most 60 deep, and a formula over 20,000 characters is shown as written, so no reply or draft can stall it.

## Reporting a problem

Please report security problems privately through GitHub's **Report a vulnerability** button on this repository's Security tab, not in a public issue. Include the block that caused it, your macOS version and your TeX distribution.
