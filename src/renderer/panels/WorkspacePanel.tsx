import { useState, useEffect, useCallback, useRef } from 'react'
import PanelHeader from './PanelHeader'
import type { OctaveEngineStatus } from '../App'

interface WorkspaceVariable {
  name: string
  size: string
  bytes: number
  class: string
  value: string
}

interface WorkspacePanelProps {
  onCollapse: () => void
  engineStatus: OctaveEngineStatus
  refreshTrigger: number
}

function parseWhosOutput(output: string): WorkspaceVariable[] {
  const variables: WorkspaceVariable[] = []
  const lines = output.split('\n')

  // whos output format:
  // Variables visible from the current scope:
  //
  // variables in scope: top scope
  //
  //   Attr Name        Size                     Bytes  Class
  //   ==== ====        ====                     =====  =====
  //        x           1x1                          8  double
  //        y           1x3                         24  double
  //
  // Total is 4 elements using 32 bytes

  let inTable = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Attr') && trimmed.includes('Name') && trimmed.includes('Size')) {
      inTable = true
      continue
    }
    if (trimmed.startsWith('====')) continue
    if (trimmed.startsWith('Total is')) break
    if (trimmed === '') {
      if (inTable) continue
      continue
    }
    if (!inTable) continue

    // Parse variable line: optional attr, name, size, bytes, class
    // Format: "     x           1x1                          8  double"
    const match = trimmed.match(/^([a-z]*)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)$/)
    if (match) {
      variables.push({
        name: match[2],
        size: match[3],
        bytes: parseInt(match[4], 10),
        class: match[5],
        value: '',
      })
    }
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

function WorkspacePanel({ onCollapse, engineStatus, refreshTrigger }: WorkspacePanelProps): React.JSX.Element {
  const [variables, setVariables] = useState<WorkspaceVariable[]>([])
  const [sortColumn, setSortColumn] = useState<'name' | 'size' | 'class'>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const refreshingRef = useRef(false)

  const refreshWorkspace = useCallback(async () => {
    if (engineStatus !== 'ready' || refreshingRef.current) return
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
    } catch {
      // ignore errors during refresh
    } finally {
      refreshingRef.current = false
    }
  }, [engineStatus])

  // Refresh on trigger change (after commands execute)
  useEffect(() => {
    if (refreshTrigger > 0) {
      refreshWorkspace()
    }
  }, [refreshTrigger, refreshWorkspace])

  // Refresh when engine becomes ready
  useEffect(() => {
    if (engineStatus === 'ready') {
      refreshWorkspace()
    } else if (engineStatus === 'disconnected') {
      setVariables([])
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
    <div className="panel workspace-panel">
      <PanelHeader title="Workspace" onCollapse={onCollapse} />
      <div className="panel-content ws-content">
        {variables.length === 0 ? (
          <p className="placeholder-text">
            {engineStatus === 'disconnected'
              ? 'Octave not connected'
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
                <tr key={v.name} className="ws-row">
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
