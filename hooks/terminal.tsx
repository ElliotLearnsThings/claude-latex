/** @jsx h */
import type { Elements, RenderChildren, RenderElement } from 'claude-code'
import { scan, type Line, type Piece, type Span } from './parse'
import { safeHref } from './draw'
import type { MarkdownStyle } from './style'
import { cellWidth } from './unicode'

// Draws a message for the terminal, which has no Svg. Math is Unicode text
// in the math color: inline formulas run in the line, display formulas are
// laid out over several rows and centered. Prose without math stays the
// app's own Markdown. No engine calls, so tests can draw the same tree.

type TerminalElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Markdown' | 'Link'>

export type TerminalContext = {
  el: TerminalElements
  style: MarkdownStyle
  // One line of Unicode for an inline formula.
  inline: (tex: string) => string
  // The rows of a display formula.
  display: (tex: string) => string[]
  // How wide the transcript is, in cells. A display formula wider than this
  // would wrap row by row and fall apart, so it is drawn on one line.
  columns: number
}

// render-markdown.nvim's bullets, one per level of nesting, in place of the
// ones the parser writes for the desktop.
const BULLET_ICONS: Record<string, string> = { '•': '●', '◦': '○', '▪': '◆' }
const QUOTE_ICON = '▋'

// Markdown that a Unicode formula could set off inside a table cell: a pipe
// ends the cell, and stars or underscores would turn into emphasis.
function forTableCell(text: string): string {
  return text.replace(/\|/g, '∣').replace(/([\\*_`[\]<>])/g, '\\$1')
}

export function drawTerminal(pieces: Piece[], ctx: TerminalContext): RenderElement {
  const { Box, Text, Markdown, Link } = ctx.el
  const { style } = ctx

  const drawSpan = (span: Span) => {
    if (span.kind === 'math') return <Text color={style.math}>{ctx.inline(span.tex)}</Text>
    if (span.code) return <Text backgroundColor={style.code}>{span.text}</Text>
    if (span.href) {
      // A link the terminal can open keeps its address; any other shows it.
      const href = safeHref(span.href)
      if (href) return <Link href={href} label={span.text} />
      return (
        <Text color={style.link} underline>
          {`${span.text} (${span.href})`}
        </Text>
      )
    }
    const look = { ...(span.bold ? { bold: true } : {}), ...(span.italic ? { italic: true } : {}), ...(span.strike ? { strikethrough: true } : {}) }
    return <Text {...look}>{span.text}</Text>
  }

  const drawPrefix = (line: Line) => {
    if (!line.prefix) return null
    const m = /^(\s*)(\S+)(\s*)$/.exec(line.prefix)
    if (!m) return <Text>{line.prefix}</Text>
    const [, indent = '', mark = '', gap = ''] = m
    if (line.quote) return <Text color={style.quote}>{`${indent}${QUOTE_ICON}${gap}`}</Text>
    return (
      <Text>
        {indent}
        <Text color={style.bullet} bold>
          {BULLET_ICONS[mark] ?? mark}
        </Text>
        {gap}
      </Text>
    )
  }

  const drawLine = (line: Line) => {
    if (line.heading) {
      const level = Math.min(6, Math.max(1, line.level ?? 1))
      return (
        <Text bold color={style.headings[level - 1]} backgroundColor={style.headingBackgrounds[level - 1]}>
          {`${'#'.repeat(level)} `}
          {line.spans.map(drawSpan)}
        </Text>
      )
    }
    return (
      <Text>
        {drawPrefix(line)}
        {line.spans.map(drawSpan)}
      </Text>
    )
  }

  // A table keeps the app's own Markdown table, its formulas turned to text.
  const tableMarkdown = (raw: string) =>
    scan(raw)
      .map(s => (s.kind === 'inline' || s.kind === 'display' ? forTableCell(ctx.inline(s.tex)) : s.kind === 'code' ? s.raw : s.text))
      .join('')

  const drawPiece = (p: Piece): RenderChildren => {
    if (p.kind === 'md') return <Markdown text={p.text} />
    if (p.kind === 'table') return <Markdown text={tableMarkdown(p.raw)} />
    if (p.kind === 'display') {
      const rows = ctx.display(p.tex)
      const fits = Math.max(...rows.map(cellWidth)) <= ctx.columns - 2
      // One Text, so the rows stay lined up as the block is centered. Rows
      // too wide would each wrap on their own: then the formula is one line,
      // which wraps as text does.
      return (
        <Box flexDirection="column" alignItems="center" marginTop={1} marginBottom={1}>
          <Text color={style.math}>{fits || rows.length === 1 ? rows.join('\n') : ctx.inline(p.tex)}</Text>
        </Box>
      )
    }
    // A LaTeX block cannot be drawn here: it stays a code block.
    if (p.kind === 'block') return <Markdown text={p.raw} />
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {p.lines.map(drawLine)}
      </Box>
    )
  }

  return <Box flexDirection="column">{pieces.map(drawPiece)}</Box>
}
