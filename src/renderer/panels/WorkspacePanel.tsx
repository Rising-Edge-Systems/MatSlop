import { useState, useEffect, useCallback, useRef } from 'react'
import type { OctaveEngineStatus } from '../App'

interface WorkspaceVariable {
  name: string
  size: string
  bytes: number
  class: string
  value: string
}

export type { WorkspaceVariable }

export interface WorkspacePanelProps {
  onCollapse: () => void
  engineStatus: OctaveEngineStatus
  refreshTrigger: number
  onInspectVariable?: (variable: { name: string; size: string; class: string }) => void
  onVariablesChanged?: (variables: Array<{ name: string; size: string; class: string }>) => void
  /** US-019: True when Octave is paused in the debugger. When true the
   * panel surfaces a "Debug scope" indicator so the user knows `whos` is
   * reporting locals of the paused stack frame, not the top workspace. */
  debugPaused?: boolean
  /** US-019: Optional function / script name of the currently selected
   * call-stack frame — used purely for display alongside the debug-scope
   * indicator. `null` renders a generic "Debug frame" label. */
  debugFrameName?: string | null
}

export function parseWhosOutput(output: string): WorkspaceVariable[] {
  const variables: WorkspaceVariable[] = []
  const lines = output.split('\n')

  // whos output format (Octave):
  //
  //   Attr   Name              Size                     Bytes  Class
  //   ====   ====              ====                     =====  =====
  //          wspace_var_1      1x1                          8  double
  //     g    globalvar         1x1                          8  double
  //
  // The Attr column may be empty (no attributes) or contain single letters
  // like "g" (global) or "p" (persistent). Columns are space-separated.

  let inTable = false
  let attrCol = -1
  let nameCol = -1

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Attr') && trimmed.includes('Name') && trimmed.includes('Size')) {
      inTable = true
      attrCol = line.indexOf('Attr')
      nameCol = line.indexOf('Name')
      continue
    }
    if (trimmed.startsWith('====')) continue
    if (trimmed.startsWith('Total is')) break
    if (!inTable) continue
    if (trimmed === '') continue

    // Use column positions to detect attrs, then split remaining by whitespace.
    // The attr column width is (nameCol - attrCol). If the region before nameCol
    // is all whitespace, there are no attributes for this row.
    let rest = line
    if (attrCol >= 0 && nameCol > attrCol && line.length >= nameCol) {
      rest = line.substring(nameCol)
    } else {
      rest = trimmed
    }

    const tokens = rest.trim().split(/\s+/)
    // Expect at least: name, size, bytes, class
    if (tokens.length < 4) continue
    const name = tokens[0]
    const size = tokens[1]
    const bytesStr = tokens[2]
    const cls = tokens.slice(3).join(' ')
    const bytes = parseInt(bytesStr, 10)
    if (isNaN(bytes)) continue

    variables.push({
      name,
      size,
      bytes,
      class: cls,
      value: '',
    })
  }

  return variables
}

function formatValuePreview(variable: WorkspaceVariable, valueOutput: string): string {
  const { size, class: cls } = variable

  // Check if it's a scalar (1x1)
  if (size === '1x1') {
    // Extract the value from the output
    // Output format: "ans = 42" or just "42"
    const match = valueOutput.match(/=\s*(.+)/) ?? valueOutput.match(/^\s*(.+)\s*$/m)
    if (match) {
      return match[1].trim()
    }
    return valueOutput.trim()
  }

  // For strings (1xN char or string)
  if (cls === 'char') {
    const match = valueOutput.match(/=\s*(.+)/) ?? valueOutput.match(/^\s*(.+)\s*$/m)
    if (match) {
      const str = match[1].trim()
      return str.length > 40 ? str.substring(0, 37) + '...' : str
    }
  }

  // For structs
  if (cls === 'struct') {
    // Count fields from size or show generic
    return `[${size} struct]`
  }

  // For cell arrays
  if (cls === 'cell') {
    return `{${size} cell}`
  }

  // For matrices/vectors, show dimensions
  return `[${size} ${cls}]`
}

function WorkspacePanel({ onCollapse, engineStatus, refreshTrigger, onInspectVariable, onVariablesChanged, debugPaused = false, debugFrameName = null }: WorkspacePanelProps): React.JSX.Element {
  const [variables, setVariables] = useState<WorkspaceVariable[]>([])
  const [sortColumn, setSortColumn] = useState<'name' | 'size' | 'class'>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const refreshingRef = useRef(false)
  const engineStatusRef = useRef<OctaveEngineStatus>(engineStatus)
  const onVariablesChangedRef = useRef(onVariablesChanged)
  engineStatusRef.current = engineStatus
  onVariablesChangedRef.current = onVariablesChanged

  const refreshWorkspace = useCallback(async () => {
    if (engineStatusRef.current !== 'ready' || refreshingRef.current) return
    refreshingRef.current = true

    try {
      const result = await window.matslop.octaveExecute('whos')
      if (!result.output || result.output.trim() === '') {
        setVariables([])
        refreshingRef.current = false
        return
      }

      const vars = parseWhosOutput(result.output)

      // Fetch value previews for scalars and small strings
      const varsWithValues = await Promise.all(
        vars.map(async (v) => {
          if (v.size === '1x1' || v.class === 'char') {
            try {
              const valResult = await window.matslop.octaveExecute(`disp(${v.name})`)
              return { ...v, value: formatValuePreview(v, valResult.output || '') }
            } catch {
              return { ...v, value: formatValuePreview(v, '') }
            }
          }
          return { ...v, value: formatValuePreview(v, '') }
        })
      )

      setVariables(varsWithValues)
      onVariablesChangedRef.current?.(varsWithValues.map((v) => ({ name: v.name, size: v.size, class: v.class })))
    } catch {
      // ignore errors during refresh
    } finally {
      refreshingRef.current = false
    }
  }, [])

  // Refresh on trigger change (after commands execute)
  const lastTriggerRef = useRef(refreshTrigger)
  useEffect(() => {
    if (refreshTrigger > lastTriggerRef.current) {
      lastTriggerRef.current = refreshTrigger
      refreshWorkspace()
    }
  }, [refreshTrigger, refreshWorkspace])

  // Refresh once when engine first connects, clear on disconnect
  const prevStatusRef = useRef<OctaveEngineStatus>('disconnected')
  useEffect(() => {
    const wasDisconnected = prevStatusRef.current === 'disconnected'
    prevStatusRef.current = engineStatus
    if (engineStatus === 'ready' && wasDisconnected) {
      refreshWorkspace()
    } else if (engineStatus === 'disconnected') {
      setVariables([])
      onVariablesChangedRef.current?.([])
    }
  }, [engineStatus, refreshWorkspace])

  const handleSort = useCallback((column: 'name' | 'size' | 'class') => {
    setSortColumn((prev) => {
      if (prev === column) {
        setSortAsc((a) => !a)
        return column
      }
      setSortAsc(true)
      return column
    })
  }, [])

  const sortedVariables = [...variables].sort((a, b) => {
    let cmp = 0
    if (sortColumn === 'name') {
      cmp = a.name.localeCompare(b.name)
    } else if (sortColumn === 'size') {
      cmp = a.bytes - b.bytes
    } else if (sortColumn === 'class') {
      cmp = a.class.localeCompare(b.class)
    }
    return sortAsc ? cmp : -cmp
  })

  const sortIndicator = (col: 'name' | 'size' | 'class') =>
    sortColumn === col ? (sortAsc ? ' ▲' : ' ▼') : ''

  return (
    <div
      className={debugPaused ? 'panel workspace-panel ws-debug-scope' : 'panel workspace-panel'}
      data-testid="workspace-panel"
      data-debug-scope={debugPaused ? 'true' : 'false'}
    >
      {debugPaused && (
        <div className="ws-scope-banner" data-testid="workspace-debug-scope">
          <span className="ws-scope-dot" />
          <span className="ws-scope-label">
            Debug scope{debugFrameName ? `: ${debugFrameName}` : ''}
          </span>
        </div>
      )}
      <div className="panel-content ws-content">
        {variables.length === 0 ? (
          <p className="placeholder-text">
            {engineStatus === 'disconnected'
              ? 'Octave not connected'
              : debugPaused
                ? 'No local variables in this frame'
                : 'No variables in workspace'}
          </p>
        ) : (
          <table className="ws-table">
            <thead>
              <tr>
                <th className="ws-th ws-th-sortable" onClick={() => handleSort('name')}>
                  Name{sortIndicator('name')}
                </th>
                <th className="ws-th">Value</th>
                <th className="ws-th ws-th-sortable" onClick={() => handleSort('size')}>
                  Size{sortIndicator('size')}
                </th>
                <th className="ws-th ws-th-sortable" onClick={() => handleSort('class')}>
                  Class{sortIndicator('class')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedVariables.map((v) => (
                <tr
                  key={v.name}
                  className="ws-row"
                  onDoubleClick={() =>
                    onInspectVariable?.({ name: v.name, size: v.size, class: v.class })
                  }
                >
                  <td className="ws-td ws-name">{v.name}</td>
                  <td className="ws-td ws-value">{v.value}</td>
                  <td className="ws-td ws-size">{v.size}</td>
                  <td className="ws-td ws-class">{v.class}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default WorkspacePanel
