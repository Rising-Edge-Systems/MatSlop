/**
 * Debug bridge (US-015): translates UI breakpoint actions into Octave
 * `dbstop` / `dbclear` commands and owns the in-memory registry of active
 * breakpoints so they can be reapplied after an Octave restart.
 *
 * Everything in this module is pure with respect to Octave and IPC: it takes
 * a `CommandExecutor` callback and a minimal map-like interface, which makes
 * the behavior unit-testable without spinning up a real process manager.
 */

import path from 'path'

/**
 * Minimal subset of the `Map<string, Set<number>>` interface used by the
 * bridge. Declared separately so tests can pass a fake with a recorder.
 */
export interface BreakpointMapLike {
  get(key: string): Set<number> | undefined
  set(key: string, value: Set<number>): this | void
  delete(key: string): boolean | void
  entries(): IterableIterator<[string, Set<number>]>
}

/** A command executor is typically `octaveProcess.executeCommand.bind(...)`. */
export type CommandExecutor = (command: string) => void | Promise<unknown>

/** Unsaved tabs share this logical bucket so we don't apply dbstop to them. */
export const UNSAVED_BUCKET = '<unsaved>'

/**
 * Derive the Octave-facing file token for a dbstop command. We take the
 * basename (with .m extension) because Octave's `dbstop` accepts the function
 * file name and that matches how users reason about break points in their
 * editor tabs.
 */
function fileToken(filePath: string): string {
  return path.basename(filePath).replace(/"/g, '\\"')
}

/**
 * Format a `dbstop in "file.m" at LINE` command. Exported so tests can pin
 * the exact string that will be sent to Octave.
 */
export function formatDbstopCommand(filePath: string, line: number): string {
  const name = fileToken(filePath)
  return `dbstop in "${name}" at ${Math.floor(line)}`
}

/**
 * Format a `dbclear in "file.m" at LINE` command.
 */
export function formatDbclearCommand(filePath: string, line: number): string {
  const name = fileToken(filePath)
  return `dbclear in "${name}" at ${Math.floor(line)}`
}

/**
 * US-021: Format a conditional `dbstop in "file.m" at LINE if "condition"`
 * command. The condition is trimmed and has embedded double-quotes escaped
 * so that arbitrary expressions (e.g. `i > 10`, `size(x,1) == 3`) can be
 * round-tripped safely to Octave.
 *
 * Returns a plain (non-conditional) dbstop command if the condition is
 * null/empty/whitespace so callers can use a single code path for both.
 */
export function formatDbstopConditionalCommand(
  filePath: string,
  line: number,
  condition: string | null | undefined,
): string {
  const name = fileToken(filePath)
  const lineInt = Math.floor(line)
  const trimmed = (condition ?? '').trim()
  if (!trimmed) return `dbstop in "${name}" at ${lineInt}`
  // Octave's parser accepts either string quoting. We prefer single-quotes
  // around the condition string so that users can type expressions
  // containing double-quoted strings (e.g. strcmp(x, "foo")) without
  // escaping — and double-quotes inside the file name already use the same
  // escape scheme as plain `dbstop`.
  const cond = trimmed.replace(/'/g, "''")
  return `dbstop in "${name}" at ${lineInt} if '${cond}'`
}

/**
 * Normalize a filePath argument into the map key used to bucket breakpoints.
 * Unsaved tabs all land in `UNSAVED_BUCKET`.
 */
export function breakpointBucketKey(filePath: string | null | undefined): string {
  return filePath && filePath.length > 0 ? filePath : UNSAVED_BUCKET
}

/**
 * Record a breakpoint in the registry and, if the file has a real path and an
 * executor is available, forward a `dbstop` command to Octave.
 *
 * Returns `true` iff the line was valid and the registry was updated.
 */
export function setBreakpoint(
  map: BreakpointMapLike,
  filePath: string | null,
  line: number,
  exec: CommandExecutor | null,
): boolean {
  if (!Number.isFinite(line) || line <= 0) return false
  const lineInt = Math.floor(line)
  const key = breakpointBucketKey(filePath)
  const set = map.get(key) ?? new Set<number>()
  set.add(lineInt)
  map.set(key, set)
  if (exec && filePath && filePath.length > 0) {
    // Fire and forget — the process manager queues commands, so errors here
    // shouldn't propagate into the IPC return value.
    void Promise.resolve(exec(formatDbstopCommand(filePath, lineInt))).catch(() => {
      /* swallow — breakpoint bookkeeping already succeeded */
    })
  }
  return true
}

/**
 * Remove a breakpoint from the registry and, if the file has a real path and
 * an executor is available, forward a `dbclear` command to Octave.
 */
export function clearBreakpoint(
  map: BreakpointMapLike,
  filePath: string | null,
  line: number,
  exec: CommandExecutor | null,
): boolean {
  if (!Number.isFinite(line) || line <= 0) return false
  const lineInt = Math.floor(line)
  const key = breakpointBucketKey(filePath)
  const set = map.get(key)
  if (set) {
    set.delete(lineInt)
    if (set.size === 0) map.delete(key)
  }
  if (exec && filePath && filePath.length > 0) {
    void Promise.resolve(exec(formatDbclearCommand(filePath, lineInt))).catch(() => {
      /* swallow */
    })
  }
  return true
}

/**
 * US-021: Set (or clear) the condition on an existing breakpoint. The
 * registry already contains the line (callers should ensure the line was
 * added via `setBreakpoint` first), and this helper:
 *   1. Sends a `dbclear` for the line so Octave forgets any previous
 *      plain-or-conditional breakpoint at that location.
 *   2. Sends a fresh `dbstop` — conditional if `condition` is non-empty,
 *      unconditional if null/empty.
 *
 * Unsaved-bucket tabs only get the condition recorded (no Octave traffic).
 */
export function setBreakpointWithCondition(
  map: BreakpointMapLike,
  filePath: string | null,
  line: number,
  condition: string | null,
  exec: CommandExecutor | null,
): boolean {
  if (!Number.isFinite(line) || line <= 0) return false
  const lineInt = Math.floor(line)
  const key = breakpointBucketKey(filePath)
  const set = map.get(key) ?? new Set<number>()
  set.add(lineInt)
  map.set(key, set)
  if (exec && filePath && filePath.length > 0) {
    const clearCmd = formatDbclearCommand(filePath, lineInt)
    const stopCmd = formatDbstopConditionalCommand(filePath, lineInt, condition)
    void Promise.resolve(exec(clearCmd)).catch(() => {
      /* swallow */
    })
    void Promise.resolve(exec(stopCmd)).catch(() => {
      /* swallow */
    })
  }
  return true
}

/**
 * Iterate the registry and send a `dbstop` command for every remembered
 * breakpoint that has a real file path. Unsaved buckets are skipped because
 * Octave cannot address them by name.
 *
 * Returns the list of command strings sent (in stable key order), primarily
 * for testability.
 */
/**
 * US-016: parsed "paused" event emitted by `parsePausedMarker` when Octave's
 * stdout/stderr contains a debug-stop marker. `file` is whatever Octave
 * reported — typically an absolute path to a .m file, but may be a bare
 * function name in some versions. `line` is 1-based.
 */
export interface PausedLocation {
  file: string
  line: number
}

/**
 * Scan a chunk of Octave stdout/stderr text for a debug-pause marker and
 * return the first matched location, or null if the text contains no marker.
 *
 * Supports the two wording variants observed across Octave releases:
 *   - "stopped in <file> at line N"
 *   - "stopped at <func>, line N"  (column/column# optional trailing)
 *
 * Pure and dependency-free so it can be unit-tested in node without spawning
 * a real Octave process.
 */
export function parsePausedMarker(text: string): PausedLocation | null {
  if (!text) return null
  // Primary form: `stopped in <name> at line <n> [<full_path>]`
  // Octave 8.4 appends `[/absolute/path.m]` after the line number.
  // We prefer the bracketed path (absolute) over the bare name when present.
  const m1 = text.match(/stopped in\s+(.+?)\s+at line\s+(\d+)(?:\s+\[(.+?)\])?/i)
  if (m1) {
    const line = Number.parseInt(m1[2], 10)
    if (Number.isFinite(line) && line > 0) {
      const file = m1[3]?.trim() || m1[1].trim()
      return { file, line }
    }
  }
  // Secondary form: `stopped at <func>, line <n>` or `stopped at <func>: line <n>`
  const m2 = text.match(/stopped at\s+(.+?)[,:]\s*line\s+(\d+)/i)
  if (m2) {
    const line = Number.parseInt(m2[2], 10)
    if (Number.isFinite(line) && line > 0) {
      return { file: m2[1].trim(), line }
    }
  }
  return null
}

/**
 * Optional conditions map passed to {@link reapplyAllBreakpoints} so that
 * conditional breakpoints survive an Octave restart. Shape mirrors the
 * renderer's `BreakpointConditionStore` but keyed by file path so it lines
 * up with the main-process breakpoint registry.
 */
export interface BreakpointConditionsLike {
  get(key: string): Map<number, string> | Record<number, string> | undefined
}

function lookupCondition(
  conds: BreakpointConditionsLike | undefined,
  key: string,
  line: number,
): string | null {
  if (!conds) return null
  const forKey = conds.get(key)
  if (!forKey) return null
  if (forKey instanceof Map) {
    return forKey.get(line) ?? null
  }
  const v = (forKey as Record<number, string>)[line]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * US-023 (edit-and-continue, best effort): after the user saves a .m file
 * while paused, Octave may still hold the old cached parse for that function.
 * Re-applying breakpoints for JUST that file — by first `dbclear`ing each
 * recorded line and then re-`dbstop`ping it — nudges Octave to re-read the
 * source next time the function is entered. Conditional breakpoints keep
 * their condition via the optional `conditions` map, same as
 * {@link reapplyAllBreakpoints}.
 *
 * Returns the list of command strings sent in order (all dbclears first, then
 * all dbstops). Returns an empty array if the file is unsaved or has no
 * registered breakpoints — the caller still shows the edit-and-continue
 * banner so users know changes won't take effect until re-entry.
 */
export function reapplyBreakpointsForFile(
  map: BreakpointMapLike,
  filePath: string | null | undefined,
  exec: CommandExecutor,
  conditions?: BreakpointConditionsLike,
): string[] {
  if (!filePath || filePath.length === 0) return []
  const key = breakpointBucketKey(filePath)
  if (key === UNSAVED_BUCKET) return []
  const set = map.get(key)
  if (!set || set.size === 0) return []
  const sent: string[] = []
  const lines = Array.from(set).sort((a, b) => a - b)
  // Phase 1: dbclear each line so Octave forgets the stale parsed source.
  for (const line of lines) {
    const cmd = formatDbclearCommand(filePath, line)
    try {
      void Promise.resolve(exec(cmd)).catch(() => {
        /* swallow */
      })
    } catch {
      /* ignore sync failures so one bad call can't break the rest */
    }
    sent.push(cmd)
  }
  // Phase 2: re-dbstop (conditional if we have one) so the next entry to this
  // function stops at the intended lines in the freshly-saved source.
  for (const line of lines) {
    const cond = lookupCondition(conditions, key, line)
    const cmd = cond
      ? formatDbstopConditionalCommand(filePath, line, cond)
      : formatDbstopCommand(filePath, line)
    try {
      void Promise.resolve(exec(cmd)).catch(() => {
        /* swallow */
      })
    } catch {
      /* ignore sync failures so one bad call can't break the rest */
    }
    sent.push(cmd)
  }
  return sent
}

export function reapplyAllBreakpoints(
  map: BreakpointMapLike,
  exec: CommandExecutor,
  conditions?: BreakpointConditionsLike,
): string[] {
  const sent: string[] = []
  // Sort keys so reapply order is deterministic (important for tests and for
  // reproducible Octave state after restart).
  const keys = Array.from(map.entries()).map(([k]) => k).sort()
  for (const key of keys) {
    if (key === UNSAVED_BUCKET) continue
    const set = map.get(key)
    if (!set || set.size === 0) continue
    const lines = Array.from(set).sort((a, b) => a - b)
    for (const line of lines) {
      const cond = lookupCondition(conditions, key, line)
      const cmd = cond
        ? formatDbstopConditionalCommand(key, line, cond)
        : formatDbstopCommand(key, line)
      try {
        void Promise.resolve(exec(cmd)).catch(() => {
          /* swallow */
        })
      } catch {
        /* ignore sync failures so one bad call can't break the rest */
      }
      sent.push(cmd)
    }
  }
  return sent
}
