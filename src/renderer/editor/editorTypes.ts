export type EditorTabMode = 'script' | 'livescript'

export interface EditorTab {
  id: string
  filename: string
  content: string
  savedContent: string
  filePath: string | null
  mode: EditorTabMode
}

export interface LiveScriptCellFigure {
  imageDataUrl: string
  tempPath: string
  /**
   * Optional serialized plot data produced by Octave's matslop_export_fig(h)
   * — when present, the live-script UI renders the figure with the
   * interactive Plotly-based `PlotRenderer` instead of the static PNG
   * snapshot. Kept as an opaque JSON string so editorTypes.ts stays free of
   * main-process imports; the renderer parses it via parsePlotFigure().
   */
  plotJson?: string
  /**
   * Human-readable error emitted by Octave when `matslop_export_fig(h)`
   * threw while serializing this figure (US-013). When set, the renderer
   * shows a warning banner and falls back to the static PNG snapshot.
   * Kept as a plain string so editorTypes.ts stays renderer-agnostic.
   */
  plotWarning?: string
}

export interface LiveScriptStatementResult {
  /** 1-based line number in the cell where this statement starts */
  startLine: number
  /** Number of lines this statement spans */
  lineCount: number
  output?: string
  figures?: LiveScriptCellFigure[]
  isError?: boolean
}

export interface LiveScriptCell {
  type: 'code' | 'markdown'
  content: string
  output: string
  figures?: LiveScriptCellFigure[]
  /** Per-statement results after running the cell */
  statementResults?: LiveScriptStatementResult[]
}

/**
 * Split MATLAB/Octave cell content into executable statements, respecting
 * multi-line block constructs (function, if, for, while, do, switch, try,
 * parfor, unwind_protect, classdef) and line continuations (`...`).
 *
 * Returns an array of statements with 1-based startLine and lineCount for
 * each, so the UI can align outputs with source lines.
 */
export function splitStatements(code: string): Array<{ code: string; startLine: number; lineCount: number }> {
  const lines = code.split('\n')
  const result: Array<{ code: string; startLine: number; lineCount: number }> = []
  let current: string[] = []
  let currentStart = 0
  let depth = 0
  let inBlockComment = false

  const blockStart = /\b(function|if|for|while|do|switch|try|parfor|unwind_protect|classdef)\b/g
  const blockEnd = /\b(endfunction|endif|endfor|endwhile|endswitch|end_try_catch|endparfor|end_unwind_protect|endclassdef|until|end)\b/g

  function stripStringsAndComments(line: string): string {
    let out = ''
    let i = 0
    while (i < line.length) {
      const ch = line[i]
      // Line comment
      if (ch === '%' || ch === '#') break
      // Single-quoted string
      if (ch === "'") {
        i++
        while (i < line.length && line[i] !== "'") i++
        i++
        continue
      }
      // Double-quoted string
      if (ch === '"') {
        i++
        while (i < line.length && line[i] !== '"') {
          if (line[i] === '\\') i++
          i++
        }
        i++
        continue
      }
      out += ch
      i++
    }
    return out
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Handle block comments %{ ... %}
    if (inBlockComment) {
      current.push(line)
      if (trimmed === '%}' || trimmed === '#}') inBlockComment = false
      continue
    }
    if (trimmed === '%{' || trimmed === '#{') {
      inBlockComment = true
      if (current.length === 0) currentStart = i
      current.push(line)
      continue
    }

    // Skip entirely blank lines when not in a statement
    if (current.length === 0 && trimmed === '') continue

    if (current.length === 0) currentStart = i
    current.push(line)

    const codeOnly = stripStringsAndComments(line)

    // Count block start/end keywords
    const startMatches = codeOnly.match(blockStart) || []
    const endMatches = codeOnly.match(blockEnd) || []
    depth += startMatches.length - endMatches.length
    if (depth < 0) depth = 0

    // Line continuation with `...`
    const endsWithContinuation = /\.\.\.\s*$/.test(codeOnly)

    if (depth === 0 && !endsWithContinuation) {
      const stmt = current.join('\n').trim()
      if (stmt !== '') {
        result.push({
          code: stmt,
          startLine: currentStart + 1,
          lineCount: current.length,
        })
      }
      current = []
    }
  }

  // Trailing partial statement (depth imbalance)
  if (current.length > 0) {
    const stmt = current.join('\n').trim()
    if (stmt !== '') {
      result.push({
        code: stmt,
        startLine: currentStart + 1,
        lineCount: current.length,
      })
    }
  }

  return result
}

export interface LiveScriptDocument {
  cells: LiveScriptCell[]
}

export function createEmptyLiveScript(): string {
  const doc: LiveScriptDocument = {
    cells: [
      { type: 'markdown', content: '# Untitled\n\nDescribe your analysis here.', output: '' },
      { type: 'code', content: '', output: '' },
    ],
  }
  return JSON.stringify(doc, null, 2)
}

export function parseLiveScript(content: string): LiveScriptDocument {
  try {
    const parsed = JSON.parse(content)
    if (parsed && Array.isArray(parsed.cells)) {
      return parsed as LiveScriptDocument
    }
  } catch {
    // ignore parse errors
  }
  return { cells: [{ type: 'code', content: '', output: '' }] }
}

export function serializeLiveScript(doc: LiveScriptDocument): string {
  return JSON.stringify(doc, null, 2)
}

/**
 * Per-tab breakpoint store keyed by tab id. Each value is the set of 1-based
 * source line numbers that currently have a breakpoint. Kept as a plain
 * Record<string, number[]> so it can be serialized and cheaply compared in
 * React (Set instances don't diff well in state).
 *
 * Breakpoints are intentionally stored at the tab level (not by file path) so
 * that an unsaved "untitled.m" tab can still hold breakpoints before it is
 * written to disk, and so that two tabs pointing at the same path can diverge
 * if we ever split-edit.
 */
export type BreakpointStore = Record<string, number[]>

/**
 * Toggle a breakpoint on the given line inside the tab's breakpoint list.
 * Always returns a NEW store object (with a new inner array for the affected
 * tab) so React state setters can rely on referential inequality to re-render.
 *
 * Pure and stateless so it can be unit-tested without a Monaco instance.
 */
export function toggleBreakpoint(
  store: BreakpointStore,
  tabId: string,
  line: number,
): BreakpointStore {
  if (!Number.isFinite(line) || line <= 0) return store
  const lineInt = Math.floor(line)
  const existing = store[tabId] ?? []
  const idx = existing.indexOf(lineInt)
  let nextLines: number[]
  if (idx === -1) {
    // Add and keep sorted ascending so decorations / tests are deterministic.
    nextLines = existing.concat(lineInt).sort((a, b) => a - b)
  } else {
    nextLines = existing.slice()
    nextLines.splice(idx, 1)
  }
  return { ...store, [tabId]: nextLines }
}

/**
 * Remove any breakpoint state associated with a tab (called when a tab is
 * closed) so the store doesn't grow without bound.
 */
export function clearBreakpointsForTab(
  store: BreakpointStore,
  tabId: string,
): BreakpointStore {
  if (!(tabId in store)) return store
  const next = { ...store }
  delete next[tabId]
  return next
}

/**
 * Return the sorted list of breakpoint lines for a tab. Safe to call for
 * unknown tab ids (returns an empty array).
 */
export function getBreakpointsForTab(
  store: BreakpointStore,
  tabId: string,
): number[] {
  return store[tabId] ?? []
}

/**
 * US-021: Conditional breakpoint conditions, stored in a structure parallel
 * to `BreakpointStore` so that the existing toggle logic does not have to
 * care about conditions. Keys: tabId → (lineNumber → condition-expression).
 *
 * A breakpoint line WITHOUT a condition entry is a plain (unconditional)
 * breakpoint; a line WITH an entry is a conditional breakpoint and gets
 * rendered with a different glyph color. The expression is sent to Octave
 * as the `if "<expr>"` suffix on its `dbstop` command.
 *
 * Pure and stateless so it can be unit-tested without Monaco.
 */
export type BreakpointConditionStore = Record<string, Record<number, string>>

/**
 * Set (or clear) the condition expression attached to a breakpoint on a
 * given tab/line. Passing a null/empty/whitespace-only condition REMOVES
 * the condition, reverting the breakpoint to an unconditional one. Always
 * returns a new store object so React state comparisons work.
 */
export function setBreakpointCondition(
  store: BreakpointConditionStore,
  tabId: string,
  line: number,
  condition: string | null,
): BreakpointConditionStore {
  if (!Number.isFinite(line) || line <= 0) return store
  const lineInt = Math.floor(line)
  const trimmed = condition == null ? '' : condition.trim()
  const existing = store[tabId] ?? {}
  const hadEntry = lineInt in existing
  if (!trimmed) {
    if (!hadEntry) return store
    const nextForTab = { ...existing }
    delete nextForTab[lineInt]
    if (Object.keys(nextForTab).length === 0) {
      const nextStore = { ...store }
      delete nextStore[tabId]
      return nextStore
    }
    return { ...store, [tabId]: nextForTab }
  }
  if (existing[lineInt] === trimmed) return store
  return { ...store, [tabId]: { ...existing, [lineInt]: trimmed } }
}

/**
 * Return the condition expression on a given tab/line, or null if the
 * breakpoint is unconditional (or doesn't exist).
 */
export function getBreakpointCondition(
  store: BreakpointConditionStore,
  tabId: string,
  line: number,
): string | null {
  if (!Number.isFinite(line) || line <= 0) return null
  const lineInt = Math.floor(line)
  const forTab = store[tabId]
  if (!forTab) return null
  const cond = forTab[lineInt]
  return cond ?? null
}

/**
 * Drop all condition entries for a tab (used when a tab is closed or when
 * every breakpoint on the tab is toggled off at once).
 */
export function clearBreakpointConditionsForTab(
  store: BreakpointConditionStore,
  tabId: string,
): BreakpointConditionStore {
  if (!(tabId in store)) return store
  const next = { ...store }
  delete next[tabId]
  return next
}

/**
 * Move the cell at `sourceIndex` so that it lands at `targetIndex` in the
 * sequence of drop-zone slots. Drop-zone slots are the positions *between*
 * cells, numbered 0..cells.length (inclusive).
 *
 * Rules:
 *   - Returns a new array; never mutates the input.
 *   - A no-op drop (dropping a cell into the slot immediately above or
 *     below itself, or out-of-range indices) returns the array unchanged.
 *
 * Pure and stateless so that drag-reorder behavior can be unit-tested.
 */
export function reorderCells<T>(cells: T[], sourceIndex: number, targetIndex: number): T[] {
  if (sourceIndex < 0 || sourceIndex >= cells.length) return cells
  if (targetIndex < 0 || targetIndex > cells.length) return cells
  // Dropping into the slot immediately above or below itself is a no-op.
  if (targetIndex === sourceIndex || targetIndex === sourceIndex + 1) return cells
  const next = cells.slice()
  const [moved] = next.splice(sourceIndex, 1)
  const adjustedTarget = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex
  next.splice(adjustedTarget, 0, moved)
  return next
}

/**
 * US-029: Code sections in .m files. A section header is a line whose first
 * non-whitespace characters are `%%` (optionally followed by a title comment).
 * This matches MATLAB's "code sections" / "cell mode" feature, letting a user
 * subdivide a plain .m script and run just the chunk around the cursor.
 *
 * Everything below lives as pure helpers so section-detection logic can be
 * unit-tested without Monaco. The UI layer maps these line numbers onto
 * editor decorations and cursor movements.
 */

/** Returns true if `line` is a `%%` section header (possibly with a trailing title). */
export function isSectionHeaderLine(line: string): boolean {
  const trimmed = line.trimStart()
  return trimmed.startsWith('%%')
}

/**
 * Return the 1-based line numbers of every `%%` section header in `code`.
 * Empty input and code without headers yield an empty array.
 */
export function findSectionHeaderLines(code: string): number[] {
  const lines = code.split('\n')
  const result: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isSectionHeaderLine(lines[i])) {
      result.push(i + 1)
    }
  }
  return result
}

export interface SectionRange {
  /** 1-based line number of the `%%` header, or null when the cursor is in a
   * prelude section BEFORE the first header. */
  headerLine: number | null
  /** 1-based line number of the first executable line of the section (the
   * line immediately after the header, or 1 when there's no header). */
  contentStartLine: number
  /** 1-based line number of the LAST line of the section (inclusive).
   * When the cursor sits in the final section, this is the last line of the
   * file. */
  endLine: number
  /** Extracted section body joined with `\n`, trimmed of leading/trailing
   * blank lines. The header line itself is NOT included. Empty string if the
   * section body is empty. */
  code: string
}

/**
 * Compute the section that contains the given 1-based `cursorLine` inside
 * `code`. If `code` has no `%%` headers at all, the whole file is treated as
 * one big "section". If the cursor lands ON a `%%` header line itself, that
 * header is treated as the start of its section (not the previous one).
 *
 * Pure + deterministic so sectioning can be tested without Monaco.
 */
export function findSectionRange(code: string, cursorLine: number): SectionRange {
  const lines = code.split('\n')
  const lineCount = lines.length
  if (lineCount === 0) {
    return { headerLine: null, contentStartLine: 1, endLine: 1, code: '' }
  }
  const cursor = Math.max(1, Math.min(lineCount, Math.floor(cursorLine)))

  // Walk backwards from cursor to find the enclosing header.
  let headerLine: number | null = null
  for (let i = cursor; i >= 1; i--) {
    if (isSectionHeaderLine(lines[i - 1])) {
      headerLine = i
      break
    }
  }
  // Walk forwards from the line AFTER the cursor (or header) to find the
  // next section header — that's one past `endLine`.
  const forwardStart = headerLine != null ? headerLine + 1 : cursor + 1
  let endLine = lineCount
  for (let i = forwardStart; i <= lineCount; i++) {
    if (isSectionHeaderLine(lines[i - 1])) {
      endLine = i - 1
      break
    }
  }
  const contentStartLine = headerLine != null ? headerLine + 1 : 1
  // Guard: a %% header with nothing after it produces an empty body.
  const bodyLines = contentStartLine > endLine
    ? []
    : lines.slice(contentStartLine - 1, endLine)
  const body = bodyLines.join('\n').replace(/^\s*\n+|\n+\s*$/g, '')
  return { headerLine, contentStartLine, endLine, code: body }
}

/**
 * After running the section at `cursorLine`, find the 1-based line number
 * where the editor cursor should move for "Run and Advance":
 *   - If there IS a next `%%` header after the current section, move the
 *     cursor to the first content line of THAT next section (i.e. header + 1,
 *     or the header line itself when it has no body).
 *   - Otherwise (we're already in the last section) return null and the
 *     caller should leave the cursor alone.
 */
export function findNextSectionAdvanceLine(code: string, cursorLine: number): number | null {
  const lines = code.split('\n')
  const range = findSectionRange(code, cursorLine)
  // `range.endLine` is the last line of the current section; the next
  // section (if any) starts on endLine + 1 with a header.
  const nextHeaderLine = range.endLine + 1
  if (nextHeaderLine > lines.length) return null
  if (!isSectionHeaderLine(lines[nextHeaderLine - 1])) return null
  // Move cursor onto the first content line of the next section, clamped to
  // the end of the file for a header with no body.
  const advanceLine = nextHeaderLine + 1
  return Math.min(advanceLine, lines.length)
}
