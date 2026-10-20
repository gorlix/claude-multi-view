import type { GitInfo } from '../types'

// Pure parsers for the band's git segment: no `$`, only strings in and out.

// `git status --porcelain=v2 --branch` -> branch and counts. Entry lines are
// "1 XY ..." (changed), "2 XY ..." (renamed), "u XY ..." (unmerged), "? path".
export const parseStatus = (out: string): Omit<GitInfo, 'worktree'> => {
  const info = { branch: '', modified: 0, staged: 0, untracked: 0, ahead: 0, behind: 0 }
  let oid = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) info.branch = line.slice(14).trim()
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      info.ahead = Number(m?.[1] ?? 0)
      info.behind = Number(m?.[2] ?? 0)
    } else if (line.startsWith('? ')) info.untracked++
    else if (/^[12u] /.test(line)) {
      const xy = line.slice(2, 4)
      if (xy[0] && xy[0] !== '.') info.staged++
      if (xy[1] && xy[1] !== '.') info.modified++
    }
  }
  // A detached HEAD has no name: show the short commit instead.
  if (info.branch === '(detached)') info.branch = `@${oid.slice(0, 7)}`
  return info
}

// `git rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel`
// -> the folder name of a linked worktree, undefined in the main one.
export const worktreeName = (out: string): string | undefined => {
  const [gitDir, common, top] = out.split('\n').map(l => l.trim())
  if (!gitDir || !common || !top || gitDir === common) return undefined
  return top.split('/').filter(Boolean).pop()
}

export const sameGit = (a: GitInfo | null, b: GitInfo | null) => JSON.stringify(a) === JSON.stringify(b)
