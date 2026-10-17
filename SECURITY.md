# Security

## What the mod runs

The mod draws math with MathJax, which runs inside Claude Code with no file, process or network access.

LaTeX blocks are different. When a reply contains a ` ```tikz `, ` ```tikzcd ` or ` ```latex ` block, the mod compiles it with your own `latex` and `dvisvgm`. Claude writes those blocks, and Claude's replies can be shaped by whatever it reads: a web page, a file in your repository, an issue comment. So the mod treats every block as untrusted input.

## What protects you

| Risk | Protection |
| --- | --- |
| Running shell commands with `\write18` | `latex` runs with `-no-shell-escape` |
| Reading your files with `\input`, `\openin` or `\includegraphics` | On macOS, `sandbox-exec` denies reading your home folder apart from `~/.cache/claude-latex`, `~/Library/texlive`, `~/Library/texmf`, `~/texmf` and `~/Library/Fonts`, and denies `/Volumes`. On Linux, bubblewrap mounts empty folders over every home folder (`/home`, `/root`, yours wherever it really is), `/mnt`, `/media`, `/run/media`, `/run/user` and `/var/tmp`, then binds back read-only only the mod's cache, TeX's per-user trees as `kpsewhich` names them (`TEXMFHOME`, `TEXMFCONFIG`, and `TEXMFROOT` for a TeX installed in your home folder) and your font folders |
| Writing files with `\openout` | A run may write only its own folder: a compile its build folder, a format build the formats folder, plus TeX's own var tree and the temp folders. The rest of the cache, which later sessions load, is read-only to every run. On Linux the whole root is mounted read-only, with a private `/tmp`. `openout_any=p` also stops TeX writing outside the build folder |
| Writing or reading files with PostScript in `\special{ps: ...}` | dvisvgm runs with `--no-specials=ps`, so a block's PostScript never runs. TikZ, pgfplots, colors and rotations draw through dvisvgm's own specials and are unaffected |
| Sending data out | The sandbox denies all network access (on Linux, a network namespace with no interfaces) |
| A block that never finishes | Each compile is stopped after 60 seconds |
| A block that exhausts TeX's memory | TeX stops with a capacity error, shown on that block |
| A huge drawing | A drawing over the app's 128 KB limit shows an error on that block, and the rest of the message still renders |
| A formula that overflows MathJax | Errors and stack overflows are caught and the formula shows as red source |

The macOS profile is written to `~/.cache/claude-latex/sandbox.sb` when a session starts, so you can read exactly what it allows; each run passes its writable folder as the profile's `WORKDIR` parameter. The Linux command line is built by `bwrapArgv` in `hooks/sandbox.ts`. The mod uses whichever sandbox can start the typesetter itself here, tried in that order, and `/latex setup` names it, or says why none could start. Every compile runs in its own folder under `~/.cache/claude-latex/build/`, deleted afterwards.

TeX's own `openin_any=p` setting does not stop every TeX build reading a file by its absolute path (TeX Live 2023 on Linux refused it; the macOS build tested did not), and it does nothing for dvisvgm. That is why the mod uses a sandbox instead of relying on TeX's settings.

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

The same attacks were run on Linux (Ubuntu, TeX Live 2023, bubblewrap 0.9) through `bwrapArgv` with the mod's compile commands and environment: the canary was not found by `\input` and not read by `\openin`; `\openout` to the home folder, to an absolute `/tmp` path and up into the cache were refused; `\write18` created nothing; a piped `\input{|curl ...}` was not run; a file under `/mnt` was not found. A `\special{ps: ...}` that writes a cached SVG or a saved format, or reads a file under `/mnt`, did nothing: dvisvgm skipped it, and with PostScript specials turned back on for the test the sandbox refused it. XeLaTeX compiles, with `fontspec` and saved formats, ran in the same sandbox.

Before 0.7.0 the macOS profile let every run write anywhere in `~/.cache/claude-latex`, and dvisvgm ran PostScript specials, so a block could overwrite a cached SVG or a saved format that later sessions load. Clear `~/.cache/claude-latex` once after updating if you want to be sure no earlier block did.

The Unicode conversion used in the terminal and the prompt box runs inside the mod, never a program. A macro that calls itself stops after 1000 expansions, groups nest at most 60 deep, and a formula over 20,000 characters is shown as written, so no reply or draft can stall it.

## Reporting a problem

Please report security problems privately through GitHub's **Report a vulnerability** button on this repository's Security tab, not in a public issue. Include the block that caused it, your macOS version and your TeX distribution.
