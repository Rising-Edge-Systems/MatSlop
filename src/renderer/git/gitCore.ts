/**
 * US-037: Pure git helpers used by both main and renderer.
 *
 * Parses `git status --porcelain=v1 -z` / `-z` output, maps status codes
 * to human-friendly badges, and turns unified-diff text into a structured
 * list of hunks for the diff viewer. No side effects, no fs, no electron —
 * safe to import from either bundle and unit-test under vitest.
 */

/** Raw status entry parsed from `git status --porcelain` one line at a time. */
export interface GitStatusEntry {
  /** File path relative to the repo root. */
  path: string
  /** Optional original path when the entry is a rename (XY = 'R '). */
  origPath?: string
  /** Index (staged) status char. Space means "unmodified in the index". */
  indexStatus: string
  /** Worktree (unstaged) status char. Space means "unmodified in wt". */
  workTreeStatus: string
  /** True when the entry has at least one staged change. */
  staged: boolean
  /** True when the entry has at least one unstaged change. */
  unstaged: boolean
  /** True when the file is untracked (`??`). */
  untracked: boolean
  /** Single-letter badge: M/A/D/R/U/? for the file-browser overlay. */
  badge: string
}

/**
 * Parse the output of `git status --porcelain=v1` (NOT -z — we accept
 * newline-delimited lines so vitest can feed plain fixture strings).
 *
 * Lines look like:
 *   ` M src/foo.ts`         — unstaged modified
 *   `M  src/foo.ts`         — staged modified
 *   `MM src/foo.ts`         — staged and unstaged
 *   `?? src/foo.ts`         — untracked
 *   `R  old.ts -> new.ts`   — rename
 */
export function parseGitStatusPorcelain(raw: string): GitStatusEntry[] {
  if (!raw) return []
  const entries: GitStatusEntry[] = []
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (!line || line.length < 3) continue
    const xy = line.substring(0, 2)
    const rest = line.substring(3)
    const indexStatus = xy[0]
    const workTreeStatus = xy[1]
    let pathPart = rest
    let origPath: string | undefined
    if ((indexStatus === 'R' || indexStatus === 'C') && rest.includes(' -> ')) {
      const [o, n] = rest.split(' -> ')
      origPath = o
      pathPart = n
    }
    const untracked = xy === '??'
    const staged = !untracked && indexStatus !== ' ' && indexStatus !== '?'
    const unstaged = !untracked && workTreeStatus !== ' ' && workTreeStatus !== '?'
    const badge = statusBadge(indexStatus, workTreeStatus)
    entries.push({
      path: pathPart,
      origPath,
      indexStatus,
      workTreeStatus,
      staged,
      unstaged,
      untracked,
      badge,
    })
  }
  return entries
}

/**
 * Reduce an XY pair to the single-letter badge we paint on the file
 * browser. Priority: untracked > unresolved > modified/added/deleted/renamed.
 */
export function statusBadge(indexStatus: string, workTreeStatus: string): string {
  if (indexStatus === '?' || workTreeStatus === '?') return '?'
  if (indexStatus === 'U' || workTreeStatus === 'U' || (indexStatus === 'D' && workTreeStatus === 'D')) return 'U'
  if (indexStatus === 'A' || workTreeStatus === 'A') return 'A'
  if (indexStatus === 'R' || workTreeStatus === 'R') return 'R'
  if (indexStatus === 'D' || workTreeStatus === 'D') return 'D'
  if (indexStatus === 'M' || workTreeStatus === 'M') return 'M'
  if (indexStatus === 'C' || workTreeStatus === 'C') return 'C'
  return ''
}

/**
 * Build a lookup map: absolute file path → badge. Caller passes the repo
 * root so the relative paths in the porcelain output can be resolved.
 */
export function buildStatusBadgeMap(
  entries: GitStatusEntry[],
  repoRoot: string,
  pathJoin: (root: string, rel: string) => string,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of entries) {
    map.set(pathJoin(repoRoot, entry.path), entry.badge)
  }
  return map
}

/** One hunk (pair of @@ lines + body) from a unified diff. */
export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

/** One line inside a hunk. */
export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  text: string
  /** 1-based line number in the old file (undefined for additions). */
  oldLine?: number
  /** 1-based line number in the new file (undefined for deletions). */
  newLine?: number
}

/** Parsed diff for a single file. */
export interface ParsedDiff {
  oldPath: string | null
  newPath: string | null
  hunks: DiffHunk[]
  /** True when the diff has no hunks (e.g. mode change only). */
  empty: boolean
}

/**
 * Parse the output of `git diff <path>` or `git diff --cached <path>`
 * for a SINGLE file. Handles a single `diff --git ...` block.
 *
 * The parser is intentionally small — just enough to drive a side-by-side
 * viewer. Binary diffs come back with `empty: true` and no hunks.
 */
export function parseUnifiedDiff(raw: string): ParsedDiff {
  const result: ParsedDiff = { oldPath: null, newPath: null, hunks: [], empty: true }
  if (!raw) return result
  const lines = raw.split(/\r?\n/)
  let i = 0
  // Skip to first hunk or header.
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(line)
      if (match) {
        result.oldPath = match[1]
        result.newPath = match[2]
      }
      i++
      continue
    }
    if (line.startsWith('--- ')) {
      const v = line.substring(4)
      if (v !== '/dev/null' && v.startsWith('a/')) result.oldPath = v.substring(2)
      i++
      continue
    }
    if (line.startsWith('+++ ')) {
      const v = line.substring(4)
      if (v !== '/dev/null' && v.startsWith('b/')) result.newPath = v.substring(2)
      i++
      continue
    }
    if (line.startsWith('@@')) break
    i++
  }
  while (i < lines.length) {
    const line = lines[i]
    if (!line.startsWith('@@')) {
      i++
      continue
    }
    const hdr = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!hdr) {
      i++
      continue
    }
    const oldStart = parseInt(hdr[1], 10)
    const oldLines = hdr[2] ? parseInt(hdr[2], 10) : 1
    const newStart = parseInt(hdr[3], 10)
    const newLines = hdr[4] ? parseInt(hdr[4], 10) : 1
    const hunk: DiffHunk = { header: line, oldStart, oldLines, newStart, newLines, lines: [] }
    i++
    let oldCursor = oldStart
    let newCursor = newStart
    while (i < lines.length) {
      const l = lines[i]
      if (l.startsWith('@@') || l.startsWith('diff --git ')) break
      if (l.startsWith('+')) {
        hunk.lines.push({ kind: 'add', text: l.substring(1), newLine: newCursor })
        newCursor++
      } else if (l.startsWith('-')) {
        hunk.lines.push({ kind: 'del', text: l.substring(1), oldLine: oldCursor })
        oldCursor++
      } else if (l.startsWith(' ')) {
        hunk.lines.push({ kind: 'context', text: l.substring(1), oldLine: oldCursor, newLine: newCursor })
        oldCursor++
        newCursor++
      } else if (l.startsWith('\\')) {
        // "\ No newline at end of file" — skip.
      } else if (l === '') {
        // Treat blank lines as context lines too.
        hunk.lines.push({ kind: 'context', text: '', oldLine: oldCursor, newLine: newCursor })
        oldCursor++
        newCursor++
      } else {
        break
      }
      i++
    }
    result.hunks.push(hunk)
    result.empty = false
  }
  return result
}

/**
 * Quick sanity check on a commit message: trims whitespace and fails
 * empty. Extra rules like subject-line length can grow here later.
 */
export function validateCommitMessage(msg: string): { valid: boolean; error?: string } {
  const trimmed = msg.trim()
  if (!trimmed) return { valid: false, error: 'Commit message is required' }
  return { valid: true }
}

/** Path-agnostic join (used in buildStatusBadgeMap unit tests). */
export function posixJoin(root: string, rel: string): string {
  if (!root) return rel
  if (root.endsWith('/') || root.endsWith('\\')) return root + rel
  return root + '/' + rel
}
