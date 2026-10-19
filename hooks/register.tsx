import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { AgentRow, InboxItem, Limit, PacaTask, SavedSession } from '../types'
import {
  activeKey,
  isShownTask,
  linkProject,
  noteUpdate,
  refreshTasks,
  resolveProject,
} from './paca'

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

const sessions = atom({ plugin: 'multi-view', key: 'sessions' } as const, [])
const showSessions = atom({ plugin: 'multi-view', key: 'showSessions' } as const, false)
const SESSIONS_SHOWN = 12
const pacaProject = atom({ plugin: 'multi-view', key: 'pacaProject' } as const, null)
const pacaTasks = atom({ plugin: 'multi-view', key: 'pacaTasks' } as const, [])
const pacaActive = atom({ plugin: 'multi-view', key: 'pacaActive' } as const, null)
const showPaca = atom({ plugin: 'multi-view', key: 'showPaca' } as const, false)
const PACA_POLL_MS = 180_000
const PACA_SHOWN = 10

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: 'sett' }
const THRESHOLDS = [90, 80]

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

// Parents first, children indented under them.
const tree = (rows: AgentRow[]): { row: AgentRow; depth: number }[] => {
  const ids = new Set(rows.map(r => r.id))
  const out: { row: AgentRow; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const row of rows) {
      const isRoot = parent === undefined && (!row.parentId || !ids.has(row.parentId))
      if (isRoot || (parent !== undefined && row.parentId === parent)) {
        out.push({ row, depth })
        walk(row.id, depth + 1)
      }
    }
  }
  walk(undefined, 0)
  return out
}

const counts = (rows: AgentRow[]) => ({
  run: rows.filter(r => ACTIVE.has(r.status)).length,
  idle: rows.filter(r => r.status === 'idle').length,
})

const limitColor = (pct: number) => (pct >= 90 ? 'red' : pct >= 80 ? 'yellow' : undefined)

// "2h10m", "3g4h": time left until the window resets.
const until = (resetsAt: string | undefined, at: number) => {
  if (!resetsAt || !at) return ''
  const mins = Math.max(0, Math.round((Date.parse(resetsAt) - at) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return d > 0 ? `${d}g${h}h` : h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}

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

// The project folder Claude Code keeps this workspace's transcripts in.
async function projectDir($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  return `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}`
}

async function loadSessions($: EngineInterface) {
  const script = `${$.plugin.root}/hooks/list_sessions.py`
  const run = await $.process.run(['python3', '-I', script, await projectDir($), await $.session.id()])
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
  const cwd = await $.session.cwd()
  const run = await $.process.run(['tmux', 'new-window', '-c', cwd, '-n', short(row.title, 24), 'claude', '--resume', row.id])
  $.ui.toast(run.exitCode === 0 ? `Ripresa in tmux: ${short(row.title, 40)}` : `tmux: ${run.stderr.trim()}`)
}

async function startPaca($: EngineInterface) {
  const project = await resolveProject($)
  await update($, pacaProject, () => project)
  if (!project) return
  const saved = await $.store.get(activeKey(await $.session.id()))
  if (saved && typeof saved === 'object') await update($, pacaActive, () => saved as PacaTask)
  await refreshTasks($)
}

async function togglePaca($: EngineInterface) {
  const isShown = !(await read($, showPaca))
  await update($, showPaca, () => isShown)
  if (isShown) {
    await refreshTasks($).catch(() => $.ui.toast('PACA non raggiungibile'))
    await $.ui.open({ id: PANE, title: 'Agenti' })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const cwd = await $.session.cwd()
    await update($, chat, () => cwd.split('/').filter(Boolean).pop() ?? cwd)
    // Each command on its own: a name taken (a skill `paca` exists) must not
    // stop the others from registering.
    const command = (name: string, description: string) =>
      $.command.register({ name, description }).catch(() => $.ui.toast(`multi-view: /${name} non registrato`))
    await command('agenti', 'Apre il pannello con agenti e messaggi in arrivo')
    await command('sessioni', 'Mostra le sessioni salvate di questo workspace, da riprendere in tmux')
    await command('paca-tasks', 'Mostra i task aperti del progetto PACA di questo workspace')
    await command('paca-link', 'Collega il workspace a un progetto PACA: /paca-link <PREFISSO> [server MCP] | auto | off')
    await command('inbox-clear', 'Svuota i messaggi arrivati da altre sessioni')
    $.clock.every(POLL_MS, () => void poll($))
    await update($, now, () => 0)
    void $.clock.now().then(at => update($, now, () => at))
    $.clock.every(60_000, () => void $.clock.now().then(at => update($, now, () => at)))
    void startPaca($).catch(() => undefined)
    $.clock.every(PACA_POLL_MS, () => void refreshTasks($).catch(() => undefined))
    void $.session.usage().then(u => setLimits($, u.rateLimits)).catch(() => undefined)
    void $.ui.open({ id: PANE, title: 'Agenti' })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
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
      await noteUpdate($, input.taskId).catch(() => undefined)
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
    const from =
      ('teammate' in origin ? origin.teammate : undefined) ??
      ('plugin' in origin ? origin.plugin : undefined) ??
      'altra sessione'
    const record = async () => {
      const item: InboxItem = { at: await $.clock.now(), from, text: e.text }
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
    const active = await read($, pacaActive)

    return (
      <Box>
        {lims.map(l => (
          <Text key={`lim-${l.kind}`} color={limitColor(l.percentUsed)} dimColor={!limitColor(l.percentUsed)}>
            {LIMIT_NAMES[l.kind]} {l.percentUsed}%{until(l.resetsAt, at) && ` (${until(l.resetsAt, at)})`}
            {' · '}
          </Text>
        ))}
        <Text dimColor>chat: {await read($, chat)}</Text>
        {active && (
          <Text color="blue">
            {' · '}
            {active.ref} {active.status}: {short(active.title, 40)}
          </Text>
        )}
        {rows.length > 0 && (
          <Text dimColor>
            {' · '}
            {rows.length} agenti ({run} attivi, {idle} idle)
          </Text>
        )}
        {msgs.length > 0 && <Text color="yellow"> · {msgs.length} msg</Text>}
        <Text> </Text>
        <Button key="sessions" label="Sessioni" onPress={() => void toggleSessions($)} />
        {viewed && (
          <Text color="cyan"> · vista: {short(viewedRow?.label ?? viewed, 30)} </Text>
        )}
        {viewed && (
          <Button key="back" label="Torna" onPress={() => void $.ui.view({})} />
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const rows = await read($, agents)
    const msgs = await read($, inbox)
    const viewed = e.props.view?.agentId
    const width = Math.max(20, (e.viewport?.columns ?? 40) - 14)
    const lims = await read($, limits)
    const at = await read($, now)
    const project = await read($, pacaProject)
    const openTasks = (await read($, pacaTasks)).filter(isShownTask)

    return (
      <Box flexDirection="column">
        {lims.map(l => (
          <Text key={`lim-${l.kind}`} color={limitColor(l.percentUsed)}>
            Limite {LIMIT_NAMES[l.kind]}: {l.percentUsed}%
            {until(l.resetsAt, at) && `, reset tra ${until(l.resetsAt, at)}`}
          </Text>
        ))}
        <Button
          key="main"
          label={viewed ? 'Conversazione principale' : '> Conversazione principale'}
          onPress={() => void $.ui.view({})}
        />
        {rows.length === 0 && <Text dimColor>Nessun agente in questa sessione.</Text>}
        {tree(rows).map(({ row, depth }) => (
          <Box key={row.id}>
            <Text>{'  '.repeat(depth)}</Text>
            <Button
              key={`view-${row.id}`}
              label={`${row.id === viewed ? '> ' : ''}${short(row.label, width)}`}
              onPress={() => void $.ui.view({ agentId: row.id })}
            />
            <Text dimColor={!ACTIVE.has(row.status)} color={row.status === 'failed' ? 'red' : undefined}>
              {' '}
              {row.status} · {row.type}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Button
          key="sessions-toggle"
          label={`${(await read($, showSessions)) ? 'v' : '>'} Sessioni del workspace`}
          onPress={() => void toggleSessions($)}
        />
        {(await read($, showSessions)) &&
          (await read($, sessions)).slice(0, SESSIONS_SHOWN).map(row =>
            row.isCurrent ? (
              <Text key={`s-${row.id}`} dimColor>
                {'  '}= {short(row.title, width)} (questa)
              </Text>
            ) : (
              <Box key={`s-${row.id}`}>
                <Text>{'  '}</Text>
                <Button
                  key={`resume-${row.id}`}
                  label={short(row.title, width)}
                  onPress={() => void resumeSession($, row)}
                />
                <Text dimColor> {ago(row.mtime, at)}</Text>
              </Box>
            ),
          )}
        {project && <Text> </Text>}
        {project && (
          <Button
            key="paca-toggle"
            label={`${(await read($, showPaca)) ? 'v' : '>'} PACA ${project.name} (${openTasks.length} aperti)`}
            onPress={() => void togglePaca($)}
          />
        )}
        {project &&
          (await read($, showPaca)) &&
          openTasks.slice(0, PACA_SHOWN).map(task => (
            <Box key={`t-${task.id}`} flexDirection="column">
              <Text color={task.category === 'inprogress' ? 'blue' : undefined}>
                {'  '}
                {task.ref} {task.status}: {short(task.title, width)}
              </Text>
              <Box>
                <Text>{'    '}</Text>
                <Button
                  key={`do-${task.id}`}
                  label="Lavora qui"
                  onPress={() => void $.prompt.fill({ text: `/paca-do ${task.ref}` })}
                />
                <Text> </Text>
                <Button
                  key={`chat-${task.id}`}
                  label="Nuova chat"
                  onPress={() => void $.prompt.fill({ text: `/handoff ${task.ref} ${task.title}` })}
                />
                <Text> </Text>
                <Button
                  key={`ref-${task.id}`}
                  label="Copia ref"
                  onPress={() => void $.ui.copy({ text: task.ref })}
                />
              </Box>
            </Box>
          ))}
        {msgs.length > 0 && <Text bold>{'\n'}Messaggi ({msgs.length})</Text>}
        {msgs.slice(-5).map(m => (
          <Text key={String(m.at)} wrap="truncate-end">
            <Text color="yellow">{short(m.from, 20)}:</Text> {m.text.replace(/\s+/g, ' ')}
          </Text>
        ))}
        {msgs.length > 0 && (
          <Button key="clear" label="Svuota inbox" onPress={() => void update($, inbox, () => [])} />
        )}
      </Box>
    )
  })
}
