import type { AgentStatus } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const pane = (surface: (typeof SURFACES)[number]) =>
  ({ plugin: 'multi-view', surface, component: 'Pane', requestId: 'agenti', props: {} }) as never

test('a peer message shows in the pane and still reaches the model', async ($, on) => {
  on('session.receive', ($, e) => ({ text: e.text }))
  on('clock.now', () => ({ value: 1 }))
  on('ui.toast', () => ({ value: undefined }))
  const got = await $.session.receive({
    origin: { kind: 'peer', teammate: 'verticale-a', isVerified: true },
    text: 'lavoro finito',
  } as never)
  expect(got.text).toBe('lavoro finito')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.findAll({ type: 'Text', text: /Messaggi \(1\)/ })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Text', text: /verticale-a/ })).not.toHaveLength(0)
    await ui.unmount()
  }
})

test('/inbox-clear empties the inbox', async ($, on) => {
  on('session.receive', ($, e) => ({ text: e.text }))
  on('clock.now', () => ({ value: 1 }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.receive({ origin: { kind: 'peer' }, text: 'ciao' } as never)
  const ran = await $.command.run({ command: 'inbox-clear', args: '' } as never)
  expect(ran.text).toBe('Inbox svuotata.')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /Messaggi/ })).toHaveLength(0)
})

test('a non-peer delivery does not touch the inbox', async ($, on) => {
  on('session.receive', ($, e) => ({ text: e.text }))
  on('clock.now', () => ({ value: 1 }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.receive({ origin: { kind: 'task-notification' }, text: 'x' } as never)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /Nessun agente/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /Messaggi/ })).toHaveLength(0)
})

test('agents show as a tree and a finished one raises a toast', async ($, on) => {
  let status: AgentStatus = 'running'
  const toasts: string[] = []
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'audit file', type: 'Explore', status },
      { id: 'a2', description: 'figlio', type: 'general-purpose', status: 'running', parentId: 'a1' },
    ],
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined }
  })
  await $.command.run({ command: 'agenti', args: '' } as never)
  const ui = await $.ui.mount(pane('terminal'))
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons).toHaveLength(4)
  expect(await ui.findAll({ type: 'Text', text: /running · Explore/ })).toHaveLength(1)

  status = 'completed'
  await $.command.run({ command: 'agenti', args: '' } as never)
  expect(toasts).toEqual(['Agente completed: audit file'])
})

test('5h and weekly limits lead the pane and warn past 80% once', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const measure = (fiveHour: number) =>
    $.session.measure({
      context: { window: 200000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: fiveHour },
        { kind: 'seven_day', percentUsed: 18 },
      ],
      changed: ['rateLimits'],
    } as never)
  await measure(42)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /Limite 5h: 42%/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /Limite sett: 18%/ })).toHaveLength(1)
  await measure(81)
  await measure(83)
  expect(toasts).toEqual(['Limite 5h al 81%'])
})

test('saved sessions list and resume in a new tmux window', async ($, on) => {
  const runs: string[][] = []
  const saved = [
    { id: 'cur', title: 'Questa chat', mtime: 1, isCurrent: true },
    { id: 'old', title: 'MCP Proxmox e cluster', mtime: 1, isCurrent: false },
  ]
  on('env.get', ($, e) => ({ value: (e as { name: string }).name === 'TMUX' ? '/tmp/tmux' : '/home/u' }))
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'cur' }))
  on('clock.now', () => ({ value: 120_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    const argv = [...(e as { argv: string[] }).argv]
    runs.push(argv)
    const stdout = argv[0] === 'python3' ? JSON.stringify(saved) : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run({ command: 'sessioni', args: '' } as never)
  expect(runs[0]?.[3]).toBe('/home/u/.claude/projects/-home-u-repo')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /Questa chat \(questa\)/ })).toHaveLength(1)
  await ui.press({ key: 'resume-old' })
  expect(runs[1]).toEqual(['tmux', 'new-window', '-c', '/home/u/repo', '-n', 'MCP Proxmox e cluster', 'claude', '--resume', 'old'])
})
