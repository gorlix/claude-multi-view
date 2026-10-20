import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, RenderChildren, SessionRateLimit } from 'claude-code'

import type { AgentRow, InboxItem, Limit, PacaTask, Prefs, SavedSession, Tab, TabStyle } from '../types'
import {
  activeKey,
  isShownTask,
  linkProject,
  noteUpdate,
  pollTasks,
  refreshTasks,
  resolveProject,
} from './paca'
import { SEP, bar, categoryTone, ctxTone, glyphFor, limitTone, tree } from './ui'

// Multi-view: one pane with the session's agents (press one to view its
// transcript), a band above the prompt saying which chat this is and how many
// agents run, an inbox for messages from other sessions, and a toast when an
// agent finishes. The 5h and weekly limits lead the band, with a toast
// when one crosses 80% and 90%. A "Sessioni" button lists the workspace's
// saved sessions (~/.claude/projects/<cwd>/*.jsonl); pressing one resumes it
// in a new tmux window, since a mod cannot switch this process's session.
// PACA: the task this chat moved to In Progress sits in the band, the
// workspace project's open tasks in the pane, status changes toast. Vertical chats' own pane stays in chat-verticali (later).

const PANE = 'agenti'
const POLL_MS = 2000
const INBOX_MAX = 20
const DONE = new Set(['completed', 'failed', 'killed', 'idle'])
const ACTIVE = new Set(['pending', 'running', 'waiting'])

const agents = atom({ plugin: 'multi-view', key: 'agents' } as const, [])
const inbox = atom({ plugin: 'multi-view', key: 'inbox' } as const, [])
const chat = atom({ plugin: 'multi-view', key: 'chat' } as const, '')
const limits = atom({ plugin: 'multi-view', key: 'limits' } as const, [])
// Refreshed once a minute so the "resets in" countdown moves.
const now = atom({ plugin: 'multi-view', key: 'now' } as const, 0)
// Pressing a reset time switches every limit between time left and clock time.
const resetClock = atom({ plugin: 'multi-view', key: 'resetClock' } as const, false)

// Menu choices, saved in the plugin store under one global key.
const PREFS_KEY = 'prefs'
const DEFAULT_PREFS: Prefs = {
  tab: 'all',
  tabStyle: 'both',
  bandLimits: true,
  bandCtx: true,
  bandChat: true,
  bandPaca: true,
  bandAgents: true,
  bandInbox: true,
  paneLimits: true,
  paneAgents: true,
  panePaca: true,
  paneSessions: true,
  paneInbox: true,
  openPaneAtStart: true,
}
// The on/off choices, as opposed to tab and tabStyle.
type Switch = keyof Omit<Prefs, 'tab' | 'tabStyle'>

// Tab labels, single-width glyphs only (emoji have ambiguous width).
const TAB_LOOK: Record<Tab | 'settings', [string, string]> = {
  all: ['☰', 'Tutto'],
  limits: ['▰', 'Limiti'],
  agents: ['●', 'Agenti'],
  sessions: ['↺', 'Sessioni'],
  paca: ['◆', 'PACA'],
  inbox: ['✉', 'Messaggi'],
  settings: ['⚙', 'Impostazioni'],
}
const TAB_STYLES: [TabStyle, string][] = [
  ['both', 'icona + nome'],
  ['icon', 'solo icona'],
  ['name', 'solo nome'],
]

const tabLabel = (name: Tab | 'settings', style: TabStyle, count?: number) => {
  const [icon, word] = TAB_LOOK[name]
  const base = style === 'icon' ? icon : style === 'name' ? word : `${icon} ${word}`
  return count ? `${base} ${count}` : base
}

const prefs = atom({ plugin: 'multi-view', key: 'prefs' } as const, DEFAULT_PREFS)
// Not saved: the settings line under the band starts closed.
const showMenu = atom({ plugin: 'multi-view', key: 'showMenu' } as const, false)
// Same for the pane's settings section under the tab bar.
const showPaneMenu = atom({ plugin: 'multi-view', key: 'showPaneMenu' } as const, false)
// Arrival time of the inbox message opened in full, if any.
const openMsg = atom({ plugin: 'multi-view', key: 'openMsg' } as const, null)

const sessions = atom({ plugin: 'multi-view', key: 'sessions' } as const, [])
const showSessions = atom({ plugin: 'multi-view', key: 'showSessions' } as const, false)
const SESSIONS_SHOWN = 12
const pacaProject = atom({ plugin: 'multi-view', key: 'pacaProject' } as const, null)
const pacaTasks = atom({ plugin: 'multi-view', key: 'pacaTasks' } as const, [])
const pacaActive = atom({ plugin: 'multi-view', key: 'pacaActive' } as const, null)
const pacaBacklog = atom({ plugin: 'multi-view', key: 'pacaBacklog' } as const, 0)
const ctx = atom({ plugin: 'multi-view', key: 'ctx' } as const, null)
const showPaca = atom({ plugin: 'multi-view', key: 'showPaca' } as const, false)
const PACA_POLL_MS = 180_000
const PACA_SHOWN = 10

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: 'sett' }
const THRESHOLDS = [90, 80]
// Band narrower than this drops its bars and keeps the numbers.
const BAND_NARROW = 120

const toRow = (a: AgentInfo): AgentRow => ({
  id: a.id,
  label: a.name ?? a.description ?? a.type,
  type: a.type,
  status: a.status,
  parentId: a.parentId,
})

const sameRows = (a: AgentRow[], b: AgentRow[]) =>
  a.length === b.length &&
  a.every((r, i) => r.id === b[i]?.id && r.status === b[i]?.status && r.label === b[i]?.label)

const counts = (rows: AgentRow[]) => ({
  run: rows.filter(r => ACTIVE.has(r.status)).length,
  idle: rows.filter(r => r.status === 'idle').length,
})

// "2h10m", "3g4h": time left until the window resets.
const until = (resetsAt: string | undefined, at: number) => {
  if (!resetsAt || !at) return ''
  const mins = Math.max(0, Math.round((Date.parse(resetsAt) - at) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return d > 0 ? `${d}g${h}h` : h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}

const DAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']

// "18:40" today, "lun 18:40" on another day: local time the window resets.
const hhmm = (ms: number) => {
  const when = new Date(ms)
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
}

// A peer message from another Claude Code session arrives wrapped as
// <cross-session-message from="…" from-name="…">body</cross-session-message>:
// the sender is its from-name and the body is the message.
const unwrap = (text: string) => {
  const m = /^\s*<cross-session-message\b([^>]*)>\s*([\s\S]*?)\s*<\/cross-session-message>\s*$/.exec(text)
  if (!m) return { text }
  return { name: /\bfrom-name="([^"]*)"/.exec(m[1] ?? '')?.[1], text: m[2] ?? '' }
}

// A message's title: its first line without markdown marks, cut at the
// first sentence end, so a long one-line message still reads as a title.
const msgTitle = (text: string) => {
  const first = text.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  const line = first.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '')
  const stop = line.search(/[.:;!?](\s|$)/)
  return stop > 0 ? line.slice(0, stop) : line
}

const clockAt = (resetsAt: string | undefined, at: number) => {
  if (!resetsAt || !at) return ''
  const when = new Date(Date.parse(resetsAt))
  const hm = hhmm(when.getTime())
  return when.toDateString() === new Date(at).toDateString() ? hm : `${DAYS[when.getDay()]} ${hm}`
}

const toggleResetClock = ($: EngineInterface) => void update($, resetClock, isClock => !isClock)

async function setPrefs($: EngineInterface, patch: Partial<Prefs>) {
  const next = { ...(await read($, prefs)), ...patch }
  await update($, prefs, () => next)
  await $.store.set(PREFS_KEY, next).catch(() => $.ui.toast('Impostazioni non salvate'))
}

async function loadPrefs($: EngineInterface) {
  const saved = await $.store.get(PREFS_KEY).catch(() => undefined)
  if (saved && typeof saved === 'object') await update($, prefs, () => ({ ...DEFAULT_PREFS, ...(saved as Partial<Prefs>) }))
}

const toggleMenu = ($: EngineInterface, isOpen?: boolean) =>
  void update($, showMenu, was => isOpen ?? !was)

const togglePaneMenu = ($: EngineInterface) => void update($, showPaneMenu, was => !was)

// "5m fa", "3h fa", "2g fa".
const ago = (mtime: number, at: number) => {
  if (!at) return ''
  const mins = Math.max(0, Math.round((at - mtime) / 60000))
  return mins < 60 ? `${mins}m fa` : mins < 1440 ? `${Math.round(mins / 60)}h fa` : `${Math.round(mins / 1440)}g fa`
}

const short = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

// Last status seen per agent, to toast on the move from active to done.
let last = new Map<string, string>()

async function poll($: EngineInterface) {
  const rows = (await $.agent.list()).map(toRow)
  for (const row of rows) {
    const before = last.get(row.id)
    if (before && ACTIVE.has(before) && DONE.has(row.status)) {
      $.ui.toast(`Agente ${row.status}: ${short(row.label, 40)}`)
    }
  }
  last = new Map(rows.map(r => [r.id, r.status]))
  if (!sameRows(await read($, agents), rows)) {
    await update($, agents, () => rows)
  }
}

// Highest threshold already toasted per window; reset when the window does.
let warned = new Map<string, number>()

async function setLimits($: EngineInterface, raw: readonly SessionRateLimit[]) {
  const list: Limit[] = raw
    .filter(l => l.kind in LIMIT_NAMES)
    .map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
  for (const l of list) {
    const before = warned.get(l.kind) ?? 0
    const hit = THRESHOLDS.find(t => l.percentUsed >= t) ?? 0
    if (hit > before) {
      $.ui.toast(`Limite ${LIMIT_NAMES[l.kind]} al ${l.percentUsed}%`)
    }
    warned.set(l.kind, hit)
  }
  await update($, limits, () => list)
}

const setCtx = ($: EngineInterface, percent: number | undefined) =>
  update($, ctx, () => (percent === undefined ? null : Math.round(percent)))

// The project folder Claude Code keeps this workspace's transcripts in.
async function projectDir($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  return `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}`
}

async function loadSessions($: EngineInterface) {
  const script = `${$.plugin.root}/hooks/list_sessions.py`
  const prefix = (await read($, pacaProject))?.prefix
  const run = await $.process.run([
    'python3',
    '-I',
    script,
    await projectDir($),
    await $.session.id(),
    ...(prefix ? ['--prefix', prefix] : []),
  ])
  if (run.exitCode !== 0) {
    $.ui.toast('Sessioni non leggibili: vedi /agenti')
    return
  }
  const list = JSON.parse(run.stdout) as SavedSession[]
  await update($, sessions, () => list)
}

async function toggleSessions($: EngineInterface) {
  const isShown = !(await read($, showSessions))
  await update($, showSessions, () => isShown)
  if (isShown) {
    const at = await $.clock.now()
    await update($, now, () => at)
    await loadSessions($).catch(() => $.ui.toast('Sessioni non leggibili'))
    await $.ui.open({ id: PANE, title: 'Agenti' })
  }
}

async function resumeSession($: EngineInterface, row: SavedSession) {
  const command = `claude --resume ${row.id}`
  if (!(await $.env.get('TMUX'))) {
    await $.ui.copy({ text: command })
    $.ui.toast(`Fuori da tmux: copiato "${command}"`)
    return
  }
  // The window name ends in the first 8 chars of the id: that is how an
  // already running resume is found again.
  const tag = `·${row.id.slice(0, 8)}`
  const windows = await $.process.run(['tmux', 'list-windows', '-a', '-F', '#{window_id} #{window_name}'])
  const open = windows.exitCode === 0 ? windows.stdout.split('\n').find(l => l.trimEnd().endsWith(tag)) : undefined
  const windowId = open?.split(' ')[0]
  if (windowId) {
    await $.process.run(['tmux', 'select-window', '-t', windowId])
    $.ui.toast('Già aperta: salto alla finestra')
    return
  }
  const cwd = await $.session.cwd()
  const run = await $.process.run(['tmux', 'new-window', '-c', cwd, '-n', `${short(row.title, 24)}${tag}`, 'claude', '--resume', row.id])
  $.ui.toast(run.exitCode === 0 ? `Ripresa in tmux: ${short(row.title, 40)}` : `tmux: ${run.stderr.trim()}`)
}

async function startPaca($: EngineInterface) {
  const project = await resolveProject($)
  await update($, pacaProject, () => project)
  if (!project) return
  const saved = await $.store.get(activeKey(await $.session.id()))
  if (saved && typeof saved === 'object') await update($, pacaActive, () => saved as PacaTask)
  await pollTasks($, PACA_POLL_MS)
}

async function togglePaca($: EngineInterface) {
  const isShown = !(await read($, showPaca))
  await update($, showPaca, () => isShown)
  if (isShown) {
    await refreshTasks($, false).catch(() => $.ui.toast('PACA non raggiungibile'))
    await $.ui.open({ id: PANE, title: 'Agenti' })
  }
}

// The tmux window shows the session's title instead of "claude". Only a
// window this mod may name is renamed: one tmux still auto-renames, one the
// mod opened for a resume (name ends with ·<id8>), or one it named before.
// A window named on purpose (chat-verticali's slug) keeps its name.
let tmuxNamed: string | undefined

async function syncTmuxTitle($: EngineInterface, isForced = false) {
  const pane = await $.env.get('TMUX_PANE')
  if (!pane) return
  const id = await $.session.id()
  const script = `${$.plugin.root}/hooks/session_title.py`
  const titled = await $.process.run(['python3', '-I', script, `${await projectDir($)}/${id}.jsonl`])
  const title = titled.stdout.trim()
  if (titled.exitCode !== 0 || !title) return
  const tmux = (...args: string[]) => $.process.run(['tmux', ...args])
  const current = (await tmux('display-message', '-p', '-t', pane, '#{window_name}')).stdout.trim()
  const auto = (await tmux('show-window-options', '-t', pane, '-v', 'automatic-rename')).stdout.trim()
  const suffix = `·${id.slice(0, 8)}`
  const hasSuffix = current.endsWith(suffix)
  const wanted = `${short(title, 30)}${hasSuffix ? suffix : ''}`
  if (current === wanted) return
  const isOurs = isForced || auto !== 'off' || hasSuffix || current === tmuxNamed
  if (!isOurs) return
  await tmux('rename-window', '-t', pane, wanted)
  tmuxNamed = wanted
}

export const register: Register = on => {
  on('turn.complete', ($, e, next) => {
    void syncTmuxTitle($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'titolo-finestra' }, async $ => {
    await syncTmuxTitle($, true)

    return { text: (await $.env.get('TMUX_PANE')) ? 'Finestra tmux rinominata col titolo della chat.' : 'Non sei in tmux.' }
  })

  on('session.start', async ($, e, next) => {
    void syncTmuxTitle($).catch(() => undefined)
    const cwd = await $.session.cwd()
    await update($, chat, () => cwd.split('/').filter(Boolean).pop() ?? cwd)
    await loadPrefs($)
    // Each command on its own: a name taken (a skill `paca` exists) must not
    // stop the others from registering.
    const command = (name: string, description: string) =>
      $.command.register({ name, description }).catch(() => $.ui.toast(`multi-view: /${name} non registrato`))
    await command('agenti', 'Apre il pannello con agenti e messaggi in arrivo')
    await command('sessioni', 'Mostra le sessioni salvate di questo workspace, da riprendere in tmux')
    await command('paca-tasks', 'Mostra i task aperti del progetto PACA di questo workspace')
    await command('paca-link', 'Collega il workspace a un progetto PACA: /paca-link <PREFISSO> [server MCP] | auto | off')
    await command('titolo-finestra', 'Rinomina la finestra tmux con il titolo di questa chat')
    await command('multiview', 'Apre il menù della banda di multi-view (le impostazioni del pannello sono nel ⚙ del pannello)')
    await command('inbox-clear', 'Svuota i messaggi arrivati da altre sessioni')
    $.clock.every(POLL_MS, () => void poll($))
    await update($, now, () => 0)
    void $.clock.now().then(at => update($, now, () => at))
    $.clock.every(60_000, () => void $.clock.now().then(at => update($, now, () => at)))
    void startPaca($).catch(() => undefined)
    $.clock.every(PACA_POLL_MS, () => void pollTasks($, PACA_POLL_MS).catch(() => undefined))
    void $.session
      .usage()
      .then(async u => {
        await setCtx($, u.context.percent)
        await setLimits($, u.rateLimits)
      })
      .catch(() => undefined)
    if ((await read($, prefs)).openPaneAtStart) void $.ui.open({ id: PANE, title: 'Agenti' })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await setCtx($, e.context.percent).catch(() => undefined)
    }
    if (e.changed.includes('rateLimits')) {
      await setLimits($, e.rateLimits).catch(() => undefined)
    }

    return next(e)
  })

  on('command.run', { command: 'agenti' }, async $ => {
    await poll($)
    await $.ui.open({ id: PANE, title: 'Agenti' })

    return { text: 'Pannello agenti aperto.' }
  })

  on('command.run', { command: 'multiview' }, async $ => {
    toggleMenu($, true)

    return { text: 'Menù della banda aperto sotto la banda (⋯). Le impostazioni del pannello sono nel ⚙ in fondo alla barra delle schede.' }
  })

  on('command.run', { command: 'sessioni' }, async $ => {
    await update($, showSessions, () => false)
    await toggleSessions($)

    return { text: 'Sessioni del workspace nel pannello Agenti.' }
  })

  on('command.run', { command: 'paca-tasks' }, async $ => {
    if (!(await read($, pacaProject))) {
      await startPaca($).catch(() => undefined)
    }
    const project = await read($, pacaProject)
    if (!project) {
      return { text: 'Nessun progetto PACA per questo workspace. Collegalo con /paca-link <PREFISSO>.' }
    }
    await update($, showPaca, () => false)
    await togglePaca($)

    return { text: `Task PACA di ${project.name} nel pannello Agenti.` }
  })

  on('command.run', { command: 'paca-link' }, async ($, e) => {
    const arg = e.args.trim()
    if (!arg) return { text: 'Uso: /paca-link <PREFISSO> [server MCP] | auto | off' }
    const [prefix = '', server] = arg.split(/\s+/)
    if (prefix === 'auto') {
      await $.store.delete(`paca-link:${await $.session.cwd()}`)
    } else {
      await linkProject($, prefix === 'off' ? 'off' : prefix.toUpperCase(), server)
    }
    await update($, pacaTasks, () => [])
    await startPaca($).catch(() => undefined)
    const project = await read($, pacaProject)

    return {
      text: project
        ? `Workspace collegato a ${project.name} (${project.prefix}) via ${project.server}.`
        : 'Nessun progetto PACA trovato: controlla prefisso e server MCP (es. /paca-link HOME paca-homelab).',
    }
  })

  // Any PACA server: `paca`, or a per-repo one such as `paca-homelab`.
  on('tool.call', { tool: /^mcp__paca(-[\w-]+)?__update_task$/ }, async ($, e, next) => {
    const ran = await next(e)
    const input = e as { taskId?: string; statusId?: string }
    if (!ran.isError && input.taskId && input.statusId) {
      await noteUpdate($, input.taskId, PACA_POLL_MS).catch(() => undefined)
    }

    return ran
  })

  on('command.run', { command: 'inbox-clear' }, async $ => {
    await update($, inbox, () => [])

    return { text: 'Inbox svuotata.' }
  })

  on('session.receive', { origin: { kind: 'peer' } }, async ($, e, next) => {
    // Recording is best effort: the delivery always goes on to the model.
    const origin = e.origin
    const body = unwrap(e.text)
    const from =
      ('teammate' in origin ? origin.teammate : undefined) ??
      ('plugin' in origin ? origin.plugin : undefined) ??
      body.name ??
      'altra sessione'
    const record = async () => {
      const item: InboxItem = { at: await $.clock.now(), from, text: body.text }
      await update($, inbox, list => [...list, item].slice(-INBOX_MAX))
      $.ui.toast(`Messaggio da ${short(from, 30)}`)
    }
    await record().catch(() => undefined)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = await read($, agents)
    const msgs = await read($, inbox)
    const { run, idle } = counts(rows)
    const viewed = e.props.view?.agentId
    const viewedRow = viewed ? rows.find(r => r.id === viewed) : undefined
    const lims = await read($, limits)
    const at = await read($, now)
    const isClock = await read($, resetClock)
    const active = await read($, pacaActive)
    const ctxPct = await read($, ctx)
    const pref = await read($, prefs)
    const menuOpen = await read($, showMenu)

    // Under BAND_NARROW columns the bars go and only numbers stay. Segments
    // never shrink: one that does not fit moves whole to the next line.
    const isNarrow = (e.viewport?.columns ?? Infinity) < BAND_NARROW
    const cells = isNarrow ? 0 : 8
    const dim = <Text dimColor>{SEP}</Text>

    // Visible segments, joined by one separator each: a hidden one leaves no
    // leading or doubled separator.
    const segments: [string, RenderChildren][] = []
    if (pref.bandLimits) {
      for (const l of lims) {
        const b = bar(l.percentUsed, cells)
        const tone = limitTone(l.percentUsed)
        const left = isClock ? clockAt(l.resetsAt, at) : until(l.resetsAt, at)
        segments.push([
          `lim-${l.kind}`,
          <Box>
            <Text dimColor>{LIMIT_NAMES[l.kind]} </Text>
            <Text color={tone}>{b.on}</Text>
            <Text dimColor>{b.off}</Text>
            <Text color={tone}>{cells ? ' ' : ''}{l.percentUsed}%</Text>
            {left && <Text> </Text>}
            {left && <Button key={`reset-${l.kind}`} label={left} onPress={() => toggleResetClock($)} />}
          </Box>,
        ])
      }
    }
    if (pref.bandCtx && ctxPct !== null) {
      segments.push([
        'ctx',
        <Box>
          <Text dimColor>ctx </Text>
          <Text color={ctxTone(ctxPct)}>{bar(ctxPct, cells).on}</Text>
          <Text dimColor>{bar(ctxPct, cells).off}</Text>
          <Text color={ctxTone(ctxPct)}>{cells ? ' ' : ''}{ctxPct}%</Text>
        </Box>,
      ])
    }
    if (pref.bandChat) {
      segments.push(['chat', <Text dimColor>chat: {await read($, chat)}</Text>])
    }
    if (pref.bandPaca && active) {
      segments.push([
        'paca',
        <Box>
          <Text inverse color="blue">
            {' '}
            {active.ref}{' '}
          </Text>
          <Text color="blue"> {active.status}: {short(active.title, 40)}</Text>
        </Box>,
      ])
    }
    if (pref.bandAgents && rows.length > 0) {
      segments.push([
        'agents',
        <Box>
          <Text color="green">● {run}</Text>
          <Text color="yellow"> ◐ {idle}</Text>
          <Text dimColor> / {rows.length}</Text>
        </Box>,
      ])
    }
    if (pref.bandInbox && msgs.length > 0) {
      segments.push(['inbox', <Text color="yellow">✉ {msgs.length}</Text>])
    }

    const row = (
      <Box flexWrap="wrap">
        {segments.map(([key, node], i) => (
          <Box key={`seg-${key}`} flexShrink={0}>
            {i > 0 && dim}
            {node}
          </Box>
        ))}
        {viewed && (
          <Text color="cyan"> │ vista: {short(viewedRow?.label ?? viewed, 30)} </Text>
        )}
        {viewed && (
          <Button key="back" label="Torna" onPress={() => void $.ui.view({})} />
        )}
        <Box flexShrink={0}>
          {(segments.length > 0 || viewed) && dim}
          <Button key="menu" label="⋯" onPress={() => toggleMenu($)} />
        </Box>
      </Box>
    )
    if (!menuOpen) return row

    // One toggle per saved choice: ☑ on, ☐ off. PACA only once the
    // workspace has a project, as in the pane's menu.
    const hasPaca = (await read($, pacaProject)) !== null
    const toggles: [Switch, string][] = [
      ['bandLimits', 'limiti'],
      ['bandCtx', 'ctx'],
      ['bandChat', 'chat'],
      ...(hasPaca ? [['bandPaca', 'task PACA'] as [Switch, string]] : []),
      ['bandAgents', 'agenti'],
      ['bandInbox', 'messaggi'],
    ]

    return (
      <Box flexDirection="column">
        {row}
        <Box flexWrap="wrap">
          {toggles.map(([name, label]) => (
            <Box key={`pref-box-${name}`} flexShrink={0}>
              <Button
                key={`pref-${name}`}
                label={`${pref[name] ? '☑' : '☐'} ${label}`}
                onPress={() => void setPrefs($, { [name]: !pref[name] })}
              />
              <Text dimColor>{' │ '}</Text>
            </Box>
          ))}
          <Button key="menu-close" label="chiudi" onPress={() => toggleMenu($, false)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = await read($, agents)
    const msgs = await read($, inbox)
    const viewed = e.props.view?.agentId
    const width = Math.max(16, (e.viewport?.columns ?? 40) - 18)
    const barCells = Math.max(8, Math.min(24, (e.viewport?.columns ?? 40) - 26))
    const lims = await read($, limits)
    const at = await read($, now)
    const isClock = await read($, resetClock)
    const project = await read($, pacaProject)
    const backlog = await read($, pacaBacklog)
    const openTasks = (await read($, pacaTasks)).filter(isShownTask)
    const sessionsOpen = await read($, showSessions)
    const pacaOpen = await read($, showPaca)
    const active = await read($, pacaActive)
    const pref = await read($, prefs)
    // Only tabs whose section exists; a vanished one falls back to all.
    const paneMenuOpen = await read($, showPaneMenu)
    const hasLimits = lims.length > 0 && pref.paneLimits
    const hasAgents = pref.paneAgents
    const hasSessions = pref.paneSessions
    const hasPaca = !!project && pref.panePaca
    // The inbox stays even when empty, so it is clear where messages land.
    const hasInbox = pref.paneInbox
    const opened = await read($, openMsg)
    const style = pref.tabStyle
    const tabs: [Tab, string, string][] = (
      [
        ['all', true, undefined],
        ['limits', hasLimits, undefined],
        ['agents', hasAgents, rows.length],
        ['sessions', hasSessions, undefined],
        ['paca', hasPaca, openTasks.length],
        ['inbox', hasInbox, msgs.length],
      ] as [Tab, boolean, number | undefined][]
    )
      .filter(([, isOn]) => isOn)
      .map(([name, , count]) => [name, `tab-${name}`, tabLabel(name, style, count)])
    // One toggle per pane choice, each controlling only the pane.
    const paneToggles: [Switch, string][] = [
      ['paneLimits', 'limiti'],
      ['paneAgents', 'agenti'],
      ['paneSessions', 'sessioni'],
      ...(project ? [['panePaca', 'PACA'] as [Switch, string]] : []),
      ['paneInbox', 'messaggi'],
      ['openPaneAtStart', "pannello all'avvio"],
    ]
    const tab: Tab = tabs.some(t => t[0] === pref.tab) ? pref.tab : 'all'
    const isShown = (name: Tab) => tab === 'all' || tab === name
    // A rounded section with its title as the first line.
    const section = (title: string, tone: string | undefined, body: RenderChildren) => (
      <Box key={`sec-${title}`} flexDirection="column" borderStyle="round" borderColor={tone ?? 'gray'} paddingX={1}>
        <Text bold color={tone}>
          {title}
        </Text>
        {body}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexWrap="wrap">
          {tabs.map(([name, key, label]) => (
            <Box key={`${key}-box`}>
              <Button key={key} label={`${tab === name ? '▸ ' : ''}${label}`} onPress={() => void setPrefs($, { tab: name })} />
              <Text> </Text>
            </Box>
          ))}
          <Button key="pane-menu" label={tabLabel('settings', style)} onPress={() => togglePaneMenu($)} />
        </Box>
        {paneMenuOpen &&
          section(
            'Impostazioni',
            undefined,
            <Box flexDirection="column">
              {paneToggles.map(([name, label]) => (
                <Button
                  key={`pref-${name}`}
                  label={`${pref[name] ? '☑' : '☐'} ${label}`}
                  onPress={() => void setPrefs($, { [name]: !pref[name] })}
                />
              ))}
              <Box flexWrap="wrap">
                <Text dimColor>schede: </Text>
                {TAB_STYLES.map(([value, label]) => (
                  <Box key={`tabStyle-box-${value}`} flexShrink={0}>
                    <Button
                      key={`tabStyle-${value}`}
                      label={`${style === value ? '◉' : '○'} ${label}`}
                      onPress={() => void setPrefs($, { tabStyle: value })}
                    />
                    <Text> </Text>
                  </Box>
                ))}
              </Box>
              <Button key="pane-menu-close" label="chiudi" onPress={() => void update($, showPaneMenu, () => false)} />
            </Box>,
          )}
        {hasLimits &&
          isShown('limits') &&
          section(
            'Limiti',
            undefined,
            lims.map(l => {
              const b = bar(l.percentUsed, barCells)
              const tone = limitTone(l.percentUsed)
              const left = isClock ? clockAt(l.resetsAt, at) : until(l.resetsAt, at)
              const label = isClock ? `reset ${left.includes(' ') ? '' : 'alle '}${left}` : `reset tra ${left}`
              return (
                <Box key={`lim-${l.kind}`} flexDirection="column">
                  <Box>
                    <Text bold>{LIMIT_NAMES[l.kind]?.padEnd(5)}</Text>
                    <Text color={tone}>{b.on}</Text>
                    <Text dimColor>{b.off}</Text>
                    <Text color={tone}> {l.percentUsed}%</Text>
                  </Box>
                  {left && (
                    <Box>
                      <Text>{'     '}</Text>
                      <Button key={`reset-${l.kind}`} label={label} onPress={() => toggleResetClock($)} />
                    </Box>
                  )}
                </Box>
              )
            }),
          )}
        {hasAgents &&
          isShown('agents') &&
          section(
          'Agenti',
          'green',
          <Box flexDirection="column">
            <Button
              key="main"
              label={viewed ? 'Conversazione principale' : '▸ Conversazione principale'}
              onPress={() => void $.ui.view({})}
            />
            {rows.length === 0 && <Text dimColor>Nessun agente in questa sessione.</Text>}
            {tree(rows).map(({ row, prefix }) => {
              const g = glyphFor(row.status)
              return (
                <Box key={row.id}>
                  <Text dimColor>{prefix}</Text>
                  <Text color={g.color} dimColor={g.dim}>
                    {g.glyph}{' '}
                  </Text>
                  <Button
                    key={`view-${row.id}`}
                    label={`${row.id === viewed ? '▸ ' : ''}${short(row.label, width - prefix.length)}`}
                    onPress={() => void $.ui.view({ agentId: row.id })}
                  />
                  <Text dimColor={!ACTIVE.has(row.status) && row.status !== 'failed'} color={row.status === 'failed' ? 'red' : undefined}>
                    {' '}
                    {row.status} · {row.type}
                  </Text>
                </Box>
              )
            })}
          </Box>,
        )}
        {hasSessions &&
          isShown('sessions') &&
          section(
          'Sessioni',
          'cyan',
          <Box flexDirection="column">
            <Button
              key="sessions-toggle"
              label={`${sessionsOpen ? '▾' : '▸'} Sessioni del workspace`}
              onPress={() => void toggleSessions($)}
            />
            {sessionsOpen &&
              (await read($, sessions)).slice(0, SESSIONS_SHOWN).map(row =>
                row.isCurrent ? (
                  <Text key={`s-${row.id}`} dimColor>
                    {'  '}● {short(row.title, width)} (questa)
                  </Text>
                ) : (
                  <Box key={`s-${row.id}`}>
                    <Text dimColor>{'  ○ '}</Text>
                    {row.pacaRef && (
                      <Text inverse color={row.pacaRef === active?.ref ? 'blue' : undefined}>
                        {' '}
                        {row.pacaRef}{' '}
                      </Text>
                    )}
                    {row.pacaRef && <Text> </Text>}
                    <Button
                      key={`resume-${row.id}`}
                      label={short(row.title, width - 2 - (row.pacaRef ? row.pacaRef.length + 3 : 0))}
                      onPress={() => void resumeSession($, row)}
                    />
                    <Text dimColor> {ago(row.mtime, at)}</Text>
                  </Box>
                ),
              )}
          </Box>,
        )}
        {hasPaca &&
          isShown('paca') &&
          section(
            'PACA',
            'blue',
            <Box flexDirection="column">
              <Button
                key="paca-toggle"
                label={`${pacaOpen ? '▾' : '▸'} ${project.name} (${openTasks.length} aperti · ${backlog} backlog)`}
                onPress={() => void togglePaca($)}
              />
              {pacaOpen &&
                openTasks.slice(0, PACA_SHOWN).map(task => {
                  const tone = categoryTone(task.category)
                  return (
                    <Box key={`t-${task.id}`} flexDirection="column">
                      <Box>
                        <Text inverse color={tone}>
                          {' '}
                          {task.ref}{' '}
                        </Text>
                        <Text color={tone}>
                          {' '}
                          {task.status}
                        </Text>
                      </Box>
                      <Text>
                        {'  '}
                        {short(task.title, width)}
                      </Text>
                      <Box>
                        <Text dimColor>{'  └ '}</Text>
                        <Button
                          key={`do-${task.id}`}
                          label="Lavora qui"
                          onPress={() => void $.prompt.fill({ text: `/paca-do ${task.ref}` })}
                        />
                        <Text dimColor>{' │ '}</Text>
                        <Button
                          key={`chat-${task.id}`}
                          label="Nuova chat"
                          onPress={() => void $.prompt.fill({ text: `/handoff ${task.ref} ${task.title}` })}
                        />
                        <Text dimColor>{' │ '}</Text>
                        <Button
                          key={`ref-${task.id}`}
                          label="Copia ref"
                          onPress={() => void $.ui.copy({ text: task.ref })}
                        />
                      </Box>
                    </Box>
                  )
                })}
            </Box>,
          )}
        {hasInbox &&
          isShown('inbox') &&
          section(
            msgs.length > 0 ? `✉ Messaggi (${msgs.length})` : '✉ Messaggi',
            msgs.length > 0 ? 'yellow' : undefined,
            <Box flexDirection="column">
              {msgs.length === 0 && (
                <Text dimColor>Nessun messaggio. Qui arrivano quelli delle altre sessioni (es. una chat verticale che ha finito).</Text>
              )}
              {msgs
                .slice(-5)
                .reverse()
                .map(m => {
                  const isOpen = opened === m.at
                  // Only the arrow is a button: the text beside it is cut to
                  // the pane's real width, which the viewport does not give.
                  return (
                    <Box key={`m-${m.at}`} flexDirection="column">
                      <Box>
                        <Button
                          key={`msg-${m.at}`}
                          label={isOpen ? '▾' : '▸'}
                          onPress={() => void update($, openMsg, () => (isOpen ? null : m.at))}
                        />
                        <Text wrap="truncate-end">
                          {' '}
                          <Text dimColor>{hhmm(m.at)} · </Text>
                          <Text color="yellow">{short(m.from, 20)}</Text>
                          <Text dimColor> · </Text>
                          {msgTitle(m.text)}
                        </Text>
                      </Box>
                      {isOpen && <Text>{m.text}</Text>}
                      {isOpen && (
                        <Box>
                          <Text dimColor>{'  └ '}</Text>
                          <Button key={`copy-${m.at}`} label="Copia" onPress={() => void $.ui.copy({ text: m.text })} />
                          <Text dimColor>{' │ '}</Text>
                          <Button key={`quote-${m.at}`} label="Nel prompt" onPress={() => void $.prompt.fill({ text: m.text })} />
                        </Box>
                      )}
                    </Box>
                  )
                })}
              {msgs.length > 0 && (
                <Button key="clear" label="Svuota inbox" onPress={() => void update($, inbox, () => [])} />
              )}
            </Box>,
          )}
      </Box>
    )
  })
}
