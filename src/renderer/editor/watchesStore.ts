/**
 * US-022: Pure helpers for the Watch expressions panel.
 *
 * Watches are stored as an ordered list of {id, expression, value, error}
 * tuples. Values are populated asynchronously by the panel/App via
 * `disp(expression)` IPC calls against the running Octave process. Keeping
 * the data-structure mutations in pure helpers makes them unit-testable in
 * node without mounting React.
 */

export interface WatchEntry {
  /** Stable opaque id used as React key and for targeted updates. */
  id: string
  /** Raw Octave expression (e.g. `x`, `length(data)`, `foo.bar(1)`). */
  expression: string
  /**
   * Most recent value preview (typically the trimmed output of
   * `disp(expression)`). `null` before the first evaluation, `''` for
   * expressions that produce no output.
   */
  value: string | null
  /**
   * Last evaluation error (e.g. "error: 'x' undefined"). `null` when the
   * previous evaluation succeeded. Fatal errors do NOT remove the entry —
   * the expression stays pinned so the user can fix it and continue.
   */
  error: string | null
}

let nextWatchId = 1

/** Mint a new {@link WatchEntry} with a fresh id. */
export function createWatch(expression: string): WatchEntry {
  return {
    id: `watch-${nextWatchId++}`,
    expression,
    value: null,
    error: null,
  }
}

/**
 * Append a watch to the list. Empty/whitespace-only expressions are ignored
 * (returns the original list unchanged) so an accidental Enter press on an
 * empty input is a no-op.
 */
export function addWatch(watches: WatchEntry[], expression: string): WatchEntry[] {
  const trimmed = expression.trim()
  if (trimmed === '') return watches
  return [...watches, createWatch(trimmed)]
}

/** Remove a watch by id. Returns a new array. */
export function removeWatch(watches: WatchEntry[], id: string): WatchEntry[] {
  return watches.filter((w) => w.id !== id)
}

/**
 * Update a watch's expression by id. Clears the previous value/error since
 * the old readings no longer describe the new expression. Empty edits are
 * treated as a delete (returns the list minus that entry) so users can
 * blank a row to remove it.
 */
export function updateWatchExpression(
  watches: WatchEntry[],
  id: string,
  expression: string,
): WatchEntry[] {
  const trimmed = expression.trim()
  if (trimmed === '') return removeWatch(watches, id)
  return watches.map((w) =>
    w.id === id ? { ...w, expression: trimmed, value: null, error: null } : w,
  )
}

/** Record a successful evaluation result for the given watch id. */
export function setWatchValue(
  watches: WatchEntry[],
  id: string,
  value: string,
): WatchEntry[] {
  return watches.map((w) =>
    w.id === id ? { ...w, value, error: null } : w,
  )
}

/** Record a failed evaluation for the given watch id. */
export function setWatchError(
  watches: WatchEntry[],
  id: string,
  error: string,
): WatchEntry[] {
  return watches.map((w) =>
    w.id === id ? { ...w, value: null, error } : w,
  )
}

/**
 * Clear value/error fields on every watch — used when Octave disconnects
 * or the debugger resumes, so stale readings aren't shown as current.
 */
export function clearWatchValues(watches: WatchEntry[]): WatchEntry[] {
  return watches.map((w) => ({ ...w, value: null, error: null }))
}

/**
 * Format the raw output of `disp(expression)` into a single-line preview
 * suitable for the panel row. Octave's `disp` typically emits a trailing
 * newline; multi-row values become space-separated tokens and very long
 * strings are truncated with a `…`.
 */
export function formatWatchValue(raw: string, maxLen: number = 120): string {
  if (raw == null) return ''
  const collapsed = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .join(' ')
  if (collapsed.length <= maxLen) return collapsed
  return collapsed.slice(0, maxLen - 1) + '…'
}

/**
 * Build the Octave command that evaluates an expression and prints its
 * value. We wrap in try/catch so a bad expression doesn't print to Octave's
 * stderr and doesn't abort the caller's command queue.
 */
export function buildWatchCommand(expression: string): string {
  // Escape single-quotes for the error branch's literal expression string.
  const escaped = expression.replace(/'/g, "''")
  return `try; disp(${expression}); catch err; printf('__MSLP_WATCH_ERR__:%s\\n', err.message); end`
}

/**
 * Parse the raw output of {@link buildWatchCommand}. Returns either
 * `{ok: true, value}` when disp succeeded or `{ok: false, error}` when the
 * inner catch fired its `__MSLP_WATCH_ERR__` marker.
 */
export function parseWatchOutput(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: '' }
  const marker = '__MSLP_WATCH_ERR__:'
  const idx = raw.indexOf(marker)
  if (idx >= 0) {
    const tail = raw.slice(idx + marker.length)
    const eol = tail.indexOf('\n')
    const message = (eol >= 0 ? tail.slice(0, eol) : tail).trim()
    return { ok: false, error: message || 'error' }
  }
  return { ok: true, value: raw }
}

/** Reset the id sequence. Test-only hook so id strings stay deterministic. */
export function __resetWatchIdsForTests(): void {
  nextWatchId = 1
}
