import type { AgentRow, TmuxWindow, Vertical } from '../types'

// Pure presentation helpers for register.tsx: glyphs, colors and strings only,
// no elements, so they hold no `$` and need no atom.

// Single-width Unicode only; emoji have ambiguous width in terminals.
export const SEP = ' │ '

// Fill cells out of `cells`, at least one while anything is used.
export const bar = (pct: number, cells: number) => {
  const clamped = Math.max(0, Math.min(100, pct))
  const filled = clamped > 0 && cells > 0 ? Math.max(1, Math.round((clamped / 100) * cells)) : 0
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

// "45s", "1m23s", "1h02m": how long a turn has run or took.
export const fmtDuration = (ms: number) => {
  const secs = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0
    ? `${h}h${String(m).padStart(2, '0')}m`
    : m > 0
      ? `${m}m${String(secs % 60).padStart(2, '0')}s`
      : `${secs}s`
}

// `tmux list-windows -a -F '#{window_id} #{window_name}'` -> windows.
export const parseWindows = (out: string): TmuxWindow[] =>
  out
    .split('\n')
    .map(l => l.trimEnd())
    .filter(Boolean)
    .map(l => {
      const at = l.indexOf(' ')
      return { id: at < 0 ? l : l.slice(0, at), name: at < 0 ? '' : l.slice(at + 1) }
    })

// The window a resumed session lives in: its name ends with ·<first 8 chars of the id>.
export const windowOfSession = (windows: TmuxWindow[], id: string) =>
  windows.find(w => w.name.endsWith(`·${id.slice(0, 8)}`))

// A vertical's window: named by its slug, or by a resume (·<id8>).
export const windowOfVertical = (windows: TmuxWindow[], v: Pick<Vertical, 'id' | 'slug'>) =>
  windows.find(w => w.name === v.slug) ?? windowOfSession(windows, v.id)

type Tone = { glyph: string; color?: string; dim: boolean }

export const VERTICAL_GLYPHS: Record<Vertical['status'], Tone> = {
  active: { glyph: '●', color: 'green', dim: false },
  paused: { glyph: '◐', color: 'yellow', dim: false },
  done: { glyph: '✓', dim: true },
}
