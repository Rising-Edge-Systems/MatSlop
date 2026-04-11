import { describe, it, expect } from 'vitest'
import {
  parseGitStatusPorcelain,
  parseUnifiedDiff,
  statusBadge,
  validateCommitMessage,
  buildStatusBadgeMap,
  posixJoin,
} from '../../src/renderer/git/gitCore'

describe('parseGitStatusPorcelain', () => {
  it('parses an empty status', () => {
    expect(parseGitStatusPorcelain('')).toEqual([])
  })

  it('parses unstaged modified', () => {
    const result = parseGitStatusPorcelain(' M src/foo.ts')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      path: 'src/foo.ts',
      indexStatus: ' ',
      workTreeStatus: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      badge: 'M',
    })
  })

  it('parses staged modified', () => {
    const result = parseGitStatusPorcelain('M  src/foo.ts')
    expect(result[0]).toMatchObject({ staged: true, unstaged: false, badge: 'M' })
  })

  it('parses both staged and unstaged on same file', () => {
    const result = parseGitStatusPorcelain('MM src/foo.ts')
    expect(result[0]).toMatchObject({ staged: true, unstaged: true, badge: 'M' })
  })

  it('parses untracked files', () => {
    const result = parseGitStatusPorcelain('?? src/new.ts')
    expect(result[0]).toMatchObject({ untracked: true, staged: false, unstaged: false, badge: '?' })
  })

  it('parses added (staged) files', () => {
    const result = parseGitStatusPorcelain('A  src/new.ts')
    expect(result[0].badge).toBe('A')
    expect(result[0].staged).toBe(true)
  })

  it('parses deleted files', () => {
    const result = parseGitStatusPorcelain(' D src/gone.ts')
    expect(result[0].badge).toBe('D')
    expect(result[0].unstaged).toBe(true)
  })

  it('parses renames with origPath', () => {
    const result = parseGitStatusPorcelain('R  old.ts -> new.ts')
    expect(result[0]).toMatchObject({
      path: 'new.ts',
      origPath: 'old.ts',
      badge: 'R',
      staged: true,
    })
  })

  it('parses multiple entries', () => {
    const raw = [
      ' M src/a.ts',
      'M  src/b.ts',
      '?? src/c.ts',
      '',
    ].join('\n')
    expect(parseGitStatusPorcelain(raw)).toHaveLength(3)
  })

  it('handles unmerged files (U)', () => {
    const result = parseGitStatusPorcelain('UU conflict.ts')
    expect(result[0].badge).toBe('U')
  })
})

describe('statusBadge', () => {
  it('prefers ? for untracked', () => {
    expect(statusBadge('?', '?')).toBe('?')
  })
  it('prefers U for unmerged', () => {
    expect(statusBadge('U', 'U')).toBe('U')
    expect(statusBadge('D', 'D')).toBe('U')
  })
  it('returns M for modified', () => {
    expect(statusBadge('M', ' ')).toBe('M')
    expect(statusBadge(' ', 'M')).toBe('M')
  })
  it('returns empty for clean pair', () => {
    expect(statusBadge(' ', ' ')).toBe('')
  })
})

describe('buildStatusBadgeMap', () => {
  it('maps relative paths to absolute via the join fn', () => {
    const entries = parseGitStatusPorcelain(' M src/foo.ts\n?? src/bar.ts')
    const map = buildStatusBadgeMap(entries, '/repo', posixJoin)
    expect(map.get('/repo/src/foo.ts')).toBe('M')
    expect(map.get('/repo/src/bar.ts')).toBe('?')
  })
})

describe('parseUnifiedDiff', () => {
  it('handles empty input', () => {
    const result = parseUnifiedDiff('')
    expect(result.empty).toBe(true)
    expect(result.hunks).toHaveLength(0)
  })

  it('parses a simple hunk', () => {
    const raw = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1234567..89abcdef 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' unchanged line',
      '-deleted line',
      '+added line 1',
      '+added line 2',
      ' another unchanged',
    ].join('\n')
    const result = parseUnifiedDiff(raw)
    expect(result.empty).toBe(false)
    expect(result.oldPath).toBe('foo.ts')
    expect(result.newPath).toBe('foo.ts')
    expect(result.hunks).toHaveLength(1)
    const hunk = result.hunks[0]
    expect(hunk.oldStart).toBe(1)
    expect(hunk.newStart).toBe(1)
    expect(hunk.lines.filter((l) => l.kind === 'add')).toHaveLength(2)
    expect(hunk.lines.filter((l) => l.kind === 'del')).toHaveLength(1)
    expect(hunk.lines.filter((l) => l.kind === 'context')).toHaveLength(2)
  })

  it('tracks old/new line numbers across context', () => {
    const raw = [
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -10,2 +10,3 @@',
      ' x',
      '+y',
      ' z',
    ].join('\n')
    const result = parseUnifiedDiff(raw)
    const h = result.hunks[0]
    expect(h.lines[0]).toMatchObject({ kind: 'context', oldLine: 10, newLine: 10 })
    expect(h.lines[1]).toMatchObject({ kind: 'add', newLine: 11 })
    expect(h.lines[2]).toMatchObject({ kind: 'context', oldLine: 11, newLine: 12 })
  })

  it('parses multiple hunks', () => {
    const raw = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '@@ -5,1 +5,1 @@',
      '-c',
      '+d',
    ].join('\n')
    expect(parseUnifiedDiff(raw).hunks).toHaveLength(2)
  })
})

describe('validateCommitMessage', () => {
  it('rejects empty', () => {
    expect(validateCommitMessage('').valid).toBe(false)
    expect(validateCommitMessage('   ').valid).toBe(false)
  })
  it('accepts non-empty', () => {
    expect(validateCommitMessage('fix: bug').valid).toBe(true)
  })
})
