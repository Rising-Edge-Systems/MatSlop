/**
 * Pure helpers for the Variable Editor (US-036).
 *
 * These functions are DOM-free / React-free / Electron-free so they can be
 * unit-tested in node via vitest and imported from both renderer components
 * and tests.
 */

export interface MatrixData {
  rows: number
  cols: number
  values: string[][]
}

/**
 * Parse an Octave `whos`-style size string like "3x4", "3x4x2", or "5x6x2x3"
 * into a plain number array. Invalid entries collapse to 1 so callers always
 * get a non-empty array.
 */
export function parseDimensionString(size: string): number[] {
  if (!size) return [1, 1]
  const parts = size
    .split('x')
    .map((s) => parseInt(s.trim(), 10))
    .map((n) => (Number.isFinite(n) && n > 0 ? n : 1))
  if (parts.length === 0) return [1, 1]
  if (parts.length === 1) return [parts[0], 1]
  return parts
}

/**
 * Return the number of trailing dimensions beyond rows/cols — i.e. how many
 * slice-selectors to show. For a 3x4 matrix → 0. For 3x4x2 → 1. For 3x4x2x5 → 2.
 */
export function extraDimensionCount(dims: number[]): number {
  return Math.max(0, dims.length - 2)
}

/**
 * Build an Octave command that disp()s a 2D slice of a variable. For 2D
 * variables `sliceIndices` should be empty. For a 3D+ variable, pass the
 * 1-based indices of the trailing dims in order.
 *
 * Example: buildSliceDispCommand('A', [2, 1]) → `disp(A(:,:,2,1))`
 */
export function buildSliceDispCommand(name: string, sliceIndices: number[]): string {
  if (sliceIndices.length === 0) return `disp(${name})`
  const idx = sliceIndices.map((n) => String(Math.max(1, Math.floor(n)))).join(',')
  return `disp(${name}(:,:,${idx}))`
}

/**
 * Build an assignment command that updates a single cell of a variable,
 * respecting a slice. Returns something like `A(2,3) = 5;` for 2D or
 * `A(2,3,1,4) = 5;` for 4D (sliceIndices = [1,4], row=2, col=3).
 *
 * `value` is inserted verbatim — the caller is responsible for ensuring it's
 * a valid Octave numeric expression.
 */
export function buildCellAssignCommand(
  name: string,
  sliceIndices: number[],
  row: number,
  col: number,
  value: string
): string {
  const r = Math.max(1, Math.floor(row) + 1)
  const c = Math.max(1, Math.floor(col) + 1)
  const tail = sliceIndices.length === 0 ? '' : ',' + sliceIndices.map((n) => String(Math.max(1, Math.floor(n)))).join(',')
  return `${name}(${r},${c}${tail}) = ${value};`
}

/**
 * Validate that a user-entered cell value parses as a finite number. Returns
 * a canonical string form (trimmed) or null if invalid. Accepts decimal,
 * signed, exponential, and the "-" leading sign.
 */
export function normalizeNumericInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  // Allow simple scalar arithmetic? No — keep strict to avoid code injection.
  if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  return trimmed
}

/**
 * Parse an Octave `disp(matrix)` output back into a rows×cols grid of string
 * tokens. Extracted from VariableInspectorDialog so it can be unit-tested.
 */
export function parseMatrixOutput(output: string, rows: number, cols: number): MatrixData {
  const values: string[][] = []
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('ans'))

  for (const line of lines) {
    if (/^Columns?\s+\d+/.test(line)) continue
    const nums = line.split(/\s+/).filter((s) => s.length > 0)
    if (nums.length > 0) values.push(nums)
  }

  if (values.length > rows) {
    const assembled: string[][] = Array.from({ length: rows }, () => [] as string[])
    let rowIdx = 0
    for (const row of values) {
      assembled[rowIdx].push(...row)
      rowIdx++
      if (rowIdx >= rows) rowIdx = 0
    }
    return { rows, cols, values: assembled }
  }

  const padded = values.map((row) => {
    while (row.length < cols) row.push('')
    return row.slice(0, cols)
  })
  while (padded.length < rows) {
    padded.push(Array(cols).fill(''))
  }

  return { rows, cols, values: padded.slice(0, rows) }
}

/**
 * Undo stack entry — stores what the cell WAS before the edit so we can
 * rewrite it back on undo. Kept variable-scoped (keyed by variable name) by
 * the caller so multiple open variables each get their own stack.
 */
export interface VariableEditRecord {
  sliceIndices: number[]
  row: number
  col: number
  /** The cell value BEFORE the edit, as a normalized numeric string. */
  previousValue: string
  /** The cell value AFTER the edit, as a normalized numeric string. */
  newValue: string
}

export interface VariableUndoState {
  history: VariableEditRecord[]
  /** Index in history of the "next-to-undo" entry. When 0, nothing to undo. */
  cursor: number
}

export function createEmptyUndoState(): VariableUndoState {
  return { history: [], cursor: 0 }
}

/**
 * Push a new edit onto the undo stack. If the cursor is currently mid-history
 * (the user undid N steps and then made a fresh edit), the discarded tail is
 * trimmed so redo can no longer reach it.
 */
export function pushEdit(
  state: VariableUndoState,
  record: VariableEditRecord
): VariableUndoState {
  const trimmedHistory = state.history.slice(0, state.cursor)
  trimmedHistory.push(record)
  return { history: trimmedHistory, cursor: trimmedHistory.length }
}

export function canUndo(state: VariableUndoState): boolean {
  return state.cursor > 0
}

export function canRedo(state: VariableUndoState): boolean {
  return state.cursor < state.history.length
}

/**
 * Return the record that should be undone + the new state WITHOUT actually
 * applying the command (callers run the Octave assign themselves). Returns
 * null if there's nothing to undo.
 */
export function undoStep(
  state: VariableUndoState
): { record: VariableEditRecord; next: VariableUndoState } | null {
  if (!canUndo(state)) return null
  const record = state.history[state.cursor - 1]
  return {
    record,
    next: { history: state.history, cursor: state.cursor - 1 },
  }
}

export function redoStep(
  state: VariableUndoState
): { record: VariableEditRecord; next: VariableUndoState } | null {
  if (!canRedo(state)) return null
  const record = state.history[state.cursor]
  return {
    record,
    next: { history: state.history, cursor: state.cursor + 1 },
  }
}
