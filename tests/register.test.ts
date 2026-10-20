import type { AgentStatus } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { ctxTone } from '../hooks/ui'

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
    const stdout = argv[0] === 'python3' ? JSON.stringify(saved) : argv[1] === 'list-windows' ? windows : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run({ command: 'sessioni', args: '' } as never)
  expect(runs[0]?.[3]).toBe('/home/u/.claude/projects/-home-u-repo')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /Questa chat \(questa\)/ })).toHaveLength(1)
  await ui.press({ key: 'resume-old' })
  expect(await ui.findAll({ type: 'Text', text: /ACME-3/ })).toHaveLength(1)
  await ui.press({ key: 'resume-old' })
  expect(runs.at(-1)).toEqual(['tmux', 'new-window', '-c', '/home/u/repo', '-n', 'MCP Proxmox e cluster·old', 'claude', '--resume', 'old'])

  // A window already named for that session is selected, not duplicated.
  windows = '@1 bash\n@7 altro·old\n'
  const before = runs.length
  await ui.press({ key: 'resume-old' })
  expect(runs.slice(before).map(r => r[1])).toEqual(['list-windows', 'select-window'])
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
