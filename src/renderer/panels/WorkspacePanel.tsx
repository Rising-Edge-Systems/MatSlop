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

/**
 * US-S04: Unified value-preview formatter for the Workspace panel.
 *
 * Rules:
 *   • Scalars (size === '1x1' and a numeric class): parse the numeric value
 *     and render with 6 significant digits via `toPrecision(6)`, trimming
 *     trailing zeros (3.14159, 1.00000e-5 → 1e-5, 42). Booleans render as
 *     'true'/'false'. If parsing fails, fall back to the raw trimmed token.
 *   • Strings (cls === 'char' OR 'string'): render the string truncated at
 *     20 characters with an ellipsis ('abcdefghijabcdefghij...').
 *   • Everything else (matrices, structs, cells, objects): '[RxC class]'.
 */
export function formatValuePreview(variable: WorkspaceVariable, valueOutput: string): string {
  const { size, class: cls } = variable

  // Strings first — a 1x3 char is still a string, not a "scalar".
  if (cls === 'char' || cls === 'string') {
    const raw = extractValueToken(valueOutput)
    if (raw === null) return `[${size} ${cls}]`
    // Octave wraps char output in double quotes for `disp` sometimes; strip.
    const stripped = raw.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1')
    return truncateString(stripped, 20)
  }

  // Struct/cell/object are never rendered as scalars even at size 1x1 —
  // their "value" is not a single number, so show the uniform dim+class.
  const nonScalarClasses = new Set(['struct', 'cell', 'function_handle', 'object', 'class'])
  if (nonScalarClasses.has(cls)) {
    return `[${size} ${cls}]`
  }

  // Scalar numeric / logical
  if (size === '1x1') {
    const raw = extractValueToken(valueOutput)
    if (raw === null) return `[${size} ${cls}]`

    if (cls === 'logical') {
      if (raw === '1' || raw.toLowerCase() === 'true') return 'true'
      if (raw === '0' || raw.toLowerCase() === 'false') return 'false'
      return raw
    }

    const num = Number(raw)
    if (Number.isFinite(num)) {
      return formatNumber(num)
    }
    // Non-finite words Octave emits: Inf, -Inf, NaN
    return raw
  }

  // Non-scalar: uniform [RxC class] for matrices, structs, cells, objects.
  return `[${size} ${cls}]`
}

/**
 * Extracts the value body from a `disp` / display output. Octave's `disp`
 * typically emits a bare value ("42\n"), while `display(x)` emits "x = 42".
 * Strings may arrive as `ans = abc` or just `abc`.
 */
function extractValueToken(valueOutput: string): string | null {
  if (!valueOutput) return null
  const trimmed = valueOutput.trim()
  if (trimmed === '') return null
  // "name = <value>" — take the RHS, which may span multiple lines.
  const eq = trimmed.indexOf('=')
  if (eq >= 0) {
    const rhs = trimmed.slice(eq + 1).trim()
    if (rhs !== '') return rhs
  }
  return trimmed
}

/** Truncate a string to `max` visible chars, appending '...' when cut. */
function truncateString(str: string, max: number): string {
  if (str.length <= max) return str
  return str.substring(0, max) + '...'
}

/**
 * Render a finite number with 6 significant digits. Trims trailing
 * zeros in both fixed and exponential forms so scalars display cleanly
 * (3.14159 not 3.14159, 1e-5 not 1.00000e-5, 42 not 42.0000).
 */
function formatNumber(n: number): string {
  if (n === 0) return '0'
  const abs = Math.abs(n)
  // Use exponential for very small or very large magnitudes so the preview
  // cell doesn't show "0.00001" or "1234570". toPrecision(6) picks its own
  // exponential threshold (abs<1e-6) so we force it via toExponential(5).
  let precision: string
  if (abs < 1e-4 || abs >= 1e6) {
    precision = n.toExponential(5)
  } else {
    precision = n.toPrecision(6)
  }
  // Exponential form: "1.00000e-5" → "1e-5"
  if (/e/i.test(precision)) {
    const [mantissa, exp] = precision.split(/e/i)
    const trimmedMantissa = mantissa.includes('.')
      ? mantissa.replace(/0+$/, '').replace(/\.$/, '')
      : mantissa
    // Normalise "e+5" → "e+5" (keep sign), "e-05" → "e-5" (strip leading 0s).
    const normExp = exp.replace(/^([+-]?)0+(\d)/, '$1$2')
    return `${trimmedMantissa}e${normExp}`
  }
  // Fixed form: trim trailing zeros after the decimal point.
  if (precision.includes('.')) {
    return precision.replace(/0+$/, '').replace(/\.$/, '')
  }
  return precision
}

function WorkspacePanel({ onCollapse, engineStatus, refreshTrigger, onInspectVariable, onVariablesChanged, debugPaused = false, debugFrameName = null }: WorkspacePanelProps): React.JSX.Element {
  const [variables, setVariables] = useState<WorkspaceVariable[]>([])
  const [sortColumn, setSortColumn] = useState<'name' | 'size' | 'class'>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const refreshingRef = useRef(false)
  const pendingRefreshRef = useRef(false)
  const refreshSeqRef = useRef(0)
  const engineStatusRef = useRef<OctaveEngineStatus>(engineStatus)
  const onVariablesChangedRef = useRef(onVariablesChanged)
  engineStatusRef.current = engineStatus
  onVariablesChangedRef.current = onVariablesChanged

  // Coalesced refresh: if a refresh is already in flight, remember that
  // another one is wanted and run it once the current one finishes.
  // Without this, rapid-fire refresh triggers (typing commands quickly)
  // get silently dropped and the panel shows stale state from the first
  // completed refresh — e.g. only `ans` after `clear all; x=1; y=2;`.
  const refreshWorkspace = useCallback(async () => {
    // Fall back to the live IPC status if the ref has not caught up yet —
    // on a fast mount the first refreshTrigger effect can fire before
    // App.tsx's octaveStatus has propagated down into props.
    if (engineStatusRef.current !== 'ready') {
      try {
        const live = await window.matslop.octaveGetStatus()
        if (live === 'ready') {
          engineStatusRef.current = 'ready'
        } else {
          return
        }
      } catch {
        return
      }
    }
    // Each refresh captures a unique id; a later refresh supersedes any
    // earlier one whose result has not yet been committed to state. We
    // still track an in-flight flag but do not use it to block new
    // refreshes — instead we let them race and the latest `seq` wins.
    refreshSeqRef.current += 1
    const mySeq = refreshSeqRef.current
    refreshingRef.current = true

    try {
      // Race the whos IPC against a 1.5s timeout so a genuine process-manager
      // stall (seen on the very first refresh after some HMR reloads) does
      // not freeze the panel.
      const whosWithTimeout = async (): Promise<{ output: string; error: string; isComplete: boolean }> => {
        return Promise.race([
          window.matslop.octaveExecute('whos'),
          new Promise<{ output: string; error: string; isComplete: boolean }>((resolve) =>
            setTimeout(() => resolve({ output: '', error: 'timeout', isComplete: true }), 1500),
          ),
        ])
      }
      let result = await whosWithTimeout()
      for (let attempt = 0; attempt < 3 && (!result.output || result.output.trim() === ''); attempt++) {
        await new Promise<void>((r) => setTimeout(r, 120))
        result = await whosWithTimeout()
      }
      // If a later refresh has already been started, drop our result.
      if (mySeq !== refreshSeqRef.current) return
      if (!result.output || result.output.trim() === '') {
        if (mySeq !== refreshSeqRef.current) return
        setVariables([])
        onVariablesChangedRef.current?.([])
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

      // Drop stale result if superseded
      if (mySeq !== refreshSeqRef.current) return
      setVariables(varsWithValues)
      onVariablesChangedRef.current?.(varsWithValues.map((v) => ({ name: v.name, size: v.size, class: v.class })))
    } catch {
      // ignore errors during refresh
    } finally {
      // Only the latest refresh clears the in-flight flag.
      if (mySeq === refreshSeqRef.current) {
        refreshingRef.current = false
      }
    }
  }, [])

  // Refresh on any trigger change (after commands execute). Previously
  // guarded on `refreshTrigger > lastTriggerRef.current`, which dropped
  // refreshes whenever React batched several rapid setWorkspaceRefreshTrigger
  // calls into a single re-render — the useEffect saw a multi-step jump but
  // only ran once, and the in-flight guard ate the coalesced re-run.
  useEffect(() => {
    if (refreshTrigger > 0) {
      refreshWorkspace()
    }
  }, [refreshTrigger, refreshWorkspace])

  // Test hook: expose a direct refresh call so Playwright and hand-testing
  // can sync the panel to Octave state without waiting for a command cycle.
  // Gated on `import.meta.env.DEV` so Vite's define-plugin + tree-shaking
  // strips the entire block (including the hook-name string literals) from
  // production bundles. US-T03.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as {
      __matslopRefreshWorkspace?: () => Promise<void>
      __matslopResetWsGuard?: () => void
      __matslopWsRefs?: { refreshing: boolean; pending: boolean }
    }
    w.__matslopRefreshWorkspace = async () => {
      await refreshWorkspace()
    }
    w.__matslopResetWsGuard = () => {
      refreshingRef.current = false
      pendingRefreshRef.current = false
    }
    w.__matslopWsRefs = {
      get refreshing() {
        return refreshingRef.current
      },
      get pending() {
        return pendingRefreshRef.current
      },
    } as { refreshing: boolean; pending: boolean }
    return () => {
      const ww = window as unknown as {
        __matslopRefreshWorkspace?: unknown
        __matslopResetWsGuard?: unknown
        __matslopWsRefs?: unknown
      }
      ww.__matslopRefreshWorkspace = undefined
      ww.__matslopResetWsGuard = undefined
      ww.__matslopWsRefs = undefined
    }
  }, [refreshWorkspace])

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
