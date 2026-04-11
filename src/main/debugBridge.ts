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
  // Primary form: `stopped in <path> at line <n>`
  const m1 = text.match(/stopped in\s+(.+?)\s+at line\s+(\d+)/i)
  if (m1) {
    const line = Number.parseInt(m1[2], 10)
    if (Number.isFinite(line) && line > 0) {
      return { file: m1[1].trim(), line }
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

export function reapplyAllBreakpoints(
  map: BreakpointMapLike,
  exec: CommandExecutor,
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
      const cmd = formatDbstopCommand(key, line)
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
