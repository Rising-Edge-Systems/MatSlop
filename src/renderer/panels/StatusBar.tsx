import type { OctaveEngineStatus } from '../App'

export interface CursorPosition {
  line: number
  column: number
}

interface StatusBarProps {
  cwd: string
  engineStatus: OctaveEngineStatus
  cursorPosition: CursorPosition | null
  errorCount?: number
  /** US-016: surface "Debug: paused" when Octave is stopped at a breakpoint. */
  debugPaused?: boolean
  /**
   * US-S02: When true, the status bar shows "Running…" instead of
   * "Ready"/"Busy". Driven by the ref-counted `octaveBusyTracker` in the
   * renderer so the indicator only appears once a command has been in
   * flight for ~250ms. Takes precedence over `engineStatus` for the label
   * (but not for the `disconnected` state — if Octave is gone we still
   * show that).
   */
  running?: boolean
}

const statusLabels: Record<OctaveEngineStatus, string> = {
  ready: 'Ready',
  busy: 'Busy',
  disconnected: 'Disconnected',
}

const statusColors: Record<OctaveEngineStatus, string> = {
  ready: '#4ec9b0',
  busy: '#dcdcaa',
  disconnected: '#f48771',
}

const RUNNING_LABEL = 'Running…'
const RUNNING_COLOR = '#dcdcaa'

function StatusBar({ cwd, engineStatus, cursorPosition, errorCount = 0, debugPaused = false, running = false }: StatusBarProps): React.JSX.Element {
  const showRunning = running && engineStatus !== 'disconnected'
  const label = showRunning ? RUNNING_LABEL : statusLabels[engineStatus]
  const color = showRunning ? RUNNING_COLOR : statusColors[engineStatus]
  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <span className="status-bar-item status-bar-cwd" title={cwd}>
          {cwd}
        </span>
        {debugPaused && (
          <span
            className="status-bar-item status-bar-debug-paused"
            data-testid="status-debug-paused"
          >
            <span className="status-dot" style={{ backgroundColor: '#4caf50' }} />
            Debug: paused
          </span>
        )}
      </div>
      <div className="status-bar-right">
        {errorCount > 0 && (
          <span className="status-bar-item status-bar-errors">
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        )}
        <span
          className="status-bar-item"
          data-testid="engine-status"
          data-running={showRunning ? 'true' : 'false'}
        >
          <span
            className="status-dot"
            style={{ backgroundColor: color }}
          />
          {label}
        </span>
        {cursorPosition && (
          <span className="status-bar-item">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
        )}
        <span className="status-bar-item">UTF-8</span>
      </div>
    </div>
  )
}

export default StatusBar
