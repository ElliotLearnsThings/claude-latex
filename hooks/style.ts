// The colors the terminal and the prompt box draw Markdown and math in.
//
// They follow render-markdown.nvim (MeanderingProgrammer/render-markdown.nvim)
// as set up in github.com/ElliotLearnsThings/nvimconfig: its default look
// (a colored band behind each heading, colored list markers, checkboxes,
// quote bars and inline code on a darker cell) with the highlight groups of
// rose-pine, the first colorscheme in that config's rotation. Dark terminals
// get Rosé Pine (main), light ones Rosé Pine Dawn.

export type MarkdownStyle = {
  // RenderMarkdownH1 to H6: each heading level's text.
  headings: string[]
  // RenderMarkdownH1Bg to H6Bg: the band behind each level, the heading's
  // color at a fifth over the background, as rose-pine blends it.
  headingBackgrounds: string[]
  // RenderMarkdownMath: TeX, inline and display.
  math: string
  // RenderMarkdownCodeInline: the cell behind inline code and code blocks.
  code: string
  // RenderMarkdownBullet, RenderMarkdownChecked, RenderMarkdownUnchecked.
  bullet: string
  checked: string
  unchecked: string
  // RenderMarkdownQuote: the bar of a block quote.
  quote: string
  // RenderMarkdownLink: link text.
  link: string
  // RenderMarkdownDash, and the markers (#, **, `) left visible while typing.
  muted: string
  // RenderMarkdownTableHead: a table's pipes and its rule.
  table: string
}

type Palette = Record<'base' | 'overlay' | 'muted' | 'subtle' | 'text' | 'love' | 'gold' | 'rose' | 'pine' | 'foam' | 'iris', string>

const ROSE_PINE: Palette = {
  base: '#191724', overlay: '#26233a', muted: '#6e6a86', subtle: '#908caa', text: '#e0def4',
  love: '#eb6f92', gold: '#f6c177', rose: '#ebbcba', pine: '#31748f', foam: '#9ccfd8', iris: '#c4a7e7',
}
const ROSE_PINE_DAWN: Palette = {
  base: '#faf4ed', overlay: '#f2e9e1', muted: '#9893a5', subtle: '#797593', text: '#575279',
  love: '#b4637a', gold: '#ea9d34', rose: '#d7827e', pine: '#286983', foam: '#56949f', iris: '#907aa9',
}

// `color` laid over `under` at `alpha`, as Neovim's blend does.
export function blend(color: string, under: string, alpha: number): string {
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const a = rgb(color)
  const b = rgb(under)
  return `#${a.map((c, i) => Math.round(c * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`
}

function styleOf(p: Palette): MarkdownStyle {
  // rose-pine's heading groups: h1 iris, h2 foam, h3 rose, h4 gold, h5 pine,
  // h6 foam.
  const headings = [p.iris, p.foam, p.rose, p.gold, p.pine, p.foam]
  return {
    headings,
    headingBackgrounds: headings.map(color => blend(color, p.base, 0.2)),
    math: p.gold,
    code: p.overlay,
    bullet: p.rose,
    checked: p.foam,
    unchecked: p.muted,
    quote: p.subtle,
    link: p.iris,
    muted: p.muted,
    table: p.subtle,
  }
}

export const DARK_STYLE = styleOf(ROSE_PINE)
export const LIGHT_STYLE = styleOf(ROSE_PINE_DAWN)

// Whether the terminal says its background is light: COLORFGBG is
// "foreground;background" in the 16 ANSI colors, set by rxvt, Konsole,
// iTerm2 and others. 7 and 15 are white.
export function isLightTerminal(colorFgBg: string | undefined): boolean {
  const background = colorFgBg?.split(';').pop()
  return background === '7' || background === '15'
}
