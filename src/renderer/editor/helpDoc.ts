/**
 * US-031: Help browser (`doc` command).
 *
 * Pure helpers for:
 *   1. Detecting `doc <name>` commands typed in the Command Window so the
 *      renderer can intercept them and route to the Help panel instead of
 *      forwarding to Octave (which would open an external pager).
 *   2. Parsing Octave `help <name>` output into a lightweight segment
 *      stream that the Help panel can render with clickable
 *      cross-references ("See also: ...").
 *
 * Everything here is side-effect free, React-free, Electron-free — and
 * therefore unit-testable in node.
 */

/** A single rendered segment of help text. */
export type HelpSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; target: string }

/**
 * `doc sin`  → 'sin'
 * `  doc   foo_bar  ` → 'foo_bar'
 * `doc foo bar`, `doc`, `doc()`, `sin` → null
 *
 * Accepts exactly ONE argument. The argument must be a plain identifier
 * (letters/digits/underscore, optionally with a trailing dot-method like
 * `matrix.times` — kept liberal so dotted names work for future classdef
 * cases). Everything else returns null and the command falls through to
 * Octave normally.
 */
export function parseDocCommand(input: string): string | null {
  if (typeof input !== 'string') return null
  const m = input.match(/^\s*doc\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;?\s*$/)
  return m ? m[1] : null
}

/**
 * Same shape as parseDocCommand but for `help <name>` — some users reach
 * for `help` first. The Command Window intercepts both variants so the
 * Help panel fills up either way.
 */
export function parseHelpCommand(input: string): string | null {
  if (typeof input !== 'string') return null
  const m = input.match(/^\s*help\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;?\s*$/)
  return m ? m[1] : null
}

/**
 * Builds the Octave command that retrieves help text for `name` as a
 * single blob. We wrap the body in a printf-delimited block so the
 * renderer can slice it out of the larger IPC output cleanly, even if
 * other noise (prompts, warnings) bleeds into the stream.
 *
 * Usage (renderer):
 *   const cmd = buildHelpFetchCommand('sin')
 *   const { output } = await window.matslop.octaveExecute(cmd)
 *   const body = extractHelpBody(output) ?? output
 */
export function buildHelpFetchCommand(name: string): string {
  // Defensive: strip anything that isn't a safe identifier char. The
  // caller already validates via parseDocCommand, but this is belt-
  // and-suspenders because the string gets substituted into an Octave
  // try/catch block.
  const safe = name.replace(/[^A-Za-z0-9_.]/g, '')
  return [
    'try;',
    `printf('__MSLP_HELP_BEGIN__:${safe}\\n');`,
    `disp(help('${safe}'));`,
    "printf('__MSLP_HELP_END__\\n');",
    'catch err;',
    `printf('__MSLP_HELP_BEGIN__:${safe}\\n');`,
    "printf('%s\\n', err.message);",
    "printf('__MSLP_HELP_END__\\n');",
    'end;',
  ].join('')
}

/**
 * Slice a help body out of a raw IPC output stream using the delimiters
 * written by `buildHelpFetchCommand`. Returns null if the markers are
 * missing (in which case the caller can fall back to the raw string).
 */
export function extractHelpBody(raw: string): string | null {
  const m = raw.match(/__MSLP_HELP_BEGIN__:[^\n]*\n([\s\S]*?)__MSLP_HELP_END__/)
  return m ? m[1].replace(/\n+$/, '') : null
}

/**
 * Pull the list of cross-reference identifiers out of a help body.
 *
 * Octave / MATLAB-style "See also:" blocks vary a LOT in punctuation:
 *   "See also: cos, tan."
 *   "See also: cos, tan, atan."
 *   "See also: cos, tan\n          atan2, sinh."
 *   "@xref{cos}, @xref{tan}"
 *   "See also: `cos', `tan'"
 *
 * This extractor is deliberately forgiving: it finds the last "See
 * also:" occurrence (case-insensitive) and scans ahead collecting
 * identifier tokens until it hits a blank line or the end of the body.
 * Punctuation is stripped. Duplicates are removed but order is
 * preserved so UI lists match source order.
 */
export function extractSeeAlso(body: string): string[] {
  if (!body) return []
  // @xref{foo} form (texinfo)
  const xrefs = [...body.matchAll(/@xref\{([A-Za-z_][A-Za-z0-9_.]*)\}/g)].map(
    (m) => m[1],
  )
  if (xrefs.length > 0) return dedupe(xrefs)

  // Prose "See also: ..." form
  const idx = body.search(/see also:/i)
  if (idx < 0) return []
  const tail = body.slice(idx + 'see also:'.length)
  // Stop at first blank line (double newline) — avoids slurping the
  // rest of the doc when there's no trailing period.
  const stopMatch = tail.match(/\n\s*\n/)
  const section = stopMatch ? tail.slice(0, stopMatch.index) : tail
  const tokens = [...section.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/g)].map(
    (m) => m[0],
  )
  return dedupe(tokens)
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
}

/**
 * Split a help body into renderable segments. Each "See also" token
 * becomes a `link` segment so the UI can attach a click handler; all
 * other characters pass through as `text`.
 *
 * Uses `extractSeeAlso` to determine the link set, then scans the body
 * for those identifiers AFTER the first "See also:" marker so body-text
 * occurrences of common words (e.g. "sin" in prose before the cross-ref
 * section) stay as plain text.
 */
export function splitHelpBody(body: string): HelpSegment[] {
  if (!body) return []
  const refs = new Set(extractSeeAlso(body))
  if (refs.size === 0) {
    return [{ kind: 'text', text: body }]
  }
  // Find where the cross-ref region starts so we don't linkify prose
  // occurrences of the same token higher up.
  const idx = body.search(/see also:/i)
  if (idx < 0) {
    return [{ kind: 'text', text: body }]
  }
  const head = body.slice(0, idx + 'see also:'.length)
  const tail = body.slice(idx + 'see also:'.length)
  const segments: HelpSegment[] = [{ kind: 'text', text: head }]
  // Tokenize tail into [text...][ident][text...][ident]...
  const re = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/g
  let last = 0
  for (const m of tail.matchAll(re)) {
    const start = m.index ?? 0
    const token = m[0]
    if (start > last) {
      segments.push({ kind: 'text', text: tail.slice(last, start) })
    }
    if (refs.has(token)) {
      segments.push({ kind: 'link', target: token })
    } else {
      segments.push({ kind: 'text', text: token })
    }
    last = start + token.length
  }
  if (last < tail.length) {
    segments.push({ kind: 'text', text: tail.slice(last) })
  }
  return segments
}

/** Result type for the App.tsx help state. */
export interface HelpState {
  /** Currently-displayed topic name (null = panel is closed). */
  topic: string | null
  /** Raw help body shown in the panel, or null while fetching. */
  content: string | null
  /** Error message if the fetch failed. */
  error: string | null
  /** Navigation stack — most recent last. Lets the panel offer a Back button. */
  history: string[]
  /** True while an async fetch is in flight. */
  loading: boolean
}

export const EMPTY_HELP_STATE: HelpState = {
  topic: null,
  content: null,
  error: null,
  history: [],
  loading: false,
}

/**
 * Pure reducer: begin navigating to a new topic. Appends the previous
 * topic to the history stack so the UI can offer a Back button.
 */
export function beginHelpNavigation(state: HelpState, topic: string): HelpState {
  const history = state.topic && state.topic !== topic ? [...state.history, state.topic] : state.history
  return {
    topic,
    content: null,
    error: null,
    history,
    loading: true,
  }
}

/** Pure reducer: a fetch resolved successfully for `topic`. */
export function completeHelpNavigation(
  state: HelpState,
  topic: string,
  content: string,
): HelpState {
  // Ignore stale results.
  if (state.topic !== topic) return state
  return { ...state, content, error: null, loading: false }
}

/** Pure reducer: a fetch failed for `topic`. */
export function failHelpNavigation(state: HelpState, topic: string, error: string): HelpState {
  if (state.topic !== topic) return state
  return { ...state, content: null, error, loading: false }
}

/** Pure reducer: pop the history stack. Returns the previous topic or null. */
export function popHelpHistory(state: HelpState): { state: HelpState; previous: string | null } {
  if (state.history.length === 0) {
    return { state, previous: null }
  }
  const history = state.history.slice(0, -1)
  const previous = state.history[state.history.length - 1]
  return {
    state: { topic: previous, content: null, error: null, history, loading: true },
    previous,
  }
}

/** Pure reducer: close the panel (clears topic + history). */
export function closeHelp(_state: HelpState): HelpState {
  return EMPTY_HELP_STATE
}
