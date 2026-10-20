export type AgentRow = {
  id: string
  label: string
  type: string
  status: string
  parentId?: string
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type SavedSession = { id: string; title: string; mtime: number; isCurrent: boolean; pacaRef?: string | null }

export type PacaProject = { id: string; name: string; prefix: string; server: string }

export type PacaTask = {
  id: string
  ref: string
  title: string
  statusId: string
  typeId: string
  status: string
  category: string
  updated: string
}

export type GitInfo = {
  branch: string
  worktree?: string
  modified: number
  staged: number
  untracked: number
  ahead: number
  behind: number
}

export type TmuxWindow = { id: string; name: string }

export type Vertical = {
  id: string
  slug: string
  title: string
  status: 'active' | 'paused' | 'done'
  contextPercent: number | null
}

export type Tab = 'all' | 'limits' | 'agents' | 'sessions' | 'verticals' | 'paca' | 'inbox'

export type TabStyle = 'both' | 'icon' | 'name'

export type Prefs = {
  tab: Tab
  tabStyle: TabStyle
  bandLimits: boolean
  bandCtx: boolean
  bandChat: boolean
  bandPaca: boolean
  bandAgents: boolean
  bandInbox: boolean
  bandGit: boolean
  bandTurn: boolean
  paneLimits: boolean
  paneAgents: boolean
  panePaca: boolean
  paneSessions: boolean
  paneInbox: boolean
  paneVerticals: boolean
  notifyDesktop: boolean
  openPaneAtStart: boolean
}

export type InboxItem = { at: number; from: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'multi-view': {
      agents: AgentRow[]
      inbox: InboxItem[]
      chat: string
      limits: Limit[]
      now: number
      resetClock: boolean
      sessions: SavedSession[]
      showSessions: boolean
      pacaProject: PacaProject | null
      pacaTasks: PacaTask[]
      pacaActive: PacaTask | null
      pacaBacklog: number
      ctx: number | null
      showPaca: boolean
      prefs: Prefs
      showMenu: boolean
      showPaneMenu: boolean
      openMsg: number | null
      gitInfo: GitInfo | null
      turnStart: number | null
      turnLast: number | null
      tick: number
      tmuxWindows: TmuxWindow[]
      killPending: string | null
      verticals: Vertical[]
    }
  }
}
