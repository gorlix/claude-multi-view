import { read, update, atom } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { PacaProject, PacaTask } from '../types'

// PACA through its MCP server, called by the mod itself (no model turn).
// The server answers formatted text, not JSON: the parsers below read the
// "Key: value" blocks it prints, so a format change in PACA lands here.

// Servers tried in order: a /paca-link choice, `paca-<workspace folder>`
// (a server scoped to one repo, e.g. paca-homelab), then the user's `paca`.
const DEFAULT_SERVER = 'paca'
const SHOWN_CATEGORIES = ['inprogress', 'refinement', 'todo']

// Declared again in register.tsx: same refs, same state.
const pacaProject = atom({ plugin: 'multi-view', key: 'pacaProject' } as const, null)
const pacaTasks = atom({ plugin: 'multi-view', key: 'pacaTasks' } as const, [])
const pacaActive = atom({ plugin: 'multi-view', key: 'pacaActive' } as const, null)

type Status = { name: string; category: string }

const field = (block: string, key: string) =>
  block.match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1]?.trim() ?? ''

const blocks = (text: string) => text.split(/\n---\n/)

// "📋 Todo" → "Todo": the emoji PACA puts ahead of names stays out of the band.
const plain = (name: string) => name.replace(/^[^\p{L}\p{N}]+/u, '').trim()

export function parseProjects(text: string, server = DEFAULT_SERVER): PacaProject[] {
  return blocks(text)
    .map(b => ({ id: field(b, 'ID'), name: field(b, 'Project'), prefix: field(b, 'Task ID Prefix'), server }))
    .filter(p => p.id && p.prefix)
}

export function parseRepos(text: string): string[] {
  return [...text.matchAll(/^Repository: (\S+)$/gm)].map(m => (m[1] ?? '').toLowerCase())
}

export function parseStatuses(text: string): Map<string, Status> {
  const map = new Map<string, Status>()
  for (const b of blocks(text)) {
    const id = field(b, 'ID')
    if (id) map.set(id, { name: plain(field(b, 'Task Status')), category: field(b, 'Category') })
  }
  return map
}

export function parseTasks(text: string, prefix: string, statuses: Map<string, Status>): PacaTask[] {
  const out: PacaTask[] = []
  for (const b of blocks(text)) {
    const head = b.match(/^Task #(\d+): (.*)$/m)
    const id = field(b, 'ID')
    if (!head || !id) continue
    const statusId = field(b, 'Status')
    const status = statuses.get(statusId)
    out.push({
      id,
      ref: `${prefix}-${head[1]}`,
      title: plain(head[2] ?? ''),
      statusId,
      status: status?.name ?? '?',
      category: status?.category ?? '',
      updated: field(b, 'Updated'),
    })
  }
  return out
}

export const nextCursor = (text: string) => text.match(/cursor="([^"]+)"/)?.[1]

// "git@github.com:gorlix/x.git", "https://github.com/gorlix/x" → "gorlix/x".
export const repoOf = (remote: string) =>
  remote.trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1]?.toLowerCase()

async function pacaText($: EngineInterface, server: string, tool: string, args: Record<string, unknown> = {}) {
  const res = await $.mcp.call(server, tool, args)
  const text = res.content.map(c => c.text ?? '').join('\n')
  if (res.isError) throw new Error(text || `${tool} failed`)
  return text
}

const linkKey = (cwd: string) => `paca-link:${cwd}`

type Link = { prefix: string; server?: string }

// Projects one server can see; a server missing or refusing gives none.
async function projectsOn($: EngineInterface, server: string) {
  try {
    return parseProjects(await pacaText($, server, 'list_projects'), server)
  } catch {
    return []
  }
}

// The project for this workspace: a /paca-link choice, else the project whose
// linked GitHub repos include this checkout's origin, on the first server
// that answers for it. A server pinned to one project (PACA_PROJECT_ID) sees
// only that one, hence the per-repo server first.
export async function resolveProject($: EngineInterface): Promise<PacaProject | null> {
  const cwd = await $.session.cwd()
  const folder = cwd.split('/').filter(Boolean).pop() ?? ''
  const linked = (await $.store.get(linkKey(cwd))) as Link | 'off' | string | undefined
  if (linked === 'off') return null
  const link: Link | undefined = typeof linked === 'string' ? { prefix: linked } : linked
  const servers = [...new Set([link?.server, `paca-${folder}`, DEFAULT_SERVER].filter((s): s is string => !!s))]
  if (link) {
    for (const server of servers) {
      const found = (await projectsOn($, server)).find(p => p.prefix === link.prefix)
      if (found) return found
    }
    return null
  }
  const remote = await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd })
  const repo = remote.exitCode === 0 ? repoOf(remote.stdout) : undefined
  if (!repo) return null
  for (const server of servers) {
    for (const project of await projectsOn($, server)) {
      const repos = await pacaText($, server, 'github_list_linked_repos', { projectId: project.id })
        .then(parseRepos)
        .catch(() => [] as string[])
      if (repos.includes(repo)) return project
    }
  }
  return null
}

export async function linkProject($: EngineInterface, prefix: string, server?: string) {
  const link: Link | 'off' = prefix === 'off' ? 'off' : { prefix, ...(server ? { server } : {}) }
  await $.store.set(linkKey(await $.session.cwd()), link)
}

// Reads the open tasks and toasts each status change since the last read.
export async function refreshTasks($: EngineInterface) {
  const project = await read($, pacaProject)
  if (!project) return
  const statuses = parseStatuses(await pacaText($, project.server, 'list_task_statuses', { projectId: project.id }))
  const all: PacaTask[] = []
  let cursor: string | undefined
  for (let page = 0; page < 5; page++) {
    const text = await pacaText($, project.server, 'list_tasks', { projectId: project.id, pageSize: 200, ...(cursor ? { cursor } : {}) })
    all.push(...parseTasks(text, project.prefix, statuses))
    cursor = nextCursor(text)
    if (!cursor) break
  }
  const before = new Map((await read($, pacaTasks)).map(t => [t.id, t]))
  const active = await read($, pacaActive)
  for (const task of all) {
    const old = before.get(task.id)
    if (old && old.statusId !== task.statusId) {
      $.ui.toast(`${task.ref}: ${old.status} → ${task.status}`)
    } else if (old && active?.id === task.id && old.updated !== task.updated) {
      $.ui.toast(`${task.ref} aggiornato su PACA`)
    }
  }
  const shown = all
    .filter(t => SHOWN_CATEGORIES.includes(t.category))
    .sort((a, b) => SHOWN_CATEGORIES.indexOf(a.category) - SHOWN_CATEGORIES.indexOf(b.category))
  // Keep the closed ones known too, so a task leaving the list still toasts.
  await update($, pacaTasks, () => [...shown, ...all.filter(t => !SHOWN_CATEGORIES.includes(t.category))])
  if (active) {
    const fresh = all.find(t => t.id === active.id)
    if (fresh) await update($, pacaActive, () => fresh)
  }
}

export const activeKey = (sessionId: string) => `paca-active:${sessionId}`

// After update_task moved a task to an in-progress status, it is this chat's.
export async function noteUpdate($: EngineInterface, taskId: string) {
  await refreshTasks($)
  const task = (await read($, pacaTasks)).find(t => t.id === taskId)
  if (task?.category === 'inprogress') {
    await update($, pacaActive, () => task)
    await $.store.set(activeKey(await $.session.id()), task)
  }
}

export const isShownTask = (t: PacaTask) => SHOWN_CATEGORIES.includes(t.category)
