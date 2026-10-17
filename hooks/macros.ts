// The macros file a first-time user gets from the settings pane: a few
// common definitions to keep or delete, and how the file is read.

export const MACROS_TEMPLATE = `% LaTeX macros for the Claude Code LaTeX mod.
%
% Every formula in Claude's replies can use what is defined here: MathJax on
% the desktop, your LaTeX for blocks and fonts, and the Unicode text in a
% terminal. Use \\newcommand, \\renewcommand and \\DeclareMathOperator, one
% per line. After editing, press "Reload macros" in /latex.

% Number sets
\\newcommand{\\N}{\\mathbb{N}}
\\newcommand{\\Z}{\\mathbb{Z}}
\\newcommand{\\Q}{\\mathbb{Q}}
\\newcommand{\\R}{\\mathbb{R}}
\\newcommand{\\C}{\\mathbb{C}}

% Probability
\\newcommand{\\E}{\\mathbb{E}}
\\DeclareMathOperator{\\Var}{Var}
\\DeclareMathOperator{\\Cov}{Cov}

% Optimization
\\DeclareMathOperator*{\\argmin}{arg\\,min}
\\DeclareMathOperator*{\\argmax}{arg\\,max}

% Delimiters with an argument: \\abs{x}, \\norm{x}
\\newcommand{\\abs}[1]{\\left\\lvert #1 \\right\\rvert}
\\newcommand{\\norm}[1]{\\left\\lVert #1 \\right\\rVert}
`

// How many definitions a macros file holds, for the settings pane.
export function countDefinitions(text: string): number {
  return (text.match(/^\s*\\(?:(?:re)?newcommand|providecommand|DeclareMathOperator|def)\b/gm) ?? []).length
}
