import type { AgentRow } from '../types'

// Pure presentation helpers for register.tsx: glyphs, colors and strings only,
// no elements, so they hold no `$` and need no atom.

// Single-width Unicode only; emoji have ambiguous width in terminals.
export const SEP = ' │ '

// Fill cells out of `cells`, at least one while anything is used.
export const bar = (pct: number, cells: number) => {
  const clamped = Math.max(0, Math.min(100, pct))
  const filled = clamped > 0 ? Math.max(1, Math.round((clamped / 100) * cells)) : 0
  return { on: '▰'.repeat(filled), off: '▱'.repeat(cells - filled) }
}

// Green until 80%, then yellow, red from 90%.
export const limitTone = (pct: number) => (pct >= 90 ? 'red' : pct >= 80 ? 'yellow' : 'green')

type Glyph = { glyph: string; color?: string; dim: boolean }

const GLYPHS: Record<string, Glyph> = {
  running: { glyph: '●', color: 'green', dim: false },
  pending: { glyph: '●', color: 'cyan', dim: false },
  waiting: { glyph: '●', color: 'cyan', dim: false },
  idle: { glyph: '◐', color: 'yellow', dim: false },
  completed: { glyph: '✓', dim: true },
  failed: { glyph: '✗', color: 'red', dim: false },
  killed: { glyph: '■', dim: true },
}

export const glyphFor = (status: string): Glyph => GLYPHS[status] ?? { glyph: '·', dim: true }

// Parents first; children get "├─ " / "└─ " connectors under a "│  " guide.
export const tree = (rows: AgentRow[]): { row: AgentRow; prefix: string }[] => {
  const ids = new Set(rows.map(r => r.id))
  const out: { row: AgentRow; prefix: string }[] = []
  const walk = (parent: string | undefined, guide: string) => {
    const kids = rows.filter(r =>
      parent === undefined ? !r.parentId || !ids.has(r.parentId) : r.parentId === parent,
    )
    kids.forEach((row, i) => {
      const isLast = i === kids.length - 1
      out.push({ row, prefix: parent === undefined ? '' : guide + (isLast ? '└─ ' : '├─ ') })
      walk(row.id, parent === undefined ? '' : guide + (isLast ? '   ' : '│  '))
    })
  }
  walk(undefined, '')
  return out
}

// PACA status category to pill color.
export const categoryTone = (category: string) =>
  category === 'inprogress' ? 'blue' : category === 'refinement' ? 'magenta' : category === 'todo' ? 'yellow' : undefined

// Context fill of the chat: green until 60%, yellow from 60, red from 80.
export const ctxTone = (pct: number) => (pct >= 80 ? 'red' : pct >= 60 ? 'yellow' : 'green')
