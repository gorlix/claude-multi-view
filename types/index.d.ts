export type AgentRow = {
  id: string
  label: string
  type: string
  status: string
  parentId?: string
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type SavedSession = { id: string; title: string; mtime: number; isCurrent: boolean }

export type PacaProject = { id: string; name: string; prefix: string; server: string }

export type PacaTask = {
  id: string
  ref: string
  title: string
  statusId: string
  status: string
  category: string
  updated: string
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
      sessions: SavedSession[]
      showSessions: boolean
      pacaProject: PacaProject | null
      pacaTasks: PacaTask[]
      pacaActive: PacaTask | null
      showPaca: boolean
    }
  }
}
