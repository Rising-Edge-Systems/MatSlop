import { useState, useEffect, useCallback, useRef } from 'react'
import {
  parseDimensionString,
  extraDimensionCount,
  buildSliceDispCommand,
  buildCellAssignCommand,
  normalizeNumericInput,
  parseMatrixOutput,
  createEmptyUndoState,
  pushEdit,
  canUndo,
  canRedo,
  undoStep,
  redoStep,
  type MatrixData,
  type VariableUndoState,
} from './variableEditorCore'

export interface InspectedVariable {
  name: string
  size: string
  class: string
}

interface VariableInspectorDialogProps {
  variable: InspectedVariable
  onClose: () => void
}

interface StructData {
  fields: { key: string; value: string }[]
}

function parseStructOutput(output: string): StructData {
  const fields: { key: string; value: string }[] = []
  const lines = output.split('\n')
  for (const line of lines) {
    const match = line.match(/^\s*(\w+)\s*[:=]\s*(.*)$/)
    if (match) {
      fields.push({ key: match[1], value: match[2].trim() })
    }
  }
  return { fields }
}

function MatrixView({
  variable,
  data,
  onCellEdit,
}: {
  variable: InspectedVariable
  data: MatrixData
  onCellEdit: (row: number, col: number, value: string, previousValue: string) => void
}): React.JSX.Element {
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [cellError, setCellError] = useState<string | null>(null)

  const handleDoubleClick = (row: number, col: number, currentValue: string) => {
    setEditingCell({ row, col })
    setEditValue(currentValue)
    setCellError(null)
  }

  const handleEditSubmit = () => {
    if (!editingCell) return
    const normalized = normalizeNumericInput(editValue)
    if (normalized === null) {
      setCellError('Invalid numeric value')
      return
    }
    const previous = data.values[editingCell.row]?.[editingCell.col] ?? '0'
    onCellEdit(editingCell.row, editingCell.col, normalized, previous)
    setEditingCell(null)
    setCellError(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSubmit()
    } else if (e.key === 'Escape') {
      setEditingCell(null)
      setCellError(null)
    }
  }

  // Limit display to reasonable size for performance
  const maxDisplay = 50
  const displayRows = Math.min(data.rows, maxDisplay)
  const displayCols = Math.min(data.cols, maxDisplay)
  const isTruncated = data.rows > maxDisplay || data.cols > maxDisplay

  return (
    <div className="vi-matrix-container">
      {isTruncated && (
        <div className="vi-truncated-notice">
          Showing {displayRows}x{displayCols} of {variable.size}
        </div>
      )}
      {cellError && (
        <div className="vi-cell-error" data-testid="vi-cell-error">
          {cellError}
        </div>
      )}
      <div className="vi-matrix-scroll">
        <table className="vi-matrix-table" data-testid="vi-matrix-table">
          <thead>
            <tr>
              <th className="vi-matrix-corner"></th>
              {Array.from({ length: displayCols }, (_, i) => (
                <th key={i} className="vi-matrix-col-header">
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.values.slice(0, displayRows).map((row, ri) => (
              <tr key={ri}>
                <td className="vi-matrix-row-header">{ri + 1}</td>
                {row.slice(0, displayCols).map((val, ci) => (
                  <td
                    key={ci}
                    className="vi-matrix-cell"
                    data-row={ri}
                    data-col={ci}
                    onDoubleClick={() => handleDoubleClick(ri, ci, val)}
                  >
                    {editingCell?.row === ri && editingCell?.col === ci ? (
                      <input
                        className="vi-matrix-cell-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleEditSubmit}
                        onKeyDown={handleEditKeyDown}
                        autoFocus
                      />
                    ) : (
                      val
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StructView({ data }: { data: StructData }): React.JSX.Element {
  return (
    <div className="vi-struct-container">
      <table className="vi-struct-table">
        <thead>
          <tr>
            <th className="vi-struct-th">Field</th>
            <th className="vi-struct-th">Value</th>
          </tr>
        </thead>
        <tbody>
          {data.fields.map((f) => (
            <tr key={f.key} className="vi-struct-row">
              <td className="vi-struct-key">{f.key}</td>
              <td className="vi-struct-value">{f.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StringView({
  value,
  variable,
  onEdit,
}: {
  value: string
  variable: InspectedVariable
  onEdit: (newValue: string) => void
}): React.JSX.Element {
  const [text, setText] = useState(value)
  const [dirty, setDirty] = useState(false)

  const handleApply = () => {
    onEdit(text)
    setDirty(false)
  }

  return (
    <div className="vi-string-container">
      <textarea
        className="vi-string-textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        rows={8}
      />
      {dirty && (
        <div className="vi-string-actions">
          <button className="vi-btn vi-btn-primary" onClick={handleApply}>
            Apply to {variable.name}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Slice selector UI for 3D+ variables — one number input per trailing
 * dimension. Values are 1-based to match Octave conventions and what the
 * `buildSliceDispCommand` helper emits.
 */
function SliceSelector({
  dims,
  sliceIndices,
  onChange,
}: {
  dims: number[]
  sliceIndices: number[]
  onChange: (indices: number[]) => void
}): React.JSX.Element | null {
  const extra = extraDimensionCount(dims)
  if (extra === 0) return null

  const trailing = dims.slice(2)
  return (
    <div className="vi-slice-selector" data-testid="vi-slice-selector">
      <span className="vi-slice-label">Slice:</span>
      <span className="vi-slice-prefix">(:, :,</span>
      {trailing.map((max, i) => (
        <span key={i} className="vi-slice-dim">
          <input
            type="number"
            className="vi-slice-input"
            data-testid={`vi-slice-input-${i}`}
            min={1}
            max={max}
            value={sliceIndices[i] ?? 1}
            onChange={(e) => {
              const next = [...sliceIndices]
              const n = parseInt(e.target.value, 10)
              next[i] = Number.isFinite(n) && n >= 1 && n <= max ? n : 1
              onChange(next)
            }}
          />
          {i < trailing.length - 1 && <span>,</span>}
          <span className="vi-slice-max"> / {max}</span>
        </span>
      ))}
      <span className="vi-slice-suffix">)</span>
    </div>
  )
}

export default function VariableInspectorDialog({
  variable,
  onClose,
}: VariableInspectorDialogProps): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null)
  const [structData, setStructData] = useState<StructData | null>(null)
  const [stringValue, setStringValue] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dims = parseDimensionString(variable.size)
  const rows = dims[0]
  const cols = dims[1]
  const extraDims = extraDimensionCount(dims)

  const [sliceIndices, setSliceIndices] = useState<number[]>(() =>
    Array.from({ length: extraDims }, () => 1)
  )

  const [undoState, setUndoState] = useState<VariableUndoState>(() => createEmptyUndoState())
  // Mirror into a ref so ephemeral event callbacks see the latest state
  // without having to re-bind on every change.
  const undoStateRef = useRef(undoState)
  undoStateRef.current = undoState

  const isNumericMatrix =
    ['double', 'single', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'logical'].includes(
      variable.class
    )

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      if (variable.class === 'struct') {
        const result = await window.matslop.octaveExecute(`disp(${variable.name})`)
        if (result.error) {
          setError(result.error)
        } else {
          setStructData(parseStructOutput(result.output || ''))
        }
      } else if (variable.class === 'char') {
        const result = await window.matslop.octaveExecute(`disp(${variable.name})`)
        if (result.error) {
          setError(result.error)
        } else {
          setStringValue(result.output?.trim() || '')
        }
      } else if (isNumericMatrix) {
        const cmd = buildSliceDispCommand(variable.name, sliceIndices)
        const result = await window.matslop.octaveExecute(cmd)
        if (result.error) {
          setError(result.error)
        } else {
          setMatrixData(parseMatrixOutput(result.output || '', rows, cols))
        }
      } else {
        const result = await window.matslop.octaveExecute(`disp(${variable.name})`)
        if (result.error) {
          setError(result.error)
        } else {
          setStringValue(result.output?.trim() || '')
        }
      }
    } catch {
      setError('Failed to fetch variable data')
    } finally {
      setLoading(false)
    }
  }, [variable, rows, cols, isNumericMatrix, sliceIndices])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const applyAssign = useCallback(
    async (row: number, col: number, value: string, slice: number[]): Promise<boolean> => {
      const cmd = buildCellAssignCommand(variable.name, slice, row, col, value)
      try {
        const result = await window.matslop.octaveExecute(cmd)
        if (result.error) {
          setError(result.error)
          return false
        }
        return true
      } catch {
        setError('Failed to update variable')
        return false
      }
    },
    [variable.name]
  )

  const handleCellEdit = useCallback(
    async (row: number, col: number, newValue: string, previousValue: string) => {
      const ok = await applyAssign(row, col, newValue, sliceIndices)
      if (!ok) return
      setUndoState((prev) =>
        pushEdit(prev, {
          sliceIndices: [...sliceIndices],
          row,
          col,
          previousValue,
          newValue,
        })
      )
      fetchData()
    },
    [applyAssign, sliceIndices, fetchData]
  )

  const handleUndo = useCallback(async () => {
    const step = undoStep(undoStateRef.current)
    if (!step) return
    const ok = await applyAssign(step.record.row, step.record.col, step.record.previousValue, step.record.sliceIndices)
    if (!ok) return
    setUndoState(step.next)
    fetchData()
  }, [applyAssign, fetchData])

  const handleRedo = useCallback(async () => {
    const step = redoStep(undoStateRef.current)
    if (!step) return
    const ok = await applyAssign(step.record.row, step.record.col, step.record.newValue, step.record.sliceIndices)
    if (!ok) return
    setUndoState(step.next)
    fetchData()
  }, [applyAssign, fetchData])

  const handleStringEdit = useCallback(
    async (newValue: string) => {
      const escaped = newValue.replace(/'/g, "''")
      const cmd = `${variable.name} = '${escaped}';`
      try {
        const result = await window.matslop.octaveExecute(cmd)
        if (result.error) {
          setError(result.error)
        }
      } catch {
        setError('Failed to update variable')
      }
    },
    [variable.name]
  )

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void handleUndo()
        return
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
      ) {
        e.preventDefault()
        void handleRedo()
        return
      }
    },
    [onClose, handleUndo, handleRedo]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Also expose the undo state on a global test hook so Playwright tests can
  // drive the undo stack without synthesizing real edits against a running
  // Octave process.
  useEffect(() => {
    ;(window as unknown as { __matslopVariableEditor?: unknown }).__matslopVariableEditor = {
      undoCount: undoState.cursor,
      historyLength: undoState.history.length,
      canUndo: canUndo(undoState),
      canRedo: canRedo(undoState),
    }
    return () => {
      delete (window as unknown as { __matslopVariableEditor?: unknown }).__matslopVariableEditor
    }
  }, [undoState])

  return (
    <div className="vi-overlay" onClick={handleOverlayClick} data-testid="variable-inspector">
      <div className="vi-dialog">
        <div className="vi-header">
          <div className="vi-title">
            <span className="vi-var-name">{variable.name}</span>
            <span className="vi-var-meta">
              {variable.size} {variable.class}
            </span>
          </div>
          <div className="vi-header-actions">
            {isNumericMatrix && (
              <>
                <button
                  className="vi-btn vi-btn-undo"
                  data-testid="vi-undo"
                  disabled={!canUndo(undoState)}
                  onClick={() => void handleUndo()}
                  title="Undo (Ctrl+Z)"
                >
                  Undo
                </button>
                <button
                  className="vi-btn vi-btn-redo"
                  data-testid="vi-redo"
                  disabled={!canRedo(undoState)}
                  onClick={() => void handleRedo()}
                  title="Redo (Ctrl+Y)"
                >
                  Redo
                </button>
              </>
            )}
            <button className="vi-close-btn" onClick={onClose} title="Close">
              &times;
            </button>
          </div>
        </div>
        {isNumericMatrix && extraDims > 0 && (
          <SliceSelector dims={dims} sliceIndices={sliceIndices} onChange={setSliceIndices} />
        )}
        <div className="vi-body">
          {loading && <div className="vi-loading">Loading...</div>}
          {error && <div className="vi-error">{error}</div>}
          {!loading && !error && matrixData && (
            <MatrixView variable={variable} data={matrixData} onCellEdit={handleCellEdit} />
          )}
          {!loading && !error && structData && <StructView data={structData} />}
          {!loading && !error && stringValue !== null && !matrixData && !structData && (
            variable.class === 'char' ? (
              <StringView value={stringValue} variable={variable} onEdit={handleStringEdit} />
            ) : (
              <div className="vi-generic-output">
                <pre className="vi-generic-pre">{stringValue}</pre>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
