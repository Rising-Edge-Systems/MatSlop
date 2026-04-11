/**
 * US-033: Pure helpers for the Profiler panel.
 *
 * Octave's built-in profiler is driven by `profile on` / `profile off`.
 * Reports are fetched via `profile('info')`, which returns a struct whose
 * `FunctionTable` is an array of per-function records with `FunctionName`,
 * `TotalTime`, and `NumCalls` fields. Rather than parse Octave's fixed-width
 * `profshow` output (which is fragile across versions), we emit one
 * printf-marked line per function:
 *
 *   __MSLP_PROF__|<name>|<totalTime>|<numCalls>
 *
 * The line format is tab-free, self-delimited, and easy to parse in the
 * renderer. Locating a function's source uses `which '<name>'` — Octave
 * prints the absolute path when found, an empty string (or `.m` variant
 * depending on build) when it's a built-in.
 */

export type ProfilerMode = 'idle' | 'running' | 'stopped'

/** One row in the profiler report table. */
export interface ProfilerEntry {
  /** Octave function name (e.g. `plot`, `mymod>helper`, `@anon`). */
  functionName: string
  /** Cumulative time spent in the function, in seconds. */
  totalTime: number
  /** Number of times the function was called. */
  numCalls: number
}

/** The Octave command that enables profiling. */
export function buildProfileStartCommand(): string {
  return 'profile on'
}

/**
 * The Octave command that disables profiling. Uses `profile off` rather
 * than `profile off; profile clear` so the next Report still captures the
 * last run's data.
 */
export function buildProfileStopCommand(): string {
  return 'profile off'
}

/** The Octave command that clears accumulated profiler data. */
export function buildProfileClearCommand(): string {
  return 'profile clear'
}

/**
 * Build the Octave command that prints the current profile report as a
 * sequence of `__MSLP_PROF__|<name>|<time>|<calls>` lines. Wrapped in a
 * try/catch so a profiler-never-started error is surfaced via a
 * `__MSLP_PROF_ERR__:<msg>` marker instead of leaking to the caller's
 * stderr and poisoning the command queue.
 *
 * The command uses temporary variables prefixed with `__mslp_` so it
 * doesn't collide with anything in the user's workspace, and clears them
 * at the end regardless of success path.
 */
export function buildProfileReportCommand(): string {
  // `profile('info')` is the preferred accessor since it does not toggle
  // the profiler state. We iterate FunctionTable, guard against the
  // field being absent, and emit one marker line per entry.
  return [
    'try;',
    '  __mslp_info = profile("info");',
    '  if (isstruct(__mslp_info) && isfield(__mslp_info, "FunctionTable"));',
    '    for __mslp_i = 1:numel(__mslp_info.FunctionTable);',
    '      __mslp_f = __mslp_info.FunctionTable(__mslp_i);',
    '      printf("__MSLP_PROF__|%s|%.9f|%d\\n", __mslp_f.FunctionName, __mslp_f.TotalTime, __mslp_f.NumCalls);',
    '    endfor;',
    '  endif;',
    'catch __mslp_err;',
    '  printf("__MSLP_PROF_ERR__:%s\\n", strrep(__mslp_err.message, char(10), " "));',
    'end_try_catch;',
    'clear __mslp_info __mslp_f __mslp_i __mslp_err;',
  ].join(' ')
}

/**
 * Parse the raw output of {@link buildProfileReportCommand}. Returns
 * `{ok: true, entries}` when one or more profiler rows were captured, or
 * `{ok: false, error}` when the inner try/catch emitted
 * `__MSLP_PROF_ERR__`. An empty-but-successful run returns
 * `{ok: true, entries: []}` — useful when profiling was enabled but no
 * functions have been called yet.
 */
export function parseProfileReport(
  raw: string,
): { ok: true; entries: ProfilerEntry[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, entries: [] }
  const text = String(raw).replace(/\r/g, '')
  // Error branch wins: if the Octave-side try/catch emitted a marker,
  // surface it verbatim even if some rows were emitted before the error.
  const errMarker = '__MSLP_PROF_ERR__:'
  const errIdx = text.indexOf(errMarker)
  if (errIdx >= 0) {
    const tail = text.slice(errIdx + errMarker.length)
    const eol = tail.indexOf('\n')
    const msg = (eol >= 0 ? tail.slice(0, eol) : tail).trim()
    return { ok: false, error: msg || 'profiler error' }
  }

  const entries: ProfilerEntry[] = []
  const marker = '__MSLP_PROF__|'
  for (const line of text.split('\n')) {
    const idx = line.indexOf(marker)
    if (idx < 0) continue
    const rest = line.slice(idx + marker.length)
    // Split on the LAST two `|` so function names containing a literal
    // `|` (rare but possible for anonymous handles) stay intact.
    const lastBar = rest.lastIndexOf('|')
    if (lastBar < 0) continue
    const callsStr = rest.slice(lastBar + 1).trim()
    const head = rest.slice(0, lastBar)
    const prevBar = head.lastIndexOf('|')
    if (prevBar < 0) continue
    const timeStr = head.slice(prevBar + 1).trim()
    const name = head.slice(0, prevBar).trim()
    const totalTime = Number(timeStr)
    const numCalls = Number(callsStr)
    if (name === '' || !Number.isFinite(totalTime) || !Number.isFinite(numCalls)) {
      continue
    }
    entries.push({ functionName: name, totalTime, numCalls })
  }
  return { ok: true, entries }
}

/**
 * Sort entries in-place-safe (returns a new array). Default sort is by
 * descending total time, with numCalls as the tiebreaker and name as the
 * stable fallback — mirrors MATLAB's default profiler view.
 */
export function sortProfileEntries(
  entries: ProfilerEntry[],
  key: 'totalTime' | 'numCalls' | 'functionName' = 'totalTime',
  direction: 'asc' | 'desc' = 'desc',
): ProfilerEntry[] {
  const mul = direction === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    if (key === 'functionName') {
      return a.functionName.localeCompare(b.functionName) * mul
    }
    const av = a[key]
    const bv = b[key]
    if (av !== bv) return (av - bv) * mul
    // Stable tiebreaker: name ascending.
    return a.functionName.localeCompare(b.functionName)
  })
}

/**
 * Build an Octave command that prints the absolute source path for a
 * function via `which`. The wrapper prints one line of the form
 * `__MSLP_WHICH__:<path>` so the renderer can robustly locate the path
 * even when the user has `format` or other output noise enabled.
 */
export function buildWhichCommand(functionName: string): string {
  // Escape embedded single quotes for the literal argument.
  const escaped = functionName.replace(/'/g, "''")
  return `try; __mslp_p = which('${escaped}'); printf('__MSLP_WHICH__:%s\\n', __mslp_p); catch; printf('__MSLP_WHICH__:\\n'); end_try_catch; clear __mslp_p`
}

/**
 * Parse the output of {@link buildWhichCommand}. Returns the resolved
 * absolute path (trimmed), or `null` when `which` returned empty (e.g.
 * the function is a built-in or was not found).
 */
export function parseWhichOutput(raw: string): string | null {
  if (raw == null) return null
  const text = String(raw).replace(/\r/g, '')
  const marker = '__MSLP_WHICH__:'
  const idx = text.indexOf(marker)
  if (idx < 0) return null
  const tail = text.slice(idx + marker.length)
  const eol = tail.indexOf('\n')
  const line = (eol >= 0 ? tail.slice(0, eol) : tail).trim()
  return line === '' ? null : line
}

/**
 * Human-readable formatter for a total-time value. Keeps ms-scale values
 * readable while still showing sub-ms precision.
 */
export function formatProfileTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds === 0) return '0 s'
  if (seconds >= 1) return `${seconds.toFixed(3)} s`
  const ms = seconds * 1000
  if (ms >= 1) return `${ms.toFixed(2)} ms`
  const us = ms * 1000
  return `${us.toFixed(0)} µs`
}
