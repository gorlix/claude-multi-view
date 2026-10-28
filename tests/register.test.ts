import type { AgentStatus } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { parseStatus, worktreeName } from '../hooks/git'
import { ctxTone, fmtDuration, parseWindows, windowOfSession, windowOfVertical } from '../hooks/ui'

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
    expect(await ui.findAll({ type: 'Text', text: /verticale-a · lavoro finito/ })).not.toHaveLength(0)
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
  expect(await ui.findAll({ type: 'Text', text: /Messaggi \(/ })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Text', text: /Nessun messaggio/ })).toHaveLength(1)
})

test('a non-peer delivery does not touch the inbox', async ($, on) => {
  on('session.receive', ($, e) => ({ text: e.text }))
  on('clock.now', () => ({ value: 1 }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.receive({ origin: { kind: 'task-notification' }, text: 'x' } as never)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /Nessun agente/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /Messaggi \(/ })).toHaveLength(0)
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
  // 3 tabs (Tutto, Agenti, Sessioni) + ⚙ + main + 2 agents + sessions toggle
  expect(buttons).toHaveLength(9)
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
  expect(await ui.findAll({ type: 'Text', text: /42%/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /5h/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /▰/ })).not.toHaveLength(0)
  expect(await ui.findAll({ type: 'Text', text: /18%/ })).toHaveLength(1)
  const band = await $.ui.mount({ plugin: 'multi-view', surface: 'terminal', component: 'AbovePrompt', props: {} } as never)
  expect(await band.findAll({ type: 'Text', text: /42%/ })).toHaveLength(1)
  expect(await band.findAll({ type: 'Text', text: /▰/ })).not.toHaveLength(0)
  await measure(81)
  await measure(83)
  expect(toasts).toEqual(['Limite 5h al 81%'])
})

test('pressing a reset time switches between time left and clock time', async ($, on) => {
  const at = Date.parse('2026-10-20T10:00:00Z')
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'cur' }))
  on('env.get', () => ({ value: '/home/u' }))
  on('clock.now', () => ({ value: at }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: new Date(at + 130 * 60000).toISOString() }],
    changed: ['rateLimits'],
  } as never)
  // /sessioni reads the clock, which the countdown needs.
  await $.command.run({ command: 'sessioni', args: '' })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Button', text: 'reset tra 2h10m' })).toHaveLength(1)
  await ui.press({ key: 'reset-five_hour' })
  expect(await ui.findAll({ type: 'Button', text: /^reset (alle |\w{3} )\d\d:\d\d$/ } as never)).toHaveLength(1)
  const band = await $.ui.mount({ plugin: 'multi-view', surface: 'terminal', component: 'AbovePrompt', props: {} } as never)
  expect(await band.findAll({ type: 'Button', text: /^(\w{3} )?\d\d:\d\d$/ } as never)).toHaveLength(1)
  await band.press({ key: 'reset-five_hour' })
  expect(await band.findAll({ type: 'Button', text: '2h10m' })).toHaveLength(1)
})

test('a narrow band drops its bars and keeps the numbers', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 31 }],
    changed: ['rateLimits'],
  } as never)
  const band = (columns: number) =>
    $.ui.mount({ plugin: 'multi-view', surface: 'terminal', component: 'AbovePrompt', props: {}, viewport: { columns, rows: 40, isFullscreen: false } } as never)
  const wide = await band(200)
  expect(await wide.findAll({ type: 'Text', text: /▰/ })).not.toHaveLength(0)
  await wide.unmount()
  const narrow = await band(80)
  expect(await narrow.findAll({ type: 'Text', text: /▰/ })).toHaveLength(0)
  expect(await narrow.findAll({ type: 'Text', text: /^31%$/ })).toHaveLength(1)
})

test('an inbox message opens in full and can go to the prompt', async ($, on) => {
  const filled: string[] = []
  on('session.receive', ($, e) => ({ text: e.text }))
  on('clock.now', () => ({ value: 1 }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', ($, e) => {
    filled.push(String((e as { text: string }).text))
    return { isFilled: true }
  })
  const text = 'lavoro finito: commit abc123, deploy no, resta da sistemare il README'
  await $.session.receive({ origin: { kind: 'peer', teammate: 'verticale-a' }, text } as never)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text })).toHaveLength(0)
  // Closed: one line with time, chat and the title up to the first stop.
  expect(await ui.findAll({ type: 'Text', text: /\d\d:\d\d · verticale-a · lavoro finito$/ })).not.toHaveLength(0)
  await ui.press({ key: 'msg-1' })
  expect(await ui.findAll({ type: 'Text', text })).toHaveLength(1)
  await ui.press({ key: 'quote-1' })
  expect(filled).toEqual([text])
  await ui.press({ key: 'msg-1' })
  expect(await ui.findAll({ type: 'Text', text })).toHaveLength(0)
})

test('a cross-session envelope gives the sender and the body', async ($, on) => {
  on('session.receive', ($, e) => ({ text: e.text }))
  on('clock.now', () => ({ value: 1 }))
  on('ui.toast', () => ({ value: undefined }))
  const text =
    '<cross-session-message from="uds:/run/x.sock" from-name="verticale-b" from-mode="prompting">\n## Verticale chiuso: inbox\n- Deploy: no.\n</cross-session-message>'
  await $.session.receive({ origin: { kind: 'peer' }, text } as never)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /verticale-b · Verticale chiuso$/ })).not.toHaveLength(0)
  expect(await ui.findAll({ type: 'Text', text: /cross-session|altra sessione/ })).toHaveLength(0)
  await ui.press({ key: 'msg-1' })
  expect(await ui.findAll({ type: 'Text', text: '## Verticale chiuso: inbox\n- Deploy: no.' })).toHaveLength(1)
})

test('tab labels can be icon and name, icon only or name only', async ($, on) => {
  on('store.set', () => ({ value: undefined }))
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Button', text: '▸ ☰ Tutto' })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Button', text: '⚙ Impostazioni' })).toHaveLength(1)
  await ui.press({ key: 'pane-menu' })
  await ui.press({ key: 'tabStyle-icon' })
  expect(await ui.findAll({ type: 'Button', text: '▸ ☰' })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Button', text: '⚙' })).toHaveLength(1)
  await ui.press({ key: 'tabStyle-name' })
  expect(await ui.findAll({ type: 'Button', text: '▸ Tutto' })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Button', text: '◉ solo nome' })).toHaveLength(1)
})

test('saved sessions list and resume in a new tmux window', async ($, on) => {
  const runs: string[][] = []
  let windows = ''
  const saved = [
    { id: 'cur', title: 'Questa chat', mtime: 1, isCurrent: true },
    { id: 'old', title: 'MCP Proxmox e cluster', mtime: 1, isCurrent: false, pacaRef: 'ACME-3' },
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
    const stdout = argv[0] === 'python3' ? (argv[2]?.endsWith('running_sessions.py') ? '[]' : JSON.stringify(saved)) : argv[1] === 'list-windows' ? windows : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run({ command: 'sessioni', args: '' } as never)
  expect(runs[0]?.[3]).toBe('/home/u/.claude/projects/-home-u-repo')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /Questa chat \(questa\)/ })).toHaveLength(1)
  await ui.press({ key: 'resume-old' })
  expect(await ui.findAll({ type: 'Text', text: /ACME-3/ })).toHaveLength(1)
  await ui.press({ key: 'resume-old' })
  expect(runs.find(r => r[1] === 'new-window')).toEqual(['tmux', 'new-window', '-c', '/home/u/repo', '-n', 'MCP Proxmox e cluster·old', 'claude', '--resume', 'old'])

  // A window already named for that session is selected, not duplicated.
  windows = '@1 bash\n@7 altro·old\n'
  const before = runs.length
  await ui.press({ key: 'resume-old' })
  expect(runs.slice(before).filter(r => r[0] === 'tmux').map(r => r[1])).toEqual(['list-windows', 'select-window'])
  expect(runs.at(-1)).toEqual(['tmux', 'select-window', '-t', '@7'])
})

test('context fill shows in the band, yellow from 60 and red from 80', async ($, on) => {
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const measure = (percent: number) =>
    $.session.measure({ context: { window: 200000, percent }, rateLimits: [], changed: ['context'] } as never)
  const band = () => $.ui.mount({ plugin: 'multi-view', surface: 'terminal', component: 'AbovePrompt', props: {} } as never)
  await measure(34)
  const ui = await band()
  expect(await ui.findAll({ type: 'Text', text: /34%/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /34%/, color: 'green' } as never)).toHaveLength(1)
  await measure(85)
  expect(await ui.findAll({ type: 'Text', text: /85%/, color: 'red' } as never)).toHaveLength(1)
})
test('ctxTone thresholds', () => {
  expect([59, 60, 79, 80].map(ctxTone)).toEqual(['green', 'yellow', 'yellow', 'red'])
})

// tmux window title: renamed only when the mod may name the window.
const tmuxSetup = (on: Parameters<TestBody>[1], window: string, auto: string) => {
  const runs: string[][] = []
  on('env.get', ($, e) => {
    const name = (e as { name: string }).name
    return { value: name === 'TMUX_PANE' ? '%1' : name === 'HOME' ? '/home/u' : undefined }
  })
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'abcdef1234' }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    const out = argv[0] === 'python3' ? 'Mod UI multi-agent\n'
      : argv[1] === 'display-message' ? `${window}\n`
      : argv[1] === 'show-window-options' ? `${auto}\n` : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return runs
}

test('an auto-named tmux window takes the chat title', async ($, on) => {
  const runs = tmuxSetup(on, 'claude', '')
  await $.command.run({ command: 'titolo-finestra', args: '' } as never)
  expect(runs.find(r => r[1] === 'rename-window')).toEqual(['tmux', 'rename-window', '-t', '%1', 'Mod UI multi-agent'])
})

test('a window named on purpose keeps its name unless forced', async ($, on) => {
  const runs = tmuxSetup(on, 'trim-42-fix', 'off')
  on('turn.complete', () => ({ text: '' }) as never)
  await $.turn.complete({ answer: { text: 'ok' } } as never)
  expect(runs.find(r => r[1] === 'rename-window')).toBeUndefined()
  await $.command.run({ command: 'titolo-finestra', args: '' } as never)
  expect(runs.find(r => r[1] === 'rename-window')?.[4]).toBe('Mod UI multi-agent')
})

test('a resume window keeps its ·id8 suffix', async ($, on) => {
  const runs = tmuxSetup(on, 'vecchio titolo·abcdef12', 'off')
  await $.command.run({ command: 'titolo-finestra', args: '' } as never)
  expect(runs.find(r => r[1] === 'rename-window')?.[4]).toBe('Mod UI multi-agent·abcdef12')
})

const BAND = { plugin: 'multi-view', surface: 'terminal', component: 'AbovePrompt', props: {} } as never

test('pane tabs show one section at a time and Tutto restores all', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  await $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }], changed: ['rateLimits'] } as never)
  const ui = await $.ui.mount(pane('terminal'))
  const has = async (t: string) => (await ui.findAll({ type: 'Text', text: new RegExp(`^${t}$`) } as never)).length
  expect([await has('Limiti'), await has('Agenti'), await has('Sessioni')]).toEqual([1, 1, 1])
  expect(await ui.findAll({ type: 'Button', text: '▸ ☰' })).toHaveLength(1)
  await ui.press({ key: 'tab-agents' })
  expect([await has('Limiti'), await has('Agenti'), await has('Sessioni')]).toEqual([0, 1, 0])
  expect(await ui.findAll({ type: 'Button', text: '▸ ●' })).toHaveLength(1)
  await ui.press({ key: 'tab-all' })
  expect([await has('Limiti'), await has('Agenti'), await has('Sessioni')]).toEqual([1, 1, 1])
})

test('a tab whose section vanishes falls back to all', async ($, on) => {
  on('session.receive', ($, e) => ({ text: e.text }))
  on('clock.now', () => ({ value: 1 }))
  on('ui.toast', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  await $.session.receive({ origin: { kind: 'peer' }, text: 'ciao' } as never)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'tab-inbox' })
  expect(await ui.findAll({ type: 'Text', text: /^Agenti$/ } as never)).toHaveLength(0)
  // An emptied inbox keeps its tab; switching the section off drops it.
  await $.command.run({ command: 'inbox-clear', args: '' } as never)
  expect(await ui.findAll({ type: 'Text', text: /^Agenti$/ } as never)).toHaveLength(0)
  await ui.press({ key: 'pane-menu' })
  await ui.press({ key: 'pref-paneInbox' })
  expect(await ui.findAll({ type: 'Text', text: /^Agenti$/ } as never)).toHaveLength(1)
})

test('the band menu hides band limits, keeps the pane ones and saves prefs', async ($, on) => {
  const store = new Map<string, unknown>()
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined }
  })
  await $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 24 }], changed: ['rateLimits'] } as never)
  const band = await $.ui.mount(BAND)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await band.findAll({ type: 'Text', text: /24%/ })).toHaveLength(1)
  expect(await band.findAll({ type: 'Button', text: /limiti/ })).toHaveLength(0)
  await band.press({ key: 'menu' })
  expect(await band.findAll({ type: 'Button', text: '☑ limiti' })).toHaveLength(1)
  // The pane settings are not in the band menu.
  expect(await band.findAll({ type: 'Button', text: /pannello/ })).toHaveLength(0)
  await band.press({ key: 'pref-bandLimits' })
  expect(await band.findAll({ type: 'Button', text: '☐ limiti' })).toHaveLength(1)
  expect(await band.findAll({ type: 'Text', text: /24%/ })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Text', text: /24%/ })).toHaveLength(1)
  expect((store.get('prefs') as { bandLimits: boolean }).bandLimits).toBe(false)
  // Pane settings live in the pane and leave the band alone.
  await ui.press({ key: 'pane-menu' })
  expect(await ui.findAll({ type: 'Text', text: /^Impostazioni$/ } as never)).toHaveLength(1)
  await ui.press({ key: 'pref-paneLimits' })
  expect(await ui.findAll({ type: 'Text', text: /24%/ })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Button', text: '▰' })).toHaveLength(0)
  expect((store.get('prefs') as { paneLimits: boolean }).paneLimits).toBe(false)
  await band.press({ key: 'menu-close' })
  expect(await band.findAll({ type: 'Button', text: 'chiudi' })).toHaveLength(0)
  await ui.press({ key: 'pane-menu-close' })
  expect(await ui.findAll({ type: 'Text', text: /^Impostazioni$/ } as never)).toHaveLength(0)
})

test('the band menu offers the PACA toggle only with a PACA project', async ($, on) => {
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'menu' })
  expect(await band.findAll({ type: 'Button', text: /task PACA/ })).toHaveLength(0)
  expect(await band.findAll({ type: 'Button', text: /limiti/ })).toHaveLength(1)
})

test('hidden band segments leave no leading or doubled separator', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  await $.session.measure({ context: { window: 200000, percent: 40 }, rateLimits: [{ kind: 'five_hour', percentUsed: 24 }], changed: ['rateLimits', 'context'] } as never)
  const band = await $.ui.mount(BAND)
  const seps = async () => (await band.findAll({ type: 'Text', text: ' │ ' } as never)).length
  // limits, ctx, chat, ⋯: three separators.
  expect(await seps()).toBe(3)
  await band.press({ key: 'menu' })
  await band.press({ key: 'pref-bandChat' })
  await band.press({ key: 'pref-bandCtx' })
  expect(await band.findAll({ type: 'Text', text: /chat:/ })).toHaveLength(0)
  expect(await band.findAll({ type: 'Text', text: /ctx/ })).toHaveLength(0)
  expect(await band.findAll({ type: 'Button', text: 'Sessioni' })).toHaveLength(0)
  expect(await band.findAll({ type: 'Text', text: /24%/ })).toHaveLength(1)
  expect(await band.findAll({ type: 'Button', text: '⋯' })).toHaveLength(1)
  // limits + ⋯: one separator in the row, and the menu line adds its own.
  const menuSeps = await seps()
  await band.press({ key: 'menu-close' })
  expect(await seps()).toBe(1)
  expect(menuSeps).toBeGreaterThan(1)
  await band.press({ key: 'menu' })
  await band.press({ key: 'pref-bandLimits' })
  await band.press({ key: 'menu-close' })
  // only ⋯ left: no separator at all.
  expect(await seps()).toBe(0)
})

test('pane settings hide a section and its tab, and do not touch the band', async ($, on) => {
  on('ui.toast', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  const band = await $.ui.mount(BAND)
  const ui = await $.ui.mount(pane('terminal'))
  const has = async (t: string) => (await ui.findAll({ type: 'Text', text: new RegExp(`^${t}$`) } as never)).length
  expect(await has('Agenti')).toBe(1)
  expect(await ui.findAll({ type: 'Button', key: 'tab-agents' } as never)).toHaveLength(1)
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'pane-menu' })
  expect(await ui.findAll({ type: 'Button', text: '☑ agenti' })).toHaveLength(1)
  await ui.press({ key: 'pref-paneAgents' })
  expect(await ui.findAll({ type: 'Button', text: '☐ agenti' })).toHaveLength(1)
  expect(await has('Agenti')).toBe(0)
  expect(await ui.findAll({ type: 'Button', key: 'tab-agents' } as never)).toHaveLength(0)
  // The selected tab vanished: back to Tutto, other sections still there.
  expect(await ui.findAll({ type: 'Button', text: '▸ ☰' })).toHaveLength(1)
  expect(await has('Sessioni')).toBe(1)
  // The band keeps its own segments and its menu has no pane toggles.
  expect(await band.findAll({ type: 'Text', text: /chat:/ })).toHaveLength(1)
  await band.press({ key: 'menu' })
  expect(await band.findAll({ type: 'Button', text: '☑ agenti' })).toHaveLength(1)
})

test('/multiview opens the band menu and says where pane settings are', async ($, on) => {
  on('ui.toast', () => ({ value: undefined }))
  const ran = await $.command.run({ command: 'multiview', args: '' } as never)
  expect(ran.text).toMatch(/Menù/)
  expect(ran.text).toMatch(/⚙/)
  const band = await $.ui.mount(BAND)
  expect(await band.findAll({ type: 'Button', text: 'chiudi' })).toHaveLength(1)
})

const result = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('parseStatus counts staged, modified, untracked and ahead/behind', () => {
  const out = [
    '# branch.oid abcdef1234567890',
    '# branch.head feat/git-band',
    '# branch.upstream origin/feat/git-band',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb hooks/a.ts',
    '1 M. N... 100644 100644 100644 aaa bbb hooks/b.ts',
    '1 MM N... 100644 100644 100644 aaa bbb hooks/c.ts',
    '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
    'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
    '? notes.md',
    '? tmp/',
  ].join('\n')
  expect(parseStatus(out)).toEqual({ branch: 'feat/git-band', modified: 3, staged: 4, untracked: 2, ahead: 2, behind: 1 })
  expect(parseStatus('# branch.oid abcdef1234567890\n# branch.head (detached)\n').branch).toBe('@abcdef1')
  expect(parseStatus('')).toEqual({ branch: '', modified: 0, staged: 0, untracked: 0, ahead: 0, behind: 0 })
})

test('worktreeName is set only for a linked worktree', () => {
  expect(worktreeName('/r/.git\n/r/.git\n/r\n')).toBeUndefined()
  expect(worktreeName('/r/.git/worktrees/fix-x\n/r/.git\n/w/fix-x\n')).toBe('fix-x')
  expect(worktreeName('')).toBeUndefined()
})

test('fmtDuration, tmux window parsing and lookups', () => {
  expect([0, 45_000, 83_000, 600_000, 3_720_000].map(fmtDuration)).toEqual(['0s', '45s', '1m23s', '10m00s', '1h02m'])
  const windows = parseWindows('@1 bash\n@7 altro·abcdef12\n@9 mio-slug\n')
  expect(windows).toEqual([
    { id: '@1', name: 'bash' },
    { id: '@7', name: 'altro·abcdef12' },
    { id: '@9', name: 'mio-slug' },
  ])
  expect(windowOfSession(windows, 'abcdef1234')?.id).toBe('@7')
  expect(windowOfVertical(windows, { id: 'zzzzzzzz1', slug: 'mio-slug' })?.id).toBe('@9')
  expect(windowOfVertical(windows, { id: 'abcdef12xx', slug: 'altro-slug' })?.id).toBe('@7')
  expect(windowOfVertical(windows, { id: 'nope', slug: 'nope' })).toBeUndefined()
})

// The props of every Text matching, to check colors (findAll's own filter ignores them).
const propsOf = async (ui: { findAll: (q: never) => Promise<{ props?: unknown }[]> }, text: string | RegExp) =>
  (await ui.findAll({ type: 'Text', text } as never)).map(n => n.props)

const done = { answer: 'ok', durationMs: 45_000, isAborted: false, turnId: 't1', reason: 'answer' } as never

test('the band shows git branch, counts and the linked worktree', async ($, on) => {
  let isRepo = true
  on('turn.complete', () => ({ text: '' }) as never)
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    if (argv[0] !== 'git' || !isRepo) return result('', 128)
    if (argv[2] === 'rev-parse') return result('/r/.git/worktrees/fix-x\n/r/.git\n/w/fix-x\n')
    return result('# branch.head feat/x\n# branch.ab +3 -0\n1 .M N... a b c d e f.ts\n1 A. N... a b c d e g.ts\n? h.ts\n')
  })
  on('store.set', () => ({ value: undefined }))
  const clock = mock.clock(on)
  await $.turn.complete(done)
  await clock.settle()
  const band = await $.ui.mount(BAND)
  expect(await band.findAll({ type: 'Text', text: '⎇ fix-x ' })).toHaveLength(1)
  expect(await propsOf(band, 'feat/x')).toEqual([{ color: 'cyan' }])
  expect(await propsOf(band, ' ●1')).toEqual([{ color: 'yellow' }])
  expect(await propsOf(band, ' ↑3')).toEqual([{ dimColor: true }])
  expect(await band.findAll({ type: 'Text', text: ' +1' })).toHaveLength(1)
  expect(await band.findAll({ type: 'Text', text: ' ?1' })).toHaveLength(1)
  expect(await band.findAll({ type: 'Text', text: ' ↑3' })).toHaveLength(1)
  // Zero counts leave no text.
  expect(await band.findAll({ type: 'Text', text: /↓/ })).toHaveLength(0)
  await band.press({ key: 'menu' })
  expect(await band.findAll({ type: 'Button', text: '☑ git' })).toHaveLength(1)
  await band.press({ key: 'pref-bandGit' })
  expect(await band.findAll({ type: 'Text', text: 'feat/x' })).toHaveLength(0)
  await band.press({ key: 'pref-bandGit' })
  // Not a repo: no segment.
  isRepo = false
  await $.turn.complete(done)
  await clock.settle()
  expect(await band.findAll({ type: 'Text', text: 'feat/x' })).toHaveLength(0)
})

test('turn timer runs while a turn does and keeps the last duration after', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('process.run', () => result('', 128))
  on('store.set', () => ({ value: undefined }))
  const band = await $.ui.mount(BAND)
  expect(await band.findAll({ type: 'Text', text: /⏱/ })).toHaveLength(0)
  await $.turn.start({ text: 'ciao', turnId: 't1' })
  expect(await propsOf(band, '⏱ 0s')).toEqual([{ color: 'cyan' }])
  // A subagent's turn does not restart the timer.
  clock.set(1_010_000)
  await $.turn.start({ text: '', turnId: 't2', agentId: 'a1' })
  await $.turn.complete({ ...(done as object), agentId: 'a1', durationMs: 3000 } as never)
  expect(await band.findAll({ type: 'Text', text: /⏱ 3s/ })).toHaveLength(0)
  await $.turn.complete(done)
  expect(await propsOf(band, '⏱ 45s')).toEqual([{ dimColor: true }])
  await band.press({ key: 'menu' })
  expect(await band.findAll({ type: 'Button', text: '☑ turno' })).toHaveLength(1)
  await band.press({ key: 'pref-bandTurn' })
  expect(await band.findAll({ type: 'Text', text: /⏱/ })).toHaveLength(0)
})

// Runs notify-send/tmux are mocked: nothing real is sent. notify is fired
// and forgotten, so a test drains pending work before looking at the runs.
const drain = () => new Promise(r => setTimeout(r, 10))
const agentNow = { status: 'running' as AgentStatus }
const notifySetup = (on: Parameters<TestBody>[1], env: Record<string, string>, active = () => '11') => {
  const runs: string[][] = []
  on('env.get', ($, e) => ({ value: env[(e as { name: string }).name] }))
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'cur' }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', ($, e) => {
    runs.push(['fs.write', (e as { path: string }).path])
    return { value: undefined }
  })
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'audit file', type: 'Explore', status: agentNow.status }] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    if (argv[0] === 'python3') return result('Fix notifiche\n')
    return result(argv[1] === 'display-message' ? `${active()}\n` : '')
  })
  return runs
}

const finishAgent = async ($: Parameters<TestBody>[0]) => {
  agentNow.status = 'running'
  await $.command.run({ command: 'agenti', args: '' } as never)
  agentNow.status = 'completed'
  await $.command.run({ command: 'agenti', args: '' } as never)
  await drain()
}

test('a finished agent sends a desktop notification outside tmux', async ($, on) => {
  const runs = notifySetup(on, { HOME: '/h' })
  await finishAgent($)
  expect(runs.filter(r => r[0] === 'notify-send')).toEqual([
    ['notify-send', '-a', 'Claude', '-h', 'string:desktop-entry:claude-multi-view', '-i', 'dialog-information', '-u', 'normal', 'repo · Fix notifiche', 'Agente finito: audit file'],
  ])
  expect(runs.filter(r => r[0] === 'fs.write')).toEqual([['fs.write', '/h/.local/share/applications/claude-multi-view.desktop']])
})

test('in tmux the notification is skipped only when this window is the one in view', async ($, on) => {
  let active = '11'
  const runs = notifySetup(on, { TMUX_PANE: '%3' }, () => active)
  await finishAgent($)
  expect(runs.some(r => r[1] === 'display-message' && r.includes('%3'))).toBe(true)
  expect(runs.filter(r => r[0] === 'notify-send')).toHaveLength(0)
  active = '01'
  await finishAgent($)
  expect(runs.filter(r => r[0] === 'notify-send')).toHaveLength(1)
})

test('limit thresholds and inbox messages notify, and the pane switch turns it off', async ($, on) => {
  const runs = notifySetup(on, {})
  on('store.set', () => ({ value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.receive', ($, e) => ({ text: e.text }))
  on('clock.now', () => ({ value: 1 }))
  await $.session.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 85 }], changed: ['rateLimits'] } as never)
  await $.session.receive({ origin: { kind: 'peer', teammate: 'verticale-a' }, text: 'Finito. Resta il README' } as never)
  await drain()
  expect(runs.filter(r => r[0] === 'notify-send').map(r => r.slice(3))).toEqual([
    ['-h', 'string:desktop-entry:claude-multi-view', '-i', 'dialog-warning', '-u', 'normal', 'repo · Fix notifiche', "Limite 5h all'85%"],
    ['-h', 'string:desktop-entry:claude-multi-view', '-i', 'mail-unread', '-u', 'normal', 'repo · Fix notifiche', 'Da verticale-a:\nFinito. Resta il README'],
  ])
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'pane-menu' })
  expect(await ui.findAll({ type: 'Button', text: '☑ notifiche desktop' })).toHaveLength(1)
  await ui.press({ key: 'pref-notifyDesktop' })
  await $.session.receive({ origin: { kind: 'peer', teammate: 'altro' }, text: 'x' } as never)
  await drain()
  expect(runs.filter(r => r[0] === 'notify-send')).toHaveLength(2)
})

test('sessions with an open tmux window get a green dot, vai and a confirmed chiudi', async ($, on) => {
  const clock = mock.clock(on, { now: 120_000 })
  const runs: string[][] = []
  let windows = '@7 altro·oldoldol\n'
  const saved = [
    { id: 'cur', title: 'Questa chat', mtime: 1, isCurrent: true },
    { id: 'oldoldold', title: 'Sessione aperta', mtime: 1, isCurrent: false },
    { id: 'closed001', title: 'Sessione chiusa', mtime: 1, isCurrent: false },
  ]
  on('env.get', ($, e) => ({ value: (e as { name: string }).name === 'TMUX' ? '/tmp/tmux' : '/home/u' }))
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'cur' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    if (argv[0] === 'python3') {
      if (argv[2]?.endsWith('running_sessions.py')) return result('[]')
      return result(argv[2]?.endsWith('list_verticals.py') ? '[]' : JSON.stringify(saved))
    }
    if (argv[1] === 'kill-window') windows = ''
    return result(argv[1] === 'list-windows' ? windows : '')
  })
  await $.command.run({ command: 'sessioni', args: '' } as never)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await propsOf(ui, /^  ● $/)).toEqual([{ color: 'green' }])
  expect(await ui.findAll({ type: 'Button', text: 'vai' })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Button', key: 'go-closed001' } as never)).toHaveLength(0)
  expect(await ui.findAll({ type: 'Button', key: 'kill-cur' } as never)).toHaveLength(0)
  await ui.press({ key: 'go-oldoldold' })
  expect(runs.at(-1)).toEqual(['tmux', 'select-window', '-t', '@7'])
  // First press asks, nothing is killed yet; the timeout resets it.
  await ui.press({ key: 'kill-oldoldold' })
  expect(await ui.findAll({ type: 'Button', text: 'conferma?' })).toHaveLength(1)
  expect(runs.some(r => r[1] === 'kill-window')).toBe(false)
  await clock.advance(5000)
  expect(await ui.findAll({ type: 'Button', text: 'chiudi' })).toHaveLength(1)
  // vai in between also cancels a pending confirm.
  await ui.press({ key: 'kill-oldoldold' })
  await ui.press({ key: 'go-oldoldold' })
  expect(await ui.findAll({ type: 'Button', text: 'chiudi' })).toHaveLength(1)
  // Two presses kill the window and the mark goes away.
  await ui.press({ key: 'kill-oldoldold' })
  await ui.press({ key: 'kill-oldoldold' })
  expect(runs.filter(r => r[1] === 'kill-window')).toEqual([['tmux', 'kill-window', '-t', '@7']])
  expect(await ui.findAll({ type: 'Button', text: 'vai' })).toHaveLength(0)
})

test('the Verticali section lists this chat\'s verticals and jumps to their window', async ($, on) => {
  const toasts: string[] = []
  const runs: string[][] = []
  let running: object[] = []
  const verticals = [
    { id: 'v1aaaaaaa', slug: 'fix-banda', title: 'Sistema la banda del pannello con un titolo lungo', status: 'active', contextPercent: 42, createdAt: '2026-10-20' },
    { id: 'v2bbbbbbb', slug: 'docs', title: 'README', status: 'paused', contextPercent: null, createdAt: '2026-10-19' },
    { id: 'v3ccccccc', slug: 'vecchio', title: 'Finito', status: 'done', contextPercent: 7, createdAt: '2026-10-18' },
  ]
  on('env.get', ($, e) => ({ value: (e as { name: string }).name === 'TMUX' ? '/tmp/tmux' : '/home/u' }))
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'cur' }))
  on('clock.now', () => ({ value: 1 }))
  on('store.set', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    if (argv[0] === 'python3') {
      if (argv[2]?.endsWith('running_sessions.py')) return result(JSON.stringify(running))
      return result(argv[2]?.endsWith('list_verticals.py') ? JSON.stringify(verticals) : '[]')
    }
    return result(argv[1] === 'list-windows' ? '@1 bash\n@4 fix-banda\n@5 x·v3cccccc\n' : '')
  })
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /^Verticali$/ } as never)).toHaveLength(0)
  await $.command.run({ command: 'sessioni', args: '' } as never)
  const verticalsCall = runs.find(r => r[2]?.endsWith('list_verticals.py'))
  expect(verticalsCall?.slice(3)).toEqual(['/home/u/.claude/plugins/store', 'cur'])
  expect(await ui.findAll({ type: 'Text', text: /^Verticali$/ } as never)).toHaveLength(1)
  expect(await ui.findAll({ type: 'Button', text: '⑂ Verticali 1' })).toHaveLength(1)
  expect(await propsOf(ui, /^● $/)).toEqual([{ color: 'green', dimColor: false }])
  expect(await propsOf(ui, /^◐ $/)).toEqual([{ color: 'yellow', dimColor: false }])
  expect(await propsOf(ui, /^✓ $/)).toEqual([{ dimColor: true }])
  expect(await ui.findAll({ type: 'Text', text: ' ctx 42%' })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /fix-banda/ })).not.toHaveLength(0)
  await ui.press({ key: 'vgo-v1aaaaaaa' })
  expect(runs.at(-1)).toEqual(['tmux', 'select-window', '-t', '@4'])
  // Found by the ·id8 suffix when the slug does not match.
  await ui.press({ key: 'vgo-v3ccccccc' })
  expect(runs.at(-1)).toEqual(['tmux', 'select-window', '-t', '@5'])
  await ui.press({ key: 'vgo-v2bbbbbbb' })
  expect(toasts.at(-1)).toBe('Nessuna finestra tmux per docs')
  // The running registry wins, whatever the window is called.
  running = [{ sessionId: 'v2bbbbbbb', pid: 1, windowId: '@9', paneId: '%9' }]
  await ui.press({ key: 'vgo-v2bbbbbbb' })
  expect(runs.at(-1)).toEqual(['tmux', 'select-window', '-t', '@9'])
  running = [{ sessionId: 'v2bbbbbbb', pid: 1, windowId: null, paneId: null }]
  await ui.press({ key: 'vgo-v2bbbbbbb' })
  expect(toasts.at(-1)).toBe('Aperta fuori da tmux')
  running = []
  // Switch off: section and tab go.
  await ui.press({ key: 'pane-menu' })
  expect(await ui.findAll({ type: 'Button', text: '☑ verticali' })).toHaveLength(1)
  await ui.press({ key: 'pref-paneVerticals' })
  expect(await ui.findAll({ type: 'Text', text: /^Verticali$/ } as never)).toHaveLength(0)
  expect(await ui.findAll({ type: 'Button', key: 'tab-verticals' } as never)).toHaveLength(0)
})

test('a session in the running registry is never resumed twice', async ($, on) => {
  const runs: string[][] = []
  const toasts: string[] = []
  let running: object[] = []
  const saved = [
    { id: 'cur', title: 'Questa chat', mtime: 1, isCurrent: true },
    { id: 'runrunrun', title: 'Sessione viva', mtime: 1, isCurrent: false },
  ]
  on('env.get', ($, e) => ({ value: (e as { name: string }).name === 'TMUX' ? '/tmp/tmux' : '/home/u' }))
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'cur' }))
  on('clock.now', () => ({ value: 120_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text: string }).text))
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    if (argv[0] === 'python3') {
      if (argv[2]?.endsWith('running_sessions.py')) return result(JSON.stringify(running))
      return result(argv[2]?.endsWith('list_verticals.py') ? '[]' : JSON.stringify(saved))
    }
    return result(argv[1] === 'list-windows' ? '@1 bash\n@12 chat originale\n' : '')
  })
  await $.command.run({ command: 'sessioni', args: '' } as never)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Button', text: 'vai' })).toHaveLength(0)
  // Started after the list was loaded: resume reloads the registry first.
  running = [{ sessionId: 'runrunrun', pid: 1, windowId: '@12', paneId: '%12' }]
  await ui.press({ key: 'resume-runrunrun' })
  await ui.press({ key: 'resume-runrunrun' })
  expect(runs.some(r => r[1] === 'new-window')).toBe(false)
  expect(runs.at(-1)).toEqual(['tmux', 'select-window', '-t', '@12'])
  expect(toasts.at(-1)).toBe('Già aperta: salto alla finestra')
  // The window is not named ·id8: the dot, vai and chiudi still show.
  expect(await ui.findAll({ type: 'Button', key: 'go-runrunrun' } as never)).toHaveLength(1)
  expect(await ui.findAll({ type: 'Button', key: 'kill-runrunrun' } as never)).toHaveLength(1)
  // Running outside tmux: no window to jump to, no chiudi, no new process.
  running = [{ sessionId: 'runrunrun', pid: 1, windowId: null, paneId: null }]
  await ui.press({ key: 'resume-runrunrun' })
  expect(toasts.at(-1)).toBe('Già aperta fuori da tmux')
  expect(runs.some(r => r[1] === 'new-window')).toBe(false)
  expect(await ui.findAll({ type: 'Button', key: 'kill-runrunrun' } as never)).toHaveLength(0)
  await ui.press({ key: 'go-runrunrun' })
  expect(toasts.at(-1)).toBe('Aperta fuori da tmux')
})
