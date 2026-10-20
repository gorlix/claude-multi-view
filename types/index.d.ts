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

export type Tab = 'all' | 'limits' | 'agents' | 'sessions' | 'paca' | 'inbox'

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
  paneLimits: boolean
  paneAgents: boolean
  panePaca: boolean
  paneSessions: boolean
  paneInbox: boolean
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
    }
  }
}
