/**
 * US-018: Call-stack bridge. Pure helpers for building the Octave command
 * that emits the current `dbstack()` as parseable marker lines, and for
 * parsing that output back into a structured array of frames.
 *
 * The helpers are pure and dependency-free so they can be unit tested in
 * Node without spawning a real Octave process.
 */

/** A single call-stack frame as reported by Octave's `dbstack` function. */
export interface CallStackFrame {
  /** Function / script name (e.g. "myfunc" or the top-level script name). */
  name: string
  /** Absolute path to the file containing the frame, if Octave knows it. */
  file: string
  /** 1-based line number of the currently executing statement in that frame. */
  line: number
}

/** Marker tokens wrapping the call-stack payload in Octave stdout. */
export const CALL_STACK_BEGIN = '__MATSLOP_STACK_BEGIN__'
export const CALL_STACK_END = '__MATSLOP_STACK_END__'
export const CALL_STACK_ROW = '__MATSLOP_STACK__'

/**
 * Field separator used inside a single marker row. `||` is unlikely to
 * appear in function names or file paths, so it's safe as a split token
 * without needing to escape anything.
 */
export const CALL_STACK_SEP = '||'

/**
 * Build the Octave command that prints the current call stack as a
 * sequence of `__MATSLOP_STACK__||name||line||file` rows wrapped in begin/
 * end markers. Designed to be appended to any IPC `octave:execute` call.
 *
 * The command deliberately uses short, mangled local variable names so it
 * doesn't collide with anything in the paused user workspace.
 */
export function formatCallStackQuery(): string {
  return [
    `disp('${CALL_STACK_BEGIN}');`,
    '__mslp_cs__=dbstack();',
    'for __mslp_csk__=1:length(__mslp_cs__);',
    `disp(['${CALL_STACK_ROW}${CALL_STACK_SEP}' __mslp_cs__(__mslp_csk__).name '${CALL_STACK_SEP}' num2str(__mslp_cs__(__mslp_csk__).line) '${CALL_STACK_SEP}' __mslp_cs__(__mslp_csk__).file]);`,
    'end;',
    `disp('${CALL_STACK_END}');`,
    'clear __mslp_cs__ __mslp_csk__;',
  ].join('')
}

/**
 * Scan a chunk of Octave stdout/stderr text for call-stack marker rows and
 * return them as structured frames. Rows with non-numeric line numbers are
 * silently dropped. Output preserves the top-to-bottom order Octave
 * reported — top of `dbstack()` (the currently paused frame) first.
 */
export function parseCallStack(text: string): CallStackFrame[] {
  if (!text) return []
  const frames: CallStackFrame[] = []
  // Match rows line-by-line to avoid regex greediness eating across newlines.
  const lines = text.split(/\r?\n/)
  const prefix = `${CALL_STACK_ROW}${CALL_STACK_SEP}`
  for (const raw of lines) {
    const idx = raw.indexOf(prefix)
    if (idx < 0) continue
    const payload = raw.substring(idx + prefix.length)
    const parts = payload.split(CALL_STACK_SEP)
    if (parts.length < 3) continue
    // parts = [name, line, file, ...restJoined]
    const name = parts[0].trim()
    const line = Number.parseInt(parts[1], 10)
    // Re-join any trailing parts in case a pathological file path contained
    // the separator. In practice this is unreachable but keeps the parser
    // lossless.
    const file = parts.slice(2).join(CALL_STACK_SEP).trim()
    if (!Number.isFinite(line) || line <= 0) continue
    frames.push({ name, file, line })
  }
  return frames
}
