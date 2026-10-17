# Changelog

## 0.7.0

- A setup check, at the top of `/latex` and as text with `/latex setup`. It says which TeX the mod uses and where it is, which LaTeX packages the mod's documents load are missing (a minimal TeX Live lacks `standalone.cls`, and every block then failed), whether the sandbox is on, and how many macros were read, and gives the one command that installs what is missing. **Check again** re-runs it after an install, with no restart.
- The check configures the mod by itself: a LaTeX math font whose package is not installed falls back to MathJax with a note instead of failing every formula, and the welcome band says when diagrams cannot compile yet.
- A **Backend** setting: `auto`, `latex`, `xelatex` or `mathjax`. XeLaTeX lets blocks load system OpenType fonts with `fontspec`, with saved formats of its own. `mathjax` never runs a local TeX. A **TeX folder** setting points the mod at one folder instead of searching.
- Security: a LaTeX block could write anywhere in `~/.cache/claude-latex` through dvisvgm's PostScript specials, and so overwrite cached drawings and saved formats that later sessions load. dvisvgm now runs with `--no-specials=ps`, and each TeX run may write only its own folder; the rest of the cache is read-only to it. This was so on macOS too: clear `~/.cache/claude-latex` once after updating.
- LaTeX on Linux runs in a bubblewrap sandbox: empty folders over every home folder and `/mnt`, `/media`, `/run/user` and `/var/tmp`, with only the mod's cache, TeX's own trees and your fonts bound back read-only, a read-only root, a private `/tmp`, no network. The same attacks as on macOS were tried and blocked. The sandbox is chosen by starting the typesetter itself in it, through the real paths of a linked home folder, and the setup check says why when none can start.
- Saved formats are tied to the TeX that built them, so pointing the mod at another TeX builds new ones instead of disabling them. A font that becomes available after the workers started (an install, then Check again) is used, and each job compiles in the font its cache key names. XeLaTeX results are cached apart from LaTeX's.
- Macros from the settings: the **Macros file** path can be edited in `/latex`, **Create it with examples** writes a starter file, and **Reload macros** or `/latex reload` reads it again with no restart. Every formula, in every surface, reads the macros, and the terminal and prompt box use them too.
- The settings pane is grouped (Setup, Rendering, Macros, Terminal, Messages) and opens tall enough in a terminal to show every setting.

## 0.6.0

- Math renders in a terminal. Each formula becomes Unicode text in the math color: inline math in the line (`\alpha^2 + \frac{1}{2}` reads `α² + ½`), display math laid out over several rows, with stacked fractions, sums with their bounds above and below, matrices and cases in tall brackets and `align` rows lined up. Math alphabets (`\mathbb`, `\mathcal`, `\mathfrak`, `\bm`), accents, `\ce` and the macros file all apply. LaTeX blocks stay code. The **Math in the terminal** setting turns it off.
- The prompt box is painted as you type, the way render-markdown.nvim paints a Markdown buffer: headings on a colored band, list markers, checkboxes, quotes, emphasis, links and code, in Rosé Pine (Dawn on a light terminal). Each formula is colored and previewed as Unicode beside it. The **Style the prompt box** setting turns it off.
- In a terminal the model is told that math shows as Unicode there and that LaTeX blocks are not compiled.
- Your messages in a terminal follow the **Your messages** setting: `under` shows their math below the row, `rendered` draws the whole message.
- The settings pane test answers `config.set` with a plain value, as the engine now requires.
- A dollar inside a code span no longer closes a formula: `$5 and $10, and \`$HOME\`` was drawn as math, on the desktop too.
- The Unicode conversion is bounded: a macro that calls itself stops after 1000 expansions, groups nest at most 60 deep, and a formula over 20,000 characters is shown as written, so no formula can stall a render or a key press.
- Macros a formula defines itself apply within it, `\over`, `\choose` and `\atop` work, a one-line fraction gets brackets beside other terms (`(a/b)c`), and side-by-side stacked fractions and sums keep a gap.
- In a terminal, links keep their address, and a display formula wider than the window is drawn on one line instead of wrapping row by row.

## 0.5.0

- Your messages can render as Markdown with math, in a bubble. This is the experimental `rendered` value of the new **Your messages** setting. The app's own row stays under the bubble as a small pill, so the time, rewind and fork controls are kept. Your messages are now left as typed by default. `under` brings back the math under the app's bubble.
- The desktop app drops a drawing over about 250 KB and keeps showing an older one. The mod now measures its drawing, stops at 235 KB and hands the rest of the message to the app with a note.
- The parser reads a message left to right. This fixes `$a$$b$` swallowing the rest of a message, `$$` inside a code span drawn as math, a `$` inside `\text{}` splitting a formula, and an empty `$$ $$` turning prose into math.
- A table with math in its cells is laid out by the mod. Links, `_italic_`, `~~strikethrough~~` and `\$` work in a paragraph that has math.
- A display formula MathJax cannot draw, such as one with `\intertext`, is typeset by your TeX install.
- A macro defined in one formula no longer changes later formulas. Tags and labels start again for each formula.
- Array rules (`\hline`, the `|` in `{cc|c}`) and frames now draw. Their width was in a stylesheet that a standalone SVG does not have.
- Each MathJax SVG is about 40% smaller: glyph outlines are rewritten on a coarser grid in relative coordinates, and MathJax's page-only attributes are dropped. A page of about 75 formulas now fits in one reply.
- The model is told how math renders here: one section added to the system prompt, where the mod draws, with the syntax that renders and the size limits. The **Tell the model how math renders here** setting turns it off.
- A block that is compiling is no longer compiled again by a second and third worker.
- Punctuation stays on the same line as the formula it touches. Nested lists step in, a list with math in it is laid out as one list, and a list that reaches 10 no longer has its numbers clipped.
- Blank lines at the start and end of a block are dropped. A pasted `tikzcd` block that ended with one failed to compile.
- The debug log records every message drawn, its size, each compile and any reason the engine gives for refusing a drawing.
- Changes for the plugin directory. Math font, Math color and Your messages no longer list their choices in `plugin.json`, because the directory does not accept that yet. The `/latex` pane still offers the choices. The pane names each setting it changes in full. The MathJax bundle no longer contains `__proto__`, and every character outside ASCII in it is written as an escape. The README lists everything the mod runs, reads and writes.

## 0.4.0

- Your own messages keep the app's bubble, with its copy button. The math and diagrams from your message are drawn under it. A full rendered copy is an option, off by default.
- A one-time welcome note above the prompt, and a settings pane opened with `/latex`.
- Every `latex` and `dvisvgm` run goes through a macOS sandbox that blocks reading your home folder, writing elsewhere and the network.
- MathJax SVGs define each glyph once, so long formulas are about 70% smaller and fit the app's limit.
- Setup runs in the background after a session starts, one step at a time, and writes `~/.cache/claude-latex/debug/setup.log`.
- Messages are not force-redrawn while a reply streams. This fixes a reply that could stop drawing partway.
- More preamble-only commands (`\DeclareMathAlphabet`, `\newtheorem`, `\definecolor` and others) are moved out of block bodies.
- The Copy TeX button is a setting, off by default.
- Interrupted compiles are retried. A compile that runs past 60 seconds says it may loop forever.

## 0.3.0

- Ten LaTeX math fonts, typeset by your own TeX install, with MathJax shown until each formula is ready.
- ` ```latex ` blocks for any LaTeX snippet.
- mhchem and physics in MathJax, `\bm`, and unknown commands reported as errors.
- Saved LaTeX formats, which roughly halve compile time, and three compiles at once.
- Each compile runs in its own folder.
- Drawings over the app's 128 KB limit show an error on that block.

## 0.2.0

- TikZ and tikz-cd blocks, compiled with `latex` and `dvisvgm`.
- Inline math sits on the text's baseline.
- A macros file, light and dark settings, and math in your own messages.

## 0.1.0

- First release: MathJax renders `$...$` and `$$...$$` in Claude's replies in the desktop Code tab.
