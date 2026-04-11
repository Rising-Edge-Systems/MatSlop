/**
 * US-032: Find in Files — pure helpers for the Find-in-Files feature.
 *
 * This module contains no React/DOM/Electron imports so it can be unit
 * tested in node. The matching logic here is used by BOTH the renderer
 * (FindInFilesPanel's display) and the main process (the `find:inFiles`
 * IPC that walks the filesystem). Sharing a single helper keeps glob and
 * match semantics consistent between the two sides.
 */

/** A single match found inside one file. */
export interface FindMatch {
  /** Absolute or relative file path (as passed to the search). */
  file: string
  /** 1-based line number. */
  line: number
  /** 1-based column number of the start of the match. */
  column: number
  /** Full line text (trimmed of trailing newline) for display context. */
  text: string
}

export interface SearchOptions {
  /** Case-insensitive match. Default false. */
  caseInsensitive?: boolean
  /** Treat the query as a regular expression. Default false. */
  regex?: boolean
  /** Whole-word match (\b...\b). Default false. */
  wholeWord?: boolean
  /** Cap the number of matches returned per file. Default 500. */
  maxPerFile?: number
}

/**
 * Convert a simple glob pattern into a RegExp that matches a FILE NAME
 * (not a path). Supports `*` (any run of chars that is NOT a path sep),
 * `?` (any single non-sep char), character classes `[abc]`, and comma
 * -separated alternatives via `{a,b,c}`. Everything else is escaped.
 *
 * Examples:
 *   `*.m`     → /^[^/\\]*\.m$/
 *   `*.{m,mls}` → /^[^/\\]*\.(m|mls)$/
 *   `test_*.m` → /^test_[^/\\]*\.m$/
 */
export function globToRegExp(pattern: string): RegExp {
  if (!pattern) return /.^/ // matches nothing
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') {
      out += '[^/\\\\]*'
      i++
    } else if (ch === '?') {
      out += '[^/\\\\]'
      i++
    } else if (ch === '{') {
      // alternation — find matching close brace
      const close = pattern.indexOf('}', i + 1)
      if (close === -1) {
        out += '\\{'
        i++
      } else {
        const alts = pattern
          .substring(i + 1, close)
          .split(',')
          .map((p) => globToRegExp(p).source.slice(1, -1)) // strip ^ and $
        out += '(' + alts.join('|') + ')'
        i = close + 1
      }
    } else if (ch === '[') {
      // character class — copy through
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) {
        out += '\\['
        i++
      } else {
        out += pattern.substring(i, close + 1)
        i = close + 1
      }
    } else if ('\\^$.|+()'.includes(ch)) {
      out += '\\' + ch
      i++
    } else {
      out += ch
      i++
    }
  }
  return new RegExp('^' + out + '$')
}

/**
 * Test whether a file NAME (basename) matches any of the glob patterns.
 * A comma-separated list of patterns is also accepted (e.g. `*.m,*.mls`).
 * An empty / whitespace-only pattern means "match everything".
 */
export function matchesGlob(filename: string, globPattern: string): boolean {
  const trimmed = globPattern.trim()
  if (!trimmed) return true
  const parts = trimmed.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (parts.length === 0) return true
  for (const p of parts) {
    if (globToRegExp(p).test(filename)) return true
  }
  return false
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build the RegExp used to scan each line of file content.
 */
export function buildSearchRegex(query: string, opts: SearchOptions = {}): RegExp | null {
  if (!query) return null
  let source: string
  if (opts.regex) {
    try {
      // validate by constructing a throwaway
      new RegExp(query)
      source = query
    } catch {
      return null
    }
  } else {
    source = escapeRegExp(query)
  }
  if (opts.wholeWord) {
    source = '\\b' + source + '\\b'
  }
  const flags = opts.caseInsensitive ? 'gi' : 'g'
  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

/**
 * Search a single file's text content for all matches of `query`.
 * Returns one `FindMatch` per matching line (multiple hits on the same
 * line are collapsed to a single result pointing at the first hit —
 * common Find-in-Files UX). The `text` field is the full line.
 */
export function searchFileText(
  filePath: string,
  content: string,
  query: string,
  opts: SearchOptions = {},
): FindMatch[] {
  const regex = buildSearchRegex(query, opts)
  if (!regex) return []
  const maxPerFile = opts.maxPerFile ?? 500
  const matches: FindMatch[] = []
  // Split on \n but keep \r handling for windows content.
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]
    // Reset regex state for each line (we use /g).
    regex.lastIndex = 0
    const m = regex.exec(lineText)
    if (m) {
      matches.push({
        file: filePath,
        line: i + 1,
        column: m.index + 1,
        text: lineText,
      })
      if (matches.length >= maxPerFile) break
    }
  }
  return matches
}

/** Truncate a line of context to a readable length for list display. */
export function truncateContext(line: string, maxLen = 200): string {
  if (line.length <= maxLen) return line
  return line.substring(0, maxLen) + '…'
}
