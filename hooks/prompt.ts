import type { PromptDecoration } from 'claude-code'
import { scan } from './parse'
import type { MarkdownStyle } from './style'
import { texToUnicode, type Macros } from './unicode'

// Paints the draft in the prompt box the way render-markdown.nvim paints a
// Markdown buffer while you edit it: the markers stay where you typed them,
// dimmed, and what they mark takes its style. Headings get their level's
// color on a band, list markers and checkboxes their colors, inline code a
// darker cell, and TeX the math color with a Unicode preview after it:
// typing `$\alpha^2$` shows ` → α²` beside it. Pure functions, no engine
// calls.

// A draft longer than this is left unpainted: every key would scan it.
const MAX_DRAFT_CHARS = 20_000
// The longest preview drawn after a formula.
const MAX_PREVIEW_CHARS = 120
const FENCE_RE = /^ {0,3}(```+|~~~+)/
// Bold, italic, strikethrough and links on one line. Code spans and math are
// read by `scan` first, so nothing here looks inside them.
const EMPHASIS_RE = /(\*\*\*|___)(?=\S)(.+?)(?<=\S)\1|(\*\*|__)(?=\S)(.+?)(?<=\S)\3|(?<![\w*])(\*|_)(?=[^\s*_])(.+?)(?<=[^\s*_])\5(?![\w*])|~~(?=\S)(.+?)(?<=\S)~~|\[([^\]\n]+)\]\(([^)\s]+)\)/g

export function promptDecorations(text: string, style: MarkdownStyle, macros?: Macros): PromptDecoration[] {
  if (!text || text.length > MAX_DRAFT_CHARS) return []
  const out: PromptDecoration[] = []
  const paint = (start: number, end: number, look: Omit<PromptDecoration, 'start' | 'end'>) => {
    if (end > start || look.virtualText) out.push({ start, end, ...look })
  }
  const marker = (start: number, end: number) => paint(start, end, { color: style.muted })

  // Lines first: fences, headings, lists, quotes, rules and tables. The
  // stretches outside fences are kept for the inline pass.
  const prose: { start: number; text: string }[] = []
  let fence: string | null = null
  let offset = 0
  let run: { start: number; text: string } | null = null
  for (const line of text.split('\n')) {
    const start = offset
    const end = start + line.length
    offset = end + 1
    const fenceMark = FENCE_RE.exec(line)
    if (fence !== null || fenceMark) {
      if (run) prose.push(run)
      run = null
      if (fence === null) fence = fenceMark![1]!
      else if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') fence = null
      // A code block sits on the code cell; its fences are dimmed.
      paint(start, end, fenceMark ? { color: style.muted, backgroundColor: style.code } : { backgroundColor: style.code })
      continue
    }
    if (run) run.text += `\n${line}`
    else run = { start, text: line }
    lineStyle(line, start, end, style, paint)
  }
  if (run) prose.push(run)

  // Then what sits inside a line: code spans, math and emphasis.
  for (const stretch of prose) {
    let at = stretch.start
    for (const segment of scan(stretch.text)) {
      if (segment.kind === 'text') {
        emphasis(segment.text, at, style, paint, marker)
        at += segment.text.length
        continue
      }
      const end = at + segment.raw.length
      if (segment.kind === 'code') {
        paint(at, end, { backgroundColor: style.code })
        const ticks = segment.raw.length - segment.text.length
        marker(at, at + ticks / 2)
        marker(end - ticks / 2, end)
      } else {
        paint(at, end, { color: style.math })
        const preview = texToUnicode(segment.tex, macros)
        if (preview && preview !== segment.tex.trim()) {
          const shown = [...preview].length > MAX_PREVIEW_CHARS ? `${[...preview].slice(0, MAX_PREVIEW_CHARS).join('')}…` : preview
          paint(end, end, { virtualText: ` → ${shown}`, color: style.math, italic: true })
        }
      }
      at = end
    }
  }
  return out
}

type Paint = (start: number, end: number, look: Omit<PromptDecoration, 'start' | 'end'>) => void

function lineStyle(line: string, start: number, end: number, style: MarkdownStyle, paint: Paint): void {
  const heading = /^( {0,3})(#{1,6})(\s+|$)/.exec(line)
  if (heading) {
    const level = heading[2]!.length
    const color = style.headings[level - 1]!
    paint(start, end, { color, backgroundColor: style.headingBackgrounds[level - 1], bold: true })
    paint(start + heading[1]!.length, start + heading[1]!.length + level, { color, dimColor: true })
    return
  }
  if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
    paint(start, end, { color: style.muted })
    return
  }
  const table = /^\s*\|/.test(line)
  if (table) {
    const isRule = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)
    if (isRule) paint(start, end, { color: style.table })
    else for (const m of line.matchAll(/(?<!\\)\|/g)) paint(start + m.index!, start + m.index! + 1, { color: style.table })
    return
  }
  let at = 0
  // Quotes, which may hold a list: > - item.
  for (let quote = /^(\s*>\s?)/.exec(line.slice(at)); quote; quote = /^(\s*>\s?)/.exec(line.slice(at))) {
    paint(start + at, start + at + quote[1]!.length, { color: style.quote, bold: true })
    at += quote[1]!.length
  }
  const list = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(line.slice(at))
  if (list) {
    const markStart = start + at + list[1]!.length
    paint(markStart, markStart + list[2]!.length, { color: style.bullet, bold: true })
    at += list[0].length
    const box = /^\[([ xX-])\]/.exec(line.slice(at))
    if (box) {
      paint(start + at, start + at + 3, { color: box[1] === ' ' ? style.unchecked : style.checked, bold: true })
    }
  }
}

function emphasis(text: string, offset: number, style: MarkdownStyle, paint: Paint, marker: (s: number, e: number) => void): void {
  for (const m of text.matchAll(EMPHASIS_RE)) {
    const start = offset + m.index!
    const end = start + m[0].length
    if (m[8] !== undefined) {
      // [text](url): the text as a link, the brackets and address dimmed.
      const textEnd = start + 1 + m[8].length
      marker(start, start + 1)
      paint(start + 1, textEnd, { color: style.link, underline: true })
      marker(textEnd, end)
      continue
    }
    const mark = m[1] ?? m[3] ?? m[5] ?? '~~'
    const look = m[1] ? { bold: true, italic: true } : m[3] ? { bold: true } : m[5] ? { italic: true } : { strikethrough: true }
    paint(start, end, look)
    marker(start, start + mark.length)
    marker(end - mark.length, end)
  }
}
