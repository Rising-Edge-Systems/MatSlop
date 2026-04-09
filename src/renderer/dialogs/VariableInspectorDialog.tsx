import { useState, useEffect, useCallback } from 'react'

export interface InspectedVariable {
  name: string
  size: string
  class: string
}

interface VariableInspectorDialogProps {
  variable: InspectedVariable
  onClose: () => void
}

interface MatrixData {
  rows: number
  cols: number
  values: string[][]
}

interface StructData {
  fields: { key: string; value: string }[]
}

function parseMatrixOutput(output: string, rows: number, cols: number): MatrixData {
  const values: string[][] = []
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('ans'))

  for (const line of lines) {
    // Skip column header lines like "Columns 1 through 6:"
    if (/^Columns?\s+\d+/.test(line)) continue
    const nums = line.split(/\s+/).filter((s) => s.length > 0)
    if (nums.length > 0) {
      values.push(nums)
    }
  }

  // For wide matrices, Octave prints in column groups — reassemble rows
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

  // Pad rows to expected cols
  const padded = values.map((row) => {
    while (row.length < cols) row.push('')
    return row.slice(0, cols)
  })
  // Pad to expected rows
  while (padded.length < rows) {
    padded.push(Array(cols).fill(''))
  }

  return { rows, cols, values: padded.slice(0, rows) }
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

function parseDimensions(size: string): { rows: number; cols: number } {
  const parts = size.split('x').map((s) => parseInt(s, 10))
  return { rows: parts[0] || 1, cols: parts[1] || 1 }
}

function MatrixView({
  variable,
  data,
  onCellEdit,
}: {
  variable: InspectedVariable
  data: MatrixData
  onCellEdit: (row: number, col: number, value: string) => void
}): React.JSX.Element {
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
  const [editValue, setEditValue] = useState('')

  const handleDoubleClick = (row: number, col: number, currentValue: string) => {
    setEditingCell({ row, col })
    setEditValue(currentValue)
  }

  const handleEditSubmit = () => {
    if (editingCell && editValue.trim()) {
      onCellEdit(editingCell.row, editingCell.col, editValue.trim())
    }
    setEditingCell(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSubmit()
    } else if (e.key === 'Escape') {
      setEditingCell(null)
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
      <div className="vi-matrix-scroll">
        <table className="vi-matrix-table">
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

export default function VariableInspectorDialog({
  variable,
  onClose,
}: VariableInspectorDialogProps): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null)
  const [structData, setStructData] = useState<StructData | null>(null)
  const [stringValue, setStringValue] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { rows, cols } = parseDimensions(variable.size)
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
        const result = await window.matslop.octaveExecute(`disp(${variable.name})`)
        if (result.error) {
          setError(result.error)
        } else {
          setMatrixData(parseMatrixOutput(result.output || '', rows, cols))
        }
      } else {
        // For cell arrays and other types, just show disp output
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
  }, [variable, rows, cols, isNumericMatrix])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleCellEdit = useCallback(
    async (row: number, col: number, value: string) => {
      const escapedName = variable.name
      const cmd = `${escapedName}(${row + 1},${col + 1}) = ${value};`
      try {
        const result = await window.matslop.octaveExecute(cmd)
        if (result.error) {
          setError(result.error)
        } else {
          // Refresh matrix data
          fetchData()
        }
      } catch {
        setError('Failed to update variable')
      }
    },
    [variable.name, fetchData]
  )

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
      }
    },
    [onClose]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="vi-overlay" onClick={handleOverlayClick}>
      <div className="vi-dialog">
        <div className="vi-header">
          <div className="vi-title">
            <span className="vi-var-name">{variable.name}</span>
            <span className="vi-var-meta">
              {variable.size} {variable.class}
            </span>
          </div>
          <button className="vi-close-btn" onClick={onClose} title="Close">
            &times;
          </button>
        </div>
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
