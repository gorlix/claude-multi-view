import { expect, test } from 'claude-code/testing'

import { nextCursor, parseProjects, parseRepos, parseStatuses, parseTasks, repoOf } from '../hooks/paca'

// Samples shaped as the PACA MCP server answers (2026-10-19).
const PROJECTS = `Projects:

Project: Acme
ID: p1
Description: No description
Task ID Prefix: ACME
Created: 2026-09-14T23:13:34.457531Z`

const REPOS = `Linked GitHub Repositories:

Repository: example/acme-infra
ID: r1
Owner: example`

const STATUSES = `Task Statuses:

Task Status: 📋 Todo
ID: s-todo
Category: todo

---

Task Status: 🔧 In Progress
ID: s-prog
Category: inprogress

---

Task Status: ✅ Done
ID: s-done
Category: done`

const tasks = (status4: string, more = '') => `Tasks (2 returned${more ? ', more available' : ''}):

Task #4: 🧹 Debito tecnico / pulizia
ID: t4
Status: ${status4}
Assignees: Unassigned
Updated: 2026-09-23T12:24:12.980254Z

Description:
Pulizia.

---

Task #7: Chiuso
ID: t7
Status: s-done
Updated: 2026-09-23T12:24:12.980254Z
${more}`

test('parsers read the PACA text format', () => {
  expect(parseProjects(PROJECTS)).toEqual([{ id: 'p1', name: 'Acme', prefix: 'ACME', server: 'paca' }])
  expect(parseRepos(REPOS)).toEqual(['example/acme-infra'])
  const statuses = parseStatuses(STATUSES)
  expect(statuses.get('s-prog')).toEqual({ name: 'In Progress', category: 'inprogress' })
  const list = parseTasks(tasks('s-todo'), 'ACME', statuses)
  expect(list.map(t => [t.ref, t.title, t.status])).toEqual([
    ['ACME-4', 'Debito tecnico / pulizia', 'Todo'],
    ['ACME-7', 'Chiuso', 'Done'],
  ])
  expect(nextCursor(tasks('s-todo', '_Call list_tasks again with cursor="abc=" to fetch_'))).toBe('abc=')
  expect(repoOf('git@github.com:example/acme-infra.git')).toBe('example/acme-infra')
  expect(repoOf('https://github.com/gorlix/homelab\n')).toBe('gorlix/homelab')
})

const pane = { plugin: 'multi-view', surface: 'terminal', component: 'Pane', requestId: 'agenti', props: {} } as never

test('the repo origin finds the project; update_task to In Progress fills the band', async ($, on) => {
  let status4 = 's-todo'
  const toasts: string[] = []
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'sess' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined }
  })
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'git@github.com:example/acme-infra.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('mcp.call', ($, e) => {
    const { tool } = e as { tool: string }
    const text = tool === 'list_projects' ? PROJECTS
      : tool === 'github_list_linked_repos' ? REPOS
      : tool === 'list_task_statuses' ? STATUSES
      : tasks(status4)
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })
  on('tool.call', () => ({ result: 'ok' }) as never)

  const ran = await $.command.run({ command: 'paca-tasks', args: '' } as never)
  expect(ran.text).toBe('Task PACA di Acme nel pannello Agenti.')
  const ui = await $.ui.mount(pane)
  expect(await ui.findAll({ type: 'Text', text: /ACME-4 Todo: Debito tecnico/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /ACME-7/ })).toHaveLength(0)

  status4 = 's-prog'
  await $.tool.call({ tool: 'mcp__paca-homelab__update_task', projectId: 'p1', taskId: 't4', statusId: 's-prog' } as never)
  expect(toasts).toContain('ACME-4: Todo → In Progress')
  expect((store.get('paca-active:sess') as { ref: string }).ref).toBe('ACME-4')
  const band = await $.ui.mount({ plugin: 'multi-view', surface: 'terminal', component: 'AbovePrompt', props: {} } as never)
  expect(await band.findAll({ type: 'Text', text: /ACME-4 In Progress: Debito tecnico/ })).toHaveLength(1)
})

test('a server pinned to another project is skipped for the per-repo one', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete((e as { key: string }).key)
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/home/u/Documents/Git/homelab' }))
  on('session.id', () => ({ value: 'sess' }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'https://github.com/gorlix/homelab.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  const HOME = PROJECTS.replace('Acme', 'Home').replace('ID: p1', 'ID: p2').replace('ACME', 'HOME')
  on('mcp.call', ($, e) => {
    const { server, tool } = e as { server: string; tool: string }
    const text = tool === 'list_projects' ? (server === 'paca-homelab' ? HOME : PROJECTS)
      : tool === 'github_list_linked_repos' ? (server === 'paca-homelab' ? 'Repository: gorlix/homelab' : REPOS)
      : tool === 'list_task_statuses' ? STATUSES
      : tasks('s-todo')
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })
  const auto = await $.command.run({ command: 'paca-link', args: 'auto' } as never)
  expect(auto.text).toBe('Workspace collegato a Home (HOME) via paca-homelab.')
  const manual = await $.command.run({ command: 'paca-link', args: 'acme paca' } as never)
  expect(manual.text).toBe('Workspace collegato a Acme (ACME) via paca.')
})
