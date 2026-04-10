export type EditorTabMode = 'script' | 'livescript' | 'welcome'

export interface EditorTab {
  id: string
  filename: string
  content: string
  savedContent: string
  filePath: string | null
  mode: EditorTabMode
}

let nextId = 1

export function createTab(
  filename: string = 'untitled.m',
  content: string = '',
  filePath: string | null = null,
  mode: EditorTabMode = 'script'
): EditorTab {
  return {
    id: `tab-${nextId++}`,
    filename,
    content,
    savedContent: content,
    filePath,
    mode,
  }
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
      { type: 'code', content: '% Write your MATLAB/Octave code here\n', output: '' },
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
